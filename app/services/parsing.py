from __future__ import annotations

import base64
import re
from datetime import datetime
from decimal import Decimal, InvalidOperation
from app.models import InvoiceResult
from app.services.supplier_catalog import normalize_supplier_from_catalog


MONEY_TOKEN_RE = re.compile(r"(?:\$\s*)?([0-9]{1,3}(?:[.,][0-9]{3})*(?:[.,][0-9]{2})|[0-9]+(?:[.,][0-9]{2}))")
DATE_PATTERNS = [
    re.compile(r"\b(\d{4}-\d{2}-\d{2})\b"),
    re.compile(r"\b(\d{2}/\d{2}/\d{4})\b"),
    re.compile(r"\b(\d{2}-\d{2}-\d{4})\b"),
]
RUC_RE = re.compile(r"\b(\d{5,12}-\d{1,4}-\d{1,6})\b", flags=re.IGNORECASE)


def decode_base64_file(content_base64: str) -> bytes:
    # val input
    if not content_base64 or not isinstance(content_base64, str):
        raise ValueError("contentBase64 inválido")

    try:
        return base64.b64decode(content_base64, validate=True)
    except Exception as exc:
        raise ValueError("No se pudo decodificar contentBase64") from exc


def extract_invoice_fields_from_text(text: str) -> InvoiceResult:
    # init result
    text = (text or "").strip()
    obs: list[str] = []

    if not text:
        return InvoiceResult(confianza=0.0, observaciones=["No se detectó texto"])  # fallback

    tipo_documento = _find_tipo_documento(text)
    fecha = _find_date(text)
    nombre_marca_detectado = _find_brand_name(text)
    razon_social_detectada = _find_legal_name(text)
    ruc_detectado = _find_ruc(text)
    proveedor, proveedor_match_motivo, proveedor_match_score = _normalize_supplier(
        ruc=ruc_detectado,
        razon_social=razon_social_detectada,
        nombre_marca=nombre_marca_detectado,
    )
    cufe = _find_cufe(text)
    numero_factura = _find_invoice_number(text)
    total = _find_amount_by_keywords(text, ["total", "importe total", "monto total"])
    itbms = _find_amount_by_keywords(text, ["itbms", "iva", "impuesto"])

    found_fields = sum(
        1
        for v in [tipo_documento, fecha, proveedor, cufe, numero_factura, total, itbms, ruc_detectado]
        if v is not None
    )
    confianza = min(1.0, 0.2 + (found_fields * 0.11))

    if found_fields < 4:
        obs.append("Extracción parcial; revisar OCR o usar modelo de visión")

    return InvoiceResult(
        tipo_documento=tipo_documento,
        fecha=fecha,
        proveedor=proveedor,
        nombre_marca_detectado=nombre_marca_detectado,
        razon_social_detectada=razon_social_detectada,
        ruc_detectado=ruc_detectado,
        proveedor_match_motivo=proveedor_match_motivo,
        proveedor_match_score=proveedor_match_score,
        itbms=itbms,
        total=total,
        cufe=cufe,
        numero_factura=numero_factura,
        confianza=round(confianza, 2),
        observaciones=obs,
        texto_detectado=text,
    )


def validate_invoice_result(result: InvoiceResult) -> InvoiceResult:
    # val semantic
    if result.total is not None and result.total < 0:
        result.observaciones.append("Total inválido; se ajusta a nulo")
        result.total = None

    if result.itbms is not None and result.itbms < 0:
        result.observaciones.append("ITBMS inválido; se ajusta a nulo")
        result.itbms = None

    if result.itbms is not None and result.total is not None and result.itbms > result.total:
        result.observaciones.append("ITBMS mayor al total; revisar fuente")

    if result.fecha and not _is_valid_date(result.fecha):
        result.observaciones.append("Fecha con formato no estandarizado")

    return result


def _find_tipo_documento(text: str) -> str | None:
    low = text.lower()
    if "nota de crédito" in low or "nota credito" in low:
        return "nota_credito"
    if "factura" in low:
        return "factura"
    return None


def _find_date(text: str) -> str | None:
    for pattern in DATE_PATTERNS:
        match = pattern.search(text)
        if not match:
            continue
        raw = match.group(1)
        normalized = _normalize_date(raw)
        if normalized:
            return normalized
    return None


def _find_legal_name(text: str) -> str | None:
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    header = lines[:12]
    for line in header:
        low = line.lower()
        if any(k in low for k in ["s.a", "s.a.", "corp", "inc", "ltda", "empresa"]):
            return line[:120]
    return None


def _find_brand_name(text: str) -> str | None:
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    return lines[0][:120] if lines else None


def _find_ruc(text: str) -> str | None:
    match = RUC_RE.search(text)
    return match.group(1).upper() if match else None


def _normalize_supplier(ruc: str | None, razon_social: str | None, nombre_marca: str | None) -> tuple[str | None, str | None, float | None]:
    return normalize_supplier_from_catalog(
        ruc=ruc,
        razon_social=razon_social,
        nombre_marca=nombre_marca,
        norm_token=_norm_token,
    )


def _norm_token(raw: str) -> str:
    token = raw.upper().replace("Ó", "O")
    token = re.sub(r"[^A-Z0-9]+", " ", token)
    return re.sub(r"\s+", " ", token).strip()


def _find_cufe(text: str) -> str | None:
    match = re.search(r"\bCUFE\s*[:#-]?\s*([A-Za-z0-9-]{12,})\b", text, flags=re.IGNORECASE)
    if match:
        return match.group(1)
    match = re.search(r"\b([A-Fa-f0-9]{32,64})\b", text)
    return match.group(1) if match else None


def _find_invoice_number(text: str) -> str | None:
    match = re.search(
        r"\b(?:factura|fact\.?|invoice|n[oº°]?\s*factura)\s*[:#-]?\s*([A-Za-z0-9-]{3,30})\b",
        text,
        flags=re.IGNORECASE,
    )
    return match.group(1) if match else None


def _find_amount_by_keywords(text: str, keywords: list[str]) -> float | None:
    for line in text.splitlines():
        low = line.lower()
        if not any(k in low for k in keywords):
            continue
        match = MONEY_TOKEN_RE.search(line)
        if match:
            parsed = _parse_decimal(match.group(1))
            if parsed is not None:
                return parsed
    return None


def _parse_decimal(raw: str) -> float | None:
    token = raw.strip().replace(" ", "")
    if "," in token and "." in token:
        if token.rfind(",") > token.rfind("."):
            token = token.replace(".", "").replace(",", ".")
        else:
            token = token.replace(",", "")
    elif token.count(",") == 1 and token.count(".") == 0:
        token = token.replace(",", ".")
    else:
        token = token.replace(",", "")

    try:
        return float(Decimal(token))
    except (InvalidOperation, ValueError):
        return None


def _normalize_date(raw: str) -> str | None:
    fmts = ["%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y"]
    for fmt in fmts:
        try:
            dt = datetime.strptime(raw, fmt)
            return dt.strftime("%Y-%m-%d")
        except ValueError:
            continue
    return None


def _is_valid_date(raw: str) -> bool:
    try:
        datetime.strptime(raw, "%Y-%m-%d")
        return True
    except ValueError:
        return False
