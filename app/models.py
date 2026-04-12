from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, Field, field_validator


class ExtractInvoiceRequest(BaseModel):
    fileName: str = Field(..., min_length=1, max_length=255)
    mimeType: str = Field(..., min_length=3, max_length=100)
    contentBase64: str = Field(..., min_length=8)
    driveFileId: Optional[str] = Field(default=None, max_length=255)

    @field_validator("mimeType")
    @classmethod
    def val_mime_type(cls, v: str) -> str:
        allowed = {
            "application/pdf",
            "image/png",
            "image/jpeg",
            "image/jpg",
            "image/webp",
            "image/tiff",
        }
        if v.lower() not in allowed:
            raise ValueError(f"mimeType no soportado: {v}")
        return v.lower()


class InvoiceResult(BaseModel):
    tipo_documento: Optional[str] = None
    fecha: Optional[str] = None
    proveedor: Optional[str] = None
    nombre_marca_detectado: Optional[str] = None
    razon_social_detectada: Optional[str] = None
    ruc_detectado: Optional[str] = None
    proveedor_match_motivo: Optional[str] = None
    proveedor_match_score: Optional[float] = Field(default=None, ge=0.0, le=1.0)
    itbms: Optional[float] = None
    total: Optional[float] = None
    cufe: Optional[str] = None
    numero_factura: Optional[str] = None
    metodo_extraccion: str = Field(default="ocr")
    confianza: float = Field(..., ge=0.0, le=1.0)
    observaciones: list[str] = Field(default_factory=list)
    texto_detectado: Optional[str] = None


class ExtractInvoiceResponse(BaseModel):
    ok: bool
    data: InvoiceResult
    meta: dict
