/**
 * Realiza una consulta POST a la página de la DGI por la clave de acceso (CUFE).
 * Intenta obtener el __RequestVerificationToken si está presente en la página.
 * Extrae y devuelve todo el texto visible del HTML de la respuesta.
 *
 * @param {string} cufe La clave de acceso (CUFE) a consultar.
 * @returns {string} Todo el texto visible de la página resultante, o un mensaje de error.
 */
function extractTextFromCufe(cufe) {
  const url = "https://dgi-fep.mef.gob.pa/Consultas/FacturasPorCUFE";
  let requestVerificationToken = '';

  Logger.log(`Iniciando consulta para CUFE: ${cufe}`);

  // --- Paso 1: Obtener el __RequestVerificationToken (si existe) ---
  // Esto es necesario para muchos formularios POST para evitar CSRF.
  try {
    const initialResponse = UrlFetchApp.fetch(url, {'muteHttpExceptions': true});
    const initialHtml = initialResponse.getContentText();

    // Regex para buscar el input oculto del token
    const tokenMatch = initialHtml.match(/<input name="__RequestVerificationToken" type="hidden" value="([^"]+)" \/>/);

    if (tokenMatch && tokenMatch[1]) {
      requestVerificationToken = tokenMatch[1];
      Logger.log('Token de verificación encontrado.');
    } else {
      Logger.log('Advertencia: No se encontró __RequestVerificationToken. La consulta puede fallar si es requerido.');
    }

  } catch (e) {
    Logger.log(`Error al obtener la página inicial para token: ${e.message}`);
    return `Error: Fallo al obtener la página inicial para token. ${e.message}`;
  }

  // --- Paso 2: Preparar los datos y encabezados para la solicitud POST ---
  const payload = {
    'CUFE': cufe // Usamos 'CUFE' como el nombre del campo, según tu inspección HTML
  };

  if (requestVerificationToken) {
    payload['__RequestVerificationToken'] = requestVerificationToken;
  }

  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
  };

  const options = {
    'method': 'post',
    'payload': payload,
    'headers': headers,
    'followRedirects': true,
    'muteHttpExceptions': true // Permite capturar errores HTTP sin que el script se detenga
  };

  // --- Paso 3: Enviar la solicitud POST ---
  try {
    const response = UrlFetchApp.fetch(url, options);
    const statusCode = response.getResponseCode();
    const responseText = response.getContentText();

    if (statusCode >= 200 && statusCode < 300) {
      Logger.log(`Consulta exitosa. Código de estado: ${statusCode}`);
      // Simular soup.get_text() eliminando etiquetas HTML
      finalText = procesarTextoFacturaExtraido(responseText.replace(/<[^>]*>/g, '')); // Elimina todas las etiquetas HTML
      //Logger.log({finalText});
      return finalText
      
    } else {
      Logger.log(`Error: No se pudo obtener la URL. Código de estado: ${statusCode}`);
      Logger.log(`Cuerpo de la respuesta de error: ${responseText}`);
      return `Error: No se pudo obtener la URL. Código de estado: ${statusCode}`;
    }
  } catch (e) {
    Logger.log(`Excepción al realizar la solicitud: ${e.message}`);
    return `Error: Excepción al realizar la solicitud. ${e.message}`;
  }
}

/**
 * Función de ejemplo para probar extractTextFromCufe.
 */
function probarExtractTextFromCufe() {
  const cufeDePrueba = "FE0120000155655496-2-2017-9000002025010300907213110010113575023157"; // Usa un CUFE real

  const extractedText = extractTextFromCufe(cufeDePrueba);
  parseInvoiceData_prueba(extractedText);

  if (extractedText.startsWith("Error:")) {
    //Logger.log(extractedText);
  } else {
    //Logger.log("Texto extraído (primeros 500 caracteres):\n" + extractedText.substring(0, 500) + "...");
    // Aquí puedes aplicar tus regex al 'extractedText'
  }
}
function parseInvoiceData_prueba(text) {
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
    data.itbms = parseFloat(itbmsMatch[1]); // Convertir a número flotante
  }

  // Ejemplo para Total (buscar "Total:" o "Monto Total:" seguido de un número con decimales)
  const totalMatch = text.match(/Valor Total:\s*(\d{1,5}(?:,\d{3})*(?:\.\d+)?)/i);
  if (totalMatch) {
    data.total = parseFloat(totalMatch[1].replace(',', '')); // Convertir a número flotante
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

function procesarTextoFacturaExtraido(extractedText) {
  // Regex para capturar el bloque principal de la factura
  // (No. de factura... hasta la palabra "Cerrar" en los eventos)
  const regexBloqueFactura = /(No\. \d{10}[\s\S]*?Cerrar)/;

  const match = extractedText.match(regexBloqueFactura);

  if (match && match[1]) {
    // match[1] contendrá solo el bloque de texto que te interesa
    const bloqueDeFactura = match[1];
    //Logger.log("Bloque de factura extraído:\n" + bloqueDeFactura);

    // Ahora, a 'bloqueDeFactura' puedes aplicar las regex individuales
    // para campos como Fecha, Emisor, ITBMS, Total, etc.
    // Ejemplo:
    // const datosFactura = parseInvoiceDataFromTextBlock(bloqueDeFactura);
    // return datosFactura;

    return bloqueDeFactura; // Por ahora, devolvemos el bloque para que lo veas
  } else {
    Logger.log("Error: No se pudo encontrar el bloque de factura en el texto.");
    return "Error: Bloque de factura no encontrado.";
  }
}
