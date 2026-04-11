const NOMBRE_HOJA_DATOS = 'Datos Facturas'; // Nombre de la hoja dentro del archivo de cálculo
const NOMBRE_HOJA_REGISTRO = 'Archivos Procesados'; // Nombre de la hoja para registrar PDFs ya procesados

// --- NOMBRES DE COLUMNAS EN LA HOJA DE CÁLCULO ---
const ENCABEZADOS_DATOS = ['Fecha', 'Proveedor', 'ITBMS', 'Total', 'CUFE', 'ID Archivo Drive', 'Link'];
const ENCABEZADOS_REGISTRO = ['ID Archivo Drive', 'Nombre Archivo', 'Fecha Procesado'];

// --- FUNCIÓN PRINCIPAL QUE SE EJECUTA CON EL DISPARADOR ---
function procesarNuevosPdfs(ID_CARPETA_PDF, NOMBRE_ARCHIVO_HOJA_CALCULO) {
  const folder = DriveApp.getFolderById(ID_CARPETA_PDF);
  

  const spreadsheet = getOrCreateSpreadsheet(ID_CARPETA_PDF, NOMBRE_ARCHIVO_HOJA_CALCULO, NOMBRE_HOJA_DATOS, ENCABEZADOS_DATOS);
  const dataSheet = spreadsheet.getSheetByName(NOMBRE_HOJA_DATOS);
  const processedLogSheet = getOrCreateProcessedLogSheet(spreadsheet, NOMBRE_HOJA_REGISTRO, ENCABEZADOS_REGISTRO);

  // Obtener los IDs de archivos ya procesados
  const processedFileIds = getProcessedFileIds(processedLogSheet);

  let newPdfsFound = false;

  //const files = folder.getFilesByType(MimeType.PDF);

  const allPdfs = []; // Array para almacenar todos los archivos PDF encontrados

  //Logger.log(`Iniciando búsqueda de PDFs en la carpeta: ${rootFolder.getName()} (ID: ${rootFolderId})`);

  // Llama a la función recursiva para comenzar la exploración
  findAllPdfs(folder, allPdfs);

  //while (files.hasNext()) {
  for (let i = 0; i < allPdfs.length; i++) {
    const file = allPdfs[i];
    //const file = files.next();
    const fileId = file.getId();

    // Verificar si el archivo ya ha sido procesado
    if (processedFileIds.has(fileId)) {
      //Logger.log(`Archivo ya procesado: ${file.getName()} (${fileId})`);
      continue;
    }

    Logger.log(`Procesando nuevo PDF: ${file.getName()} (${fileId})`);
    newPdfsFound = true;

    let invoiceData;

    try {
      //const pdfText = extractTextFromPdf(fileId);
      const pdfText = extractTextFromCufe(file.getName().slice(0, -4));
      invoiceData = parseInvoiceData(pdfText);
      //Logger.log({invoiceData});
      /*if (NOMBRE_ARCHIVO_HOJA_CALCULO === 'Facturas FONDOS COMERCIALES'){
        invoiceData = parseInvoiceData_FONDOS(pdfText);
      }
      else if (NOMBRE_ARCHIVO_HOJA_CALCULO === 'Facturas PROSERV') {
        invoiceData = parseInvoiceData_PROSERV(pdfText);
      }
      else {
        invoiceData = parseInvoiceData(pdfText);
      }*/
      
      // Verificar si la factura está repetida por CUFE
      if (isDuplicateInvoice(dataSheet, invoiceData.cufe, fileId)) {
        Logger.log(`Factura duplicada (CUFE o ID de archivo): ${invoiceData.cufe || 'N/A'} - ${file.getName()}`);
        // Registrar el archivo como procesado aunque sea duplicado para evitar re-chequeo
        processedLogSheet.appendRow([fileId, file.getName(), new Date()]);
        continue;
      }

      // Añadir ID de archivo de Drive a los datos
      invoiceData.driveFileId = fileId;

      // Añadir link del archivo
      invoiceData.link = file.getUrl();

      // Formatear los datos para la fila de la hoja de cálculo
      const rowData = [
        invoiceData.fecha,
        invoiceData.proveedor,
        invoiceData.itbms,
        invoiceData.total,
        invoiceData.cufe,
        invoiceData.driveFileId,
        invoiceData.link
      ];

      dataSheet.appendRow(rowData);
      Logger.log(`Datos ingresados para ${file.getName()}`);

      // Registrar el archivo como procesado
      processedLogSheet.appendRow([fileId, file.getName(), new Date()]);

    } catch (e) {
      Logger.log(`Error al procesar ${file.getName()} (${fileId}): ${e.message}`);
      // Opcional: mover el archivo a una carpeta de errores o enviar notificación
    }
  }

  if (!newPdfsFound) {
    Logger.log('No se encontraron nuevos PDFs para procesar.');
  }
}

