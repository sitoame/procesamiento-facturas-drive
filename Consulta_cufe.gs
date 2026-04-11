function extractTextFromCufe(cufe) {
  const cufeLimpio = String(cufe || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!cufeLimpio) {
    return {
      ok: false,
      cufe: '',
      statusCode: 0,
      errorType: 'INPUT_INVALIDO',
      observaciones: 'CUFE vacío o inválido',
      text: '',
      html: ''
    };
  }

  const url = 'https://dgi-fep.mef.gob.pa/Consultas/FacturasPorCUFE';
  const baseHeaders = {
    'User-Agent': 'Mozilla/5.0 (compatible; GoogleAppsScript)',
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
  };

  let token = '';
  let cookie = '';

  try {
    const getResp = UrlFetchApp.fetch(url, {
      method: 'get',
      headers: baseHeaders,
      followRedirects: true,
      muteHttpExceptions: true
    });

    const getCode = getResp.getResponseCode();
    const getHtml = getResp.getContentText() || '';
    if (getCode >= 400 || !getHtml) {
      return {
        ok: false,
        cufe: cufeLimpio,
        statusCode: getCode,
        errorType: 'GET_DGI_FALLO',
        observaciones: 'No fue posible obtener la página de consulta DGI',
        text: '',
        html: getHtml
      };
    }

    const headers = getResp.getHeaders() || {};
    cookie = headers['Set-Cookie'] || headers['set-cookie'] || '';

    const tokenMatch = getHtml.match(/name\s*=\s*["']__RequestVerificationToken["'][^>]*value\s*=\s*["']([^"']+)["']/i)
      || getHtml.match(/value\s*=\s*["']([^"']+)["'][^>]*name\s*=\s*["']__RequestVerificationToken["']/i);
    token = tokenMatch ? tokenMatch[1] : '';
  } catch (err) {
    return {
      ok: false,
      cufe: cufeLimpio,
      statusCode: 0,
      errorType: 'GET_DGI_EXCEPCION',
      observaciones: 'Excepción en GET DGI: ' + err.message,
      text: '',
      html: ''
    };
  }

  const payload = { CUFE: cufeLimpio };
  if (token) payload.__RequestVerificationToken = token;

  const postHeaders = Object.assign({}, baseHeaders);
  if (cookie) postHeaders.Cookie = cookie;

  try {
    const postResp = UrlFetchApp.fetch(url, {
      method: 'post',
      payload: payload,
      headers: postHeaders,
      followRedirects: true,
      muteHttpExceptions: true
    });

    const postCode = postResp.getResponseCode();
    const html = postResp.getContentText() || '';
    if (postCode < 200 || postCode >= 300) {
      return {
        ok: false,
        cufe: cufeLimpio,
        statusCode: postCode,
        errorType: 'POST_DGI_HTTP',
        observaciones: 'DGI respondió HTTP ' + postCode,
        text: htmlToText(html),
        html: html
      };
    }

    const text = htmlToText(html);
    if (!text || text.length < 40) {
      return {
        ok: false,
        cufe: cufeLimpio,
        statusCode: postCode,
        errorType: 'POST_DGI_SIN_CONTENIDO',
        observaciones: 'Respuesta DGI sin contenido legible',
        text: text,
        html: html
      };
    }

    return {
      ok: true,
      cufe: cufeLimpio,
      statusCode: postCode,
      errorType: '',
      observaciones: token ? 'Consulta DGI completada' : 'Consulta DGI completada sin token antiforgery',
      text: text,
      html: html
    };
  } catch (err) {
    return {
      ok: false,
      cufe: cufeLimpio,
      statusCode: 0,
      errorType: 'POST_DGI_EXCEPCION',
      observaciones: 'Excepción en POST DGI: ' + err.message,
      text: '',
      html: ''
    };
  }
}

function htmlToText(html) {
  const raw = String(html || '');
  if (!raw) return '';

  return raw
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '\n- ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s*\n\s*/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .trim();
}
