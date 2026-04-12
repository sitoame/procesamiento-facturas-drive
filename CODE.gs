const NOMBRE_HOJA_DATOS = 'Datos Facturas';
const NOMBRE_HOJA_REGISTRO = 'Archivos Procesados';
const NOMBRE_HOJA_CATALOGO = 'Catalogo Proveedores';
const NOMBRE_HOJA_CARPETAS = 'Carpetas Procesadas';

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
const ENCABEZADOS_CARPETAS = [
  'Folder ID',
  'Ultimo Checkpoint',
  'Ultimo Conteo PDF',
  'Ultima Ejecucion',
  'Estado',
  'Observaciones'
];
const ENCABEZADOS_CATALOGO = [
  'Proveedor Canonico',
  'Alias',
  'RUC',
  'Tipo Documento Frecuente',
  'Activo'
];

const METODO_OCR = 'ocr';
const METODO_CONSULTA_CUFE = 'consulta_cufe';
const MAX_TOTAL_OCR = 1000;
const MAX_ITBMS_RATIO_OCR = 0.07;

function procesarNuevosPdfs(idCarpetaPdf, nombreArchivoHojaCalculo) {
  const folder = DriveApp.getFolderById(idCarpetaPdf);
  const spreadsheet = getOrCreateSpreadsheet(idCarpetaPdf, nombreArchivoHojaCalculo, NOMBRE_HOJA_DATOS, ENCABEZADOS_DATOS);
  const dataSheet = spreadsheet.getSheetByName(NOMBRE_HOJA_DATOS);
  const processedLogSheet = getOrCreateProcessedLogSheet(spreadsheet, NOMBRE_HOJA_REGISTRO, ENCABEZADOS_REGISTRO);
  const folderCheckpointSheet = getOrCreateFolderCheckpointSheet(spreadsheet, NOMBRE_HOJA_CARPETAS, ENCABEZADOS_CARPETAS);
  const catalogoProveedores = getCatalogoProveedores(spreadsheet);

  const processedFileIds = getProcessedFileIds(processedLogSheet);
  const checkpointCtx = createFolderCheckpointContext(folderCheckpointSheet);
  let nuevosProcesados = 0;

  try {
    const allPdfs = collectPdfsWithCheckpoint(folder, checkpointCtx);

    for (let i = 0; i < allPdfs.length; i++) {
      const file = allPdfs[i];
      const fileId = file.getId();
      if (processedFileIds.has(fileId)) continue;

      const contexto = construirContextoArchivo(file);
      contexto.dataSheet = dataSheet;
      contexto.processedLogSheet = processedLogSheet;
      contexto.catalogoProveedores = catalogoProveedores;

      try {
        const resultado = extraerYNormalizarFactura(contexto);
        guardarResultado(resultado, contexto);
        processedFileIds.add(fileId);
        nuevosProcesados++;
      } catch (err) {
        Logger.log('Error en archivo ' + file.getName() + ' (' + fileId + '): ' + err.message);
        registrarProcesado(processedLogSheet, fileId, file.getName());
        processedFileIds.add(fileId);
      }
    }
  } finally {
    flushFolderCheckpointContext(checkpointCtx);
  }

  Logger.log('Proceso finalizado. Archivos nuevos procesados: ' + nuevosProcesados);
}

function extraerYNormalizarFactura(contexto) {
  const startedAt = new Date().getTime();
  const clasificacion = clasificarDocumento(contexto);

  if (clasificacion === 'NO_FISCAL') {
    return buildNoFiscalResult(contexto, startedAt);
  }

  let extraction = null;
  if (clasificacion === 'FACTURA_ELECTRONICA_CUFE') {
    extraction = extraerPorConsultaCufe(contexto);
  }
  if (!extraction || !extraction.ok) {
    extraction = extraerPorOcr(contexto);
  }

  return normalizarYValidar(extraction, contexto, startedAt);
}

