from __future__ import annotations

import re
from dataclasses import dataclass


CUFE_FILE_RE = re.compile(r"([A-Z0-9]{20,64})", flags=re.IGNORECASE)


@dataclass(frozen=True)
class CufeQueryResult:
    ok: bool
    cufe: str
    proveedor: str | None = None
    fecha: str | None = None
    total: float | None = None
    itbms: float | None = None
    numero_factura: str | None = None


def infer_cufe_from_filename(file_name: str) -> str | None:
    base = (file_name or "").rsplit(".", 1)[0]
    match = CUFE_FILE_RE.search(base)
    if not match:
        return None
    return re.sub(r"[^A-Z0-9]", "", match.group(1).upper())


def query_invoice_by_cufe(cufe: str) -> CufeQueryResult:
    # stub infra; contrato explícito para integrar consulta real
    if not cufe:
        return CufeQueryResult(ok=False, cufe="")
    return CufeQueryResult(ok=True, cufe=cufe)
