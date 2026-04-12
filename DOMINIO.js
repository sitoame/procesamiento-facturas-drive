const EXTRACCION_METODO = {
  OCR: 'ocr',
  CONSULTA_CUFE: 'consulta_cufe'
};

const UMBRAL_TOTAL_OCR = 1000;
const MAX_ITBMS_RATE = 0.07;

function parseInvoiceText(text) {
  const safeText = text || '';
  return {
    fecha: extractMatch(safeText, /FECHA AUTORIZACIÓN\s*(\d{2}\/\d{2}\/\d{4})/i),
    proveedorRaw: extractMatch(safeText, /NOMBRE\s*([^\n]+?)\s*DIRECCIÓN/i),
    itbms: extractNumber(safeText, /ITBMS Total:\s*(\d{1,6}(?:[.,]\d{3})*(?:[.,]\d+)?)/i),
    total: extractNumber(safeText, /Valor Total:\s*(\d{1,6}(?:[.,]\d{3})*(?:[.,]\d+)?)/i),
    cufe: extractMatch(safeText, /\[CUFE\]\s*([A-Z0-9-]+)\s*PROTOCOLO/i)
  };
}

function processExtractedInvoice(parsed, method, providerCatalog) {
  const data = {
    fecha: parsed.fecha || '',
    proveedor: matchProvider(parsed.proveedorRaw, providerCatalog),
    itbms: parsed.itbms,
    total: parsed.total,
    cufe: parsed.cufe || '',
    metodoExtraccion: method,
    confianza: method === EXTRACCION_METODO.CONSULTA_CUFE ? 1 : estimateOcrConfidence(parsed)
  };

  const validationFlags = {
    invalidTotalByOcrThreshold: false,
    invalidItbmsByOcrThreshold: false
  };

  if (method === EXTRACCION_METODO.OCR) {
    applyOcrBusinessValidations(data, validationFlags);
  }

  return { data, validationFlags };
}

function applyOcrBusinessValidations(data, flags) {
  if (typeof data.total === 'number' && data.total > UMBRAL_TOTAL_OCR) {
    data.total = '';
    flags.invalidTotalByOcrThreshold = true;
  }

  if (typeof data.itbms === 'number' && typeof data.total === 'number' && data.total > 0) {
    if (data.itbms > data.total * MAX_ITBMS_RATE) {
      data.itbms = '';
      flags.invalidItbmsByOcrThreshold = true;
    }
  }
}

function matchProvider(rawProvider, providerCatalog) {
  if (!rawProvider) return '';
  const candidate = rawProvider.trim();
  if (!candidate) return '';
  const hasMatch = providerCatalog.some(function (provider) {
    return provider === candidate;
  });
  return hasMatch ? candidate : '';
}

function estimateOcrConfidence(parsed) {
  const fields = [parsed.fecha, parsed.proveedorRaw, parsed.itbms, parsed.total, parsed.cufe];
  const filled = fields.filter(function (value) {
    return value !== '' && value !== null && typeof value !== 'undefined';
  }).length;
  return Number((filled / fields.length).toFixed(2));
}

function selectExtractionMethod(fileName) {
  const base = (fileName || '').replace(/\.pdf$/i, '').trim();
  return isLikelyCufe(base) ? EXTRACCION_METODO.CONSULTA_CUFE : EXTRACCION_METODO.OCR;
}

function isLikelyCufe(value) {
  return /^[A-Z0-9-]{30,}$/.test(value);
}

function buildOutputRow(data, fileId, fileUrl) {
  return [
    data.fecha,
    data.proveedor,
    data.itbms,
    data.total,
    data.cufe,
    data.metodoExtraccion,
    data.confianza,
    fileId,
    fileUrl
  ];
}

function computeEmptyFieldRate(data) {
  const fields = [data.fecha, data.proveedor, data.itbms, data.total, data.cufe];
  const empty = fields.filter(function (value) {
    return value === '' || value === null || typeof value === 'undefined';
  }).length;
  return Number((empty / fields.length).toFixed(2));
}

function extractMatch(text, regex) {
  const match = text.match(regex);
  return match && match[1] ? match[1].trim() : '';
}

function extractNumber(text, regex) {
  const match = text.match(regex);
  if (!match || !match[1]) return '';
  const normalized = match[1].replace(/\./g, '').replace(',', '.');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : '';
}

const DomainApi = {
  EXTRACCION_METODO,
  parseInvoiceText,
  processExtractedInvoice,
  applyOcrBusinessValidations,
  matchProvider,
  selectExtractionMethod,
  buildOutputRow,
  computeEmptyFieldRate
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = DomainApi;
}
