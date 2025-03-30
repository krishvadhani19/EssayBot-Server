#!/usr/bin/env python
# coding: utf-8

import pandas as pd
import numpy as np
import re
import json
import logging
import boto3
from io import BytesIO
from flask import Blueprint, request, jsonify
import os

# Configure logging
logging.basicConfig(level=logging.INFO,
                    format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)

# Create blueprint
reports_bp = Blueprint("reports", __name__)

# S3 configuration
S3_BUCKET = os.getenv("AWS_S3_BUCKET", "essaybotbucket")
AWS_REGION = os.getenv("AWS_REGION", "us-east-1")
s3_client = boto3.client(
    "s3",
    region_name=AWS_REGION,
    aws_access_key_id=os.getenv("AWS_ACCESS_KEY_ID"),
    aws_secret_access_key=os.getenv("AWS_SECRET_ACCESS_KEY")
)


def download_file_from_s3(s3_key: str) -> BytesIO:
    """Download a file from S3 and return it as a BytesIO object."""
    try:
        # Extract the key from full S3 URL if provided
        if s3_key.startswith('https://'):
            s3_key = s3_key.split('.com/')[-1]

        response = s3_client.get_object(Bucket=S3_BUCKET, Key=s3_key)
        return BytesIO(response["Body"].read())
    except Exception as e:
        logger.error(f"Failed to download from S3: {str(e)}")
        raise


def get_feedback_and_score_columns(df, criteria_names):
    """
    Extract feedback and score columns from DataFrame based on criteria names.
    Returns a mapping of criteria to their feedback and score columns.
    """
    column_mapping = {}

    # Print columns for debugging
    logger.info(f"Available columns in Excel: {df.columns.tolist()}")

    for criterion in criteria_names:
        # Create exact patterns to match feedback and score columns
        feedback_col = f"{criterion}_feedback"
        score_col = f"{criterion}_score"

        # Also try with spaces removed
        feedback_pattern = criterion.replace(" ", "").upper() + ".*FEEDBACK"
        score_pattern = criterion.replace(" ", "").upper() + ".*SCORE"

        # Find matching columns
        feedback_cols = [col for col in df.columns if feedback_col.upper(
        ) in col.upper() or re.search(feedback_pattern, col.upper())]
        score_cols = [col for col in df.columns if score_col.upper(
        ) in col.upper() or re.search(score_pattern, col.upper())]

        if feedback_cols and score_cols:
            column_mapping[criterion] = {
                "feedback": feedback_cols[0],
                "score": score_cols[0]
            }
        else:
            logger.warning(
                f"Could not find feedback or score columns for criterion: {criterion}")
            logger.warning(f"Looked for patterns: {feedback_col}, {score_col}")

    return column_mapping


