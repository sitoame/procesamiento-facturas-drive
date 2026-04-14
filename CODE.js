const NOMBRE_HOJA_DATOS = 'Datos Facturas';
const NOMBRE_HOJA_REGISTRO = 'Archivos Procesados';
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
  'ID Carpeta',
  'Nombre',
  'Parent ID',
  'Ultima Revision',
  'Cantidad PDFs',
  'Cantidad Subcarpetas',
  'Firma Estado',
  'Estado'
];

const TIPO_DOCUMENTO = {
  FACTURA_ELECTRONICA_CUFE: 'FACTURA_ELECTRONICA_CUFE',
  PDF_TEXTO: 'PDF_TEXTO',
  ESCANEO_O_IMAGEN: 'ESCANEO_O_IMAGEN',
  NO_FISCAL: 'NO_FISCAL'
};

const ESTADO_RESULTADO = {
  OK: 'OK',
  OMITIDO_NO_FISCAL: 'OMITIDO_NO_FISCAL',
  PENDIENTE_VISION: 'PENDIENTE_VISION',
  ERROR_EXTRACCION: 'ERROR_EXTRACCION'
};

const METODO_EXTRACCION = {
  DGI: 'DGI_CUFE',
  TEXTO: 'TEXTO_EMBEBIDO',
  VISION: 'VISION_STUB',
  SKIP: 'SKIP'
};

const UMBRAL_TEXTO_CORTO = 40;

function procesarNuevosPdfs(ID_CARPETA_PDF, NOMBRE_ARCHIVO_HOJA_CALCULO) {
  const rootFolder = DriveApp.getFolderById(ID_CARPETA_PDF);
  const spreadsheet = getOrCreateSpreadsheet(
    ID_CARPETA_PDF,
    NOMBRE_ARCHIVO_HOJA_CALCULO,
    NOMBRE_HOJA_DATOS,
    ENCABEZADOS_DATOS
  );
  const dataSheet = spreadsheet.getSheetByName(NOMBRE_HOJA_DATOS);
  const processedLogSheet = getOrCreateProcessedLogSheet(spreadsheet, NOMBRE_HOJA_REGISTRO, ENCABEZADOS_REGISTRO);
  const folderIndexSheet = getOrCreateFolderIndexSheet(spreadsheet, NOMBRE_HOJA_CARPETAS, ENCABEZADOS_CARPETAS);

  const processedFileIds = getProcessedFileIds(processedLogSheet);
  const folderIndex = getFolderIndex(folderIndexSheet);
  const carpetasPendientes = listarCarpetasPendientes(rootFolder, folderIndex, folderIndexSheet);

  if (carpetasPendientes.length === 0) {
    Logger.log('Sin cambios en carpetas. No hay trabajo incremental.');
    return;
  }

  for (let i = 0; i < carpetasPendientes.length; i++) {
    procesarCarpetaIncremental(
      carpetasPendientes[i],
      {
        dataSheet: dataSheet,
        processedLogSheet: processedLogSheet,
        processedFileIds: processedFileIds,
        folderIndexSheet: folderIndexSheet,
        folderIndex: folderIndex
      }
    );
  }
}

