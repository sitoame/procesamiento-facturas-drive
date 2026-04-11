const NOMBRE_HOJA_DATOS = 'Datos Facturas';
const NOMBRE_HOJA_REGISTRO = 'Archivos Procesados';
const NOMBRE_HOJA_CATALOGO = 'Catalogo Proveedores';

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
const ENCABEZADOS_CATALOGO = [
  'Proveedor Canonico',
  'Alias',
  'RUC',
  'Tipo Documento Frecuente',
  'Activo'
];

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
  const catalogoProveedores = getCatalogoProveedores(spreadsheet);

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
    contexto.catalogoProveedores = catalogoProveedores;

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
    processedLogSheet: null,
    catalogoProveedores: null
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
  const cufeNombre = inferirCufeDesdeNombre(contexto.fileName || contexto.nombreArchivo || '');
  if (!cufeNombre) {
    return {
      ok: false,
      metodoExtraccion: 'DGI',
      confianza: 0,
      estado: 'REVISION_MANUAL',
      datos: {
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
        observaciones: 'Nombre de archivo sin CUFE válido'
      },
      observaciones: 'Nombre de archivo sin CUFE válido'
    };
  }

  contexto.cufeDetectado = cufeNombre;
  const consulta = extractTextFromCufe(cufeNombre);
  if (!consulta || !consulta.ok) {
    const errCode = consulta && consulta.error && consulta.error.code ? consulta.error.code : 'DGI_ERROR';
    const errMsg = consulta && consulta.error && consulta.error.message ? consulta.error.message : 'Consulta DGI fallida';
    const errDetail = consulta && consulta.error && consulta.error.detail ? consulta.error.detail : '';
    const obs = 'Consulta DGI fallida [' + errCode + ']: ' + errMsg + (errDetail ? ' - ' + errDetail : '');

    return {
      ok: false,
      metodoExtraccion: 'DGI',
      confianza: 0,
      estado: 'REVISION_MANUAL',
      error: {
        code: errCode,
        message: errMsg,
        detail: errDetail,
        statusCode: consulta && consulta.statusCode ? consulta.statusCode : 0,
        cufe: cufeNombre
      },
      datos: {
        fecha: '',
        proveedor: '',
        proveedorNormalizado: '',
        itbms: '',
        total: '',
        cufe: cufeNombre,
        tipoDocumento: contexto.tipoDocumento || 'FACTURA',
        metodoExtraccion: 'DGI',
        confianza: 0,
        estado: 'REVISION_MANUAL',
        observaciones: obs
      },
      observaciones: obs
    };
  }

  const parsed = parseInvoiceDataFromDgiText(consulta.text);
  const proveedorNormalizado = normalizarProveedor(parsed.proveedor, contexto.catalogoProveedores || null);
  const datos = {
    fecha: parsed.fecha || '',
    proveedor: parsed.proveedor || '',
    proveedorNormalizado: proveedorNormalizado || '',
    itbms: parsed.itbms,
    total: parsed.total,
    cufe: parsed.cufe || cufeNombre,
    tipoDocumento: contexto.tipoDocumento || 'FACTURA',
    metodoExtraccion: 'DGI',
    confianza: 0.95,
    estado: 'OK',
    observaciones: ''
  };

  const faltanClave = !datos.fecha || !datos.proveedor || toNumber(datos.total) === '';
  if (faltanClave) {
    datos.estado = 'REVISION_MANUAL';
    datos.confianza = 0.6;
    datos.observaciones = 'DGI respondió, pero faltan campos clave (fecha/proveedor/total)';
  }

  return {
    ok: !faltanClave,
    metodoExtraccion: 'DGI',
    confianza: datos.confianza,
    estado: datos.estado,
    textoFuente: consulta.text,
    datos: datos,
    observaciones: datos.observaciones || 'Extracción por CUFE en DGI'
  };
}


