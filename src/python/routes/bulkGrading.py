from typing import Dict, List, Optional, Any, Tuple
from dataclasses import dataclass
from flask import Flask, request, jsonify, Blueprint
import logging
import pandas as pd
from io import BytesIO
import os
from datetime import datetime
import sys
import boto3
import json
import requests
from concurrent.futures import ThreadPoolExecutor, as_completed

# Assuming these are defined elsewhere
from .rag_pipeline import retrieve_relevant_text
from agents import get_prompt

parent_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.append(parent_dir)

# Configure logging
logging.basicConfig(level=logging.INFO,
                    format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)

# Configuration constants
MAX_CONCURRENT_REQUESTS = 4
DEFAULT_MODEL = "llama3.1:8b"
RAG_K = 10
RAG_DISTANCE_THRESHOLD = 0.5
RAG_MAX_TOTAL_LENGTH = 6000


@dataclass
class GradingProgress:
    total_essays: int
    completed_essays: int = 0
    failed_essays: int = 0
    current_essay_index: int = 0


bulkGrading_bp = Blueprint("bulkGrading", __name__)

# LLM API settings
LLM_API_URL = "http://localhost:5001/api/generate"
S3_BUCKET = os.getenv("AWS_S3_BUCKET", "essaybotbucket")
AWS_REGION = os.getenv("AWS_REGION", "us-east-1")
s3_client = boto3.client(
    "s3",
    region_name=AWS_REGION,
    aws_access_key_id=os.getenv("AWS_ACCESS_KEY_ID"),
    aws_secret_access_key=os.getenv("AWS_SECRET_ACCESS_KEY")
)


def send_post_request_sync(
    prompt: str,
    temperature: float = 0.7,
    top_p: float = 0.9,
    max_tokens: int = 2048,
    model: str = DEFAULT_MODEL
) -> Optional[Dict[str, Any]]:
    payload = {
        "model": model,
        "prompt": prompt,
        "stream": False,
        "max_tokens": max_tokens,
        "temperature": temperature,
        "top_p": top_p,
        "format": "json"
    }
    headers = {"Content-Type": "application/json"}
    try:
        response = requests.post(LLM_API_URL, json=payload, headers=headers)
        response.raise_for_status()
        return response.json()
    except Exception as e:
        logger.error(f"LLM API error: {e}")
        return None


def grade_essay_sync(
    essay: str,
    question: str,
    config_prompt: Dict[str, Any],
    professor_username: str,
    course_id: str,
    assignment_title: str,
    model: str,
    progress: GradingProgress
) -> Dict[str, Dict[str, Any]]:
    try:
        rag_chunks = retrieve_relevant_text(
            query=question,
            professor_username=professor_username,
            course_id=course_id,
            assignmentTitle=assignment_title,
            k=RAG_K,
            distance_threshold=RAG_DISTANCE_THRESHOLD,
            max_total_length=RAG_MAX_TOTAL_LENGTH
        )
        rag_context = "\n".join(
            rag_chunks) if rag_chunks else "No relevant context available."

        assembled_prompts = get_prompt(config_prompt)
        if not assembled_prompts or "criteria_prompts" not in assembled_prompts:
            raise ValueError("Invalid or missing criteria_prompts")

        grading_results = {}
        for criterion_name, criterion_data in assembled_prompts["criteria_prompts"].items():
            if not isinstance(criterion_data, dict) or "prompt" not in criterion_data:
                raise ValueError(
                    f"Invalid prompt for criterion: {criterion_name}")

            full_prompt = criterion_data["prompt"]
            full_prompt = full_prompt.replace("{{question}}", question)
            full_prompt = full_prompt.replace("{{essay}}", essay)
            full_prompt = full_prompt.replace("{{rag_context}}", rag_context)

            response = send_post_request_sync(full_prompt, model=model)
            if response and "response" in response:
                try:
                    result = json.loads(response["response"])
                    grading_results[criterion_name] = {
                        "score": result.get("score", 0),
                        "feedback": result.get("feedback", "No feedback provided")
                    }
                except json.JSONDecodeError:
                    grading_results[criterion_name] = {
                        "score": 0,
                        "feedback": "Failed to parse LLM response"
                    }
            else:
                grading_results[criterion_name] = {
                    "score": 0,
                    "feedback": "No response from LLM"
                }

        progress.completed_essays += 1
        progress.current_essay_index += 1
        return grading_results

    except Exception as e:
        logger.error(f"Error grading essay: {e}")
        progress.failed_essays += 1
        return {
            criterion: {"score": 0, "feedback": f"Error: {str(e)}"}
            for criterion in config_prompt.get("criteria_prompts", {}).keys()
        }


