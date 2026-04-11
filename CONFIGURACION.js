
const ID_CARPETAS = [
  '1YuiqhQ-oyQRBHsYP8cvOe35NFs-HiTwA', //ENSA 0
  '1uvviPvTEtorrLiIIu2iVvlUUxWo2mFN1', //FONDOS COMERCIALES 1
  '1NdQsvwNSmSDXg4TdzhqZuP1hbq4Zxlin', //PROSERV 2
  '10r_6Rx_n62TxgCUvL9n4qLxpJfjIXR4z', //MINIDEPOSITOS 3
  '14OYOdWUTU0Eo52uC91bUzjAbCIR04pld', //FUMI EXPRESS 4
  '1xBBkSZocbOTxlJFOr882k2Z64GPDCJI0', //LA DOÑA 5
  '1-QwxJrGJV7qcdCHwcgXukVUz4BAE_VI0', //ENERO 6
  '1--jU-sl0aVfsxngO0r9Vd9Pn_5FUWfG0', //TODAS 7
  '1isifjyeEaoXqaaF0-IWJ_6HldEVAHug_', //JUNIO 8 
  '1nibsGi3OF165l4C_y_DiAQdysTkxovOW', //JULIO 9
  '1Moxa75dYOy_eaXJav0mmfrx1gBRnSzFL', //DICIEMBRE 10
  '1dGJSBXSnflrCMPV8feksdnBQz6KyZBTf', //NOVIEMBRE 11
  '1ghfhKtOM_yfvFRzRm9TG5O98LIJIuyxt', //OCTUBRE 12
  '13gXXtLroT8zU3VeLyTJ7xZKDMPHne7MB', //SEPTIEMBRE 13
  '1pD_gbWjTK-pt7rSPYzwH_DIS28k_4xCM', //AGOSTO 14
  '1nibsGi3OF165l4C_y_DiAQdysTkxovOW', //JULIO 15
  ]

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
]

function ENSA() {
  procesarNuevosPdfs(ID_CARPETAS[0], NOMBRE_ARCHIVOS[0]);
}

function FONDOS_COMERCIALES() {
  procesarNuevosPdfs(ID_CARPETAS[1], NOMBRE_ARCHIVOS[1]);
}

function PROSERV() {
  procesarNuevosPdfs(ID_CARPETAS[2], NOMBRE_ARCHIVOS[2]);
}

function MINIDEPOSITOS() {
  procesarNuevosPdfs(ID_CARPETAS[3], NOMBRE_ARCHIVOS[3]);
}

function FUMIEXPRESS() {
  procesarNuevosPdfs(ID_CARPETAS[4], NOMBRE_ARCHIVOS[4]);
}

function LADOÑA() {
  procesarNuevosPdfs(ID_CARPETAS[5], NOMBRE_ARCHIVOS[5]);
}

function multicarpetas(){
  procesarNuevosPdfs(ID_CARPETAS[6], NOMBRE_ARCHIVOS[6]);
}

function FACTURAS(){
  procesarNuevosPdfs(ID_CARPETAS[15], NOMBRE_ARCHIVOS[15]);
}