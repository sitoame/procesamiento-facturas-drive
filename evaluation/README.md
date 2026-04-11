# Capa de evaluación de facturas

## 1) Estructura de datos propuesta

Se usan dos tablas de entrada (`manual_df`, `auto_df`) con el mismo esquema base:

- `invoice_id` (str, llave única)
- `fecha` (date/string parseable)
- `proveedor` (str)
- `proveedor_normalizado` (str)
- `itbms` (float)
- `total` (float)
- `cufe` (str, opcional)
- `numero_factura` (str)
- `tipo_documento` (str)

Flujo de dataset:
1. `build_labeled_dataset` normaliza ambos dataframes y los une por `invoice_id`.
2. La salida contiene prefijos `manual_` y `auto_` + columnas auxiliares (`has_auto_extraction`).
3. `evaluate` agrega columnas de match por campo y marca `needs_manual_review`.

## 2) Métricas implementadas

- Exactitud de fecha (`exactitud_fecha`)
- Exactitud de proveedor normalizado (`exactitud_proveedor`)
- Exactitud de total (`exactitud_total`, tolerancia configurable)
- Exactitud de ITBMS (`exactitud_itbms`, tolerancia configurable)
- Recall de CUFE (`recall_cufe`, solo considera filas con CUFE manual)
- Porcentaje de revisión manual (`porcentaje_revision_manual`)
- Tasa de error por proveedor (`error_rate_by_supplier`)

## 3) Ejecución con datos simulados

```bash
python3 evaluation/invoice_evaluation.py
```

Esto genera `evaluation_report.json` con:
- `summary_metrics`
- `row_evaluation`

## 4) Integración al pipeline actual

Integración recomendada al final del pipeline OCR/ETL:

1. Persistir salida automática en una tabla/CSV con el esquema base.
2. Cargar ground truth manual del mismo periodo.
3. Invocar `InvoiceEvaluator` para producir dataset etiquetado y métricas.
4. Exportar reporte JSON/CSV a un bucket/carpeta de monitoreo.
5. Agendar ejecución diaria/semanal para seguimiento de calidad.

Snippet de integración:

```python
import pandas as pd
from evaluation.invoice_evaluation import InvoiceEvaluator, EvalConfig

manual_df = pd.read_csv("manual_ground_truth.csv")
auto_df = pd.read_csv("pipeline_output.csv")

evaluator = InvoiceEvaluator(EvalConfig(amount_tolerance=0.05))
labeled = evaluator.build_labeled_dataset(manual_df, auto_df)
row_eval, metrics = evaluator.evaluate(labeled)
evaluator.export_report(row_eval, metrics, "reports/eval_2026_01.csv", fmt="csv")
```

## 5) Recomendaciones de iteración

- Definir cortes por tipo_documento para detectar regresiones por clase.
- Versionar diccionario de normalización de proveedores.
- Separar métricas de extracción vs métricas de clasificación (tipo_documento).
- Agregar umbrales y alertas (ej. exactitud_total < 0.98).
- Registrar `model_version` y `run_id` para trazabilidad.