function procesarCarpetaIncremental(folder, runtime) {
  const files = folder.getFilesByType(MimeType.PDF);
  let procesadosCarpeta = 0;

  while (files.hasNext()) {
    const file = files.next();
    const fileId = file.getId();

    if (runtime.processedFileIds.has(fileId)) {
      continue;
    }

    const contexto = construirContextoArchivo(file);
    const tipoDocumento = clasificarDocumento(contexto);
    let resultado;

    if (tipoDocumento === TIPO_DOCUMENTO.FACTURA_ELECTRONICA_CUFE) {
      resultado = extraerDesdeDGI(contexto);
    } else if (tipoDocumento === TIPO_DOCUMENTO.PDF_TEXTO) {
      resultado = extraerDesdeTextoEmbebido(contexto);
    } else if (tipoDocumento === TIPO_DOCUMENTO.ESCANEO_O_IMAGEN) {
      resultado = extraerDesdeVision(contexto);
    } else {
      resultado = {
        tipoDocumento: TIPO_DOCUMENTO.NO_FISCAL,
        metodoExtraccion: METODO_EXTRACCION.SKIP,
        confianza: 1,
        estado: ESTADO_RESULTADO.OMITIDO_NO_FISCAL,
        observaciones: 'Documento no fiscal detectado por clasificación.'
      };
    }

    const normalizado = normalizarYValidar(resultado, contexto);

    if (!isDuplicateInvoice(runtime.dataSheet, normalizado.cufe, fileId)) {
      guardarResultado(normalizado, contexto, runtime.dataSheet);
    } else {
      Logger.log('Duplicado detectado: ' + file.getName() + ' (' + fileId + ')');
    }

    runtime.processedLogSheet.appendRow([fileId, file.getName(), new Date()]);
    runtime.processedFileIds.add(fileId);
    procesadosCarpeta++;
  }

  const estado = construirEstadoCarpeta(folder);
  upsertFolderIndex(runtime.folderIndexSheet, runtime.folderIndex, estado, 'PROCESADA');
  Logger.log('Carpeta procesada: ' + folder.getName() + ' | PDFs nuevos: ' + procesadosCarpeta);
}

function construirContextoArchivo(file) {
  const nombre = file.getName();
  const nombreSinExtension = nombre.replace(/\.pdf$/i, '');
  const textoOCR = safeExtractPdfText(file.getId());

  return {
    fileId: file.getId(),
    fileName: nombre,
    fileNameNoExt: nombreSinExtension,
    fileUrl: file.getUrl(),
    mimeType: file.getMimeType(),
    lastUpdated: file.getLastUpdated(),
    textoOCR: textoOCR,
    textoOCRLen: textoOCR ? textoOCR.trim().length : 0
  };
}

function clasificarDocumento(contexto) {
  if (/^FE[A-Z0-9-]{20,}$/i.test(contexto.fileNameNoExt)) {
    return TIPO_DOCUMENTO.FACTURA_ELECTRONICA_CUFE;
  }

  const txt = (contexto.textoOCR || '').toUpperCase();

  if (/ORDEN DE PEDIDO|PROFORMA|COTIZACI[ÓO]N/.test(txt)) {
    return TIPO_DOCUMENTO.NO_FISCAL;
  }

  if (/FECHA DE EMISI[ÓO]N|CUFE|ITBMS/.test(txt)) {
    return TIPO_DOCUMENTO.PDF_TEXTO;
  }

  if (contexto.textoOCRLen < UMBRAL_TEXTO_CORTO) {
    return TIPO_DOCUMENTO.ESCANEO_O_IMAGEN;
  }

  return TIPO_DOCUMENTO.PDF_TEXTO;
}

function extraerDesdeDGI(contexto) {
  try {
    const texto = extractTextFromCufe(contexto.fileNameNoExt);
    const parsed = parseInvoiceData(texto || '');
    return {
      fecha: parsed.fecha,
      proveedor: parsed.proveedor,
      itbms: parsed.itbms,
      total: parsed.total,
      cufe: parsed.cufe || contexto.fileNameNoExt,
      tipoDocumento: TIPO_DOCUMENTO.FACTURA_ELECTRONICA_CUFE,
      metodoExtraccion: METODO_EXTRACCION.DGI,
      confianza: 0.95,
      estado: ESTADO_RESULTADO.OK,
      observaciones: ''
    };
  } catch (err) {
    return {
      tipoDocumento: TIPO_DOCUMENTO.FACTURA_ELECTRONICA_CUFE,
      metodoExtraccion: METODO_EXTRACCION.DGI,
      confianza: 0,
      estado: ESTADO_RESULTADO.ERROR_EXTRACCION,
      observaciones: 'Error DGI: ' + err.message
    };
  }
}

