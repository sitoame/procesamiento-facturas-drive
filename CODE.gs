const NOMBRE_HOJA_DATOS = 'Datos Facturas';
const NOMBRE_HOJA_REGISTRO = 'Archivos Procesados';

const ENCABEZADOS_DATOS = [
  'Fecha',
  'Proveedor',
  'Proveedor Normalizado',
  'ITBMS',
  'Total',
  'CUFE',
  'Tipo Documento',
  'Metodo Extraccion',
  'Confianza',
  'Estado',
  'Observaciones',
  'ID Archivo Drive',
  'Link'
];

const ENCABEZADOS_REGISTRO = ['ID Archivo Drive', 'Nombre Archivo', 'Fecha Procesado'];

function procesarNuevosPdfs(idCarpetaPdf, nombreArchivoHojaCalculo) {
  const folder = DriveApp.getFolderById(idCarpetaPdf);
  const spreadsheet = getOrCreateSpreadsheet(
    idCarpetaPdf,
    nombreArchivoHojaCalculo,
    NOMBRE_HOJA_DATOS,
    ENCABEZADOS_DATOS
  );

  const dataSheet = spreadsheet.getSheetByName(NOMBRE_HOJA_DATOS);
  const processedLogSheet = getOrCreateProcessedLogSheet(
    spreadsheet,
    NOMBRE_HOJA_REGISTRO,
    ENCABEZADOS_REGISTRO
  );

  const processedFileIds = getProcessedFileIds(processedLogSheet);
  const allPdfs = [];
  findAllPdfs(folder, allPdfs);

  let nuevosProcesados = 0;

  for (let i = 0; i < allPdfs.length; i++) {
    const file = allPdfs[i];
    const fileId = file.getId();

    if (processedFileIds.has(fileId)) {
      continue;
    }

    const contexto = construirContextoArchivo(file);
    contexto.dataSheet = dataSheet;
    contexto.processedLogSheet = processedLogSheet;

    try {
      const clasificacion = clasificarDocumento(contexto);

      let resultado;
      if (clasificacion === 'NO_FISCAL') {
        resultado = {
          ok: false,
          metodoExtraccion: 'CLASIFICADOR',
          confianza: 0.9,
          datos: {},
          observaciones: 'Documento no fiscal detectado por clasificación'
        };
      } else if (clasificacion === 'FACTURA_ELECTRONICA_CUFE') {
        resultado = extraerDesdeDGI(contexto);
        if (!resultado.ok) {
          resultado = extraerDesdeTextoEmbebido(contexto);
        }
        if (!resultado.ok) {
          resultado = extraerDesdeVision(contexto);
        }
      } else if (clasificacion === 'ESCANEO_O_IMAGEN') {
        resultado = extraerDesdeVision(contexto);
        if (!resultado.ok) {
          resultado = extraerDesdeTextoEmbebido(contexto);
        }
      } else {
        resultado = extraerDesdeTextoEmbebido(contexto);
        if (!resultado.ok) {
          resultado = extraerDesdeVision(contexto);
        }
      }

      const normalizado = normalizarYValidar(resultado, contexto);
      guardarResultado(normalizado, contexto);
      processedFileIds.add(fileId);
      nuevosProcesados++;
    } catch (err) {
      Logger.log('Error en archivo ' + file.getName() + ' (' + fileId + '): ' + err.message);
      registrarProcesado(processedLogSheet, fileId, file.getName());
      processedFileIds.add(fileId);
    }
  }

  Logger.log('Proceso finalizado. Archivos nuevos procesados: ' + nuevosProcesados);
}

function construirContextoArchivo(file) {
  const fileName = file.getName();
  const nombreArchivoSinExtension = fileName.replace(/\.[^.]+$/i, '');
  const cufeDetectado = inferirCufeDesdeNombre(fileName);

  return {
    file: file,
    fileId: file.getId(),
    fileName: fileName,
    fileUrl: file.getUrl(),
    nombreArchivoSinExtension: nombreArchivoSinExtension,
    mimeType: file.getMimeType(),
    textoOCR: '',
    tamañoTextoOCR: 0,
    esPosibleCUFEEnNombre: pareceCufe(nombreArchivoSinExtension),
    nombreArchivo: fileName,
    link: file.getUrl(),
    cufeDetectado: cufeDetectado,
    tipoDocumento: 'FACTURA',
    clasificacionDocumento: 'PENDIENTE',
    dataSheet: null,
    processedLogSheet: null
  };
}

