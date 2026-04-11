# Backend de extracción de facturas (FastAPI)

Servicio HTTP en Python para recibir PDFs/imágenes en base64 y devolver JSON estructurado para consumo desde Google Apps Script.

## Estructura

```text
.
├── app/
│   ├── __init__.py
│   ├── main.py
│   ├── models.py
│   ├── core/
│   │   └── __init__.py
│   └── services/
│       ├── __init__.py
│       ├── document.py
│       ├── parsing.py
│       └── pipeline.py
├── requirements.txt
└── README.md
```

## Arranque local

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

## Endpoint

- `POST /extract-invoice`
- Payload esperado:

```json
{
  "fileName": "archivo.pdf",
  "mimeType": "application/pdf",
  "contentBase64": "...",
  "driveFileId": "abc123"
}
```

## Probar con curl

### 1) Generar base64 de un archivo

```bash
BASE64_CONTENT=$(base64 -w 0 ./ejemplo.pdf)
```

> En macOS usa: `base64 ./ejemplo.pdf | tr -d '\n'`

### 2) Ejecutar request

```bash
curl -X POST "http://localhost:8000/extract-invoice" \
  -H "Content-Type: application/json" \
  -d "{\"fileName\":\"ejemplo.pdf\",\"mimeType\":\"application/pdf\",\"contentBase64\":\"${BASE64_CONTENT}\",\"driveFileId\":\"abc123\"}"
```

### 3) Health check

```bash
curl "http://localhost:8000/health"
```

## Notas técnicas

- El flujo OCR está preparado vía `run_ocr_stub` para conectar un motor real (Tesseract, visión documental o multimodal).
- Si el OCR no está conectado, se usa fallback heurístico sobre texto detectado (en PDF, `pypdf` como extracción inicial).
- Se incluyen validaciones de entrada, normalización y validación semántica del resultado.