function extraerDesdeTextoEmbebido(contexto) {
  try {
    const parsed = parseInvoiceData(contexto.textoOCR || '');
    return {
      fecha: parsed.fecha,
      proveedor: parsed.proveedor,
      itbms: parsed.itbms,
      total: parsed.total,
      cufe: parsed.cufe,
      tipoDocumento: TIPO_DOCUMENTO.PDF_TEXTO,
      metodoExtraccion: METODO_EXTRACCION.TEXTO,
      confianza: parsed.cufe ? 0.9 : 0.75,
      estado: ESTADO_RESULTADO.OK,
      observaciones: parsed.cufe ? '' : 'CUFE no detectado en texto embebido.'
    };
  } catch (err) {
    return {
      tipoDocumento: TIPO_DOCUMENTO.PDF_TEXTO,
      metodoExtraccion: METODO_EXTRACCION.TEXTO,
      confianza: 0,
      estado: ESTADO_RESULTADO.ERROR_EXTRACCION,
      observaciones: 'Error texto embebido: ' + err.message
    };
  }
}

function extraerDesdeVision(contexto) {
  return {
    tipoDocumento: TIPO_DOCUMENTO.ESCANEO_O_IMAGEN,
    metodoExtraccion: METODO_EXTRACCION.VISION,
    confianza: 0.2,
    estado: ESTADO_RESULTADO.PENDIENTE_VISION,
    observaciones: 'Stub Vision: integrar OCR avanzado/AI para escaneos.'
  };
}

function normalizarYValidar(resultado, contexto) {
  const fecha = normalizeDate(resultado.fecha);
  const proveedor = normalizeSpaces(resultado.proveedor || '');
  const proveedorNormalizado = normalizeProvider(proveedor);
  const itbms = toNumber(resultado.itbms);
  const total = toNumber(resultado.total);
  const cufe = normalizeSpaces(resultado.cufe || inferirCufeDesdeNombre(contexto.fileNameNoExt));

  return {
    fecha: fecha,
    proveedor: proveedor,
    proveedorNormalizado: proveedorNormalizado,
    itbms: itbms,
    total: total,
    cufe: cufe,
    tipoDocumento: resultado.tipoDocumento || TIPO_DOCUMENTO.PDF_TEXTO,
    metodoExtraccion: resultado.metodoExtraccion || METODO_EXTRACCION.TEXTO,
    confianza: typeof resultado.confianza === 'number' ? resultado.confianza : 0,
    estado: resultado.estado || ESTADO_RESULTADO.ERROR_EXTRACCION,
    observaciones: resultado.observaciones || ''
  };
}

function guardarResultado(resultado, contexto, dataSheet) {
  dataSheet.appendRow([
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
    contexto.fileId,
    contexto.fileUrl
  ]);
}

function construirEstadoCarpeta(folder) {
  const parent = folder.getParents();
  const parentId = parent.hasNext() ? parent.next().getId() : '';
  const pdfInfo = getPdfCountAndIds(folder);
  const subInfo = getSubfolderCountAndIds(folder);
  const firma = calcularFirmaCarpeta(folder, pdfInfo.ids, subInfo.ids);

  return {
    folderId: folder.getId(),
    nombre: folder.getName(),
    parentId: parentId,
    ultimaRevision: new Date(),
    cantidadPdfs: pdfInfo.count,
    cantidadSubcarpetas: subInfo.count,
    firmaEstado: firma,
    estado: 'PENDIENTE'
  };
}

function calcularFirmaCarpeta(folder, pdfIdsOpt, subfolderIdsOpt) {
  const pdfIds = pdfIdsOpt || getPdfCountAndIds(folder).ids;
  const subIds = subfolderIdsOpt || getSubfolderCountAndIds(folder).ids;
  const lastUpdated = safeDate(folder.getLastUpdated());

  return [
    folder.getId(),
    lastUpdated,
    pdfIds.length,
    subIds.length,
    pdfIds.join('|'),
    subIds.join('|')
  ].join('::');
}

function carpetaCambio(folder, folderIndex) {
  const estadoActual = construirEstadoCarpeta(folder);
  const previo = folderIndex[estadoActual.folderId];

  if (!previo) {
    return { cambio: true, estadoActual: estadoActual };
  }

  const cambio =
    String(previo.cantidadPdfs) !== String(estadoActual.cantidadPdfs) ||
    String(previo.cantidadSubcarpetas) !== String(estadoActual.cantidadSubcarpetas) ||
    String(previo.firmaEstado) !== String(estadoActual.firmaEstado);

  return { cambio: cambio, estadoActual: estadoActual };
}