function getOrCreateSpreadsheet(folderId, sheetName, tabName, headers) {
  const folder = DriveApp.getFolderById(folderId);
  const files = folder.getFilesByName(sheetName);
  let spreadsheet;

  if (files.hasNext()) {
    spreadsheet = SpreadsheetApp.open(files.next());
    Logger.log(`Hoja de cálculo existente encontrada: ${sheetName}`);
  } else {
    spreadsheet = SpreadsheetApp.create(sheetName);
    DriveApp.getFileById(spreadsheet.getId()).moveTo(folder);
    Logger.log(`Nueva hoja de cálculo creada: ${sheetName}`);
  }

  // Asegurarse de que la pestaña de datos exista y tenga los encabezados
  let dataSheet = spreadsheet.getSheetByName(tabName);
  if (!dataSheet) {
    dataSheet = spreadsheet.insertSheet(tabName);
    // Eliminar la hoja por defecto si no es la única
    if (spreadsheet.getSheets().length > 1 && spreadsheet.getSheets()[0].getName() === 'Hoja 1') {
      spreadsheet.deleteSheet(spreadsheet.getSheets()[0]);
    }
    Logger.log(`Pestaña '${tabName}' creada.`);
  }

  // Escribir encabezados si la hoja está vacía
  if (dataSheet.getLastRow() === 0) {
    dataSheet.appendRow(headers);
    Logger.log(`Encabezados escritos en '${tabName}'.`);
  }
  return spreadsheet;
}

function getOrCreateProcessedLogSheet(spreadsheet, tabName, headers) {
  let logSheet = spreadsheet.getSheetByName(tabName);
  if (!logSheet) {
    logSheet = spreadsheet.insertSheet(tabName);
    Logger.log(`Pestaña de registro '${tabName}' creada.`);
  }
  if (logSheet.getLastRow() === 0) {
    logSheet.appendRow(headers);
    Logger.log(`Encabezados escritos en '${tabName}'.`);
  }
  return logSheet;
}

function getProcessedFileIds(processedLogSheet) {
  const fileIds = new Set();
  const lastRow = processedLogSheet.getLastRow();
  if (lastRow > 1) { // Ignorar la fila de encabezados
    const range = processedLogSheet.getRange(2, 1, lastRow - 1, 1);
    const values = range.getValues();
    values.forEach(row => fileIds.add(row[0]));
  }
  return fileIds;
}

function extractTextFromPdf(fileId) {
  const pdfFile = DriveApp.getFileById(fileId);
  const pdfBlob = pdfFile.getBlob();

  // --- INICIO DE MODIFICACIÓN ---
  const fileMimeType = pdfFile.getMimeType();
  Logger.log(`Procesando archivo: ${pdfFile.getName()} (ID: ${fileId}) con MIME Type: ${fileMimeType}`);

  // Asegurarse de que el archivo es realmente un PDF antes de intentar OCR
  if (fileMimeType !== MimeType.PDF) {
    throw new Error(`El archivo ${pdfFile.getName()} (ID: ${fileId}) no es un PDF. Su tipo es: ${fileMimeType}. No se puede realizar OCR.`);
  }

  const tempDoc = Drive.Files.create({
    title: pdfFile.getName() + '_temp_ocr',
    mimeType: MimeType.GOOGLE_DOCS
  }, pdfBlob.setContentType(MimeType.PDF), { // <--- MODIFICACIÓN AQUÍ
    ocr: true,
    ocrLanguage: 'es'
  });

  // Extraer el texto del documento temporal
  const docContent = DocumentApp.openById(tempDoc.id).getBody().getText();

  //Logger.log({docContent});

  // Eliminar el documento temporal
  Drive.Files.remove(tempDoc.id);

  return docContent;
}