function buildNoFiscalResult(contexto, startedAt) {
  const metricas = buildExtractionMetrics(startedAt, METODO_OCR, {
    fecha: '',
    proveedor: '',
    itbms: '',
    total: '',
    cufe: ''
  }, {
    total: false,
    itbms: false
  });

  return {
    fecha: '',
    proveedor: '',
    proveedorNormalizado: '',
    itbms: '',
    total: '',
    cufe: contexto.cufeDetectado || '',
    tipoDocumento: 'NO_FISCAL',
    metodoExtraccion: METODO_OCR,
    confianza: 0,
    estado: 'NO_FISCAL',
    observaciones: 'Documento no fiscal detectado | ' + formatMetricsForObs(metricas),
    driveFileId: contexto.fileId,
    link: contexto.link
  };
}

function construirContextoArchivo(file) {
  const fileName = file.getName();
  return {
    file: file,
    fileId: file.getId(),
    fileName: fileName,
    fileUrl: file.getUrl(),
    mimeType: file.getMimeType(),
    textoOCR: '',
    cufeDetectado: inferirCufeDesdeNombre(fileName),
    tipoDocumento: 'FACTURA',
    clasificacionDocumento: 'PENDIENTE',
    dataSheet: null,
    processedLogSheet: null,
    catalogoProveedores: null,
    link: file.getUrl()
  };
}

function clasificarDocumento(contexto) {
  // init txt
  if (!contexto.textoOCR) {
    try {
      contexto.textoOCR = extractTextFromPdf(contexto.fileId) || '';
    } catch (err) {
      contexto.textoOCR = '';
    }
  }

  if (contexto.cufeDetectado) {
    contexto.clasificacionDocumento = 'FACTURA_ELECTRONICA_CUFE';
    contexto.tipoDocumento = 'FACTURA';
    return contexto.clasificacionDocumento;
  }

  if (textoPareceNoFiscal(contexto.textoOCR)) {
    contexto.clasificacionDocumento = 'NO_FISCAL';
    contexto.tipoDocumento = 'NO_FISCAL';
    return contexto.clasificacionDocumento;
  }

  contexto.clasificacionDocumento = 'PDF_TEXTO';
  contexto.tipoDocumento = 'FACTURA';
  return contexto.clasificacionDocumento;
}

function extraerPorConsultaCufe(contexto) {
  const cufe = contexto.cufeDetectado || inferirCufeDesdeNombre(contexto.fileName);
  if (!cufe) return { ok: false, metodoExtraccion: METODO_CONSULTA_CUFE, datos: {}, observaciones: 'CUFE no detectado' };

  const consulta = extractTextFromCufe(cufe);
  if (!consulta || !consulta.ok) {
    return { ok: false, metodoExtraccion: METODO_CONSULTA_CUFE, datos: {}, observaciones: 'Consulta CUFE fallida' };
  }

  const datos = parseInvoiceDataFromDgiText(consulta.text);
  datos.cufe = datos.cufe || cufe;
  return {
    ok: true,
    metodoExtraccion: METODO_CONSULTA_CUFE,
    confianza: 1,
    datos: datos,
    observaciones: 'Extracción por consulta CUFE'
  };
}

function extraerPorOcr(contexto) {
  try {
    const texto = contexto.textoOCR || extractTextFromPdf(contexto.fileId) || '';
    if (!texto) {
      return { ok: false, metodoExtraccion: METODO_OCR, datos: {}, observaciones: 'Sin texto OCR' };
    }

    const datos = parseInvoiceDataGeneric(texto);
    return {
      ok: true,
      metodoExtraccion: METODO_OCR,
      datos: datos,
      observaciones: 'Extracción OCR'
    };
  } catch (err) {
    return { ok: false, metodoExtraccion: METODO_OCR, datos: {}, observaciones: 'Fallo OCR: ' + err.message };
  }
}

