function extractTextFromCufe(cufe) {
  const url = 'https://dgi-fep.mef.gob.pa/Consultas/FacturasPorCUFE';
  const cufeLimpio = String(cufe || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!cufeLimpio) {
    return {
      ok: false,
      statusCode: 0,
      cufe: '',
      text: '',
      html: '',
      error: {
        code: 'CUFE_INVALIDO',
        message: 'CUFE vacío o inválido'
      }
    };
  }

  let token = '';
  try {
    const initResp = UrlFetchApp.fetch(url, {
      method: 'get',
      followRedirects: true,
      muteHttpExceptions: true,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; AppsScript)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      }
    });

    const initCode = initResp.getResponseCode();
    const initHtml = initResp.getContentText();
    if (initCode >= 200 && initCode < 400 && initHtml) {
      const m = initHtml.match(/name=["']__RequestVerificationToken["'][^>]*value=["']([^"']+)["']/i);
      if (m && m[1]) token = m[1];
    }
  } catch (err) {
    return {
      ok: false,
      statusCode: 0,
      cufe: cufeLimpio,
      text: '',
      html: '',
      error: {
        code: 'DGI_TOKEN_FETCH_ERROR',
        message: 'No fue posible iniciar sesión de consulta DGI',
        detail: err.message
      }
    };
  }

  const payload = { CUFE: cufeLimpio };
  if (token) payload.__RequestVerificationToken = token;

  const options = {
    method: 'post',
    payload: payload,
    followRedirects: true,
    muteHttpExceptions: true,
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; AppsScript)',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Referer': url
    }
  };

  try {
    const resp = UrlFetchApp.fetch(url, options);
    const statusCode = resp.getResponseCode();
    const html = resp.getContentText() || '';

    if (statusCode < 200 || statusCode >= 300) {
      return {
        ok: false,
        statusCode: statusCode,
        cufe: cufeLimpio,
        text: '',
        html: html,
        error: {
          code: 'DGI_HTTP_ERROR',
          message: 'DGI respondió con código no exitoso',
          detail: 'HTTP ' + statusCode
        }
      };
    }

    const text = html
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
      .replace(/<\/?(br|p|div|li|tr|td|th|h\d)\b[^>]*>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/\r/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]{2,}/g, ' ')
      .trim();

    const validacionRespuesta = /(EMISOR|FECHA\s*DE\s*EMISI[ÓO]N|VALOR\s*TOTAL|ITBMS|CUFE)/i.test(text);
    if (!text || !validacionRespuesta) {
      return {
        ok: false,
        statusCode: statusCode,
        cufe: cufeLimpio,
        text: text,
        html: html,
        error: {
          code: 'DGI_NO_DATOS_UTIL',
          message: 'La respuesta DGI no contiene campos esperados',
          detail: 'Respuesta sin estructura de factura reconocible'
        }
      };
    }

    return {
      ok: true,
      statusCode: statusCode,
      cufe: cufeLimpio,
      text: text,
      html: html,
      tokenFound: !!token
    };
  } catch (err) {
    return {
      ok: false,
      statusCode: 0,
      cufe: cufeLimpio,
      text: '',
      html: '',
      error: {
        code: 'DGI_POST_ERROR',
        message: 'Falló la consulta de CUFE en DGI',
        detail: err.message
      }
    };
  }
}

