# python/rag_service.py

from dotenv import load_dotenv
import os
import logging
import json
from io import BytesIO
from flask import Flask, request, jsonify, Blueprint
import boto3
import faiss
import numpy as np
import pdfplumber
from langchain.text_splitter import RecursiveCharacterTextSplitter
from langchain_huggingface import HuggingFaceEmbeddings
import tempfile

# Create a blueprint for RAG routes
rag_bp = Blueprint("rag", __name__)

# Load environment variables
load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s",
    handlers=[
        logging.FileHandler("rag_service.log"),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)

# Global caching of the embeddings model
embeddings_model = HuggingFaceEmbeddings(model_name="BAAI/bge-large-en")

# AWS S3 Configuration
S3_BUCKET = os.getenv("AWS_S3_BUCKET", "essaybotbucket")
AWS_REGION = os.getenv("AWS_REGION", "us-east-1")
s3_client = boto3.client(
    "s3",
    region_name=AWS_REGION,
    aws_access_key_id=os.getenv("AWS_ACCESS_KEY_ID"),
    aws_secret_access_key=os.getenv("AWS_SECRET_ACCESS_KEY")
)


def download_file_from_s3(s3_key):
    """Downloads file content from S3 as a BytesIO object."""
    logger.info(f"Downloading file from S3: {s3_key}")
    response = s3_client.get_object(Bucket=S3_BUCKET, Key=s3_key)
    return BytesIO(response["Body"].read())


def upload_file_to_s3(file_path, s3_key, content_type="application/octet-stream"):
    """Uploads file content from a local file to S3 and returns the public URL."""
    with open(file_path, "rb") as f:
        file_content = f.read()
    s3_client.put_object(Bucket=S3_BUCKET, Key=s3_key,
                         Body=file_content, ContentType=content_type)
    url = f"https://{S3_BUCKET}.s3.amazonaws.com/{s3_key}"
    logger.info(f"Uploaded to S3: {url}")
    return url


def upload_json_to_s3(data, s3_key):
    """Uploads a JSON object to S3 and returns the public URL."""
    temp_json_path = "temp_json.json"
    with open(temp_json_path, "w") as f:
        json.dump(data, f)
    url = upload_file_to_s3(temp_json_path, s3_key,
                            content_type="application/json")
    os.remove(temp_json_path)
    return url


def extract_text_from_pdf(file_obj):
    """Extracts text from a PDF file using pdfplumber."""
    text_pages = []
    try:
        with pdfplumber.open(file_obj) as pdf:
            for page in pdf.pages:
                page_text = page.extract_text()
                if page_text:
                    text_pages.append(page_text.strip())
    except Exception as e:
        logger.error(f"Error extracting text: {str(e)}")
    return "\n".join(text_pages)


def embed_in_batches(text_chunks, batch_size=32):
    """Processes text chunks in batches to generate embeddings."""
    embeddings = []
    for i in range(0, len(text_chunks), batch_size):
        batch = text_chunks[i:i + batch_size]
        batch_embeddings = embeddings_model.embed_documents(batch)
        embeddings.extend(batch_embeddings)
    return np.array(embeddings).astype("float32")


def create_quantized_index(embeddings, nlist=None, m=8, nbits=8):
    """
    Creates a quantized FAISS index using IndexIVFPQ.
    If there are not enough training points for the desired quantization (2^nbits),
    falls back to a flat index (IndexFlatL2).
    """
    d = embeddings.shape[1]
    num_embeddings = len(embeddings)

    if num_embeddings < (1 << nbits):
        logger.warning(
            f"Not enough training data ({num_embeddings}) for quantization with nbits={nbits}. Falling back to IndexFlatL2.")
        index = faiss.IndexFlatL2(d)
        index.add(embeddings)
        return index

    if nlist is None:
        nlist = int(np.sqrt(num_embeddings))
        if nlist < 1:
            nlist = 1

    logger.info(
        f"Creating quantized FAISS index with nlist={nlist}, m={m}, nbits={nbits}, dimension={d}")
    quantizer = faiss.IndexFlatL2(d)
    index = faiss.IndexIVFPQ(quantizer, d, nlist, m, nbits)

    logger.info("Training FAISS index")
    index.train(embeddings)
    logger.info("Adding embeddings to FAISS index")
    index.add(embeddings)
    return index


