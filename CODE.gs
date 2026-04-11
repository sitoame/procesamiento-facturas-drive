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
      clasificarDocumento(contexto);

      let resultado = extraerDesdeDGI(contexto);
      if (!resultado.ok) {
        resultado = extraerDesdeTextoEmbebido(contexto);
      }
      if (!resultado.ok) {
        resultado = extraerDesdeVision(contexto);
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
  return {
    file: file,
    fileId: file.getId(),
    nombreArchivo: file.getName(),
    link: file.getUrl(),
    cufeDetectado: inferirCufeDesdeNombre(file.getName()),
    tipoDocumento: 'FACTURA',
    dataSheet: null,
    processedLogSheet: null
  };
}

function clasificarDocumento(contexto) {
  const nombre = contexto.nombreArchivo.toUpperCase();
  if (/NC|NOTA\s*DE\s*CREDITO/.test(nombre)) {
    contexto.tipoDocumento = 'NOTA_CREDITO';
    return contexto.tipoDocumento;
  }
  if (/ND|NOTA\s*DE\s*DEBITO/.test(nombre)) {
    contexto.tipoDocumento = 'NOTA_DEBITO';
    return contexto.tipoDocumento;
  }
  contexto.tipoDocumento = 'FACTURA';
  return contexto.tipoDocumento;
}

function extraerDesdeDGI(contexto) {
  if (!contexto.cufeDetectado) {
    return { ok: false, metodoExtraccion: 'DGI', confianza: 0, observaciones: 'CUFE ausente en nombre de archivo' };
  }

  const texto = extractTextFromCufe(contexto.cufeDetectado);
  if (!texto || /^Error:/i.test(texto)) {
    return {
      ok: false,
      metodoExtraccion: 'DGI',
      confianza: 0,
      observaciones: 'Consulta DGI sin datos útiles'
    };
  }

  const datos = parseInvoiceData(texto);
  return {
    ok: true,
    metodoExtraccion: 'DGI',
    confianza: 0.95,
    textoFuente: texto,
    datos: datos,
    observaciones: 'Extracción por CUFE en DGI'
  };
}

function extraerDesdeTextoEmbebido(contexto) {
  try {
    const texto = extractTextFromPdf(contexto.fileId);
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
    estado: 'OK',
    observaciones: resultado.observaciones || '',
    driveFileId: contexto.fileId,
    link: contexto.link
  };

  if (!resultado.ok) {
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
  if (base.length < 10) return '';
  return base;
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