function clasificarDocumento(contexto) {
  // init texto OCR para clasif basada en contenido
  if (!contexto.textoOCR) {
    try {
      contexto.textoOCR = extractTextFromPdf(contexto.fileId) || '';
    } catch (err) {
      contexto.textoOCR = '';
    }
  }

  contexto.tamañoTextoOCR = limpiarTexto(contexto.textoOCR).length;

  if (contexto.esPosibleCUFEEnNombre) {
    contexto.clasificacionDocumento = 'FACTURA_ELECTRONICA_CUFE';
    contexto.tipoDocumento = 'FACTURA';
    return contexto.clasificacionDocumento;
  }

  if (textoPareceNoFiscal(contexto.textoOCR)) {
    contexto.clasificacionDocumento = 'NO_FISCAL';
    contexto.tipoDocumento = 'NO_FISCAL';
    return contexto.clasificacionDocumento;
  }

  if (textoTieneIndicadoresDeFactura(contexto.textoOCR)) {
    contexto.clasificacionDocumento = 'PDF_TEXTO';
    contexto.tipoDocumento = 'FACTURA';
    return contexto.clasificacionDocumento;
  }

  if (textoEsInsuficiente(contexto.textoOCR)) {
    contexto.clasificacionDocumento = 'ESCANEO_O_IMAGEN';
    contexto.tipoDocumento = 'FACTURA';
    return contexto.clasificacionDocumento;
  }

  contexto.clasificacionDocumento = 'PDF_TEXTO';
  contexto.tipoDocumento = 'FACTURA';
  return contexto.clasificacionDocumento;
}

function extraerDesdeDGI(contexto) {
  const cufe = inferirCufeDesdeNombre(contexto.nombreArchivo || contexto.fileName || '');
  if (!cufe) {
    return {
      ok: false,
      fecha: '',
      proveedor: '',
      proveedorNormalizado: '',
      itbms: '',
      total: '',
      cufe: '',
      tipoDocumento: contexto.tipoDocumento || 'FACTURA',
      metodoExtraccion: 'DGI',
      confianza: 0,
      estado: 'REVISION_MANUAL',
      observaciones: 'CUFE ausente o inválido en nombre de archivo',
      error: { tipo: 'CUFE_INVALIDO', detalle: 'No se detectó CUFE en el nombre del archivo' }
    };
  }

  const consulta = extractTextFromCufe(cufe);
  if (!consulta.ok) {
    return {
      ok: false,
      fecha: '',
      proveedor: '',
      proveedorNormalizado: '',
      itbms: '',
      total: '',
      cufe: cufe,
      tipoDocumento: contexto.tipoDocumento || 'FACTURA',
      metodoExtraccion: 'DGI',
      confianza: 0,
      estado: 'REVISION_MANUAL',
      observaciones: consulta.observaciones || 'Fallo de consulta DGI',
      error: {
        tipo: consulta.errorType || 'CONSULTA_DGI_FALLIDA',
        statusCode: consulta.statusCode || 0,
        detalle: consulta.observaciones || 'Sin detalle de error'
      }
    };
  }

  const parsed = parseInvoiceDataFromDgiText(consulta.text);
  const estado = parsed.estado || 'REVISION_MANUAL';
  const confianza = estado === 'OK' ? 0.95 : 0.4;

  return {
    ok: estado === 'OK',
    fecha: parsed.fecha,
    proveedor: parsed.proveedor,
    proveedorNormalizado: normalizarProveedor(parsed.proveedor),
    itbms: parsed.itbms,
    total: parsed.total,
    cufe: parsed.cufe || cufe,
    tipoDocumento: parsed.tipoDocumento || (contexto.tipoDocumento || 'FACTURA'),
    metodoExtraccion: 'DGI',
    confianza: confianza,
    estado: estado,
    observaciones: parsed.observaciones || 'Extracción DGI completada',
    datos: {
      fecha: parsed.fecha,
      proveedor: parsed.proveedor,
      itbms: parsed.itbms,
      total: parsed.total,
      cufe: parsed.cufe || cufe,
      ruc: parsed.ruc,
      numeroFactura: parsed.numeroFactura
    },
    textoFuente: consulta.text
  };
}

