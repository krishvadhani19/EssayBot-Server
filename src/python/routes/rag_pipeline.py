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
from typing import List, Generator, Optional

rag_bp = Blueprint("rag", __name__)

load_dotenv()

CHUNK_SIZE = int(os.getenv("RAG_CHUNK_SIZE", 1200))
CHUNK_OVERLAP = int(os.getenv("RAG_CHUNK_OVERLAP", 240))
BATCH_SIZE = int(os.getenv("RAG_BATCH_SIZE", 32))

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s",
    handlers=[
        logging.FileHandler("rag_service.log"),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)

embeddings_model = HuggingFaceEmbeddings(model_name="BAAI/bge-large-en")

S3_BUCKET = os.getenv("AWS_S3_BUCKET", "essaybotbucket")
AWS_REGION = os.getenv("AWS_REGION", "us-east-1")
s3_client = boto3.client(
    "s3",
    region_name=AWS_REGION,
    aws_access_key_id=os.getenv("AWS_ACCESS_KEY_ID"),
    aws_secret_access_key=os.getenv("AWS_SECRET_ACCESS_KEY")
)


def download_file_from_s3(s3_key: str) -> BytesIO:
    logger.info(f"Downloading file from S3: {s3_key}")
    try:
        response = s3_client.get_object(Bucket=S3_BUCKET, Key=s3_key)
        return BytesIO(response["Body"].read())
    except Exception as e:
        logger.error(f"Failed to download from S3: {str(e)}")
        raise


def upload_file_to_s3(file_path: str, s3_key: str, content_type: str = "application/octet-stream") -> str:
    try:
        with open(file_path, "rb") as f:
            s3_client.put_object(Bucket=S3_BUCKET, Key=s3_key,
                                 Body=f, ContentType=content_type)
        url = f"https://{S3_BUCKET}.s3.amazonaws.com/{s3_key}"
        logger.info(f"Uploaded to S3: {url}")
        return url
    except boto3.exceptions.S3UploadFailedError as e:
        logger.error(f"S3 upload failed: {str(e)}")
        raise


def upload_json_to_s3(data: dict, s3_key: str) -> str:
    with tempfile.NamedTemporaryFile(delete=False, suffix=".json", mode="w", encoding="utf-8") as temp_file:
        json.dump(data, temp_file)
        temp_file.flush()
        url = upload_file_to_s3(temp_file.name, s3_key,
                                content_type="application/json")
    os.remove(temp_file.name)
    return url


def extract_text_from_pdf(file_obj: BytesIO) -> Generator[str, None, None]:
    try:
        with pdfplumber.open(file_obj) as pdf:
            for page in pdf.pages:
                page_text = page.extract_text()
                if page_text:
                    yield page_text.strip()
    except Exception as e:
        logger.error(f"Error extracting text from PDF: {str(e)}")
        raise ValueError(f"Failed to extract text from PDF: {str(e)}")


def embed_in_batches(text_chunks: List[str], batch_size: int = BATCH_SIZE) -> np.ndarray:
    embeddings = []
    for i in range(0, len(text_chunks), batch_size):
        batch = text_chunks[i:i + batch_size]
        batch_embeddings = embeddings_model.embed_documents(batch)
        embeddings.extend(batch_embeddings)
    return np.array(embeddings).astype("float32")


