# Decisiones técnicas y trade-offs

## Decisiones

1. **Separación por capas**
   - Dominio en `app/domain` (reglas puras y matching).
   - Infraestructura en `app/infrastructure` (detección/consulta CUFE).
   - Orquestación en `app/services/pipeline.py`.

2. **Validaciones críticas como funciones puras**
   - Permite pruebas unitarias directas y reduce complejidad ciclomática en parsing.

3. **Métricas mínimas en cada ejecución**
   - Se registran `extraction_ms`, `method`, `empty_fields_rate`, `invalid_total`, `invalid_itbms` en `meta`.

4. **Proveedor sin normalización automática**
   - Se elimina fallback por texto libre para evitar falsos positivos.

## Trade-offs

- `consulta_cufe` queda con stub de infraestructura para mantener desacople; la integración real requiere cliente HTTP con manejo de retry/backoff.
- El pipeline mantiene OCR stub por compatibilidad, pero el contrato ya permite reemplazo sin tocar reglas de dominio.
