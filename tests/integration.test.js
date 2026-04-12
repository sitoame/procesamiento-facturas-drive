const test = require('node:test');
const assert = require('node:assert/strict');
const {
  EXTRACCION_METODO,
  processExtractedInvoice,
  buildOutputRow
} = require('../DOMINIO');

test('integracion salida conserva metodo y confianza', () => {
  const parsed = { fecha: '05/03/2026', proveedorRaw: 'Proveedor A', itbms: 7, total: 100, cufe: 'CUFE-1' };
  const result = processExtractedInvoice(parsed, EXTRACCION_METODO.CONSULTA_CUFE, ['Proveedor A']);
  const row = buildOutputRow(result.data, 'file-1', 'http://drive/file-1');

  assert.deepEqual(row, ['05/03/2026', 'Proveedor A', 7, 100, 'CUFE-1', 'consulta_cufe', 1, 'file-1', 'http://drive/file-1']);
});

test('integracion proveedor vacio sin match y validaciones ocr', () => {
  const parsed = { fecha: '05/03/2026', proveedorRaw: 'Otro', itbms: 80, total: 1001, cufe: 'CUFE-2' };
  const result = processExtractedInvoice(parsed, EXTRACCION_METODO.OCR, ['Proveedor A']);

  assert.equal(result.data.proveedor, '');
  assert.equal(result.data.total, '');
  assert.equal(result.data.itbms, 80);
  assert.equal(result.validationFlags.invalidTotalByOcrThreshold, true);
});