@rag_bp.route("/index", methods=["POST"])
def index_pdf():
    data = request.get_json()
    s3_file_key = data.get("s3_file_key")
    professor_username = data.get("username")
    course_id = data.get("courseId")
    if not s3_file_key:
        return jsonify({"error": "s3_file_key is required"}), 400
    if not professor_username:
        return jsonify({"error": "professorUsername is required"}), 400
    if not course_id:
        return jsonify({"error": "courseId is required"}), 400

    try:
        # Download PDF from S3
        file_obj = download_file_from_s3(s3_file_key)
        extracted_text = extract_text_from_pdf(file_obj)
        if not extracted_text.strip():
            return jsonify({"error": "No text extracted from PDF."}), 400

        # Split text into chunks using a recursive character splitter
        text_splitter = RecursiveCharacterTextSplitter(
            chunk_size=1200, chunk_overlap=240)
        text_chunks = text_splitter.split_text(extracted_text)
        if not text_chunks:
            return jsonify({"error": "No text chunks generated."}), 400

        # Generate embeddings in batches for memory efficiency
        embeddings = embed_in_batches(text_chunks, batch_size=32)

        # Create a quantized FAISS index from the embeddings
        optimized_index = create_quantized_index(embeddings)

        # Extract file name from s3_file_key
        file_name = os.path.basename(s3_file_key)
        base_name = os.path.splitext(file_name)[0]
        file_name = base_name  # e.g., "MKTG-2201-Study-Textbook"
        logger.info(f"Constructed file_name: {file_name}")

        # e.g., "MKTG-2201-Study-Textbook_faiss_index.index"
        index_file_name = f"{file_name}_faiss_index.index"
        # e.g., "MKTG-2201-Study-Textbook_chunks.json"
        chunks_file_name = f"{file_name}_chunks.json"

        # Store in professor-specific directory with courseId as the folder
        professor_dir = f"{professor_username}/{course_id}"
        index_key = f"{professor_dir}/{index_file_name}"
        chunks_key = f"{professor_dir}/{chunks_file_name}"

        # Save the text chunks as a JSON file in S3
        chunks_data = {"chunks": text_chunks}
        chunks_url = upload_json_to_s3(chunks_data, chunks_key)

        # Save the FAISS index in its native format
        temp_index_path = "temp_index.index"
        faiss.write_index(optimized_index, temp_index_path)

        # Upload the FAISS index file to S3
        index_url = upload_file_to_s3(
            temp_index_path, index_key, content_type="application/octet-stream")

        # Remove the temporary file after upload
        os.remove(temp_index_path)

        return jsonify({
            "faiss_index_url": index_url,
            "index_key": index_key,
            "chunks_url": chunks_url,
            "chunks_key": chunks_key,
            "course_id": course_id,
            "file_name": file_name
        })
    except Exception as e:
        logger.exception(f"Error indexing PDF: {str(e)}")
        return jsonify({"error": "Failed to index PDF"}), 500


def get_faiss_index_from_s3(index_key: str):
    """
    Downloads the FAISS index file from S3 and loads it.
    index_key: The S3 key of the FAISS index file.
    Returns a FAISS index object.
    """
    temp_index_path = None
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=".index") as temp_file:
            temp_index_path = temp_file.name
        s3_client.download_file(
            Bucket=S3_BUCKET, Key=index_key, Filename=temp_index_path)
        index = faiss.read_index(temp_index_path)
        return index
    finally:
        if temp_index_path and os.path.exists(temp_index_path):
            os.remove(temp_index_path)