function normalizarYValidar(resultado, contexto, startedAt) {
  const datosBase = resultado.datos || {};
  const metodo = resultado.metodoExtraccion === METODO_CONSULTA_CUFE ? METODO_CONSULTA_CUFE : METODO_OCR;
  const proveedorResolved = resolverProveedorCanonico({
    nombreDetectado: datosBase.proveedor || '',
    rucDetectado: datosBase.ruc || '',
    catalogo: contexto.catalogoProveedores
  });

  const salida = {
    fecha: normalizarFecha(datosBase.fecha),
    proveedor: proveedorResolved.proveedor,
    proveedorNormalizado: proveedorResolved.proveedorNormalizado,
    itbms: toNumber(datosBase.itbms),
    total: toNumber(datosBase.total),
    cufe: limpiarTexto(datosBase.cufe || contexto.cufeDetectado || ''),
    tipoDocumento: contexto.tipoDocumento,
    metodoExtraccion: metodo,
    confianza: metodo === METODO_CONSULTA_CUFE ? 1 : 0,
    estado: 'OK',
    observaciones: resultado.observaciones || '',
    driveFileId: contexto.fileId,
    link: contexto.link
  };

  const val = validarResultado(salida, metodo);
  salida.total = val.total;
  salida.itbms = val.itbms;
  salida.estado = val.estado;
  salida.observaciones = anexarObs(salida.observaciones, val.observaciones);

  if (metodo === METODO_OCR) {
    salida.confianza = calcularConfianza(salida, val.estado);
  }

  const metricas = buildExtractionMetrics(startedAt, metodo, salida, {
    total: val.totalInvalidado,
    itbms: val.itbmsInvalidado
  });
  salida.observaciones = anexarObs(salida.observaciones, formatMetricsForObs(metricas));

  return salida;
}

function validarResultado(data, metodo) {
  const out = {
    estado: 'OK',
    observaciones: '',
    total: toNumber(data.total),
    itbms: toNumber(data.itbms),
    totalInvalidado: false,
    itbmsInvalidado: false
  };

  const fecha = limpiarTexto(data.fecha);
  const proveedor = limpiarTexto(data.proveedor);
  const cufe = limpiarTexto(data.cufe);

  if (metodo === METODO_OCR) {
    if (out.total !== '' && out.total > MAX_TOTAL_OCR) {
      out.total = '';
      out.totalInvalidado = true;
      out.observaciones = anexarObs(out.observaciones, 'Total OCR inválido (>1000)');
    }

    if (out.total !== '' && out.itbms !== '' && out.itbms > out.total * MAX_ITBMS_RATIO_OCR) {
      out.itbms = '';
      out.itbmsInvalidado = true;
      out.observaciones = anexarObs(out.observaciones, 'ITBMS OCR inválido (>7% total)');
    }
  }

  if (!fecha || !proveedor || out.total === '') {
    out.estado = 'REVISION_MANUAL';
    out.observaciones = anexarObs(out.observaciones, 'Faltan campos clave');
  }

  if (out.total !== '' && out.itbms !== '' && out.itbms > out.total) {
    out.estado = 'ERROR_EXTRACCION';
    out.observaciones = anexarObs(out.observaciones, 'ITBMS mayor que total');
  }

  if (cufe && !/^[A-Z0-9-]{20,120}$/.test(cufe)) {
    out.estado = 'REVISION_MANUAL';
    out.observaciones = anexarObs(out.observaciones, 'CUFE con formato inválido');
  }

  return out;
}

function calcularConfianza(data, estado) {
  let score = 0.2;
  if (data.fecha) score += 0.2;
  if (data.proveedor) score += 0.2;
  if (toNumber(data.total) !== '') score += 0.2;
  if (toNumber(data.itbms) !== '') score += 0.05;
  if (data.cufe) score += 0.05;
  if (data.numeroFactura) score += 0.05;
  if (estado === 'REVISION_MANUAL') score -= 0.2;
  if (estado === 'ERROR_EXTRACCION') score -= 0.5;
  if (score < 0) score = 0;
  if (score > 1) score = 1;
  return Math.round(score * 100) / 100;
}