def create_quantized_index(embeddings: np.ndarray, nlist: Optional[int] = None, m: int = 8, nbits: int = 8) -> faiss.Index:
    d = embeddings.shape[1]
    num_embeddings = len(embeddings)
    min_points_per_centroid = 39

    if nlist is None:
        nlist = max(1, min(100, int(np.sqrt(num_embeddings))))

    min_required_points = nlist * min_points_per_centroid
    if num_embeddings < min_required_points:
        logger.warning(
            f"Not enough training data ({num_embeddings}) for clustering with nlist={nlist}. "
            f"Requires at least {min_required_points} points. Using IndexFlatL2.")
        index = faiss.IndexFlatL2(d)
        index.add(embeddings)
        return index

    adjusted_nbits = min(nbits, max(4, int(np.log2(num_embeddings) - 1)))
    if num_embeddings < (1 << adjusted_nbits):
        logger.warning(
            f"Not enough training data ({num_embeddings}) for quantization with adjusted_nbits={adjusted_nbits}. Using IndexFlatL2.")
        index = faiss.IndexFlatL2(d)
        index.add(embeddings)
        return index

    m = min(16, max(4, d // 32))
    logger.info(
        f"Creating quantized FAISS index with nlist={nlist}, m={m}, nbits={adjusted_nbits}, dimension={d}")
    quantizer = faiss.IndexFlatL2(d)
    index = faiss.IndexIVFPQ(quantizer, d, nlist, m, adjusted_nbits)

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
    assignment_title = data.get("assignmentTitle")
    if not all([s3_file_key, professor_username, course_id, assignment_title]):
        return jsonify({"error": "s3_file_key, username, courseId, and assignmentTitle are required"}), 400

    try:
        file_obj = download_file_from_s3(s3_file_key)

        text_splitter = RecursiveCharacterTextSplitter(
            chunk_size=CHUNK_SIZE,
            chunk_overlap=CHUNK_OVERLAP,
            separators=["\n\n", "\n", ". ", " ", ""],
            keep_separator=True
        )
        text_chunks = []
        for page_text in extract_text_from_pdf(file_obj):
            chunks = text_splitter.split_text(page_text)
            text_chunks.extend(chunks)
        if not text_chunks:
            return jsonify({"error": "No text chunks generated from PDF"}), 400

        embeddings = embed_in_batches(text_chunks)
        optimized_index = create_quantized_index(embeddings)

        professor_dir = f"{professor_username}/{course_id}/{assignment_title}"
        index_key = f"{professor_dir}/faiss_index.index"
        chunks_key = f"{professor_dir}/chunks.json"

        chunks_data = {"chunks": text_chunks, "index_key": index_key}
        chunks_url = upload_json_to_s3(chunks_data, chunks_key)

        with tempfile.NamedTemporaryFile(delete=False, suffix=".index") as temp_file:
            faiss.write_index(optimized_index, temp_file.name)
            index_url = upload_file_to_s3(
                temp_file.name, index_key, "application/octet-stream")
        os.remove(temp_file.name)

        return jsonify({
            "faiss_index_url": index_url,
            "index_key": index_key,
            "chunks_url": chunks_url,
            "chunks_key": chunks_key,
            "course_id": course_id,
            "assignment_title": assignment_title
        })
    except Exception as e:
        logger.exception(f"Error indexing PDF: {str(e)}")
        return jsonify({"error": f"Failed to index PDF: {str(e)}"}), 500


def get_faiss_index_from_s3(index_key: str) -> faiss.Index:
    with tempfile.NamedTemporaryFile(delete=False, suffix=".index") as temp_file:
        s3_client.download_file(
            Bucket=S3_BUCKET, Key=index_key, Filename=temp_file.name)
        index = faiss.read_index(temp_file.name)
    os.remove(temp_file.name)
    return index


def download_json_from_s3(json_key: str) -> dict:
    logger.info(f"Downloading JSON from S3: {json_key}")
    with tempfile.NamedTemporaryFile(delete=False, suffix=".json") as temp_file:
        try:
            s3_client.download_file(
                Bucket=S3_BUCKET, Key=json_key, Filename=temp_file.name)
            with open(temp_file.name, "r") as f:
                return json.load(f)
        except Exception as e:
            logger.error(f"Error downloading JSON from S3: {str(e)}")
            raise
        finally:
            os.remove(temp_file.name)


def download_chunks_from_s3(chunks_key: str) -> List[str]:
    data = download_json_from_s3(chunks_key)
    return data["chunks"]


def expand_query(query: str) -> str:
    """Expands the query by adding related terms using a simple heuristic."""
    related_terms = {
        "customer-driven marketing strategy": "market segmentation targeting differentiation positioning",
        "machine learning": "supervised learning unsupervised learning neural networks",
    }
    for key, terms in related_terms.items():
        if key.lower() in query.lower():
            return f"{query} {terms}"
    return query


def retrieve_relevant_text(query: str, faiss_index: Optional[faiss.Index] = None, k: int = 10,
                           professor_username: Optional[str] = None, course_id: Optional[str] = None,
                           assignmentTitle: Optional[str] = None, distance_threshold: float = 0.5,
                           max_total_length: int = 4000) -> List[str]:
    """Retrieves relevant text chunks using the FAISS index, with relevance filtering and length limits."""
    if not all([professor_username, course_id, assignmentTitle]):
        raise ValueError(
            "professor_username, course_id, and assignmentTitle are required")

    professor_dir = f"{professor_username}/{course_id}/{assignmentTitle}"
    index_key = f"{professor_dir}/faiss_index.index"
    chunks_key = f"{professor_dir}/chunks.json"

    try:
        faiss_index = faiss_index or get_faiss_index_from_s3(index_key)
        text_chunks = download_chunks_from_s3(chunks_key)
    except Exception as e:
        logger.error(f"Error loading FAISS index or chunks: {str(e)}")
        raise ValueError(f"Failed to load FAISS index or chunks: {str(e)}")

    expanded_query = expand_query(query)
    logger.info(f"Expanded query: {expanded_query[:100]}...")

    query_embedding = embeddings_model.embed_query(expanded_query)
    query_embedding = np.array([query_embedding]).astype("float32")

    distances, indices = faiss_index.search(query_embedding, k * 2)
    relevant_chunks = []
    total_length = 0
    for dist, idx in zip(distances[0], indices[0]):
        if idx >= len(text_chunks):
            continue
        if dist > distance_threshold:
            break
        chunk = text_chunks[idx]
        chunk_length = len(chunk)
        if total_length + chunk_length > max_total_length:
            break
        relevant_chunks.append(chunk)
        total_length += chunk_length

    total_length = sum(len(chunk) for chunk in relevant_chunks)
    if total_length < 500 and len(text_chunks) > len(relevant_chunks):
        logger.info("Initial retrieval insufficient, increasing k...")
        more_distances, more_indices = faiss_index.search(
            query_embedding, k * 4)
        for dist, idx in zip(more_distances[0], more_indices[0]):
            if idx >= len(text_chunks) or dist > distance_threshold:
                continue
            chunk = text_chunks[idx]
            if chunk in relevant_chunks:
                continue
            chunk_length = len(chunk)
            if total_length + chunk_length > max_total_length:
                break
            relevant_chunks.append(chunk)
            total_length += chunk_length

    logger.info(
        f"Retrieved {len(relevant_chunks)} chunks for query: {query[:50]}...")
    return relevant_chunks
