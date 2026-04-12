function procesarNuevosPdfs(idCarpetaPdf, nombreArchivoHojaCalculo) {
  const env = initPipeline(idCarpetaPdf, nombreArchivoHojaCalculo);
  const pdfFiles = listAllPdfs(env.rootFolder);
  const processedIds = getProcessedFileIds(env.processedLogSheet);

  let processedCount = 0;
  for (let i = 0; i < pdfFiles.length; i++) {
    const file = pdfFiles[i];
    const fileId = file.getId();
    if (processedIds.has(fileId)) continue;

    try {
      const extraction = extractInvoice(file);
      const parsed = parseInvoiceText(extraction.text);
      const processed = processExtractedInvoice(parsed, extraction.method, PIPELINE_CFG.providerCatalog);

      if (isDuplicateInvoice(env.dataSheet, processed.data.cufe, fileId)) {
        markAsProcessed(env, file, fileId);
        continue;
      }

      const row = buildOutputRow(processed.data, fileId, file.getUrl());
      env.dataSheet.appendRow(row);
      appendMetrics(env.metricsSheet, fileId, extraction, processed);
      markAsProcessed(env, file, fileId);
      processedCount++;
    } catch (error) {
      Logger.log('[pipeline] fileId=' + fileId + ' err=' + error.message);
    }
  }

  Logger.log('[pipeline] done processed=' + processedCount);
}

function initPipeline(folderId, sheetName) {
  const rootFolder = DriveApp.getFolderById(folderId);
  const spreadsheet = getOrCreateSpreadsheet(folderId, sheetName);

  return {
    rootFolder: rootFolder,
    processedFolder: getOrCreateSubFolder(rootFolder, PIPELINE_CFG.processedFolderName),
    dataSheet: getOrCreateSheet(spreadsheet, PIPELINE_CFG.dataSheet, PIPELINE_CFG.dataHeaders),
    processedLogSheet: getOrCreateSheet(spreadsheet, PIPELINE_CFG.logSheet, PIPELINE_CFG.logHeaders),
    metricsSheet: getOrCreateSheet(spreadsheet, PIPELINE_CFG.metricsSheet, PIPELINE_CFG.metricsHeaders)
  };
}

function extractInvoice(file) {
  const method = selectExtractionMethod(file.getName());
  const start = Date.now();
  const text = method === EXTRACCION_METODO.CONSULTA_CUFE
    ? extractTextFromCufe(file.getName().replace(/\.pdf$/i, ''))
    : extractTextFromPdf(file.getId());

  return {
    method: method,
    text: text,
    elapsedMs: Date.now() - start
  };
}

function appendMetrics(sheet, fileId, extraction, processed) {
  sheet.appendRow([
    new Date(),
    fileId,
    extraction.method,
    extraction.elapsedMs,
    computeEmptyFieldRate(processed.data),
    processed.validationFlags.invalidTotalByOcrThreshold,
    processed.validationFlags.invalidItbmsByOcrThreshold
  ]);
}

function markAsProcessed(env, file, fileId) {
  env.processedLogSheet.appendRow([fileId, file.getName(), new Date()]);
  moveToProcessedFolder(file, env.processedFolder);
}

function moveToProcessedFolder(file, processedFolder) {
  processedFolder.addFile(file);
  const parents = file.getParents();
  while (parents.hasNext()) {
    const parent = parents.next();
    if (parent.getId() !== processedFolder.getId()) {
      parent.removeFile(file);
    }
  }
}

function getOrCreateSpreadsheet(folderId, sheetName) {
  const folder = DriveApp.getFolderById(folderId);
  const files = folder.getFilesByName(sheetName);
  if (files.hasNext()) return SpreadsheetApp.open(files.next());

  const spreadsheet = SpreadsheetApp.create(sheetName);
  DriveApp.getFileById(spreadsheet.getId()).moveTo(folder);
  return spreadsheet;
}

function getOrCreateSheet(spreadsheet, tabName, headers) {
  let sheet = spreadsheet.getSheetByName(tabName);
  if (!sheet) sheet = spreadsheet.insertSheet(tabName);
  if (sheet.getLastRow() === 0) sheet.appendRow(headers);
  return sheet;
}

function getOrCreateSubFolder(parentFolder, subFolderName) {
  const folders = parentFolder.getFoldersByName(subFolderName);
  return folders.hasNext() ? folders.next() : parentFolder.createFolder(subFolderName);
}

function getProcessedFileIds(processedLogSheet) {
  const fileIds = new Set();
  const lastRow = processedLogSheet.getLastRow();
  if (lastRow <= 1) return fileIds;

  const values = processedLogSheet.getRange(2, 1, lastRow - 1, 1).getValues();
  for (let i = 0; i < values.length; i++) fileIds.add(values[i][0]);
  return fileIds;
}

function isDuplicateInvoice(sheet, cufe, driveFileId) {
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return false;

  const values = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();
  for (let i = 0; i < values.length; i++) {
    const existingCufe = values[i][4];
    const existingDriveFileId = values[i][7];
    if ((cufe && existingCufe === cufe) || existingDriveFileId === driveFileId) return true;
  }
  return false;
}

function extractTextFromPdf(fileId) {
  const pdfFile = DriveApp.getFileById(fileId);
  if (pdfFile.getMimeType() !== MimeType.PDF) throw new Error('invalid_mime_type');

  const tempDoc = Drive.Files.create({
    title: pdfFile.getName() + '_tmp_ocr',
    mimeType: MimeType.GOOGLE_DOCS
  }, pdfFile.getBlob().setContentType(MimeType.PDF), {
    ocr: true,
    ocrLanguage: 'es'
  });

  const content = DocumentApp.openById(tempDoc.id).getBody().getText();
  Drive.Files.remove(tempDoc.id);
  return content;
}

function listAllPdfs(folder) {
  const files = [];
  findAllPdfs(folder, files);
  return files;
}

function findAllPdfs(folder, pdfFilesArray) {
  const files = folder.getFilesByType(MimeType.PDF);
  while (files.hasNext()) pdfFilesArray.push(files.next());

  const subFolders = folder.getFolders();
  while (subFolders.hasNext()) findAllPdfs(subFolders.next(), pdfFilesArray);
}
