"""Vercel entry point: every /api/* request is served by the FastAPI app in api/_lib."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from _lib.app import app  # noqa: E402,F401
