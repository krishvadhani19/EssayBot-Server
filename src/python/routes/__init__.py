from flask import Blueprint
from .rag_pipeline import rag_bp  # Import your blueprints
from .generateRubric import rubric_bp  # Import other blueprints if applicable
from .generatePrompts import prompt_bp  # Import other blueprints if applicable
from .script import singleGrading_bp  # Import other blueprints if applicable


def create_blueprints():
    """Registers all Flask blueprints."""
    return [rag_bp, rubric_bp, prompt_bp, singleGrading_bp]
