from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class ValidationMetrics:
    invalid_total: bool
    invalid_itbms: bool


MAX_TOTAL_OCR = 1000.0
MAX_ITBMS_RATIO = 0.07


def validate_ocr_amounts(total: float | None, itbms: float | None) -> tuple[float | None, float | None, list[str], ValidationMetrics]:
    obs: list[str] = []
    invalid_total = False
    invalid_itbms = False

    if total is not None and total > MAX_TOTAL_OCR:
        total = None
        invalid_total = True
        obs.append("Total inválido para OCR (>1000)")

    if total is not None and itbms is not None and itbms > total * MAX_ITBMS_RATIO:
        itbms = None
        invalid_itbms = True
        obs.append("ITBMS inválido para OCR (>7% del total)")

    return total, itbms, obs, ValidationMetrics(invalid_total=invalid_total, invalid_itbms=invalid_itbms)


def empty_fields_rate(fields: dict[str, object | None]) -> float:
    total = len(fields)
    if total == 0:
        return 0.0
    empty = sum(1 for value in fields.values() if value in (None, ""))
    return round(empty / total, 4)
