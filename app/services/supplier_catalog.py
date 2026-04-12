from __future__ import annotations

from typing import Callable

from app.domain.provider_matching import resolve_supplier_match


def normalize_supplier_from_catalog(
    ruc: str | None,
    razon_social: str | None,
    nombre_marca: str | None,
    norm_token: Callable[[str], str],
) -> tuple[str | None, str | None, float | None]:
    return resolve_supplier_match(
        ruc=ruc,
        razon_social=razon_social,
        nombre_marca=nombre_marca,
        norm_token=norm_token,
    )
