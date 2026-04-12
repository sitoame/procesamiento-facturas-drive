from __future__ import annotations

from difflib import SequenceMatcher
from typing import Callable

CANONICAL_BY_RUC = {
    "155701584-2-2021": "MEGA LONG, S.A.",
}

ALIASES_BY_CANONICAL = {
    "MEGA LONG, S.A.": [
        "MEGA LOKO",
        "MEGA LONG PILÓN",
        "MEGA LONG PILON",
    ],
}


def resolve_supplier_match(
    ruc: str | None,
    razon_social: str | None,
    nombre_marca: str | None,
    norm_token: Callable[[str], str],
) -> tuple[str | None, str | None, float | None]:
    if ruc and ruc in CANONICAL_BY_RUC:
        return CANONICAL_BY_RUC[ruc], "match_ruc_exact", 1.0

    candidates = [value for value in [razon_social, nombre_marca] if value]
    if not candidates:
        return None, None, None

    best_score = 0.0
    best_canonical: str | None = None

    for candidate in candidates:
        token = norm_token(candidate)
        for canonical, aliases in ALIASES_BY_CANONICAL.items():
            for alias in aliases:
                score = SequenceMatcher(None, token, norm_token(alias)).ratio()
                if score > best_score:
                    best_score = score
                    best_canonical = canonical

    if best_canonical and best_score >= 0.86:
        return best_canonical, "match_alias_fuzzy", round(min(0.99, best_score), 4)

    # regla obligatoria: no escribir proveedor si no hay match
    return None, None, round(best_score, 4) if best_score else None
