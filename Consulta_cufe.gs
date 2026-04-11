function extractTextFromCufe(cufe) {
  const url = 'https://dgi-fep.mef.gob.pa/Consultas/FacturasPorCUFE';
  let requestVerificationToken = '';

  try {
    const initialResponse = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    const initialHtml = initialResponse.getContentText();
    const tokenMatch = initialHtml.match(/<input name="__RequestVerificationToken" type="hidden" value="([^"]+)"\s*\/>/i);
    if (tokenMatch && tokenMatch[1]) {
      requestVerificationToken = tokenMatch[1];
    }
  } catch (err) {
    return 'Error: Fallo al obtener token DGI. ' + err.message;
  }

  const payload = { CUFE: cufe };
  if (requestVerificationToken) {
    payload.__RequestVerificationToken = requestVerificationToken;
  }

  const options = {
    method: 'post',
    payload: payload,
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; AppsScript)'
    },
    followRedirects: true,
    muteHttpExceptions: true
  };

  try {
    const response = UrlFetchApp.fetch(url, options);
    const statusCode = response.getResponseCode();
    if (statusCode < 200 || statusCode >= 300) {
      return 'Error: DGI respondió con código ' + statusCode;
    }

    const html = response.getContentText();
    const textoPlano = html.replace(/<[^>]*>/g, ' ');
    return procesarTextoFacturaExtraido(textoPlano);
  } catch (err) {
    return 'Error: Excepción al consultar DGI. ' + err.message;
  }
}

function procesarTextoFacturaExtraido(extractedText) {
  const regexBloqueFactura = /(No\.\s*\d{10}[\s\S]*?Cerrar)/i;
  const match = extractedText.match(regexBloqueFactura);
  if (!match || !match[1]) {
    return 'Error: Bloque de factura no encontrado.';
  }
  return match[1].replace(/\s+/g, ' ').trim();
}
