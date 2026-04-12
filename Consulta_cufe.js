function extractTextFromCufe(cufe) {
  const url = 'https://dgi-fep.mef.gob.pa/Consultas/FacturasPorCUFE';
  const token = fetchVerificationToken(url);
  const payload = token ? { CUFE: cufe, __RequestVerificationToken: token } : { CUFE: cufe };

  const response = UrlFetchApp.fetch(url, {
    method: 'post',
    payload: payload,
    headers: { 'User-Agent': 'Mozilla/5.0' },
    followRedirects: true,
    muteHttpExceptions: true
  });

  const statusCode = response.getResponseCode();
  if (statusCode < 200 || statusCode >= 300) throw new Error('cufe_http_error_' + statusCode);

  return extractInvoiceBlock(response.getContentText().replace(/<[^>]*>/g, ''));
}

function fetchVerificationToken(url) {
  const initialResponse = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  const html = initialResponse.getContentText();
  const match = html.match(/<input name="__RequestVerificationToken" type="hidden" value="([^"]+)"\s*\/>/);
  return match && match[1] ? match[1] : '';
}

function extractInvoiceBlock(text) {
  const match = text.match(/(No\.\s\d{10}[\s\S]*?Cerrar)/);
  if (!match || !match[1]) throw new Error('cufe_block_not_found');
  return match[1];
}