function listarCarpetasPendientes(rootFolder, folderIndex, folderIndexSheet) {
  const pendientes = [];

  function walk(folder, forceScanChildren) {
    const check = carpetaCambio(folder, folderIndex);
    const hasChange = forceScanChildren || check.cambio;

    if (hasChange) {
      pendientes.push(folder);
      const subfolders = folder.getFolders();
      while (subfolders.hasNext()) {
        walk(subfolders.next(), true);
      }
      return;
    }

    upsertFolderIndex(folderIndexSheet, folderIndex, check.estadoActual, 'SIN_CAMBIOS');
  }

  walk(rootFolder, false);
  return pendientes;
}

function getPdfCountAndIds(folder) {
  const files = folder.getFilesByType(MimeType.PDF);
  const ids = [];

  while (files.hasNext()) {
    ids.push(files.next().getId());
  }

  ids.sort();
  return { count: ids.length, ids: ids };
}

function getSubfolderCountAndIds(folder) {
  const subfolders = folder.getFolders();
  const ids = [];

  while (subfolders.hasNext()) {
    ids.push(subfolders.next().getId());
  }

  ids.sort();
  return { count: ids.length, ids: ids };
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

  if (dataSheet.getLastRow() === 0) {
    dataSheet.appendRow(headers);
  }

  return spreadsheet;
}

function getOrCreateProcessedLogSheet(spreadsheet, tabName, headers) {
  let logSheet = spreadsheet.getSheetByName(tabName);
  if (!logSheet) {
    logSheet = spreadsheet.insertSheet(tabName);
  }
  if (logSheet.getLastRow() === 0) {
    logSheet.appendRow(headers);
  }
  return logSheet;
}

function getOrCreateFolderIndexSheet(spreadsheet, tabName, headers) {
  let sheet = spreadsheet.getSheetByName(tabName);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(tabName);
  }
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(headers);
  }
  return sheet;
}

function getFolderIndex(folderIndexSheet) {
  const map = {};
  const lastRow = folderIndexSheet.getLastRow();

  if (lastRow <= 1) {
    return map;
  }

  const values = folderIndexSheet.getRange(2, 1, lastRow - 1, ENCABEZADOS_CARPETAS.length).getValues();

  for (let i = 0; i < values.length; i++) {
    const row = values[i];
    const folderId = row[0];
    if (!folderId) continue;

    map[folderId] = {
      rowNumber: i + 2,
      folderId: row[0],
      nombre: row[1],
      parentId: row[2],
      ultimaRevision: row[3],
      cantidadPdfs: row[4],
      cantidadSubcarpetas: row[5],
      firmaEstado: row[6],
      estado: row[7]
    };
  }

  return map;
}