function extraerDesdeTextoEmbebido(contexto) {
  try {
    const texto = contexto.textoOCR || extractTextFromPdf(contexto.fileId);
    if (!texto) {
      return { ok: false, metodoExtraccion: 'OCR_DRIVE', confianza: 0, observaciones: 'Sin texto extraído' };
    }

    const datos = parseInvoiceData(texto);
    return {
      ok: true,
      metodoExtraccion: 'OCR_DRIVE',
      confianza: 0.75,
      textoFuente: texto,
      datos: datos,
      observaciones: 'Extracción OCR con Drive API'
    };
  } catch (err) {
    return {
      ok: false,
      metodoExtraccion: 'OCR_DRIVE',
      confianza: 0,
      observaciones: 'Fallo OCR: ' + err.message
    };
  }
}

function pareceCufe(nombre) {
  const limpio = limpiarTexto(nombre).toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!/^FE[A-Z0-9]{18,120}$/.test(limpio)) {
    return false;
  }
  return /\d/.test(limpio.slice(2));
}

function textoTieneIndicadoresDeFactura(texto) {
  const base = limpiarTexto(texto).toUpperCase();
  if (!base) return false;

  const indicadores = [
    'FECHA DE EMISION',
    'CUFE',
    'EMISOR',
    'VALOR TOTAL',
    'ITBMS'
  ];

  let hits = 0;
  for (let i = 0; i < indicadores.length; i++) {
    if (base.indexOf(indicadores[i]) > -1) hits++;
  }

  // 2+ indicadores reduce falsos positivos en OCR ruidoso
  return hits >= 2;
}

function textoPareceNoFiscal(texto) {
  const base = limpiarTexto(texto).toUpperCase();
  if (!base) return false;
  return /(ORDEN\s+DE\s+PEDIDO|COTIZACI[ÓO]N|PROFORMA)/i.test(base);
}

function textoEsInsuficiente(texto) {
  const raw = String(texto || '');
  const limpio = limpiarTexto(raw);
  if (!limpio) return true;

  const minChars = 80;
  if (limpio.length < minChars) return true;

  const sinEspacios = limpio.replace(/\s/g, '');
  const alnum = sinEspacios.replace(/[^A-Za-z0-9ÁÉÍÓÚÜÑáéíóúüñ]/g, '');
  const ratioAlnum = sinEspacios.length > 0 ? alnum.length / sinEspacios.length : 0;

  // ratio bajo suele indicar OCR con símbolos/ruido
  if (ratioAlnum < 0.55) return true;

  const tokens = limpio.split(/\s+/);
  const unicos = {};
  for (let i = 0; i < tokens.length; i++) {
    unicos[tokens[i]] = true;
  }
  const diversidad = Object.keys(unicos).length / Math.max(tokens.length, 1);

  // diversidad extrema baja sugiere texto repetitivo por OCR defectuoso
  if (tokens.length >= 20 && diversidad < 0.2) return true;

  return false;
}

function extraerDesdeVision(contexto) {
  return {
    ok: false,
    metodoExtraccion: 'VISION_STUB',
    confianza: 0,
    observaciones: 'Stub listo para integrar API externa'
  };
}

function normalizarYValidar(resultado, contexto) {
  const datosBase = resultado.datos || {};
  const proveedor = limpiarTexto(datosBase.proveedor || '');
  const proveedorNormalizado = normalizarProveedor(proveedor);

  const salida = {
    fecha: normalizarFecha(datosBase.fecha),
    proveedor: proveedor,
    proveedorNormalizado: proveedorNormalizado,
    itbms: toNumber(datosBase.itbms),
    total: toNumber(datosBase.total),
    cufe: limpiarTexto(datosBase.cufe || contexto.cufeDetectado || ''),
    tipoDocumento: contexto.tipoDocumento,
    metodoExtraccion: resultado.metodoExtraccion || 'N/D',
    confianza: resultado.confianza || 0,
    estado: resultado.estado || 'OK',
    observaciones: resultado.observaciones || '',
    driveFileId: contexto.fileId,
    link: contexto.link
  };

  if (!resultado.ok && salida.estado === 'OK') {
    salida.estado = 'PENDIENTE_REVISION';
  }

  if (!salida.fecha || !salida.proveedor || !salida.total) {
    salida.estado = 'PENDIENTE_REVISION';
    salida.observaciones = anexarObs(salida.observaciones, 'Campos obligatorios incompletos');
  }

  return salida;
}