function guardarResultado(resultado, contexto) {
  const sheet = contexto.dataSheet;
  const processedLogSheet = contexto.processedLogSheet;

  const duplicidad = isDuplicateInvoiceAdvanced(sheet, resultado);
  if (duplicidad.type === 'REAL') {
    resultado.estado = 'DUPLICADO_REAL';
    resultado.observaciones = anexarObs(resultado.observaciones, duplicidad.reason);
  } else if (duplicidad.type === 'POSIBLE') {
    resultado.estado = 'POSIBLE_DUPLICADO';
    resultado.observaciones = anexarObs(resultado.observaciones, duplicidad.reason);
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
  registrarProcesado(processedLogSheet, contexto.fileId, contexto.fileName);
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
  if (!logSheet) logSheet = spreadsheet.insertSheet(tabName);
  ensureHeaders(logSheet, headers);
  return logSheet;
}

function getOrCreateFolderCheckpointSheet(spreadsheet, tabName, headers) {
  let checkpointSheet = spreadsheet.getSheetByName(tabName);
  if (!checkpointSheet) checkpointSheet = spreadsheet.insertSheet(tabName);
  ensureHeaders(checkpointSheet, headers);
  return checkpointSheet;
}

function getCatalogoProveedores(spreadsheet) {
  let catalogoSheet = spreadsheet.getSheetByName(NOMBRE_HOJA_CATALOGO);
  if (!catalogoSheet) catalogoSheet = spreadsheet.insertSheet(NOMBRE_HOJA_CATALOGO);
  ensureHeaders(catalogoSheet, ENCABEZADOS_CATALOGO);

  const proveedoresBase = obtenerDiccionarioProveedores();
  for (let i = 0; i < proveedoresBase.length; i++) {
    const p = proveedoresBase[i];
    ensureProveedorCatalogo(catalogoSheet, p.canonico, p.aliases, p.ruc);
  }

  const lastRow = catalogoSheet.getLastRow();
  if (lastRow <= 1) return { aliasMap: {}, rucMap: {} };
  const values = catalogoSheet.getRange(2, 1, lastRow - 1, ENCABEZADOS_CATALOGO.length).getValues();
  return construirMapasCatalogoProveedores(values);
}

function ensureProveedorCatalogo(sheet, proveedorCanonico, aliases, ruc) {
  const aliasList = (aliases || []).filter(function (alias) { return limpiarTexto(alias); });
  const aliasRaw = aliasList.join(' | ');
  const canonicoNormalizado = normalizarNombreProveedorBase(proveedorCanonico);
  const lastRow = sheet.getLastRow();

  if (lastRow <= 1) {
    sheet.appendRow([proveedorCanonico, aliasRaw, limpiarTexto(ruc), '', 'SI']);
    return;
  }

  const values = sheet.getRange(2, 1, lastRow - 1, ENCABEZADOS_CATALOGO.length).getValues();
  let rowIndex = -1;
  for (let i = 0; i < values.length; i++) {
    if (normalizarNombreProveedorBase(values[i][0]) === canonicoNormalizado) {
      rowIndex = i + 2;
      break;
    }
  }

  if (rowIndex === -1) {
    sheet.appendRow([proveedorCanonico, aliasRaw, limpiarTexto(ruc), '', 'SI']);
    return;
  }

  const current = sheet.getRange(rowIndex, 1, 1, ENCABEZADOS_CATALOGO.length).getValues()[0];
  const next = [proveedorCanonico, aliasRaw, limpiarTexto(ruc) || current[2] || '', current[3] || '', 'SI'];
  sheet.getRange(rowIndex, 1, 1, ENCABEZADOS_CATALOGO.length).setValues([next]);
}

function ensureHeaders(sheet, headers) {
  const existing = sheet.getLastRow() > 0 ? sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0] : [];
  const mustRewrite = existing.length !== headers.length || headers.some(function (h, idx) { return existing[idx] !== h; });

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
  if (lastRow <= 1) return fileIds;

  const values = processedLogSheet.getRange(2, 1, lastRow - 1, 1).getValues();
  for (let i = 0; i < values.length; i++) fileIds.add(values[i][0]);
  return fileIds;
}

function registrarProcesado(processedLogSheet, fileId, fileName) {
  processedLogSheet.appendRow([fileId, fileName, new Date()]);
}

function createFolderCheckpointContext(checkpointSheet) {
  return {
    sheet: checkpointSheet,
    checkpoints: loadFolderCheckpoints(checkpointSheet),
    updates: {}
  };
}

