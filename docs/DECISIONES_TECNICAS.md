# Decisiones técnicas y trade-offs

## Decisiones
- Se separó dominio puro en `DOMINIO.js` para aislar reglas de negocio y habilitar tests sin dependencias de Apps Script.
- Se mantuvieron interfaces públicas (`procesarNuevosPdfs`, `ENSA`, `PROSERV`, etc.) para compatibilidad operativa.
- Se incorporó carpeta `_PROCESADOS` para mover archivos ya procesados y reforzar idempotencia en reintentos.
- Se agregó hoja `Metricas Pipeline` para registrar tiempo de extracción, método y tasa de campos vacíos.

## Trade-offs
- Match de proveedor es exacto y sensible a mayúsculas: reduce falsos positivos, pero exige catálogo curado.
- La detección de método por nombre de archivo (CUFE vs OCR) evita heurísticas costosas, aunque depende de convención de nomenclatura.
- El cálculo de confianza OCR es una aproximación por completitud de campos; es determinístico y barato, no probabilístico.