function extraerDesdeTextoEmbebido(contexto) {
  try {
    const texto = contexto.textoOCR || extractTextFromPdf(contexto.fileId);
    if (!texto) {
      return { ok: false, metodoExtraccion: 'OCR_DRIVE', confianza: 0, observaciones: 'Sin texto extraído' };
    }

    const datos = parseInvoiceDataGeneric(texto);
    const validacion = validarResultado(datos);
    const confianza = calcularConfianza(datos, 'OCR_DRIVE');

    return {
      ok: validacion.estado !== 'ERROR_EXTRACCION',
      metodoExtraccion: 'OCR_DRIVE',
      confianza: confianza,
      textoFuente: texto,
      datos: datos,
      estado: validacion.estado,
      observaciones: validacion.observaciones
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
  const proveedorNormalizado = normalizarProveedor(proveedor, contexto.catalogoProveedores);
  const proveedorNormalizado = normalizarProveedor(proveedor);
  const validacion = validarResultado(datosBase);

  const salida = {
    fecha: normalizarFecha(datosBase.fecha),
    proveedor: proveedor,
    proveedorNormalizado: proveedorNormalizado,
    itbms: toNumber(datosBase.itbms),
    total: toNumber(datosBase.total),
    cufe: limpiarTexto(datosBase.cufe || contexto.cufeDetectado || ''),
    tipoDocumento: contexto.tipoDocumento,
    metodoExtraccion: resultado.metodoExtraccion || 'N/D',
    confianza: resultado.confianza || calcularConfianza(datosBase, resultado.metodoExtraccion || 'N/D'),
    estado: resultado.estado || validacion.estado,
    observaciones: resultado.observaciones || '',
    driveFileId: contexto.fileId,
    link: contexto.link
  };

  if (contexto.tipoDocumento === 'NO_FISCAL') {
    salida.estado = 'NO_FISCAL';
    return salida;
  }

  if (!resultado.ok && salida.estado === 'OK') {
    salida.estado = 'REVISION_MANUAL';
  }

  if (!validacion.esValido || validacion.estado !== 'OK') {
    salida.estado = validacion.estado;
    salida.observaciones = anexarObs(salida.observaciones, validacion.observaciones);
  }

  if (salida.confianza < 0.7 && salida.estado === 'OK') {
    salida.estado = 'REVISION_MANUAL';
    salida.observaciones = anexarObs(salida.observaciones, 'Confianza baja');
  }

  return salida;
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

function getCatalogoProveedores(spreadsheet) {
  let catalogoSheet = spreadsheet.getSheetByName(NOMBRE_HOJA_CATALOGO);
  if (!catalogoSheet) {
    catalogoSheet = spreadsheet.insertSheet(NOMBRE_HOJA_CATALOGO);
  }
  ensureHeaders(catalogoSheet, ENCABEZADOS_CATALOGO);

  const lastRow = catalogoSheet.getLastRow();
  const catalogo = { aliasMap: {} };
  if (lastRow <= 1) return catalogo;

  const values = catalogoSheet.getRange(2, 1, lastRow - 1, ENCABEZADOS_CATALOGO.length).getValues();
  for (let i = 0; i < values.length; i++) {
    const canonico = limpiarTexto(values[i][0]);
    const aliasRaw = limpiarTexto(values[i][1]);
    const activo = parseBooleanCell(values[i][4]);
    if (!canonico || !activo) continue;

    const canonicoLimpio = normalizarNombreProveedorBase(canonico);
    catalogo.aliasMap[canonicoLimpio] = canonicoLimpio;

    if (aliasRaw) {
      const aliasList = aliasRaw.split(/[|,;\n]/);
      for (let j = 0; j < aliasList.length; j++) {
        const aliasLimpio = normalizarNombreProveedorBase(aliasList[j]);
        if (aliasLimpio) {
          catalogo.aliasMap[aliasLimpio] = canonicoLimpio;
        }
      }
    }
  }

  return catalogo;
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

function extraerDesdeTextoEmbebido_parseFechas(texto) {
  const meses = {
    ENERO: '01', FEBRERO: '02', MARZO: '03', ABRIL: '04', MAYO: '05', JUNIO: '06',
    JULIO: '07', AGOSTO: '08', SEPTIEMBRE: '09', SETIEMBRE: '09', OCTUBRE: '10', NOVIEMBRE: '11', DICIEMBRE: '12'
  };
  const candidatos = [];
  const t = texto.toUpperCase();
  let m;

  const patrones = [
    /(\d{4})[-\/](\d{2})[-\/](\d{2})/g,
    /(\d{2})[-\/](\d{2})[-\/](\d{4})/g,
    /(\d{2})\s+DE\s+([A-ZÁÉÍÓÚ]+)\s+DE\s+(\d{4})/g
  ];

  while ((m = patrones[0].exec(t)) !== null) {
    candidatos.push(m[1] + '-' + m[2] + '-' + m[3]);
  }
  while ((m = patrones[1].exec(t)) !== null) {
    candidatos.push(m[3] + '-' + m[2] + '-' + m[1]);
  }
  while ((m = patrones[2].exec(t)) !== null) {
    const mes = meses[m[2]] || '';
    if (mes) candidatos.push(m[3] + '-' + mes + '-' + ('0' + m[1]).slice(-2));
  }

  for (let i = 0; i < candidatos.length; i++) {
    const c = candidatos[i];
    if (/^\d{4}-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/.test(c)) return c;
  }
  return '';
}

function parseInvoiceDataGeneric(text) {
  const raw = String(text || '');
  const txt = raw.replace(/\u00A0/g, ' ');
  const upper = txt.toUpperCase();
  const data = {
    fecha: '',
    proveedor: '',
    itbms: '',
    total: '',
    cufe: '',
    numeroFactura: '',
    noFiscalDetectado: textoPareceNoFiscal(upper)
  };

  data.fecha = extraerDesdeTextoEmbebido_parseFechas(txt);

  const proveedorRegex = /(EMISOR|PROVEEDOR|RAZ[ÓO]N\s+SOCIAL|NOMBRE\s+COMERCIAL|NOMBRE)\s*:?\s*([^\n\r|]{3,120})/gi;
  const clienteCtxBlockers = /RUC\s*\/\s*CIP|CLIENTE|DIRECCION|TELEFONO|CJ:|CAJERO|VENDEDOR/i;
  let pm;
  while ((pm = proveedorRegex.exec(txt)) !== null) {
    const label = limpiarTexto(pm[1] || '').toUpperCase();
    const cand = limpiarTexto(pm[2]).replace(/[:;,.]+$/, '');
    const ctxStart = Math.max(0, pm.index - 120);
    const ctxEnd = Math.min(txt.length, pm.index + pm[0].length + 120);
    const localCtx = txt.slice(ctxStart, ctxEnd);
    if (/RAZ[ÓO]N\s+SOCIAL/i.test(label) && clienteCtxBlockers.test(localCtx)) {
      continue;
    }
    if (cand && !/\b(RUC|DV|NIT|CUFE|FACTURA)\b/i.test(cand)) {
      data.proveedor = cand;
      break;
    }
  }
  if (!data.proveedor) {
    const lineas = txt.split(/\r?\n/);
    for (let i = 0; i < Math.min(6, lineas.length); i++) {
      const l = limpiarTexto(lineas[i]);
      if (l.length >= 5 && l.length <= 120 && /[A-Za-zÁÉÍÓÚÑ]/.test(l) && !/\d{3,}/.test(l)) {
        data.proveedor = l;
        break;
      }
    }
  }

  const cufeMatch = upper.match(/(?:\bCUFE\b[\s:;#-]*)?([A-Z0-9-]{20,120})/);
  if (cufeMatch && /[A-Z]/.test(cufeMatch[1]) && /\d/.test(cufeMatch[1])) {
    data.cufe = cufeMatch[1].replace(/[^A-Z0-9-]/g, '');
  }

  const facturaMatch = txt.match(/(?:N[ÚU]MERO|NUM|NO\.?|FACTURA|FOLIO)\s*(?:DE\s*)?(?:FACTURA)?\s*[:#-]?\s*([A-Z0-9-]{3,40})/i);
  if (facturaMatch) {
    data.numeroFactura = limpiarTexto(facturaMatch[1]);
  }

  const montos = [];
  const lineas = txt.split(/\r?\n/);
  const montoRegex = /(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})|\d+(?:[.,]\d{2}))/g;
  for (let i = 0; i < lineas.length; i++) {
    const linea = lineas[i];
    let mm;
    while ((mm = montoRegex.exec(linea)) !== null) {
      const valor = toNumber(mm[1]);
      if (valor === '' || valor <= 0) continue;
      montos.push({
        valor: valor,
        linea: linea.toUpperCase()
      });
    }
  }

  let total = '';
  let itbms = '';
  for (let i = 0; i < montos.length; i++) {
    const mItem = montos[i];
    if (/(TOTAL\s+A\s+PAGAR|IMPORTE\s+TOTAL|GRAN\s+TOTAL|VALOR\s+TOTAL|TOTAL)/i.test(mItem.linea)) {
      if (total === '' || mItem.valor > total) total = mItem.valor;
    }
    if (/(ITBMS|IVA|IMPUESTO)/i.test(mItem.linea)) {
      if (itbms === '' || mItem.valor > itbms) itbms = mItem.valor;
    }
  }

  if (total === '' && montos.length) {
    montos.sort(function (a, b) { return b.valor - a.valor; });
    total = montos[0].valor;
  }
  if (itbms === '' && total !== '' && montos.length) {
    for (let i = 0; i < montos.length; i++) {
      if (montos[i].valor < total && montos[i].valor <= total * 0.2) {
        if (itbms === '' || montos[i].valor > itbms) itbms = montos[i].valor;
      }
    }
  }

  data.total = total;
  data.itbms = itbms;
  return data;
}

function validarResultado(data) {
  const out = {
    estado: 'OK',
    esValido: true,
    observaciones: ''
  };
  const fecha = limpiarTexto(data.fecha);
  const proveedor = limpiarTexto(data.proveedor);
  const total = toNumber(data.total);
  const itbms = toNumber(data.itbms);
  const cufe = limpiarTexto(data.cufe);

  if (data.noFiscalDetectado) {
    out.estado = 'NO_FISCAL';
    out.esValido = false;
    out.observaciones = anexarObs(out.observaciones, 'Expresiones de documento no fiscal');
    return out;
  }

  if (!fecha || !proveedor || total === '') {
    out.estado = 'REVISION_MANUAL';
    out.esValido = false;
    out.observaciones = anexarObs(out.observaciones, 'Faltan campos clave');
  }

  if (itbms !== '' && total !== '' && itbms > total) {
    out.estado = 'ERROR_EXTRACCION';
    out.esValido = false;
    out.observaciones = anexarObs(out.observaciones, 'ITBMS mayor que total');
  }

  if (cufe && !/^[A-Z0-9-]{20,120}$/.test(cufe)) {
    out.estado = 'REVISION_MANUAL';
    out.esValido = false;
    out.observaciones = anexarObs(out.observaciones, 'CUFE con formato inválido');
  }

  return out;
}

function calcularConfianza(data, fuente) {
  let score = 0.2;
  if (data.fecha) score += 0.2;
  if (data.proveedor) score += 0.2;
  if (toNumber(data.total) !== '') score += 0.2;
  if (toNumber(data.itbms) !== '') score += 0.05;
  if (data.cufe) score += 0.05;
  if (data.numeroFactura) score += 0.05;
  if (fuente === 'DGI') score += 0.05;

  const validacion = validarResultado(data);
  if (validacion.estado === 'REVISION_MANUAL') score -= 0.15;
  if (validacion.estado === 'ERROR_EXTRACCION') score -= 0.5;
  if (validacion.estado === 'NO_FISCAL') score -= 0.4;

  if (score < 0) score = 0;
  if (score > 1) score = 1;
  return Math.round(score * 100) / 100;
}

function isDuplicateInvoice(sheet, cufe, driveFileId) {
  const result = isDuplicateInvoiceAdvanced(sheet, {
    cufe: cufe,
    driveFileId: driveFileId
  });
  return result.type === 'REAL';
}

function isDuplicateInvoiceAdvanced(sheet, data) {
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) {
    return { isDuplicate: false, type: 'NONE', reason: '' };
  }

  const values = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();
  const incomingFirma = construirFirmaFactura(data);

  for (let i = 0; i < values.length; i++) {
    const existingCufe = values[i][5];
    const existingDriveFileId = values[i][11];
    if (data.cufe && existingCufe === data.cufe) {
      return { isDuplicate: true, type: 'REAL', reason: 'CUFE ya registrado' };
    }
    if (data.driveFileId && existingDriveFileId === data.driveFileId) {
      return { isDuplicate: true, type: 'REAL', reason: 'ID de archivo ya registrado' };
    }

    if (!incomingFirma) continue;
    const existingFirma = construirFirmaFactura({
      fecha: values[i][0],
      proveedorNormalizado: values[i][2],
      total: values[i][4]
    });
    if (existingFirma && existingFirma === incomingFirma) {
      return { isDuplicate: true, type: 'POSIBLE', reason: 'Coincidencia en firma compuesta' };
    }
  }

  return { isDuplicate: false, type: 'NONE', reason: '' };
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

function normalizarProveedor(nombreDetectado, catalogo) {
  const limpio = normalizarNombreProveedorBase(nombreDetectado);
  if (!limpio) return '';
  if (catalogo && catalogo.aliasMap && catalogo.aliasMap[limpio]) {
    return catalogo.aliasMap[limpio];
  }
  return limpio;
}

function construirFirmaFactura(data) {
  const fecha = normalizarFecha(data.fecha);
  const proveedor = normalizarNombreProveedorBase(data.proveedorNormalizado || data.proveedor || '');
  const total = normalizarImporteFirma(data.total);
  if (!fecha || !proveedor || total === '') return '';
  return [fecha, proveedor, total].join('|');
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