function guardarResultado(resultado, contexto) {
  const sheet = contexto.dataSheet;
  const processedLogSheet = contexto.processedLogSheet;

  if (isDuplicateInvoice(sheet, resultado.cufe, resultado.driveFileId)) {
    registrarProcesado(processedLogSheet, contexto.fileId, contexto.nombreArchivo);
    return;
  }

  const rowData = [
    resultado.fecha,
    resultado.proveedor,
    resultado.proveedorNormalizado,
    resultado.itbms,
    resultado.total,
    resultado.cufe,
    resultado.tipoDocumento,
    resultado.metodoExtraccion,
    resultado.confianza,
    resultado.estado,
    resultado.observaciones,
    resultado.driveFileId,
    resultado.link
  ];

  sheet.appendRow(rowData);
  registrarProcesado(processedLogSheet, contexto.fileId, contexto.nombreArchivo);
}

function getOrCreateSpreadsheet(folderId, sheetName, tabName, headers) {
  const folder = DriveApp.getFolderById(folderId);
  const files = folder.getFilesByName(sheetName);
  let spreadsheet;

  if (files.hasNext()) {
    spreadsheet = SpreadsheetApp.open(files.next());
  } else {
    spreadsheet = SpreadsheetApp.create(sheetName);
    DriveApp.getFileById(spreadsheet.getId()).moveTo(folder);
  }

  let dataSheet = spreadsheet.getSheetByName(tabName);
  if (!dataSheet) {
    dataSheet = spreadsheet.insertSheet(tabName);
    if (spreadsheet.getSheets().length > 1 && spreadsheet.getSheets()[0].getName() === 'Hoja 1') {
      spreadsheet.deleteSheet(spreadsheet.getSheets()[0]);
    }
  }

  ensureHeaders(dataSheet, headers);
  return spreadsheet;
}

function getOrCreateProcessedLogSheet(spreadsheet, tabName, headers) {
  let logSheet = spreadsheet.getSheetByName(tabName);
  if (!logSheet) {
    logSheet = spreadsheet.insertSheet(tabName);
  }
  ensureHeaders(logSheet, headers);
  return logSheet;
}

function ensureHeaders(sheet, headers) {
  const existing = sheet.getLastRow() > 0
    ? sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
    : [];

  const mustRewrite =
    existing.length !== headers.length ||
    headers.some(function (h, idx) { return existing[idx] !== h; });

  if (sheet.getLastRow() === 0) {
    sheet.appendRow(headers);
    return;
  }

  if (mustRewrite) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  }
}

function getProcessedFileIds(processedLogSheet) {
  const fileIds = new Set();
  const lastRow = processedLogSheet.getLastRow();

  if (lastRow <= 1) {
    return fileIds;
  }

  const values = processedLogSheet.getRange(2, 1, lastRow - 1, 1).getValues();
  for (let i = 0; i < values.length; i++) {
    fileIds.add(values[i][0]);
  }

  return fileIds;
}

function registrarProcesado(processedLogSheet, fileId, fileName) {
  processedLogSheet.appendRow([fileId, fileName, new Date()]);
}

function extractTextFromPdf(fileId) {
  const pdfFile = DriveApp.getFileById(fileId);
  if (pdfFile.getMimeType() !== MimeType.PDF) {
    throw new Error('El archivo no es PDF');
  }

  const tempDoc = Drive.Files.create(
    { title: pdfFile.getName() + '_tmp_ocr', mimeType: MimeType.GOOGLE_DOCS },
    pdfFile.getBlob().setContentType(MimeType.PDF),
    { ocr: true, ocrLanguage: 'es' }
  );

  try {
    return DocumentApp.openById(tempDoc.id).getBody().getText();
  } finally {
    Drive.Files.remove(tempDoc.id);
  }
}