function loadFolderCheckpoints(checkpointSheet) {
  const checkpointMap = {};
  const lastRow = checkpointSheet.getLastRow();
  if (lastRow <= 1) return checkpointMap;

  const values = checkpointSheet.getRange(2, 1, lastRow - 1, ENCABEZADOS_CARPETAS.length).getValues();
  for (let i = 0; i < values.length; i++) {
    const folderId = String(values[i][0] || '').trim();
    if (!folderId) continue;
    checkpointMap[folderId] = {
      rowIndex: i + 2,
      folderId: folderId,
      ultimoCheckpoint: Number(values[i][1] || 0),
      ultimoConteoPdf: Number(values[i][2] || 0),
      ultimaEjecucion: values[i][3] || '',
      estado: values[i][4] || '',
      observaciones: values[i][5] || ''
    };
  }
  return checkpointMap;
}

function flushFolderCheckpointContext(checkpointCtx) {
  const updates = checkpointCtx.updates;
  const folderIds = Object.keys(updates);
  if (folderIds.length === 0) return;

  const rowsByIndex = {};
  for (let i = 0; i < folderIds.length; i++) {
    const folderId = folderIds[i];
    const record = updates[folderId];
    const existing = checkpointCtx.checkpoints[folderId];
    const rowIndex = existing ? existing.rowIndex : checkpointCtx.sheet.getLastRow() + 1;
    rowsByIndex[rowIndex] = [
      folderId,
      record.ultimoCheckpoint,
      record.ultimoConteoPdf,
      record.ultimaEjecucion,
      record.estado,
      record.observaciones
    ];
    checkpointCtx.checkpoints[folderId] = {
      rowIndex: rowIndex,
      folderId: folderId,
      ultimoCheckpoint: record.ultimoCheckpoint,
      ultimoConteoPdf: record.ultimoConteoPdf,
      ultimaEjecucion: record.ultimaEjecucion,
      estado: record.estado,
      observaciones: record.observaciones
    };
  }

  const entries = Object.keys(rowsByIndex)
    .map(function (idx) { return { row: Number(idx), values: rowsByIndex[idx] }; })
    .sort(function (a, b) { return a.row - b.row; });

  let chunkStart = entries[0].row;
  let chunkValues = [entries[0].values];
  for (let i = 1; i < entries.length; i++) {
    if (entries[i].row === entries[i - 1].row + 1) {
      chunkValues.push(entries[i].values);
      continue;
    }
    checkpointCtx.sheet.getRange(chunkStart, 1, chunkValues.length, ENCABEZADOS_CARPETAS.length).setValues(chunkValues);
    chunkStart = entries[i].row;
    chunkValues = [entries[i].values];
  }
  checkpointCtx.sheet.getRange(chunkStart, 1, chunkValues.length, ENCABEZADOS_CARPETAS.length).setValues(chunkValues);
  checkpointCtx.updates = {};
}

function collectPdfsWithCheckpoint(rootFolder, checkpointCtx) {
  const files = [];
  collectPdfsFromFolder(rootFolder, checkpointCtx, files);
  return files;
}

function collectPdfsFromFolder(folder, checkpointCtx, accFiles) {
  const folderId = folder.getId();
  const folderSignal = buildFolderSignal(folder);
  const decision = shouldProcessFolder(folderSignal, checkpointCtx.checkpoints[folderId]);

  if (!decision.shouldProcess) {
    checkpointCtx.updates[folderId] = buildCheckpointRecord(folderSignal, 'SKIP', decision.reason);
    return;
  }

  try {
    const files = folder.getFilesByType(MimeType.PDF);
    while (files.hasNext()) accFiles.push(files.next());

    const subFolders = folder.getFolders();
    while (subFolders.hasNext()) collectPdfsFromFolder(subFolders.next(), checkpointCtx, accFiles);

    checkpointCtx.updates[folderId] = buildCheckpointRecord(folderSignal, 'OK', decision.reason);
  } catch (err) {
    checkpointCtx.updates[folderId] = buildCheckpointRecord(folderSignal, 'REINTENTO', 'error_scan: ' + (err.message || String(err)));
    throw err;
  }
}

function buildFolderSignal(folder) {
  return {
    checkpoint: getFolderLastUpdatedMs(folder),
    pdfCount: countDirectPdfFiles(folder)
  };
}

