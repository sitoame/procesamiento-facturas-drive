# Backend de extracción de facturas (FastAPI)

Servicio HTTP para recibir PDFs/imágenes en base64 y devolver JSON estructurado.

## Arquitectura limpia

- **Entrada (API):** `app/main.py`
- **Dominio (reglas):** `app/domain/*`
- **Infraestructura (OCR/CUFE):** `app/infrastructure/*`
- **Orquestación pipeline:** `app/services/pipeline.py`

## Reglas críticas conservadas

- Método de extracción: `ocr` o `consulta_cufe`.
- Confianza: `consulta_cufe` siempre retorna `1.0`.
- Proveedor solo se escribe si hay match de catálogo.
- OCR:
  - `total > 1000` se invalida.
  - `itbms > 7% del total` se invalida.

## Arranque local

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
make run
```

## Tests

```bash
python -m unittest discover -s tests -p "test_*.py"
```

## Endpoint

`POST /extract-invoice`

```json
{
  "fileName": "archivo.pdf",
  "mimeType": "application/pdf",
  "contentBase64": "...",
  "driveFileId": "abc123"
}
```

Respuesta incluye `data.metodo_extraccion` y métricas en `meta.metrics`.