function parseInvoiceDataFromDgiText(text) {
  const raw = String(text || '');
  const clean = raw.replace(/\u00A0/g, ' ').replace(/[ \t]+/g, ' ');
  const upper = clean.toUpperCase();
  const out = {
    fecha: '',
    proveedor: '',
    ruc: '',
    itbms: '',
    total: '',
    cufe: '',
    numeroFactura: ''
  };

  function cleanValue(v) {
    return String(v || '').replace(/[\s\n\r]+/g, ' ').replace(/^[\s:;#\-]+|[\s:;#\-]+$/g, '').trim();
  }

  function extractByPatterns(patterns, src) {
    for (let i = 0; i < patterns.length; i++) {
      const m = src.match(patterns[i]);
      if (m && m[1]) return cleanValue(m[1]);
    }
    return '';
  }

  function normalizeDecimal(value) {
    const rawVal = cleanValue(value).replace(/[^\d,.-]/g, '');
    if (!rawVal) return '';

    const negative = /-/.test(rawVal);
    const noSign = rawVal.replace(/-/g, '');
    const lastComma = noSign.lastIndexOf(',');
    const lastDot = noSign.lastIndexOf('.');
    const decimalPos = Math.max(lastComma, lastDot);

    let normalized;
    if (decimalPos > -1) {
      const intPart = noSign.slice(0, decimalPos).replace(/[.,]/g, '');
      const decPart = noSign.slice(decimalPos + 1).replace(/[.,]/g, '');
      normalized = intPart + (decPart ? '.' + decPart : '');
    } else {
      normalized = noSign.replace(/[.,]/g, '');
    }

    if (!/^\d+(\.\d+)?$/.test(normalized)) return '';
    const num = parseFloat((negative ? '-' : '') + normalized);
    if (isNaN(num)) return '';
    return Math.round(num * 100) / 100;
  }

  function normalizeDate(value) {
    const v = cleanValue(value);
    if (!v) return '';

    let m = v.match(/(\d{4})[\/\-](\d{2})[\/\-](\d{2})/);
    if (m) return m[1] + '-' + m[2] + '-' + m[3];

    m = v.match(/(\d{2})[\/\-](\d{2})[\/\-](\d{4})/);
    if (m) return m[3] + '-' + m[2] + '-' + m[1];

    return v;
  }

  out.proveedor = extractByPatterns([
    /(?:^|\n)\s*EMISOR\s*:?[ \t]*([^\n\r]{3,180})/i,
    /(?:RAZ[ÓO]N\s+SOCIAL\s+EMISOR|NOMBRE\s+EMISOR)\s*:?[ \t]*([^\n\r]{3,180})/i,
    /(?:PROVEEDOR)\s*:?[ \t]*([^\n\r]{3,180})/i
  ], clean);

  out.fecha = normalizeDate(extractByPatterns([
    /(?:FECHA\s*DE\s*EMISI[ÓO]N|FECHA\s*EMISI[ÓO]N|EMITIDA\s*EL)\s*:?[ \t]*([^\n\r]{6,40})/i,
    /(?:^|\n)\s*FECHA\s*:?[ \t]*([^\n\r]{6,40})/i
  ], clean));

  out.cufe = extractByPatterns([
    /(?:^|\n)\s*CUFE\s*:?[ \t]*([A-Z0-9-]{20,140})/i,
    /([A-Z0-9]{2,4}[A-Z0-9-]{18,140})/i
  ], upper).replace(/[^A-Z0-9-]/g, '');

  out.numeroFactura = extractByPatterns([
    /(?:N[ÚU]MERO\s*DE\s*FACTURA|NUMERO\s*FACTURA|FACTURA\s*N[ÚU]MERO|NO\.?\s*FACTURA)\s*:?[ \t#-]*([A-Z0-9-]{3,60})/i,
    /(?:^|\n)\s*FACTURA\s*:?[ \t#-]*([A-Z0-9-]{3,60})/i
  ], clean);

  out.ruc = extractByPatterns([
    /(?:^|\n)\s*RUC\s*:?[ \t]*([0-9\-]{6,25})/i,
    /(?:RUC\s*EMISOR)\s*:?[ \t]*([0-9\-]{6,25})/i
  ], clean);

  const itbmsRaw = extractByPatterns([
    /(?:ITBMS\s*(?:TOTAL)?|IMPUESTO\s*(?:ITBMS|IVA)?)[^\d\n\r]{0,20}([\d.,]{1,20})/i,
    /(?:^|\n)\s*ITBMS\s*:?[ \t]*([\d.,]{1,20})/i
  ], clean);
  const totalRaw = extractByPatterns([
    /(?:VALOR\s*TOTAL|TOTAL\s*A\s*PAGAR|IMPORTE\s*TOTAL|GRAN\s*TOTAL|TOTAL)\s*:?[ \t$B\/\.]*([\d.,]{1,20})/i
  ], clean);

  const itbmsNum = normalizeDecimal(itbmsRaw);
  const totalNum = normalizeDecimal(totalRaw);

  out.itbms = itbmsNum === '' ? '' : itbmsNum;
  out.total = totalNum === '' ? '' : totalNum;

  return out;
}
