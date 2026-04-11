from __future__ import annotations

import io

from PIL import Image
from pypdf import PdfReader

from app.models import InvoiceResult
from app.services.document import pdf_first_page_to_image
from app.services.parsing import extract_invoice_fields_from_text, validate_invoice_result


def run_document_pipeline(file_bytes: bytes, mime_type: str) -> InvoiceResult:
    # prep doc
    if mime_type == "application/pdf":
        image = pdf_first_page_to_image(file_bytes)
        extracted_text = _extract_text_from_pdf(file_bytes)
    else:
        image = _open_image(file_bytes)
        extracted_text = ""

    # hook OCR engine
    ocr_text = run_ocr_stub(image, fallback_text=extracted_text)

    # map -> fields
    result = extract_invoice_fields_from_text(ocr_text)
    return validate_invoice_result(result)


def run_ocr_stub(image: Image.Image, fallback_text: str = "") -> str:
    # placeholder integration: conectar aquí OCR/visión multimodal real
    _ = image
    return fallback_text


def _open_image(image_bytes: bytes) -> Image.Image:
    try:
        return Image.open(io.BytesIO(image_bytes)).convert("RGB")
    except Exception as exc:
        raise ValueError("No se pudo abrir la imagen") from exc


def _extract_text_from_pdf(pdf_bytes: bytes) -> str:
    try:
        reader = PdfReader(io.BytesIO(pdf_bytes))
        page = reader.pages[0]
        return page.extract_text() or ""
    except Exception:
        return ""
