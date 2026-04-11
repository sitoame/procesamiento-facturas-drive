from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

import pandas as pd

REQUIRED_FIELDS = [
    "invoice_id",
    "fecha",
    "proveedor",
    "proveedor_normalizado",
    "itbms",
    "total",
    "cufe",
    "numero_factura",
    "tipo_documento",
]


@dataclass(frozen=True)
class EvalConfig:
    amount_tolerance: float = 0.01
    date_format: str | None = None
    review_critical_fields: tuple[str, ...] = (
        "fecha",
        "proveedor_normalizado",
        "total",
        "itbms",
        "numero_factura",
        "tipo_documento",
    )


class InvoiceEvaluator:
    def __init__(self, cfg: EvalConfig | None = None) -> None:
        self.cfg = cfg or EvalConfig()

    def build_labeled_dataset(
        self,
        manual_df: pd.DataFrame,
        auto_df: pd.DataFrame,
        key: str = "invoice_id",
    ) -> pd.DataFrame:
        self._validate_input(manual_df, "manual_df", key)
        self._validate_input(auto_df, "auto_df", key)

        manual = self._normalize_base_df(manual_df).add_prefix("manual_")
        auto = self._normalize_base_df(auto_df).add_prefix("auto_")

        merged = manual.merge(
            auto,
            left_on=f"manual_{key}",
            right_on=f"auto_{key}",
            how="left",
            validate="one_to_one",
        )
        merged["invoice_id"] = merged[f"manual_{key}"]
        merged["has_auto_extraction"] = merged[f"auto_{key}"].notna()
        return merged

    def evaluate(self, labeled_df: pd.DataFrame) -> tuple[pd.DataFrame, dict[str, Any]]:
        row_eval = labeled_df.copy()

        row_eval["fecha_match"] = self._date_match(row_eval["manual_fecha"], row_eval["auto_fecha"])
        row_eval["proveedor_match"] = self._str_match(
            row_eval["manual_proveedor_normalizado"],
            row_eval["auto_proveedor_normalizado"],
        )
        row_eval["total_match"] = self._amount_match(row_eval["manual_total"], row_eval["auto_total"])
        row_eval["itbms_match"] = self._amount_match(row_eval["manual_itbms"], row_eval["auto_itbms"])
        row_eval["cufe_recalled"] = self._cufe_recall_flag(row_eval["manual_cufe"], row_eval["auto_cufe"])

        critical_match_cols = [
            f"{field}_match"
            for field in self.cfg.review_critical_fields
            if f"{field}_match" in row_eval.columns
        ]

        row_eval["needs_manual_review"] = (
            ~row_eval["has_auto_extraction"]
            | row_eval[critical_match_cols].fillna(False).eq(False).any(axis=1)
        )

        metrics = self._compute_global_metrics(row_eval)
        metrics["error_rate_by_supplier"] = self._error_rate_by_supplier(row_eval).to_dict(orient="records")

        return row_eval, metrics

    def export_report(
        self,
        row_eval: pd.DataFrame,
        metrics: dict[str, Any],
        out_path: str,
        fmt: str = "json",
    ) -> Path:
        path = Path(out_path)
        fmt_l = fmt.lower().strip()

        if fmt_l == "json":
            payload = {
                "summary_metrics": metrics,
                "row_evaluation": row_eval.to_dict(orient="records"),
            }
            pd.Series(payload).to_json(path, force_ascii=False, indent=2)
            return path

        if fmt_l == "csv":
            row_eval.to_csv(path, index=False)
            summary_path = path.with_name(f"{path.stem}_summary.csv")
            pd.DataFrame([metrics]).to_csv(summary_path, index=False)
            return path

        raise ValueError("fmt must be 'json' or 'csv'.")

    def _compute_global_metrics(self, row_eval: pd.DataFrame) -> dict[str, float]:
        return {
            "num_records": int(len(row_eval)),
            "exactitud_fecha": self._safe_mean(row_eval["fecha_match"]),
            "exactitud_proveedor": self._safe_mean(row_eval["proveedor_match"]),
            "exactitud_total": self._safe_mean(row_eval["total_match"]),
            "exactitud_itbms": self._safe_mean(row_eval["itbms_match"]),
            "recall_cufe": self._safe_mean(row_eval["cufe_recalled"]),
            "porcentaje_revision_manual": self._safe_mean(row_eval["needs_manual_review"]),
        }

    def _error_rate_by_supplier(self, row_eval: pd.DataFrame) -> pd.DataFrame:
        tmp = row_eval.copy()
        tmp["supplier"] = tmp["manual_proveedor_normalizado"].fillna("__missing_supplier__")
        tmp["any_field_error"] = (
            ~tmp[["fecha_match", "proveedor_match", "total_match", "itbms_match"]]
            .fillna(False)
            .all(axis=1)
        )

        grouped = (
            tmp.groupby("supplier", dropna=False)
            .agg(num_facturas=("invoice_id", "count"), errores=("any_field_error", "sum"))
            .reset_index()
        )
        grouped["tasa_error"] = grouped["errores"] / grouped["num_facturas"]
        return grouped.sort_values("tasa_error", ascending=False)

    def _validate_input(self, df: pd.DataFrame, name: str, key: str) -> None:
        missing = [f for f in REQUIRED_FIELDS if f not in df.columns]
        if missing:
            raise ValueError(f"{name} missing required fields: {missing}")
        if df[key].duplicated().any():
            raise ValueError(f"{name} has duplicated key values in '{key}'")

    def _normalize_base_df(self, df: pd.DataFrame) -> pd.DataFrame:
        out = df.copy()
        out["fecha"] = pd.to_datetime(out["fecha"], format=self.cfg.date_format, errors="coerce").dt.date

        for col in ["total", "itbms"]:
            out[col] = pd.to_numeric(out[col], errors="coerce")

        for col in ["proveedor", "proveedor_normalizado", "cufe", "numero_factura", "tipo_documento"]:
            out[col] = out[col].astype(str).str.strip().str.lower().replace({"nan": None, "": None})

        return out

    def _date_match(self, manual_s: pd.Series, auto_s: pd.Series) -> pd.Series:
        return manual_s.eq(auto_s)

    def _str_match(self, manual_s: pd.Series, auto_s: pd.Series) -> pd.Series:
        return manual_s.eq(auto_s)

    def _amount_match(self, manual_s: pd.Series, auto_s: pd.Series) -> pd.Series:
        diff = (manual_s - auto_s).abs()
        return diff.le(self.cfg.amount_tolerance)

    def _cufe_recall_flag(self, manual_s: pd.Series, auto_s: pd.Series) -> pd.Series:
        has_manual_cufe = manual_s.notna()
        recalled = has_manual_cufe & manual_s.eq(auto_s)

        result = pd.Series([pd.NA] * len(manual_s), index=manual_s.index, dtype="boolean")
        result[has_manual_cufe] = recalled[has_manual_cufe]
        return result

    @staticmethod
    def _safe_mean(series: pd.Series) -> float:
        valid = series.dropna()
        if valid.empty:
            return 0.0
        return float(valid.mean())