function shouldProcessFolder(folderSignal, checkpointRow) {
  // val input
  if (!checkpointRow) return { shouldProcess: true, reason: 'sin_checkpoint' };
  if (checkpointRow.estado === 'REINTENTO') return { shouldProcess: true, reason: 'estado_reintento' };
  if (!folderSignal.checkpoint) return { shouldProcess: true, reason: 'checkpoint_no_disponible' };
  if (checkpointRow.ultimoCheckpoint !== folderSignal.checkpoint) return { shouldProcess: true, reason: 'checkpoint_distinto' };
  if (checkpointRow.ultimoConteoPdf !== folderSignal.pdfCount) return { shouldProcess: true, reason: 'conteo_distinto' };
  return { shouldProcess: false, reason: 'sin_cambios' };
}

function buildCheckpointRecord(folderSignal, estado, observaciones) {
  return {
    ultimoCheckpoint: folderSignal.checkpoint,
    ultimoConteoPdf: folderSignal.pdfCount,
    ultimaEjecucion: new Date(),
    estado: estado,
    observaciones: observaciones || ''
  };
}

function getFolderLastUpdatedMs(folder) {
  try {
    const updated = folder.getLastUpdated();
    return updated ? updated.getTime() : 0;
  } catch (err) {
    return 0;
  }
}

function countDirectPdfFiles(folder) {
  let count = 0;
  const files = folder.getFilesByType(MimeType.PDF);
  while (files.hasNext()) {
    files.next();
    count++;
  }
  return count;
}

