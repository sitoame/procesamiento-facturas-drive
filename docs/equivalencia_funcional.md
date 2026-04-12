# Mapeo de equivalencia funcional

## Reglas obligatorias conservadas

| Requisito | Implementación optimizada | Evidencia |
|---|---|---|
| Método de extracción (`ocr`/`consulta_cufe`) | `run_document_pipeline` selecciona `consulta_cufe` cuando detecta CUFE en nombre; en caso contrario usa `ocr`. | `app/services/pipeline.py` |
| Confianza | Para `consulta_cufe`, confianza fija en `1.0`; para OCR se conserva cálculo heurístico previo. | `app/services/pipeline.py`, `app/services/parsing.py` |
| Proveedor solo si hay match | El resolver retorna `None` cuando no hay match de catálogo (sin fallback al texto detectado). | `app/domain/provider_matching.py` |
| Validación OCR total e ITBMS | Regla pura: total > 1000 => vacío; ITBMS > 7% de total => vacío. | `app/domain/invoice_rules.py` |
| Carpeta procesada | No se altera el flujo de checkpoint y registro de procesados en Apps Script. | `CODE.gs` |

## Compatibilidad de interfaces

- Se conserva endpoint `POST /extract-invoice` y contrato base de request/response.
- Se extiende `InvoiceResult` con `metodo_extraccion` sin romper campos existentes.
- Se mantienen módulos públicos en `app/services/*` con nombres previos.
