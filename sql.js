/**
 * ITBI Check — Busca o número SQL do imóvel pelo endereço via GeoSampa
 * Endpoint: GET /api/sql?logradouro=RUA AUGUSTA&numero=1200
 */

const WFS_BASE = 'https://wfs.geosampa.prefeitura.sp.gov.br/geoserver/ows';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const logradouro = (req.query.logradouro || '').trim().toUpperCase();
  const numero     = (req.query.numero     || '').trim();

  if (!logradouro) {
    return res.status(400).json({ error: 'Informe o nome do logradouro.' });
  }

  try {
    let cqlFilter = `nm_logrado ILIKE '%${logradouro}%'`;
    if (numero) cqlFilter += ` AND cd_numero = '${numero}'`;

    const params = new URLSearchParams({
      service:      'WFS',
      version:      '2.0.0',
      request:      'GetFeature',
      typeName:     'geoportal:lote_fiscal',
      outputFormat: 'application/json',
      count:        '10',
      CQL_FILTER:   cqlFilter,
    });

    const resp = await fetch(`${WFS_BASE}?${params.toString()}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ITBICheck/1.0)' },
    });

    if (!resp.ok) {
      return res.status(502).json({ error: 'Serviço GeoSampa indisponível no momento.' });
    }

    const data = await resp.json();

    if (!data.features || data.features.length === 0) {
      return res.status(404).json({ error: 'Endereço não encontrado. Tente apenas o nome da rua sem "Rua" ou "Av".' });
    }

    const resultados = data.features.map(f => {
      const p = f.properties;
      const sql = p.sql || p.cod_sql || p.cd_sql || formatarSQL(p.cd_setor, p.cd_quadra, p.cd_lote) || null;
      return {
        sql,
        endereco: montarEndereco(p),
        bairro:   p.nm_bairro || '',
      };
    }).filter(r => r.sql);

    if (resultados.length === 0) {
      return res.status(404).json({ error: 'Imóvel encontrado mas sem número SQL disponível.' });
    }

    return res.status(200).json({ resultados });

  } catch (err) {
    return res.status(500).json({ error: 'Erro ao consultar GeoSampa: ' + err.message });
  }
}

function formatarSQL(setor, quadra, lote) {
  if (!setor || !quadra || !lote) return null;
  return `${String(setor).padStart(3,'0')}.${String(quadra).padStart(3,'0')}.${String(lote).padStart(4,'0')}`;
}

function montarEndereco(p) {
  return [
    p.nm_tipo_logrado || '',
    p.nm_logrado      || p.nm_logradouro || '',
    p.cd_numero       || p.nu_numero     || '',
    p.nm_bairro       ? `— ${p.nm_bairro}` : '',
  ].filter(Boolean).join(' ').trim();
}
