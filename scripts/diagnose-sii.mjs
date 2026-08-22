const pageUrl = 'https://www.sii.cl/normativa_legislacion/jurisprudencia_administrativa/ley_impuesto_renta/2026/ley_impuesto_renta_jadm2026.htm';
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
    const lines = text.split(/\n/).filter((line) => /(ajax|fetch\(|\.json|api\/|jurisprud|jadm|datatable|oficio)/i.test(line)).slice(0, 100);
    if (lines.length) interesting.push({ url, lines: lines.map((line) => line.trim().slice(0, 600)) });
  } catch (error) {
    interesting.push({ url, error: String(error) });
  }
}
const inlineLines = inline.split(/\n/).filter((line) => /(ajax|fetch\(|\.json|api\/|jurisprud|jadm|datatable|oficio)/i.test(line)).slice(0, 160).map((line) => line.trim().slice(0, 600));
console.log(JSON.stringify({
  pageUrl,
  status: res.status,
  htmlLength: html.length,
  anchorCount: anchors.length,
  anchors: anchors.slice(0, 100),
  scripts,
  inlineLines,
  interesting,
}, null, 2));
