const ID_CARPETAS = [
  '1YuiqhQ-oyQRBHsYP8cvOe35NFs-HiTwA',
  '1uvviPvTEtorrLiIIu2iVvlUUxWo2mFN1',
  '1NdQsvwNSmSDXg4TdzhqZuP1hbq4Zxlin',
  '10r_6Rx_n62TxgCUvL9n4qLxpJfjIXR4z',
  '14OYOdWUTU0Eo52uC91bUzjAbCIR04pld',
  '1xBBkSZocbOTxlJFOr882k2Z64GPDCJI0',
  '1-QwxJrGJV7qcdCHwcgXukVUz4BAE_VI0',
  '1--jU-sl0aVfsxngO0r9Vd9Pn_5FUWfG0',
  '1isifjyeEaoXqaaF0-IWJ_6HldEVAHug_',
  '1nibsGi3OF165l4C_y_DiAQdysTkxovOW',
  '1Moxa75dYOy_eaXJav0mmfrx1gBRnSzFL',
  '1dGJSBXSnflrCMPV8feksdnBQz6KyZBTf',
  '1ghfhKtOM_yfvFRzRm9TG5O98LIJIuyxt',
  '13gXXtLroT8zU3VeLyTJ7xZKDMPHne7MB',
  '1pD_gbWjTK-pt7rSPYzwH_DIS28k_4xCM',
  '1nibsGi3OF165l4C_y_DiAQdysTkxovOW'
];

const NOMBRE_ARCHIVOS = [
  'Facturas ENSA',
  'Facturas FONDOS COMERCIALES',
  'Facturas PROSERV',
  'Facturas MINIDEPOSITOS',
  'Facturas FUMIEXPRESS',
  'Facturas LA DOÑA',
  'Facturas ENERO',
  'Facturas',
  'Facturas JUNIO',
  'Facturas JULIO',
  'Facturas DICIEMBRE',
  'Facturas NOVIEMBRE',
  'Facturas OCTUBRE',
  'Facturas SEPTIEMBRE',
  'Facturas AGOSTO',
  'Facturas JULIO'
];

const PIPELINE_CFG = {
  dataSheet: 'Datos Facturas',
  logSheet: 'Archivos Procesados',
  metricsSheet: 'Metricas Pipeline',
  processedFolderName: '_PROCESADOS',
  dataHeaders: ['Fecha', 'Proveedor', 'ITBMS', 'Total', 'CUFE', 'Método extracción', 'Confianza', 'ID Archivo Drive', 'Link'],
  logHeaders: ['ID Archivo Drive', 'Nombre Archivo', 'Fecha Procesado'],
  metricsHeaders: ['Timestamp', 'ID Archivo Drive', 'Método extracción', 'Tiempo extracción ms', 'Campos vacíos rate', 'Total invalidado', 'ITBMS invalidado'],
  providerCatalog: []
};

function ENSA() { procesarNuevosPdfs(ID_CARPETAS[0], NOMBRE_ARCHIVOS[0]); }
function FONDOS_COMERCIALES() { procesarNuevosPdfs(ID_CARPETAS[1], NOMBRE_ARCHIVOS[1]); }
function PROSERV() { procesarNuevosPdfs(ID_CARPETAS[2], NOMBRE_ARCHIVOS[2]); }
function MINIDEPOSITOS() { procesarNuevosPdfs(ID_CARPETAS[3], NOMBRE_ARCHIVOS[3]); }
function FUMIEXPRESS() { procesarNuevosPdfs(ID_CARPETAS[4], NOMBRE_ARCHIVOS[4]); }
function LADOÑA() { procesarNuevosPdfs(ID_CARPETAS[5], NOMBRE_ARCHIVOS[5]); }
function multicarpetas() { procesarNuevosPdfs(ID_CARPETAS[6], NOMBRE_ARCHIVOS[6]); }
function FACTURAS() { procesarNuevosPdfs(ID_CARPETAS[15], NOMBRE_ARCHIVOS[15]); }
