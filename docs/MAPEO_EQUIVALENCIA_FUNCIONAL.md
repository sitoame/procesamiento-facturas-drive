# Mapeo de equivalencia funcional

| Feature | Versión anterior | Versión optimizada |
|---|---|---|
| Procesamiento de PDFs en carpeta y subcarpetas | `findAllPdfs` recursivo | `listAllPdfs` + `findAllPdfs` recursivo (misma cobertura) |
| Prevención de reproceso | Hoja `Archivos Procesados` | Hoja `Archivos Procesados` + movimiento a `_PROCESADOS` |
| Duplicidad de factura | Validación por CUFE o ID de archivo | Validación por CUFE o ID de archivo (columna actualizada) |
| Extracción de texto | Consulta CUFE y OCR | Consulta CUFE y OCR con selección por nombre de archivo |
| Parseo de factura | Regex acopladas al pipeline | Regex en módulo de dominio testeable |
| Método de extracción | No persistido | Columna `Método extracción` (`ocr` o `consulta_cufe`) |
| Confianza | No persistida | Columna `Confianza`; en `consulta_cufe` = `1` |
| Proveedor | Se guardaba texto extraído | Solo se escribe si hay match exacto en catálogo |
| Validaciones OCR | No unificadas | `total > 1000` => vacío; `itbms > 7% total` => vacío |
| Métricas | Sin registro mínimo estructurado | Hoja de métricas con tiempo, método y tasa de campos vacíos |