def build_simulated_data() -> tuple[pd.DataFrame, pd.DataFrame]:
    manual_df = pd.DataFrame(
        [
            {
                "invoice_id": "INV-001",
                "fecha": "2026-01-05",
                "proveedor": "Acme Corp S.A.",
                "proveedor_normalizado": "acme corp",
                "itbms": 7.00,
                "total": 107.00,
                "cufe": "ABC123",
                "numero_factura": "F-1001",
                "tipo_documento": "factura",
            },
            {
                "invoice_id": "INV-002",
                "fecha": "2026-01-07",
                "proveedor": "Nova Supplies",
                "proveedor_normalizado": "nova supplies",
                "itbms": 3.50,
                "total": 53.50,
                "cufe": "XYZ999",
                "numero_factura": "N-222",
                "tipo_documento": "factura",
            },
            {
                "invoice_id": "INV-003",
                "fecha": "2026-01-08",
                "proveedor": "Acme Corp S.A.",
                "proveedor_normalizado": "acme corp",
                "itbms": 0.00,
                "total": 44.99,
                "cufe": None,
                "numero_factura": "F-1002",
                "tipo_documento": "nota_credito",
            },
        ]
    )

    auto_df = pd.DataFrame(
        [
            {
                "invoice_id": "INV-001",
                "fecha": "2026-01-05",
                "proveedor": "ACME CORP SA",
                "proveedor_normalizado": "acme corp",
                "itbms": 7.00,
                "total": 107.00,
                "cufe": "ABC123",
                "numero_factura": "F-1001",
                "tipo_documento": "factura",
            },
            {
                "invoice_id": "INV-002",
                "fecha": "2026-01-06",
                "proveedor": "Nova Supplies",
                "proveedor_normalizado": "nova supply",
                "itbms": 3.50,
                "total": 53.45,
                "cufe": None,
                "numero_factura": "N-222",
                "tipo_documento": "factura",
            },
        ]
    )

    return manual_df, auto_df


def run_example(output_fmt: str = "json") -> tuple[pd.DataFrame, dict[str, Any], Path]:
    manual_df, auto_df = build_simulated_data()
    evaluator = InvoiceEvaluator(EvalConfig(amount_tolerance=0.1))

    labeled = evaluator.build_labeled_dataset(manual_df, auto_df)
    row_eval, metrics = evaluator.evaluate(labeled)
    report_path = evaluator.export_report(
        row_eval=row_eval,
        metrics=metrics,
        out_path=f"evaluation_report.{output_fmt}",
        fmt=output_fmt,
    )
    return row_eval, metrics, report_path


if __name__ == "__main__":
    rows, summary, path = run_example(output_fmt="json")
    print("=== Summary ===")
    print(pd.Series(summary))
    print("=== Row Evaluation ===")
    print(rows[["invoice_id", "fecha_match", "proveedor_match", "total_match", "itbms_match", "cufe_recalled", "needs_manual_review"]])
    print(f"Report exported to: {path}")
