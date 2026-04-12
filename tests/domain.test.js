const test = require('node:test');
const assert = require('node:assert/strict');
const {
  EXTRACCION_METODO,
  parseInvoiceText,
  processExtractedInvoice,
  matchProvider,
  selectExtractionMethod
} = require('../DOMINIO');

test('metodo consulta_cufe asigna confianza 1', () => {
  const parsed = { fecha: '01/01/2026', proveedorRaw: 'Proveedor A', itbms: 7, total: 100, cufe: 'ABC' };
  const result = processExtractedInvoice(parsed, EXTRACCION_METODO.CONSULTA_CUFE, ['Proveedor A']);
  assert.equal(result.data.metodoExtraccion, 'consulta_cufe');
  assert.equal(result.data.confianza, 1);
});

test('match proveedor solo exacto con catalogo', () => {
  assert.equal(matchProvider('Proveedor A', ['Proveedor A']), 'Proveedor A');
  assert.equal(matchProvider('proveedor a', ['Proveedor A']), '');
  assert.equal(matchProvider('Proveedor Z', ['Proveedor A']), '');
});

test('ocr invalida total > 1000', () => {
  const parsed = { fecha: '', proveedorRaw: '', itbms: 10, total: 1200, cufe: '' };
  const result = processExtractedInvoice(parsed, EXTRACCION_METODO.OCR, []);
  assert.equal(result.data.total, '');
  assert.equal(result.validationFlags.invalidTotalByOcrThreshold, true);
});

test('ocr invalida itbms si supera 7% del total', () => {
  const parsed = { fecha: '', proveedorRaw: '', itbms: 8, total: 100, cufe: '' };
  const result = processExtractedInvoice(parsed, EXTRACCION_METODO.OCR, []);
  assert.equal(result.data.itbms, '');
  assert.equal(result.validationFlags.invalidItbmsByOcrThreshold, true);
});

test('selector de metodo usa nombre CUFE', () => {
  const method = selectExtractionMethod('FE0120000155655496-2-2017-9000002025010300907213110010113575023157.pdf');
  assert.equal(method, EXTRACCION_METODO.CONSULTA_CUFE);
  assert.equal(selectExtractionMethod('archivo.pdf'), EXTRACCION_METODO.OCR);
});

test('parser extrae campos base', () => {
  const text = 'FECHA AUTORIZACIÓN 01/02/2026 NOMBRE Proveedor A DIRECCIÓN x ITBMS Total: 7.00 Valor Total: 100.00 [CUFE] ABC-123 PROTOCOLO';
  const parsed = parseInvoiceText(text);
  assert.equal(parsed.fecha, '01/02/2026');
  assert.equal(parsed.proveedorRaw, 'Proveedor A');
  assert.equal(parsed.cufe, 'ABC-123');
});