function extractTextFromPdf(fileId) {
  const pdfFile = DriveApp.getFileById(fileId);
  if (pdfFile.getMimeType() !== MimeType.PDF) throw new Error('El archivo no es PDF');

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

function parseInvoiceDataGeneric(text) {
  const raw = String(text || '');
  const txt = raw.replace(/\u00A0/g, ' ');
  const upper = txt.toUpperCase();
  const data = {
    fecha: extraerFechaDesdeTexto(txt),
    proveedor: extraerProveedorDesdeTexto(txt),
    ruc: extraerRucDesdeTexto(txt),
    itbms: '',
    total: '',
    cufe: '',
    numeroFactura: '',
    noFiscalDetectado: textoPareceNoFiscal(upper)
  };

  const cufeMatch = upper.match(/(?:\bCUFE\b[\s:;#-]*)?([A-Z0-9-]{20,120})/);
  if (cufeMatch && /[A-Z]/.test(cufeMatch[1]) && /\d/.test(cufeMatch[1])) {
    data.cufe = cufeMatch[1].replace(/[^A-Z0-9-]/g, '');
  }

  const facturaMatch = txt.match(/(?:N[ÚU]MERO|NUM|NO\.?|FACTURA|FOLIO)\s*(?:DE\s*)?(?:FACTURA)?\s*[:#-]?\s*([A-Z0-9-]{3,40})/i);
  if (facturaMatch) data.numeroFactura = limpiarTexto(facturaMatch[1]);

  const montos = extraerMontosDesdeTexto(txt);
  data.total = montos.total;
  data.itbms = montos.itbms;
  return data;
}

function extraerFechaDesdeTexto(texto) {
  const meses = {
    ENERO: '01', FEBRERO: '02', MARZO: '03', ABRIL: '04', MAYO: '05', JUNIO: '06',
    JULIO: '07', AGOSTO: '08', SEPTIEMBRE: '09', SETIEMBRE: '09', OCTUBRE: '10', NOVIEMBRE: '11', DICIEMBRE: '12'
  };
  const upper = String(texto || '').toUpperCase();
  let m;

  const p1 = /(\d{4})[-\/](\d{2})[-\/](\d{2})/g;
  while ((m = p1.exec(upper)) !== null) {
    const c = m[1] + '-' + m[2] + '-' + m[3];
    if (/^\d{4}-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/.test(c)) return c;
  }

  const p2 = /(\d{2})[-\/](\d{2})[-\/](\d{4})/g;
  while ((m = p2.exec(upper)) !== null) {
    const c = m[3] + '-' + m[2] + '-' + m[1];
    if (/^\d{4}-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/.test(c)) return c;
  }

  const p3 = /(\d{2})\s+DE\s+([A-ZÁÉÍÓÚ]+)\s+DE\s+(\d{4})/g;
  while ((m = p3.exec(upper)) !== null) {
    const mm = meses[m[2]] || '';
    if (!mm) continue;
    return m[3] + '-' + mm + '-' + ('0' + m[1]).slice(-2);
  }

  return '';
}

function extraerProveedorDesdeTexto(texto) {
  const txt = String(texto || '');
  const lineas = txt.split(/\r?\n/);
  const regexEtiqueta = /(EMISOR|PROVEEDOR|RAZ[ÓO]N\s+SOCIAL|NOMBRE\s+COMERCIAL)\s*:?\s*([^\n\r|]{3,120})/i;

  for (let i = 0; i < Math.min(30, lineas.length); i++) {
    const ln = limpiarTexto(lineas[i]);
    if (!ln) continue;
    const m = ln.match(regexEtiqueta);
    if (m && m[2]) return limpiarTexto(m[2]).replace(/[:;,.]+$/, '');
  }

  for (let i = 0; i < Math.min(6, lineas.length); i++) {
    const head = limpiarTexto(lineas[i]);
    if (!head) continue;
    if (/\b(FACTURA|FECHA|CLIENTE|RUC|ITBMS|IVA|TOTAL|SUBTOTAL|PAGO)\b/i.test(head)) continue;
    if (/\d{3,}/.test(head)) continue;
    if (head.length < 5 || head.length > 120) continue;
    return head;
  }

  return '';
}

function extraerMontosDesdeTexto(texto) {
  const lineas = String(texto || '').split(/\r?\n/);
  const montoRegex = /(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})|\d+(?:[.,]\d{2}))/g;
  const montos = [];

  for (let i = 0; i < lineas.length; i++) {
    let m;
    while ((m = montoRegex.exec(lineas[i])) !== null) {
      const val = toNumber(m[1]);
      if (val === '' || val <= 0) continue;
      montos.push({ valor: val, linea: lineas[i].toUpperCase() });
    }
  }

  let total = '';
  let itbms = '';
  for (let i = 0; i < montos.length; i++) {
    if (/(TOTAL\s+A\s+PAGAR|IMPORTE\s+TOTAL|GRAN\s+TOTAL|VALOR\s+TOTAL|TOTAL)/i.test(montos[i].linea)) {
      if (total === '' || montos[i].valor > total) total = montos[i].valor;
    }
    if (/(ITBMS|IVA|IMPUESTO)/i.test(montos[i].linea)) {
      if (itbms === '' || montos[i].valor > itbms) itbms = montos[i].valor;
    }
  }

  if (total === '' && montos.length) {
    montos.sort(function (a, b) { return b.valor - a.valor; });
    total = montos[0].valor;
  }
  return { total: total, itbms: itbms };
}

function textoPareceNoFiscal(texto) {
  const base = limpiarTexto(texto).toUpperCase();
  if (!base) return false;
  return /(ORDEN\s+DE\s+PEDIDO|COTIZACI[ÓO]N|PROFORMA)/i.test(base);
}

function inferirCufeDesdeNombre(nombreArchivo) {
  const base = String(nombreArchivo || '').replace(/\.pdf$/i, '');
  const limpio = base.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!/^FE[A-Z0-9]{18,120}$/.test(limpio)) return '';
  return /\d/.test(limpio.slice(2)) ? limpio : '';
}

function resolverProveedorCanonico(input) {
  const nombreDetectado = input && input.nombreDetectado ? input.nombreDetectado : '';
  const rucDetectado = input && input.rucDetectado ? normalizarRuc(input.rucDetectado) : '';
  const catalogo = input && input.catalogo ? input.catalogo : null;
  const limpio = normalizarNombreProveedorBase(nombreDetectado);

  if (catalogo && rucDetectado && catalogo.rucMap && catalogo.rucMap[rucDetectado]) {
    const canonical = catalogo.rucMap[rucDetectado];
    return { proveedor: canonical, proveedorNormalizado: canonical, fuente: 'match_ruc' };
  }

  if (catalogo && limpio && catalogo.aliasMap && catalogo.aliasMap[limpio]) {
    const canonical = catalogo.aliasMap[limpio];
    return { proveedor: canonical, proveedorNormalizado: canonical, fuente: 'match_alias' };
  }

  return { proveedor: '', proveedorNormalizado: '', fuente: 'sin_match' };
}

function normalizarProveedor(nombreDetectado, catalogo) {
  const match = resolverProveedorCanonico({ nombreDetectado: nombreDetectado, rucDetectado: '', catalogo: catalogo });
  return match.proveedorNormalizado;
}

function isDuplicateInvoice(sheet, cufe, driveFileId) {
  const result = isDuplicateInvoiceAdvanced(sheet, { cufe: cufe, driveFileId: driveFileId });
  return result.type === 'REAL';
}

function isDuplicateInvoiceAdvanced(sheet, data) {
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return { isDuplicate: false, type: 'NONE', reason: '' };

  const values = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();
  const incomingFirma = construirFirmaFactura(data);

  for (let i = 0; i < values.length; i++) {
    if (data.cufe && values[i][5] === data.cufe) return { isDuplicate: true, type: 'REAL', reason: 'CUFE ya registrado' };
    if (data.driveFileId && values[i][11] === data.driveFileId) return { isDuplicate: true, type: 'REAL', reason: 'ID de archivo ya registrado' };

    if (!incomingFirma) continue;
    const existingFirma = construirFirmaFactura({ fecha: values[i][0], proveedorNormalizado: values[i][2], total: values[i][4] });
    if (existingFirma && existingFirma === incomingFirma) return { isDuplicate: true, type: 'POSIBLE', reason: 'Coincidencia en firma compuesta' };
  }

  return { isDuplicate: false, type: 'NONE', reason: '' };
}

function construirFirmaFactura(data) {
  const fecha = normalizarFecha(data.fecha);
  const proveedor = normalizarNombreProveedorBase(data.proveedorNormalizado || data.proveedor || '');
  const total = normalizarImporteFirma(data.total);
  if (!fecha || !proveedor || total === '') return '';
  return [fecha, proveedor, total].join('|');
}

function buildExtractionMetrics(startedAtMs, metodo, data, invalidados) {
  const elapsed = Math.max(0, new Date().getTime() - startedAtMs);
  const fields = [data.fecha, data.proveedor, data.total, data.itbms, data.cufe];
  let emptyCount = 0;
  for (let i = 0; i < fields.length; i++) {
    if (fields[i] === '' || fields[i] === null || fields[i] === undefined) emptyCount++;
  }

  return {
    t_ms: elapsed,
    metodo: metodo,
    vacios_validacion_rate: Math.round((emptyCount / fields.length) * 10000) / 10000,
    inv_total: !!(invalidados && invalidados.total),
    inv_itbms: !!(invalidados && invalidados.itbms)
  };
}

function formatMetricsForObs(metricas) {
  return [
    'met_t=' + metricas.t_ms + 'ms',
    'met_m=' + metricas.metodo,
    'met_v=' + metricas.vacios_validacion_rate,
    'met_inv_total=' + (metricas.inv_total ? '1' : '0'),
    'met_inv_itbms=' + (metricas.inv_itbms ? '1' : '0')
  ].join(';');
}

function normalizarNombreProveedorBase(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[.,;:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function normalizarImporteFirma(value) {
  const num = toNumber(value);
  if (num === '') return '';
  return Number(num).toFixed(2);
}

function parseBooleanCell(value) {
  if (typeof value === 'boolean') return value;
  const txt = limpiarTexto(value).toUpperCase();
  if (!txt) return false;
  return txt === 'SI' || txt === 'SÍ' || txt === 'TRUE' || txt === '1' || txt === 'ACTIVO' || txt === 'X';
}

function normalizarRuc(value) {
  const raw = String(value || '').toUpperCase().replace(/\s+/g, '');
  if (!raw) return '';
  const limpio = raw.replace(/[^A-Z0-9-]/g, '');
  if (/^\d{1,20}-\d{1,4}-\d{1,20}$/.test(limpio)) return limpio;
  return '';
}

function extraerRucDesdeTexto(texto) {
  const txt = String(texto || '');
  const match = txt.match(/\b(\d{1,20}-\d{1,4}-\d{1,20})\b/);
  return match ? normalizarRuc(match[1]) : '';
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
  const e = limpiarTexto(extra);
  if (!e) return b;
  if (!b) return e;
  return b + ' | ' + e;
}
