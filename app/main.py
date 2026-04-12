from __future__ import annotations

from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse

from app.models import ExtractInvoiceRequest, ExtractInvoiceResponse
from app.services.parsing import decode_base64_file
from app.services.pipeline import run_document_pipeline

app = FastAPI(
    title="Invoice Extractor API",
    version="0.1.0",
    description="Servicio para extraer campos de facturas escaneadas difíciles.",
)


@app.get("/health")
def health() -> dict:
    return {"ok": True, "service": "invoice-extractor", "version": "0.1.0"}


@app.post("/extract-invoice", response_model=ExtractInvoiceResponse)
def extract_invoice(payload: ExtractInvoiceRequest):
    try:
        file_bytes = decode_base64_file(payload.contentBase64)
        output = run_document_pipeline(
            file_bytes=file_bytes,
            mime_type=payload.mimeType,
            file_name=payload.fileName,
        )

        meta = {
            "fileName": payload.fileName,
            "mimeType": payload.mimeType,
            "driveFileId": payload.driveFileId,
            "strategy": "clean-pipeline-v2",
            "metrics": {
                "extraction_ms": output.metrics.extraction_ms,
                "method": output.metrics.method,
                "empty_fields_rate": output.metrics.empty_fields_rate,
                "invalid_total": output.metrics.invalid_total,
                "invalid_itbms": output.metrics.invalid_itbms,
            },
        }
        return ExtractInvoiceResponse(ok=True, data=output.result, meta=meta)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        return JSONResponse(
            status_code=500,
            content={
                "ok": False,
                "error": "internal_error",
                "detail": str(exc),
            },
        )
