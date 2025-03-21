import os
import json
import logging
import random
import requests
from typing import List, Dict, Any
from flask import Flask, request, jsonify, Blueprint

from .rag_pipeline import retrieve_relevant_text, get_faiss_index_from_s3

# Set up logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)

# Create a Flask blueprint for rubric generation
rubric_bp = Blueprint("rubric", __name__)

# Local LLM API configuration
API_URL = "http://localhost:5001/api/generate"
DEFAULT_TEMPERATURE = 0.3
DEFAULT_TOP_P = 0.9
DEFAULT_MAX_TOKENS = 4000


def send_post_request(prompt: str, temperature=DEFAULT_TEMPERATURE,
                      top_p=DEFAULT_TOP_P, max_tokens=DEFAULT_MAX_TOKENS,
                      model="llama3.1:8b") -> str:
    payload = {
        "model": model,
        "prompt": prompt,
        "stream": False,
        "temperature": temperature,
        "top_p": top_p,
        "max_tokens": max_tokens
    }
    headers = {"Content-Type": "application/json"}
    logger.info(f"Sending request to local model: {model}")
    try:
        response = requests.post(API_URL, json=payload, headers=headers)
        response.raise_for_status()
        return response.json()["response"]
    except requests.exceptions.RequestException as e:
        logger.error(f"Error calling local model API: {str(e)}")
        raise


def generate_sample_rubric(question: str, context: List[str], model: str = "llama3.1:8b") -> Dict[str, Any]:
    """Generate a single sample rubric for the given question and context."""
    logger.info(f"Generating a sample rubric using model: {model}...")
    try:
        context_subset = random.sample(context, min(len(context), 5))
        prompt = f"""
        You are an expert educational assessment designer. Your task is to create a sample grading rubric 
        for the following question/assignment:
        
        QUESTION:
        {question}
        
        RELEVANT CONTEXT FROM COURSE MATERIALS:
        {' '.join(context_subset)}
        
        Create a sample grading rubric that assesses understanding of the subject matter and application of 
        concepts. The rubric should have 3-4 relevant criteria that are tailored to this specific question.
        
        Return the rubric as a valid JSON object with the following structure:
        
        {{
          "criteria": [
            {{
              "name": "Criterion Name",
              "description": "Detailed description of what is being assessed",
              "weight": number,
              "scoringLevels": {{
                "full": "Description of full points performance",
                "partial": "Description of partial points performance",
                "minimal": "Description of minimal points performance"
              }},
              "subCriteria": []
            }}
          ]
        }}
        
        Each criterion should include:
        1. A clear name
        2. A detailed description
        3. A weight (numerical value where all weights add up to 100)
        4. Scoring levels with descriptions
        5. An empty subCriteria array
        
        Return ONLY the JSON object with no additional text before or after it.
        """
        response = send_post_request(prompt=prompt, temperature=0.3, top_p=0.9,
                                     max_tokens=1000, model=model)
        response = response.strip()
        json_start = response.find('{')
        json_end = response.rfind('}') + 1
        if json_start != -1 and json_end > json_start:
            json_str = response[json_start:json_end]
            try:
                rubric_json = json.loads(json_str)
                if "criteria" not in rubric_json:
                    rubric_json = {"criteria": rubric_json}
                for criterion in rubric_json["criteria"]:
                    if "subCriteria" not in criterion:
                        criterion["subCriteria"] = []
                    if "scoringLevels" not in criterion:
                        criterion["scoringLevels"] = {
                            "full": "Excellent performance in this criterion.",
                            "partial": "Satisfactory performance in this criterion.",
                            "minimal": "Minimal performance in this criterion."
                        }
                    if "weight" not in criterion or not isinstance(criterion["weight"], (int, float)):
                        criterion["weight"] = 100 // len(
                            rubric_json["criteria"])
                total_weight = sum(c["weight"]
                                   for c in rubric_json["criteria"])
                if total_weight != 100:
                    scale_factor = 100 / total_weight
                    for criterion in rubric_json["criteria"]:
                        criterion["weight"] = round(
                            criterion["weight"] * scale_factor)
                    diff = 100 - sum(c["weight"]
                                     for c in rubric_json["criteria"])
                    if diff != 0:
                        rubric_json["criteria"][0]["weight"] += diff
                logger.info("Successfully generated sample rubric")
                return rubric_json
            except json.JSONDecodeError as e:
                logger.error(
                    f"Error parsing JSON from model response: {str(e)}")
                raise
        else:
            logger.error("Could not find valid JSON in model response")
            raise ValueError("No valid JSON found in response")
    except Exception as e:
        logger.error(f"Error generating rubric: {str(e)}")
        return {
            "criteria": [
                {
                    "name": "Criterion 1",
                    "description": "Auto-generated placeholder criterion",
                    "weight": 100,
                    "scoringLevels": {
                        "full": "Excellent performance in this criterion.",
                        "partial": "Satisfactory performance in this criterion.",
                        "minimal": "Minimal performance in this criterion."
                    },
                    "subCriteria": []
                }
            ]
        }


@rubric_bp.route("/generate_rubric", methods=["POST"])
def generate_rubric():
    data = request.get_json()
    print(data)
    question = data.get("question")
    professor = data.get("username")
    course_id = data.get("courseId")  # e.g., "67dd03b10804dc82ad45da1d"
    model = data.get("model", "llama3.1:8b")

    if not all([question, professor, course_id]):
        return jsonify({"error": "question, username, and courseId are required"}), 400

    try:
        # Retrieve context from the FAISS index
        context = retrieve_relevant_text(
            query=question,
            k=5,
            professor_username=professor,
            course_id=course_id
        )

        # Generate a single rubric
        rubric = generate_sample_rubric(question, context, model=model)
        print(rubric)
        result = {
            "success": True,
            "message": "Generated a sample rubric",
            "rubric": rubric
        }
        return jsonify(result)

    except Exception as e:
        logger.exception(f"Error generating sample rubric: {str(e)}")
        return jsonify({
            "success": False,
            "message": f"Error generating sample rubric: {str(e)}",
            "error": str(e)
        }), 500