def analyze_grading_performance(file_path, config_rubric):
    """
    Analyze grading performance for AI grading.

    Args:
        file_path: S3 path to the Excel file
        config_rubric: Rubric configuration containing criteria details
    """
    # Load Data from S3
    file_obj = download_file_from_s3(file_path)

    # Read the Excel file
    df_ai = pd.read_excel(file_obj)

    # Extract criteria names and weights
    criteria_data = {}
    for criterion in config_rubric["criteria"]:
        weight = criterion["weight"]
        # Convert weight to int if it's a string
        if isinstance(weight, str):
            weight = int(weight)
        # Handle MongoDB extended JSON format
        elif isinstance(weight, dict) and "$numberInt" in weight:
            weight = int(weight["$numberInt"])

        criteria_data[criterion["name"]] = {
            "weight": weight,
            "description": criterion["description"]
        }

    # Get column mappings for AI dataframe
    ai_columns = get_feedback_and_score_columns(df_ai, criteria_data.keys())

    # Calculate weighted total scores
    def calculate_total_score(df, columns_mapping):
        total_scores = pd.Series(0, index=df.index)
        max_possible_score = 0

        for criterion, details in criteria_data.items():
            if criterion in columns_mapping:
                weight = details["weight"]
                score_col = columns_mapping[criterion]["score"]
                # Don't divide weight by 100 since scores are already in their proper scale
                weighted_score = df[score_col]
                total_scores += weighted_score
                max_possible_score += weight

        return total_scores, max_possible_score

    # Calculate total scores for AI
    df_ai["TOTAL_SCORE"], ai_max_score = calculate_total_score(
        df_ai, ai_columns)

    # Generate detailed histogram data with specific bins
    def generate_detailed_histogram(scores, max_score):
        # Create percentage-based bins
        percentages = [0, 20, 40, 60, 80, 100]
        # Calculate bin edges based on max_score
        bins = [max_score * (p/100) for p in percentages]
        labels = ["0-20%", "20-40%", "40-60%", "60-80%", "80-100%"]
        counts = []

        # Print debug information
        logger.info(f"Generating histogram with max_score: {max_score}")
        logger.info(f"Score distribution: {scores.describe()}")
        logger.info(f"Bin edges: {bins}")

        for i in range(len(bins)-1):
            count = len(scores[(scores >= bins[i]) & (scores <= bins[i+1])])
            counts.append(count)
            logger.info(
                f"Bin {labels[i]}: {count} scores between {bins[i]:.1f} and {bins[i+1]:.1f}")

        return {
            "labels": labels,
            "counts": counts,
            # Convert to float for JSON serialization
            "bins": [float(b) for b in bins],
            "max_score": float(max_score)
        }

    # Calculate statistics for each criterion
    def compute_detailed_stats(df, columns_mapping):
        stats = {}
        for criterion, columns in columns_mapping.items():
            score_col = columns["score"]
            if score_col in df.columns:
                stats[criterion] = {
                    "min": float(df[score_col].min()),
                    "max": float(df[score_col].max()),
                    "mean": float(df[score_col].mean()),
                    "weight": criteria_data[criterion]["weight"],
                    "description": criteria_data[criterion]["description"],
                    # Individual scores for detailed analysis
                    "scores": df[score_col].tolist()
                }
        return stats

    # Construct the response data
    response_data = {
        "histogram": generate_detailed_histogram(df_ai["TOTAL_SCORE"], ai_max_score),
        "statistics": {
            "count": float(df_ai["TOTAL_SCORE"].count()),
            "mean": float(df_ai["TOTAL_SCORE"].mean()),
            "std": float(df_ai["TOTAL_SCORE"].std()),
            "min": float(df_ai["TOTAL_SCORE"].min()),
            "25%": float(df_ai["TOTAL_SCORE"].quantile(0.25)),
            "50%": float(df_ai["TOTAL_SCORE"].quantile(0.50)),
            "75%": float(df_ai["TOTAL_SCORE"].quantile(0.75)),
            "max": float(df_ai["TOTAL_SCORE"].max())
        },
        "rubric_evaluation": {
            "criteria": list(criteria_data.keys()),
            "weights": [data["weight"] for data in criteria_data.values()],
            "ai": {
                "means": [float(df_ai[ai_columns[c]["score"]].mean()) if c in ai_columns else 0
                          for c in criteria_data.keys()],
                "detailed_stats": compute_detailed_stats(df_ai, ai_columns)
            }
        }
    }

    return response_data


@reports_bp.route('/analyze_grading', methods=['POST'])
def analyze_grading():
    """
    Analyze grading performance from an Excel file in S3.
    Expects a POST request with s3_file_path and config_rubric.
    """
    try:
        data = request.get_json()
        required_fields = ["s3_file_path", "config_rubric"]
        if not data or not all(field in data for field in required_fields):
            return jsonify({"error": f"Missing required fields: {', '.join(required_fields)}"}), 400

        s3_file_path = data["s3_file_path"]
        config_rubric = data["config_rubric"]

        # Validate config_rubric
        if not isinstance(config_rubric, dict) or "criteria" not in config_rubric:
            return jsonify({"error": "config_rubric must be an object with a criteria array"}), 400

        # Analyze the grading performance
        result = analyze_grading_performance(
            file_path=s3_file_path,
            config_rubric=config_rubric
        )

        return jsonify(result), 200

    except Exception as e:
        logger.error(f"Error analyzing grading performance: {str(e)}")
        return jsonify({"error": str(e)}), 500