def download_json_from_s3(json_key, local_path="temp_json.json"):
    """Download a JSON file from S3."""
    logger.info(f"Downloading JSON from S3: {json_key}")
    try:
        s3_client.download_file(S3_BUCKET, json_key, local_path)
        with open(local_path, "r") as f:
            data = json.load(f)
        return data
    except Exception as e:
        logger.error(f"Error downloading JSON from S3: {str(e)}")
        raise
    finally:
        if os.path.exists(local_path):
            os.remove(local_path)


def download_chunks_from_s3(chunks_key, local_path="temp_chunks.json"):
    """Download the text chunks JSON from S3."""
    return download_json_from_s3(chunks_key, local_path)["chunks"]


def find_most_recent_index_and_chunks(professor_username, course_id):
    """
    Find the most recent FAISS index and chunks files in the S3 directory
    for the given professorUsername and courseId.
    """
    if not professor_username:
        raise ValueError("professor_username is required to locate files")
    if not course_id:
        raise ValueError("course_id is required to locate files")

    prefix = f"{professor_username}/{course_id}/"
    logger.info(f"Listing files in S3 with prefix: {prefix}")

    # List all objects in the S3 directory
    response = s3_client.list_objects_v2(Bucket=S3_BUCKET, Prefix=prefix)
    if "Contents" not in response:
        raise ValueError(f"No files found in S3 directory: {prefix}")

    # Separate FAISS index files (ending with .index) and chunks files (ending with _chunks.json)
    index_files = []
    chunks_files = []
    for obj in response["Contents"]:
        key = obj["Key"]
        last_modified = obj["LastModified"]
        if key.endswith("_faiss_index.index"):
            index_files.append({"key": key, "last_modified": last_modified})
        elif key.endswith("_chunks.json"):
            chunks_files.append({"key": key, "last_modified": last_modified})

    # Sort files by LastModified timestamp (most recent first)
    index_files.sort(key=lambda x: x["last_modified"], reverse=True)
    chunks_files.sort(key=lambda x: x["last_modified"], reverse=True)

    if not index_files:
        raise ValueError(
            f"No FAISS index files found in S3 directory: {prefix}")
    if not chunks_files:
        raise ValueError(f"No chunks files found in S3 directory: {prefix}")

    # Get the most recent index and chunks files
    most_recent_index = index_files[0]["key"]
    most_recent_chunks = chunks_files[0]["key"]

    # Extract the base names to ensure they match (e.g., both should be for "MKTG-2201-Study-Textbook")
    index_base = most_recent_index.split(
        '/')[-1].replace("_faiss_index.index", "")
    chunks_base = most_recent_chunks.split('/')[-1].replace("_chunks.json", "")
    if index_base != chunks_base:
        logger.warning(
            f"Mismatch between most recent index ({index_base}) and chunks ({chunks_base}). Using most recent files anyway.")

    logger.info(f"Selected most recent index file: {most_recent_index}")
    logger.info(f"Selected most recent chunks file: {most_recent_chunks}")
    return most_recent_index, most_recent_chunks


def retrieve_relevant_text(query, faiss_index=None, k=5, professor_username=None, course_id=None):
    """Retrieve relevant text chunks using the FAISS index."""
    if not professor_username:
        raise ValueError("professor_username is required for retrieval")
    if not course_id:
        raise ValueError("course_id is required for retrieval")

    # Find the most recent FAISS index and chunks files in S3
    index_key, chunks_key = find_most_recent_index_and_chunks(
        professor_username, course_id)

    # Load the FAISS index if not provided
    if faiss_index is None:
        faiss_index = get_faiss_index_from_s3(index_key)

    # Download the text chunks
    text_chunks = download_chunks_from_s3(chunks_key)

    # Generate query embedding
    query_embedding = embeddings_model.embed_query(query)
    query_embedding = np.array([query_embedding]).astype("float32")

    # Search the index
    distances, indices = faiss_index.search(query_embedding, k)
    logger.info(
        f"Retrieved {len(indices[0])} relevant chunks for query: {query[:50]}...")

    # Retrieve the corresponding text chunks
    relevant_chunks = [text_chunks[i]
                       for i in indices[0] if i < len(text_chunks)]
    return relevant_chunks