function parseInvoiceData(text) {
  const data = {
    fecha: '',
    proveedor: '',
    itbms: '',
    total: '',
    cufe: ''
  };

  const fechaMatch = text.match(/FECHA\s*AUTORIZACI[ÓO]N\s*:?\s*(\d{2}\/\d{2}\/\d{4})/i);
  if (fechaMatch) data.fecha = fechaMatch[1];

  const proveedorMatch = text.match(/NOMBRE\s*:?[\s\n]*([^\n]+?)\s*(?:DIRECCI[ÓO]N|RUC|DV|$)/i);
  if (proveedorMatch) data.proveedor = proveedorMatch[1].trim();

  const itbmsMatch = text.match(/ITBMS\s*Total\s*:?\s*(\d{1,6}(?:[\.,]\d{3})*(?:[\.,]\d+)?)/i);
  if (itbmsMatch) data.itbms = itbmsMatch[1];

  const totalMatch = text.match(/Valor\s*Total\s*:?\s*(\d{1,9}(?:[\.,]\d{3})*(?:[\.,]\d+)?)/i);
  if (totalMatch) data.total = totalMatch[1];

  const cufeMatch = text.match(/\[CUFE\]\s*([A-Z0-9-]+)/i);
  if (cufeMatch) data.cufe = cufeMatch[1].trim();

  return data;
}