def run_threaded_grading(
    essays: List[str],
    question: str,
    config_prompt: Dict[str, Any],
    professor_username: str,
    course_id: str,
    assignment_title: str,
    model: str
) -> List[Dict[str, Dict[str, Any]]]:
    logger.info("Starting threaded grading...")
    grading_results = []
    progress = GradingProgress(total_essays=len(essays))

    with ThreadPoolExecutor(max_workers=MAX_CONCURRENT_REQUESTS) as executor:
        futures = [
            executor.submit(
                grade_essay_sync,
                essay, question, config_prompt,
                professor_username, course_id, assignment_title, model, progress
            )
            for essay in essays
        ]

        for future in as_completed(futures):
            try:
                grading_results.append(future.result())
            except Exception as e:
                logger.error(f"Grading failed: {e}")
                grading_results.append({
                    criterion: {"score": 0, "feedback": f"Error: {str(e)}"}
                    for criterion in config_prompt.get("criteria_prompts", {}).keys()
                })
    logger.debug(
        f"Grading result for essay {progress.current_essay_index + 1}: {grading_results}")

    return grading_results


def download_file_from_s3(s3_key: str) -> BytesIO:
    logger.info(f"Downloading file from S3: {s3_key}")
    try:
        response = s3_client.get_object(Bucket=S3_BUCKET, Key=s3_key)
        return BytesIO(response["Body"].read())
    except Exception as e:
        logger.error(f"Failed to download from S3: {str(e)}")
        raise


def upload_file_to_s3(file_obj: BytesIO, s3_key: str) -> str:
    try:
        s3_client.upload_fileobj(file_obj, S3_BUCKET, s3_key)
        url = f"https://{S3_BUCKET}.s3.amazonaws.com/{s3_key}"
        logger.info(f"Uploaded to S3: {url}")
        return url
    except Exception as e:
        logger.error(f"S3 upload failed: {str(e)}")
        raise


@bulkGrading_bp.route('/grade_bulk_essays', methods=['POST'])
def grade_bulk_essays() -> Tuple[Dict[str, Any], int]:
    try:
        data = request.get_json()
        required_fields = ["courseId", "assignmentTitle",
                           "config_prompt", "question", "username", "s3_excel_link"]
        if not data or not all(field in data for field in required_fields):
            return jsonify({"error": f"Missing required fields: {', '.join(required_fields)}"}), 400

        course_id = data["courseId"]
        assignment_title = data["assignmentTitle"]
        config_prompt = data["config_prompt"]
        question = data["question"]
        professor_username = data["username"]
        s3_excel_link = data["s3_excel_link"]
        model = data.get("model", DEFAULT_MODEL)

        s3_key = s3_excel_link.replace(
            f"https://{S3_BUCKET}.s3.amazonaws.com/", "")
        folder = "/".join(s3_key.split("/")[:-1])

        excel_file = download_file_from_s3(s3_key)
        df = pd.read_excel(excel_file)
        if "ID" not in df.columns or "Response" not in df.columns:
            return jsonify({"error": "Excel must contain 'ID' and 'Response' columns"}), 400
        grading_results = run_threaded_grading(
            df["Response"].tolist(),
            question, config_prompt, professor_username, course_id, assignment_title, model
        )
        logger.debug(f"Sample grading result: {grading_results[0]}")

        criteria = list(config_prompt["criteria_prompts"].keys())
        output_data = {"ID": df["ID"], "Response": df["Response"]}
        for criterion in criteria:
            output_data[criterion] = [result[criterion]["feedback"]
                                      for result in grading_results]
            output_data[f"{criterion}_score"] = [
                result[criterion]["score"] for result in grading_results]
        output_data["Total_Score"] = [
            sum(result[c]["score"] for c in criteria) for result in grading_results
        ]

        output_df = pd.DataFrame(output_data)
        timestamp = datetime.now().strftime("%Y%m%d%H%M%S")
        output_key = f"{folder}/graded_response_{timestamp}.xlsx"
        output_buffer = BytesIO()
        output_df.to_excel(output_buffer, index=False)
        output_buffer.seek(0)
        s3_url = upload_file_to_s3(output_buffer, output_key)

        return jsonify({
            "message": "Bulk essays graded successfully",
            "s3_graded_link": s3_url,
            "total_essays": len(df),
            "completed_essays": len(df),
            # Approximate fallback
            "failed_essays": len(df) - len(grading_results)
        }), 200

    except Exception as e:
        logger.error(f"Error grading bulk essays: {str(e)}")
        return jsonify({"error": str(e)}), 500
