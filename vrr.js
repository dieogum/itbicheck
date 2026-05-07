/**
 * ITBI Check — Proxy para consulta de VVR da Prefeitura de São Paulo
 * Endpoint: GET /api/vrr?sql=000.000.0000-0
 */

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const { sql } = req.query;

  if (!sql || sql.trim().length < 5) {
    return res.status(400).json({ error: 'Informe um número SQL válido (ex: 001.002.0003-4).' });
  }

  const sqlLimpo = sql.trim().replace(/[^0-9.\-]/g, '');
  const PREFEITURA_URL = 'https://itbi.prefeitura.sp.gov.br/valorreferencia/tvm/frm_tvm_consulta_valor.aspx';

  try {
    // Passo 1: buscar página para capturar ViewState (ASP.NET)
    const getResp = await fetch(PREFEITURA_URL, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ITBICheck/1.0)' },
    });

    if (!getResp.ok) {
      return res.status(502).json({ error: 'Não foi possível conectar ao sistema da Prefeitura.' });
    }

    const html = await getResp.text();

    const viewState       = extrair(html, '__VIEWSTATE');
    const viewStateGen    = extrair(html, '__VIEWSTATEGENERATOR');
    const eventValidation = extrair(html, '__EVENTVALIDATION');
    const cookies         = getResp.headers.get('set-cookie') ?? '';

    // Passo 2: enviar formulário com o SQL
    const body = new URLSearchParams({
      __VIEWSTATE:          viewState,
      __VIEWSTATEGENERATOR: viewStateGen,
      __EVENTVALIDATION:    eventValidation,
      'ctl00$cphPrincipal$txtSQL':        sqlLimpo,
      'ctl00$cphPrincipal$btnConsultar':  'Consultar',
    });

    const postResp = await fetch(PREFEITURA_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Referer':      PREFEITURA_URL,
        'User-Agent':   'Mozilla/5.0 (compatible; ITBICheck/1.0)',
        'Cookie':       cookies,
      },
      body: body.toString(),
    });

    const resultHtml = await postResp.text();

    // Passo 3: extrair VVR da resposta
    const vrr     = extrairTexto(resultHtml, 'lblValorVenal')
                 || extrairTexto(resultHtml, 'lblValor')
                 || extrairTexto(resultHtml, 'lblVRR');

    const endereco = extrairTexto(resultHtml, 'lblEndereco')
                  || extrairTexto(resultHtml, 'lblLogradouro');

    if (!vrr) {
      return res.status(404).json({
        error: 'SQL não encontrado ou layout da página mudou.',
        debug: resultHtml.substring(0, 2000),
      });
    }

    const vrrNumero = parseBRL(vrr);
    return res.status(200).json({ sql: sqlLimpo, endereco, vrr, vrrNumero });

  } catch (err) {
    return res.status(500).json({ error: 'Erro interno: ' + err.message });
  }
}

function extrair(html, name) {
  const m = html.match(new RegExp(`name="${name}"[^>]*value="([^"]*)"`, 'i'))
         || html.match(new RegExp(`id="${name}"[^>]*value="([^"]*)"`, 'i'));
  return m ? m[1] : '';
}

function extrairTexto(html, idFragment) {
  const m = html.match(new RegExp(`id="[^"]*${idFragment}[^"]*"[^>]*>([^<]+)<`, 'i'));
  return m ? m[1].trim() : null;
}

function parseBRL(str) {
  if (!str) return null;
  return parseFloat(str.replace(/[R$\s.]/g, '').replace(',', '.'));
}