function parseInvoiceData(text) {
  const data = {
    fecha: '',
    proveedor: '',
    itbms: '',
    total: '',
    cufe: ''
  };

  // --- EJEMPLOS DE EXPRESIONES REGULARES (NECESITAN PERSONALIZACIÓN) ---
  // Estos son solo ejemplos. Debes ajustarlos a la estructura real de tus PDFs.

  // Ejemplo para Fecha (dd/mm/aaaa o dd-mm-aaaa)
  const fechaMatch = text.match(/FECHA AUTORIZACIÓN(\d{2}\/\d{2}\/\d{4})/i);
  if (fechaMatch) {
    data.fecha = fechaMatch[1];
  }

  // Ejemplo para Proveedor (buscar "Proveedor:" seguido de texto)
  const proveedorMatch = text.match(/NOMBRE([^\n]+)DIRECCIÓN/i);
  if (proveedorMatch) {
    data.proveedor = proveedorMatch[1].trim();
  }

  // Ejemplo para ITBMS (buscar "ITBMS:" o "IVA:" seguido de un número con decimales)
  const itbmsMatch = text.match(/ITBMS Total:\s*(\d{1,6}(?:,\d{3})*(?:\.\d+)?)/i);
  if (itbmsMatch) {
    data.itbms = parseFloat(itbmsMatch[1].replace(',', '.')); // Convertir a número flotante
  }

  // Ejemplo para Total (buscar "Total:" o "Monto Total:" seguido de un número con decimales)
  const totalMatch = text.match(/Valor Total:\s*(\d{1,6}(?:,\d{3})*(?:\.\d+)?)/i);
  if (totalMatch) {
    data.total = parseFloat(totalMatch[1].replace(',', '.')); // Convertir a número flotante
  }

  // Ejemplo para CUFE (Código Único de Factura Electrónica - formato específico, por ejemplo, alfanumérico largo)
  // Este es un ejemplo genérico, el CUFE puede tener un patrón muy específico.
  const cufeMatch = text.match(/\[CUFE\]\s*([A-Z0-9-]+)PROTOCOLO/i); // Ajusta el patrón según el formato real del CUFE
  if (cufeMatch) {
    data.cufe = cufeMatch[1].trim();
  }
  Logger.log({data});
  return data;
}

function isDuplicateInvoice(sheet, cufe, driveFileId) {
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return false; // Solo encabezados o vacía

  const range = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn());
  const values = range.getValues();

  for (let i = 0; i < values.length; i++) {
    const row = values[i];
    const existingCufe = row[4]; // Columna del CUFE (índice 4 para la 5ta columna)
    const existingDriveFileId = row[5]; // Columna del ID de Archivo Drive (índice 5 para la 6ta columna)

    // Considerar duplicado si el CUFE coincide O el ID de archivo de Drive coincide
    if ((cufe && existingCufe === cufe) || existingDriveFileId === driveFileId) {
      return true;
    }
  }
  return false;
}

function findAllPdfs(folder, pdfFilesArray) {
  // 1. Obtener archivos PDF directamente en esta carpeta
  const files = folder.getFilesByType(MimeType.PDF);
  while (files.hasNext()) {
    const file = files.next();
    pdfFilesArray.push(file);
    // Logger.log(`Encontrado PDF: ${file.getName()} en ${folder.getName()}`);
  }

  // 2. Obtener subcarpetas y llamarse a sí misma para cada una
  const subFolders = folder.getFolders();
  while (subFolders.hasNext()) {
    const subFolder = subFolders.next();
    // Llamada recursiva: explora la subcarpeta
    findAllPdfs(subFolder, pdfFilesArray);
  }
}