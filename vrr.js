/**
 * ITBI Check — Proxy para consulta de VVR da Prefeitura de São Paulo
 *
 * Endpoint: GET /api/vrr?sql=000.000.0000-0
 *
 * Esta função roda no servidor Vercel e contorna o bloqueio de CORS
 * da Prefeitura, fazendo a consulta no lado do servidor e devolvendo
 * o resultado para o frontend em JSON.
 */

export const config = { runtime: 'edge' };

const PREFEITURA_URL =
  'https://itbi.prefeitura.sp.gov.br/valorreferencia/tvm/frm_tvm_consulta_valor.aspx';

export default async function handler(req) {
  const { searchParams } = new URL(req.url);
  const sql = searchParams.get('sql');

  // Validação básica
  if (!sql || sql.trim().length < 5) {
    return json({ error: 'Informe um número SQL válido (ex: 001.002.0003-4).' }, 400);
  }

  const sqlLimpo = sql.trim().replace(/[^0-9.\-]/g, '');

  try {
    // ── Passo 1: buscar a página para capturar o ViewState (ASP.NET) ──
    const getResp = await fetch(PREFEITURA_URL, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ITBICheck/1.0)' },
    });

    if (!getResp.ok) {
      return json({ error: 'Não foi possível conectar ao sistema da Prefeitura.' }, 502);
    }

    const html = await getResp.text();

    // Extrai campos ocultos do ASP.NET WebForms
    const viewState        = extrair(html, '__VIEWSTATE');
    const viewStateGen     = extrair(html, '__VIEWSTATEGENERATOR');
    const eventValidation  = extrair(html, '__EVENTVALIDATION');

    // ── Passo 2: enviar o formulário com o SQL ──
    const body = new URLSearchParams({
      __VIEWSTATE:          viewState,
      __VIEWSTATEGENERATOR: viewStateGen,
      __EVENTVALIDATION:    eventValidation,
      // Ajuste o nome do campo se necessário após inspecionar a página da Prefeitura
      'ctl00$cphPrincipal$txtSQL': sqlLimpo,
      'ctl00$cphPrincipal$btnConsultar': 'Consultar',
    });

    const postResp = await fetch(PREFEITURA_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Referer': PREFEITURA_URL,
        'User-Agent': 'Mozilla/5.0 (compatible; ITBICheck/1.0)',
        // Reusa o cookie de sessão do GET
        'Cookie': getResp.headers.get('set-cookie') ?? '',
      },
      body: body.toString(),
    });

    const resultHtml = await postResp.text();

    // ── Passo 3: extrair o VVR da resposta ──
    const vrr      = extrairTexto(resultHtml, 'lblValorVenal')      // tente também: lblValor, lblVRR
                  || extrairTexto(resultHtml, 'lblValor')
                  || extrairTexto(resultHtml, 'lblVRR');

    const endereco = extrairTexto(resultHtml, 'lblEndereco')
                  || extrairTexto(resultHtml, 'lblLogradouro');

    if (!vrr) {
      // Se não achou o campo, retorna o HTML bruto para debug
      return json({
        error: 'SQL não encontrado ou layout da página mudou.',
        debug: resultHtml.substring(0, 2000), // primeiros 2000 chars para diagnóstico
      }, 404);
    }

    // Converte "R$ 1.234.567,89" → número
    const vrrNumero = parseBRL(vrr);

    return json({ sql: sqlLimpo, endereco, vrr, vrrNumero });

  } catch (err) {
    return json({ error: 'Erro interno: ' + err.message }, 500);
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Extrai value de input hidden pelo name */
function extrair(html, name) {
  const m = html.match(new RegExp(`name="${name}"[^>]*value="([^"]*)"`, 'i'))
         || html.match(new RegExp(`id="${name}"[^>]*value="([^"]*)"`, 'i'));
  return m ? m[1] : '';
}

/** Extrai texto de um elemento com id contendo o fragmento dado */
function extrairTexto(html, idFragment) {
  const m = html.match(new RegExp(`id="[^"]*${idFragment}[^"]*"[^>]*>([^<]+)<`, 'i'));
  return m ? m[1].trim() : null;
}

/** Converte "R$ 1.234.567,89" para número */
function parseBRL(str) {
  if (!str) return null;
  return parseFloat(
    str.replace(/[R$\s.]/g, '').replace(',', '.')
  );
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
