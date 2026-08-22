const listUrl = 'https://www3.sii.cl/getPublicacionesCTByMateria';
const pages = {
  RENTA: 'https://www.sii.cl/normativa_legislacion/jurisprudencia_administrativa/ley_impuesto_renta/2026/ley_impuesto_renta_jadm2026.htm',
  IVA: 'https://www.sii.cl/normativa_legislacion/jurisprudencia_administrativa/ley_impuesto_ventas/2026/ley_impuesto_ventas_jadm2026.htm',
  OTRAS: 'https://www.sii.cl/normativa_legislacion/jurisprudencia_administrativa/otras_normas/2026/otras_normas_jadm2026.htm',
};

const pageDiagnostics = {};
for (const [name, url] of Object.entries(pages)) {
  const response = await fetch(url, {
    headers: { 'user-agent': 'BeecontaBibliotecaTributaria/diagnostic' },
    signal: AbortSignal.timeout(20000),
  });
  const html = await response.text();
  const options = [...html.matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/gi)].map((m) => ({
    value: (m[1].match(/value\s*=\s*["']?([^"'\s>]+)/i) ?? [null, null])[1],
    label: m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
  }));
  const keyLiterals = [...new Set([...html.matchAll(/(?:key|materia)\s*[:=]\s*["']([^"']+)["']/gi)].map((m) => m[1]))];
  pageDiagnostics[name] = {
    url,
    status: response.status,
    htmlLength: html.length,
    options,
    keyLiterals,
  };
}

const candidateKeys = [
  'RENTA',
  'IVA',
  'VENTAS',
  'VENTAS_SERVICIOS',
  'IMPUESTO_VENTAS',
  'OTRAS',
  'OTROS',
  'OTRASNORMAS',
  'OTRAS_NORMAS',
  'OTRAS NORMAS',
  'CODIGO',
  'CT',
];

const keys = {};
for (const key of candidateKeys) {
  try {
    const response = await fetch(listUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        'user-agent': 'BeecontaBibliotecaTributaria/diagnostic',
      },
      body: JSON.stringify({ key, year: '2026' }),
      signal: AbortSignal.timeout(20000),
    });
    const text = await response.text();
    let rows = null;
    try { rows = JSON.parse(text); } catch {}
    keys[key] = {
      status: response.status,
      count: Array.isArray(rows) ? rows.length : null,
      first: Array.isArray(rows) && rows[0] ? {
        pubLegal: rows[0].pubLegal,
        tipoArchPublica: rows[0].tipoArchPublica,
        pubNumOficio: rows[0].pubNumOficio,
        pubFechaPubli: rows[0].pubFechaPubli,
      } : null,
      preview: Array.isArray(rows) ? null : text.slice(0, 300),
    };
  } catch (error) {
    keys[key] = { error: String(error) };
  }
}

console.log(JSON.stringify({
  checkedAt: new Date().toISOString(),
  listUrl,
  pages: pageDiagnostics,
  keys,
}, null, 2));