function parseInvoiceDataFromDgiText(text) {
  const src = String(text || '');
  const normalized = src
    .replace(/\r/g, '\n')
    .replace(/[\t\f\v]+/g, ' ')
    .replace(/\u00A0/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .trim();

  const result = {
    fecha: '',
    proveedor: '',
    ruc: '',
    numeroFactura: '',
    itbms: '',
    total: '',
    cufe: '',
    tipoDocumento: 'FACTURA',
    estado: 'REVISION_MANUAL',
    observaciones: ''
  };

  const fechaCandidates = [
    /FECHA\s*DE\s*EMISI[ÓO]N\s*:?\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i,
    /FECHA\s*EMISI[ÓO]N\s*:?\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i,
    /FECHA\s*AUTORIZACI[ÓO]N\s*:?\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i
  ];
  result.fecha = normalizeDateCapture(extractFirstMatch(normalized, fechaCandidates));

  const proveedorCandidates = [
    /(?:^|\n)\s*EMISOR\s*:?\s*([^\n]+)/i,
    /(?:^|\n)\s*NOMBRE\s*(?:DEL\s*EMISOR)?\s*:?\s*([^\n]+)/i,
    /(?:^|\n)\s*RAZ[ÓO]N\s*SOCIAL\s*:?\s*([^\n]+)/i
  ];
  result.proveedor = cleanField(extractFirstMatch(normalized, proveedorCandidates));

  const cufeCandidates = [
    /(?:^|\n)\s*CUFE\s*:?\s*([A-Z0-9\-]{20,140})/i,
    /(?:^|\n)\s*CODIGO\s*UNICO\s*DE\s*FACTURA\s*ELECTR[ÓO]NICA\s*:?\s*([A-Z0-9\-]{20,140})/i,
    /\b(FE[A-Z0-9]{18,140})\b/
  ];
  result.cufe = cleanField(extractFirstMatch(normalized, cufeCandidates)).toUpperCase().replace(/[^A-Z0-9]/g, '');

  const itbmsCandidates = [
    /ITBMS(?:\s*TOTAL)?\s*:?\s*(B\/.\s*)?([\d.,]+(?:\s*[\d.,]+)*)/i,
    /IMPUESTO\s*(?:TOTAL)?\s*:?\s*(B\/.\s*)?([\d.,]+(?:\s*[\d.,]+)*)/i
  ];
  result.itbms = parseMoneyCapture(extractFirstMatch(normalized, itbmsCandidates, 2));

  const totalCandidates = [
    /VALOR\s*TOTAL\s*:?\s*(B\/.\s*)?([\d.,]+(?:\s*[\d.,]+)*)/i,
    /TOTAL\s*(?:A\s*PAGAR)?\s*:?\s*(B\/.\s*)?([\d.,]+(?:\s*[\d.,]+)*)/i,
    /MONTO\s*TOTAL\s*:?\s*(B\/.\s*)?([\d.,]+(?:\s*[\d.,]+)*)/i
  ];
  result.total = parseMoneyCapture(extractFirstMatch(normalized, totalCandidates, 2));

  const facturaCandidates = [
    /N[ÚU]MERO\s*DE\s*FACTURA\s*:?\s*([A-Z0-9\-\/]+)/i,
    /FACTURA\s*N[O°º#]?\s*:?\s*([A-Z0-9\-\/]+)/i,
    /NO\.\s*FACTURA\s*:?\s*([A-Z0-9\-\/]+)/i
  ];
  result.numeroFactura = cleanField(extractFirstMatch(normalized, facturaCandidates));

  const rucCandidates = [
    /(?:^|\n)\s*RUC\s*:?\s*([0-9\-]{4,25})/i,
    /REGISTRO\s*[ÚU]NICO\s*DE\s*CONTRIBUYENTE\s*:?\s*([0-9\-]{4,25})/i
  ];
  result.ruc = cleanField(extractFirstMatch(normalized, rucCandidates));

  const missing = [];
  if (!result.fecha) missing.push('fecha');
  if (!result.proveedor) missing.push('proveedor');
  if (result.total === '' || result.total === null) missing.push('total');
  if (!result.cufe) missing.push('cufe');

  if (missing.length === 0) {
    result.estado = 'OK';
    result.observaciones = 'Campos clave DGI extraídos';
  } else {
    result.estado = 'REVISION_MANUAL';
    result.observaciones = 'Campos clave faltantes: ' + missing.join(', ');
  }

  return result;
}

function extractFirstMatch(text, patterns, groupIndex) {
  const idx = groupIndex || 1;
  for (let i = 0; i < patterns.length; i++) {
    const m = text.match(patterns[i]);
    if (m && m[idx]) return m[idx];
  }
  return '';
}

function cleanField(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeDateCapture(value) {
  const raw = cleanField(value).replace(/\-/g, '/');
  if (!raw) return '';
  const m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return raw;
  const dd = ('0' + m[1]).slice(-2);
  const mm = ('0' + m[2]).slice(-2);
  let yyyy = m[3];
  if (yyyy.length === 2) yyyy = '20' + yyyy;
  return yyyy + '-' + mm + '-' + dd;
}

function parseMoneyCapture(value) {
  const raw = cleanField(value);
  if (!raw) return '';
  const compact = raw.replace(/\s/g, '').replace(/B\//ig, '').replace(/[^\d,.-]/g, '');
  if (!compact) return '';

  const lastComma = compact.lastIndexOf(',');
  const lastDot = compact.lastIndexOf('.');
  let normalized = compact;

  if (lastComma > -1 && lastDot > -1) {
    if (lastComma > lastDot) {
      normalized = compact.replace(/\./g, '').replace(',', '.');
    } else {
      normalized = compact.replace(/,/g, '');
    }
  } else if (lastComma > -1) {
    const decimalLike = /,\d{1,2}$/.test(compact);
    normalized = decimalLike ? compact.replace(/\./g, '').replace(',', '.') : compact.replace(/,/g, '');
  }

  const n = parseFloat(normalized);
  return isNaN(n) ? '' : n;
}

function isDuplicateInvoice(sheet, cufe, driveFileId) {
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return false;

  const values = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();
  for (let i = 0; i < values.length; i++) {
    const existingCufe = values[i][5];
    const existingDriveFileId = values[i][11];
    if ((cufe && existingCufe === cufe) || existingDriveFileId === driveFileId) {
      return true;
    }
  }
  return false;
}

function findAllPdfs(folder, pdfFilesArray) {
  const files = folder.getFilesByType(MimeType.PDF);
  while (files.hasNext()) {
    pdfFilesArray.push(files.next());
  }

  const subFolders = folder.getFolders();
  while (subFolders.hasNext()) {
    findAllPdfs(subFolders.next(), pdfFilesArray);
  }
}

function inferirCufeDesdeNombre(nombreArchivo) {
  const base = nombreArchivo.replace(/\.pdf$/i, '');
  if (!pareceCufe(base)) return '';
  return base.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function normalizarProveedor(proveedor) {
  return proveedor
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function limpiarTexto(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizarFecha(value) {
  const txt = limpiarTexto(value);
  if (!txt) return '';
  const m = txt.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return txt;
  return m[3] + '-' + m[2] + '-' + m[1];
}

function toNumber(value) {
  if (value === null || value === undefined || value === '') return '';
  const raw = String(value).trim().replace(/\s/g, '');
  const normalized = raw.indexOf(',') > -1 && raw.indexOf('.') > -1
    ? raw.replace(/\./g, '').replace(',', '.')
    : raw.replace(',', '.');
  const num = parseFloat(normalized);
  return isNaN(num) ? '' : num;
}

function anexarObs(base, extra) {
  const b = limpiarTexto(base);
  if (!b) return extra;
  return b + ' | ' + extra;
}
