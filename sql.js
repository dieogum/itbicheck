/**
 * ITBICheck — Busca o número SQL do imóvel pelo endereço
 * usando o WFS público do GeoSampa (Prefeitura de São Paulo)
 *
 * Endpoint: GET /api/sql?logradouro=RUA AUGUSTA&numero=1200
 *
 * Documentação GeoSampa WFS:
 * http://wfs.geosampa.prefeitura.sp.gov.br/geoserver/ows?service=wfs&version=1.0.0&request=GetCapabilities
 */

export const config = { runtime: 'edge' };

const WFS_BASE = 'https://wfs.geosampa.prefeitura.sp.gov.br/geoserver/ows';

export default async function handler(req) {
  const { searchParams } = new URL(req.url);
  const logradouro = searchParams.get('logradouro')?.trim().toUpperCase();
  const numero     = searchParams.get('numero')?.trim();

  if (!logradouro) {
    return json({ error: 'Informe o nome do logradouro.' }, 400);
  }

  try {
    // Monta o filtro CQL para busca por endereço no cadastro fiscal
    // Campos do GeoSampa IPTU: nm_logrado (nome da rua), cd_numero (número)
    let cqlFilter = `nm_logrado ILIKE '%${logradouro}%'`;
    if (numero) {
      cqlFilter += ` AND cd_numero = '${numero}'`;
    }

    const params = new URLSearchParams({
      service:      'WFS',
      version:      '2.0.0',
      request:      'GetFeature',
      typeName:     'geoportal:lote_fiscal',   // camada do cadastro fiscal IPTU
      outputFormat: 'application/json',
      count:        '10',
      CQL_FILTER:   cqlFilter,
    });

    const resp = await fetch(`${WFS_BASE}?${params.toString()}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ITBICheck/1.0)' },
    });

    if (!resp.ok) {
      return json({ error: 'Serviço GeoSampa indisponível no momento.' }, 502);
    }

    const data = await resp.json();

    if (!data.features || data.features.length === 0) {
      return json({ error: 'Endereço não encontrado. Tente com menos palavras (ex: apenas o nome da rua sem "Rua" ou "Av").' }, 404);
    }

    // Monta lista de resultados (pode retornar vários lotes no mesmo endereço)
    const resultados = data.features.map(f => {
      const p = f.properties;
      // O SQL pode estar em campos como: sql, cod_sql, setor+quadra+lote, etc.
      const sql = p.sql
               || p.cod_sql
               || p.cd_sql
               || formatarSQL(p.cd_setor, p.cd_quadra, p.cd_lote)
               || null;

      return {
        sql,
        logradouro: p.nm_logrado  || p.nm_logradouro || '',
        numero:     p.cd_numero   || p.nu_numero      || '',
        bairro:     p.nm_bairro   || '',
        endereco:   montarEndereco(p),
      };
    }).filter(r => r.sql); // descarta registros sem SQL

    if (resultados.length === 0) {
      return json({ error: 'Imóvel encontrado mas sem número SQL disponível.' }, 404);
    }

    return json({ resultados });

  } catch (err) {
    return json({ error: 'Erro ao consultar GeoSampa: ' + err.message }, 500);
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatarSQL(setor, quadra, lote) {
  if (!setor || !quadra || !lote) return null;
  // Formato padrão: SSS.QQQ.LLLL-D (ou variações)
  return `${String(setor).padStart(3,'0')}.${String(quadra).padStart(3,'0')}.${String(lote).padStart(4,'0')}`;
}

function montarEndereco(p) {
  const partes = [
    p.nm_tipo_logrado || '',
    p.nm_logrado      || p.nm_logradouro || '',
    p.cd_numero       || p.nu_numero     || '',
    p.nm_bairro       ? `- ${p.nm_bairro}` : '',
  ].filter(Boolean);
  return partes.join(' ').trim();
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
