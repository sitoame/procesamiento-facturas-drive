from __future__ import annotations

import io

from PIL import Image
from pypdf import PdfReader


def pdf_first_page_to_image(pdf_bytes: bytes) -> Image.Image:
    # quick val
    if not pdf_bytes:
        raise ValueError("PDF vacío")

    # nota: placeholder para rasterizar real con poppler/fitz cuando se requiera
    try:
        reader = PdfReader(io.BytesIO(pdf_bytes))
        if not reader.pages:
            raise ValueError("PDF sin páginas")
        page = reader.pages[0]
        text = page.extract_text() or ""
    except Exception as exc:
        raise ValueError("No se pudo leer la primera página del PDF") from exc

    # fallback: imagen blanca con texto extraído (si existe)
    img = Image.new("RGB", (1400, 1900), color=(255, 255, 255))
    return img
