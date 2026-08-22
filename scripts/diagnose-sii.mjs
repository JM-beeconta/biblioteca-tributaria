const pageUrl = 'https://www.sii.cl/normativa_legislacion/jurisprudencia_administrativa/ley_impuesto_renta/2026/ley_impuesto_renta_jadm2026.htm';

function contexts(text, patterns, radius = 1400) {
  const out = [];
  for (const pattern of patterns) {
    const re = new RegExp(pattern, 'ig');
    let match;
    while ((match = re.exec(text))) {
      const from = Math.max(0, match.index - radius);
      const to = Math.min(text.length, match.index + match[0].length + radius);
      out.push(text.slice(from, to));
      if (out.length >= 12) return out;
    }
  }
  return out;
}

const res = await fetch(pageUrl, { headers: { 'user-agent': 'BeecontaBibliotecaTributaria/diagnostic' } });
const html = await res.text();
const scripts = [...html.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)].map((m) => new URL(m[1], pageUrl).toString());
const anchors = [...html.matchAll(/<a\b[^>]+href=["']([^"']+)["']/gi)].map((m) => m[1]);
const inline = [...html.matchAll(/<script(?![^>]+src=)[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]).join('\n');
const interesting = [];
for (const url of scripts) {
  if (!url.includes('sii.cl')) continue;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
    const text = await r.text();
    const blocks = contexts(text, ['abreDoctoJurAdm', '\\$\\.ajax', 'jurisprud', 'idBlobArchPublica'], 1800);
    if (blocks.length) interesting.push({ url, blocks: blocks.map((block) => block.slice(0, 5000)) });
  } catch (error) {
    interesting.push({ url, error: String(error) });
  }
}

console.log(JSON.stringify({
  pageUrl,
  status: res.status,
  htmlLength: html.length,
  anchorCount: anchors.length,
  anchors: anchors.slice(0, 100),
  scripts,
  inlineContexts: contexts(inline, ['\\$\\.ajax', 'abreDoctoJurAdm', 'idBlobArchPublica', 'pubNumOficio'], 2200).map((block) => block.slice(0, 6500)),
  interesting,
}, null, 2));