function upsertFolderIndex(folderIndexSheet, folderIndex, estado, status) {
  const rowData = [
    estado.folderId,
    estado.nombre,
    estado.parentId,
    estado.ultimaRevision,
    estado.cantidadPdfs,
    estado.cantidadSubcarpetas,
    estado.firmaEstado,
    status
  ];

  const previo = folderIndex[estado.folderId];

  if (previo && previo.rowNumber) {
    folderIndexSheet.getRange(previo.rowNumber, 1, 1, rowData.length).setValues([rowData]);
    folderIndex[estado.folderId] = {
      rowNumber: previo.rowNumber,
      folderId: estado.folderId,
      nombre: estado.nombre,
      parentId: estado.parentId,
      ultimaRevision: estado.ultimaRevision,
      cantidadPdfs: estado.cantidadPdfs,
      cantidadSubcarpetas: estado.cantidadSubcarpetas,
      firmaEstado: estado.firmaEstado,
      estado: status
    };
  } else {
    folderIndexSheet.appendRow(rowData);
    folderIndex[estado.folderId] = {
      rowNumber: folderIndexSheet.getLastRow(),
      folderId: estado.folderId,
      nombre: estado.nombre,
      parentId: estado.parentId,
      ultimaRevision: estado.ultimaRevision,
      cantidadPdfs: estado.cantidadPdfs,
      cantidadSubcarpetas: estado.cantidadSubcarpetas,
      firmaEstado: estado.firmaEstado,
      estado: status
    };
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

function extractTextFromPdf(fileId) {
  const pdfFile = DriveApp.getFileById(fileId);
  if (pdfFile.getMimeType() !== MimeType.PDF) {
    throw new Error('Archivo no PDF: ' + pdfFile.getName());
  }

  const tempDoc = Drive.Files.create(
    {
      title: pdfFile.getName() + '_tmp_ocr',
      mimeType: MimeType.GOOGLE_DOCS
    },
    pdfFile.getBlob().setContentType(MimeType.PDF),
    { ocr: true, ocrLanguage: 'es' }
  );

  const text = DocumentApp.openById(tempDoc.id).getBody().getText();
  Drive.Files.remove(tempDoc.id);
  return text;
}

function parseInvoiceData(text) {
  const data = {
    fecha: '',
    proveedor: '',
    itbms: '',
    total: '',
    cufe: ''
  };

  const src = text || '';

  const fechaMatch = src.match(/FECHA\s+AUTORIZACI[ÓO]N\s*(\d{2}\/\d{2}\/\d{4})/i) ||
    src.match(/FECHA\s+DE\s+EMISI[ÓO]N\s*:?\s*(\d{2}[\/-]\d{2}[\/-]\d{4})/i);
  if (fechaMatch) data.fecha = fechaMatch[1];

  const proveedorMatch = src.match(/NOMBRE\s+([\s\S]*?)\s+DIRECCI[ÓO]N/i) ||
    src.match(/EMISOR\s*:?\s*([^\n]+)/i);
  if (proveedorMatch) data.proveedor = normalizeSpaces(proveedorMatch[1]);

  const itbmsMatch = src.match(/ITBMS\s*(?:TOTAL)?\s*:?\s*(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d+)?)/i);
  if (itbmsMatch) data.itbms = normalizeNumberString(itbmsMatch[1]);

  const totalMatch = src.match(/VALOR\s+TOTAL\s*:?\s*(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d+)?)/i) ||
    src.match(/TOTAL\s+A\s+PAGAR\s*:?\s*(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d+)?)/i);
  if (totalMatch) data.total = normalizeNumberString(totalMatch[1]);

  const cufeMatch = src.match(/\[CUFE\]\s*([A-Z0-9-]{20,})/i) ||
    src.match(/CUFE\s*:?\s*([A-Z0-9-]{20,})/i);
  if (cufeMatch) data.cufe = cufeMatch[1].trim();

  return data;
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

function safeExtractPdfText(fileId) {
  try {
    return extractTextFromPdf(fileId);
  } catch (err) {
    Logger.log('OCR fallback vacío para ' + fileId + ': ' + err.message);
    return '';
  }
}

function normalizeProvider(proveedor) {
  const normalized = proveedor
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return normalized;
}

function normalizeNumberString(raw) {
  const clean = String(raw).replace(/\s+/g, '');
  const normalized = clean.indexOf(',') > -1 && clean.indexOf('.') > -1
    ? clean.replace(/\./g, '').replace(',', '.')
    : clean.replace(',', '.');
  return parseFloat(normalized);
}

function toNumber(value) {
  if (typeof value === 'number') return value;
  if (!value) return '';
  const num = normalizeNumberString(value);
  return isNaN(num) ? '' : num;
}

function normalizeDate(dateValue) {
  if (!dateValue) return '';
  if (Object.prototype.toString.call(dateValue) === '[object Date]') return dateValue;
  const match = String(dateValue).match(/^(\d{2})[\/-](\d{2})[\/-](\d{4})$/);
  if (!match) return dateValue;
  return new Date(Number(match[3]), Number(match[2]) - 1, Number(match[1]));
}

function normalizeSpaces(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function inferirCufeDesdeNombre(fileNameNoExt) {
  return /^FE[A-Z0-9-]{20,}$/i.test(fileNameNoExt) ? fileNameNoExt : '';
}

function safeDate(value) {
  if (!value) return '';
  if (Object.prototype.toString.call(value) === '[object Date]') {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), 'yyyy-MM-dd\'T\'HH:mm:ss');
  }
  return String(value);
}
