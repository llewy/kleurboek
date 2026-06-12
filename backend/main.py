import os
import base64
import io
import json
import logging
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, FileResponse, HTMLResponse
from pydantic import BaseModel
from dotenv import load_dotenv

load_dotenv()

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="Kleurboek API")

CORS_ORIGINS = os.getenv("CORS_ORIGINS", "")
if CORS_ORIGINS:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[o.strip() for o in CORS_ORIGINS.split(",") if o.strip()],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

AZURE_OPENAI_ENDPOINT = os.getenv("AZURE_OPENAI_ENDPOINT", "").rstrip("/")
AZURE_OPENAI_API_KEY = os.getenv("AZURE_OPENAI_API_KEY", "")
AZURE_OPENAI_API_VERSION = os.getenv("AZURE_OPENAI_API_VERSION", "2025-04-01-preview")
IMAGE_DEPLOYMENT = os.getenv("AZURE_OPENAI_IMAGE_DEPLOYMENT", "gpt-image-2")
STATIC_DIR = os.getenv("STATIC_DIR", os.path.join(os.path.dirname(__file__), "static"))

LEVEL_PROMPTS = {
    1: (
        "Convert this photo into an extremely simple black-and-white coloring page "
        "for very young children. Use very thick bold outlines, minimal shapes, "
        "very large open areas, almost no detail. White background, no shading."
    ),
    2: (
        "Convert this photo into a simple black-and-white children's coloring page. "
        "Use thick clear outlines, simplified shapes, large areas to color, "
        "minimal detail. White background, no shading."
    ),
    3: (
        "Convert this photo into a black-and-white coloring page for older children. "
        "Use clear outlines, moderately simplified shapes, some detail, "
        "reasonable areas to color. White background, no shading."
    ),
    4: (
        "Convert this photo into a black-and-white coloring page for teenagers. "
        "Use medium-thickness outlines, moderate detail and patterns, "
        "smaller areas to color. White background, no shading."
    ),
    5: (
        "Convert this photo into a detailed black-and-white adult coloring page. "
        "Use finer lines, detailed patterns, smaller sections, more complexity. "
        "Suitable for advanced colorists. White background, no shading."
    ),
    6: (
        "Convert this photo into an extremely intricate black-and-white adult coloring page. "
        "Use very fine detailed lines, complex patterns, tiny sections, "
        "high level of detail for experienced colorists. White background, no shading."
    ),
}

A4_SIZE = "1536x2176"


class GenerateRequest(BaseModel):
    image: str
    difficulty: int = 3


def event(data: dict) -> str:
    return f"data: {json.dumps(data)}\n\n"


@app.on_event("startup")
async def startup():
    logger.info("Kleurboek API starting...")


@app.get("/api/health")
async def health():
    return {"status": "ok"}


@app.post("/api/generate-coloring-page")
async def generate_coloring_page(req: GenerateRequest):
    import requests as http_requests

    if not AZURE_OPENAI_ENDPOINT or not AZURE_OPENAI_API_KEY:
        raise HTTPException(status_code=500, detail="Azure OpenAI credentials not configured")

    level = max(1, min(6, req.difficulty))
    prompt = LEVEL_PROMPTS[level]

    async def generate():
        raw_base64 = req.image.split(",", 1)[1]
        image_bytes = base64.b64decode(raw_base64)

        yield event({"step": "uploading", "message": "Foto voorbereiden..."})

        edit_url = (
            f"{AZURE_OPENAI_ENDPOINT}/openai/deployments/{IMAGE_DEPLOYMENT}/images/edits"
            f"?api-version={AZURE_OPENAI_API_VERSION}"
        )

        yield event({"step": "generating", "message": "Kleurplaat genereren (kan 30-60 sec duren)..."})

        try:
            response = http_requests.post(
                edit_url,
                headers={"Api-Key": AZURE_OPENAI_API_KEY},
                data={
                    "prompt": prompt,
                    "n": "1",
                    "size": A4_SIZE,
                    "quality": "high",
                },
                files={
                    "image": ("photo.png", io.BytesIO(image_bytes), "image/png"),
                },
            )

            if not response.ok:
                yield event({"step": "error", "message": f"Azure OpenAI fout: {response.text[:300]}"})
                return

            result = response.json()
            b64_data = result.get("data", [{}])[0].get("b64_json")

            if not b64_data:
                yield event({"step": "error", "message": "Geen afbeelding gegenereerd"})
                return

            yield event({
                "step": "done",
                "image_data": f"data:image/png;base64,{b64_data}",
            })

        except Exception as e:
            yield event({"step": "error", "message": str(e)})

    return StreamingResponse(generate(), media_type="text/event-stream")


# Serve frontend static files (for Docker/production)
@app.get("/{full_path:path}")
async def serve_static(full_path: str):
    if not os.path.isdir(STATIC_DIR):
        return HTMLResponse("Not Found", status_code=404)
    if not full_path:
        full_path = "index.html"
    file_path = os.path.join(STATIC_DIR, full_path)
    if os.path.isfile(file_path):
        return FileResponse(file_path)
    index_path = os.path.join(STATIC_DIR, "index.html")
    if os.path.isfile(index_path):
        return FileResponse(index_path, media_type="text/html")
    return HTMLResponse("Not Found", status_code=404)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000, log_level="info")
