from __future__ import annotations

import io
import time
from dataclasses import dataclass

from PIL import Image
from pypdf import PdfReader

from app.domain.invoice_rules import empty_fields_rate
from app.infrastructure.cufe import infer_cufe_from_filename, query_invoice_by_cufe
from app.models import InvoiceResult
from app.services.document import pdf_first_page_to_image
from app.services.parsing import extract_invoice_fields_from_text, validate_invoice_result


@dataclass(frozen=True)
class PipelineMetrics:
    extraction_ms: int
    method: str
    empty_fields_rate: float
    invalid_total: bool
    invalid_itbms: bool


@dataclass(frozen=True)
class PipelineOutput:
    result: InvoiceResult
    metrics: PipelineMetrics


def run_document_pipeline(file_bytes: bytes, mime_type: str, file_name: str) -> PipelineOutput:
    start = time.perf_counter()

    cufe_candidate = infer_cufe_from_filename(file_name)
    if cufe_candidate:
        cufe_result = query_invoice_by_cufe(cufe_candidate)
        if cufe_result.ok:
            result = InvoiceResult(
                fecha=cufe_result.fecha,
                proveedor=cufe_result.proveedor,
                itbms=cufe_result.itbms,
                total=cufe_result.total,
                cufe=cufe_result.cufe,
                numero_factura=cufe_result.numero_factura,
                tipo_documento="factura",
                metodo_extraccion="consulta_cufe",
                confianza=1.0,
                observaciones=[],
            )
            return PipelineOutput(
                result=result,
                metrics=_build_metrics(start, result, invalid_total=False, invalid_itbms=False),
            )

    if mime_type == "application/pdf":
        image = pdf_first_page_to_image(file_bytes)
        extracted_text = _extract_text_from_pdf(file_bytes)
    else:
        image = _open_image(file_bytes)
        extracted_text = ""

    # hook OCR engine
    ocr_text = run_ocr_stub(image, fallback_text=extracted_text)

    # map -> fields
    parsed = extract_invoice_fields_from_text(ocr_text)
    result, validation_metrics = validate_invoice_result(parsed)
    return PipelineOutput(
        result=result,
        metrics=_build_metrics(
            start,
            result,
            invalid_total=validation_metrics["invalid_total"],
            invalid_itbms=validation_metrics["invalid_itbms"],
        ),
    )


def _build_metrics(start: float, result: InvoiceResult, invalid_total: bool, invalid_itbms: bool) -> PipelineMetrics:
    tracked = {
        "fecha": result.fecha,
        "proveedor": result.proveedor,
        "itbms": result.itbms,
        "total": result.total,
        "cufe": result.cufe,
        "numero_factura": result.numero_factura,
    }
    elapsed_ms = int((time.perf_counter() - start) * 1000)
    return PipelineMetrics(
        extraction_ms=elapsed_ms,
        method=result.metodo_extraccion,
        empty_fields_rate=empty_fields_rate(tracked),
        invalid_total=invalid_total,
        invalid_itbms=invalid_itbms,
    )


def run_ocr_stub(image: Image.Image, fallback_text: str = "") -> str:
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
