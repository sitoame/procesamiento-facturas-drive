# Procesamiento de facturas en Google Apps Script

Automatización para procesar PDFs en Drive, extraer datos de factura y registrar resultados en Google Sheets.

## Feats críticas implementadas

- `Metodo Extraccion` solo usa valores:
  - `ocr`
  - `consulta_cufe`
- `Confianza`:
  - `consulta_cufe` => `1`
  - `ocr` => score heurístico
- Proveedor:
  - solo se escribe si hay match con catálogo (alias o RUC)
  - sin match, proveedor vacío
- Validaciones en `ocr`:
  - `total > 1000` => se invalida (vacío)
  - `itbms > 7% del total` => se invalida (vacío)
- Flujo de carpeta procesada conservado:
  - registro de archivos procesados
  - checkpoints por carpeta

## Entry points

Funciones en `CONFIGURACION.gs`:
- `ENSA`, `FONDOS_COMERCIALES`, `PROSERV`, `MINIDEPOSITOS`, `FUMIEXPRESS`, `LADOÑA`, `multicarpetas`, `FACTURAS`.

Todas delegan en `procesarNuevosPdfs(idCarpetaPdf, nombreArchivoHojaCalculo)`.
