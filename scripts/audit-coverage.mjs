import fs from 'node:fs/promises';
import { discoverSii } from '../lib/sii.mjs';
import { loadDocuments } from '../lib/store.mjs';

const ROOT = process.cwd();
const CURRENT_YEAR = new Date().getFullYear();

function groupCount(items, keyFn) {
  const counts = new Map();
  for (const item of items) {
    const key = keyFn(item);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}

async function main() {
  const stored = await loadDocuments(ROOT);
  const storedSii = stored.filter((d) => d.source === 'SII');
  const storedCounts = groupCount(storedSii, (d) => `${d.year ?? 's-f'}|${(d.categories || [])[0] ?? '?'}`);

  console.log(`Corpus almacenado: ${storedSii.length} documentos SII.`);

  // Tramo 1974-1993: la fuente sólo tiene un índice histórico agregado por categoría (no por año),
  // así que el año exacto de cada candidato recién se afina más tarde con el texto real del
  // documento — se compara por TOTAL del tramo, no año por año, para no generar falsos positivos.
  const earlyYears = Array.from({ length: 1993 - 1974 + 1 }, (_, i) => 1974 + i);
  console.log(`\n=== Descubriendo 1974-1993 (índice histórico agregado) ===`);
  const early = await discoverSii({ years: earlyYears, log: () => process.stdout.write('.') });
  console.log(`\n${early.length} candidatos descubiertos en el tramo agregado.`);

  const earlyByCategory = groupCount(early, (s) => [...s.categories][0]);
  const storedEarlyByCategory = new Map();
  for (const doc of storedSii) {
    if (doc.year && doc.year >= 1974 && doc.year <= 1993) {
      const cat = (doc.categories || [])[0] ?? '?';
      storedEarlyByCategory.set(cat, (storedEarlyByCategory.get(cat) || 0) + 1);
    }
  }

  // Tramo 1994-actual: índice anual (API dinámica para Oficios, HTML para Circulares/Resoluciones)
  // — el año del candidato en el índice es preciso, así que se compara año por año.
  const modernYears = Array.from({ length: CURRENT_YEAR - 1994 + 1 }, (_, i) => 1994 + i);
  console.log(`\n=== Descubriendo 1994-${CURRENT_YEAR} (índices anuales) ===`);
  const modern = await discoverSii({ years: modernYears, log: () => process.stdout.write('.') });
  console.log(`\n${modern.length} candidatos descubiertos en el tramo moderno.`);

  const modernDiscoveredCounts = groupCount(modern, (s) => `${s.year ?? 's-f'}|${[...s.categories][0]}`);

  const gaps = [];
  const allModernKeys = new Set([...modernDiscoveredCounts.keys(), ...storedCounts.keys()].filter((k) => {
    const year = Number(k.split('|')[0]);
    return year >= 1994;
  }));
  for (const key of allModernKeys) {
    const discoveredCount = modernDiscoveredCounts.get(key) || 0;
    const storedCount = storedCounts.get(key) || 0;
    if (discoveredCount > storedCount) {
      gaps.push({ key, discovered: discoveredCount, stored: storedCount, missing: discoveredCount - storedCount });
    }
  }
  gaps.sort((a, b) => b.missing - a.missing);

  const earlyGaps = [];
  for (const [cat, discoveredCount] of earlyByCategory) {
    const storedCount = storedEarlyByCategory.get(cat) || 0;
    if (discoveredCount > storedCount) {
      earlyGaps.push({ categoria: cat, discovered: discoveredCount, stored: storedCount, missing: discoveredCount - storedCount });
    }
  }

  const report = {
    generated_at: new Date().toISOString(),
    stored_sii_total: storedSii.length,
    tramo_1974_1993: { discovered_total: early.length, by_category: Object.fromEntries(earlyByCategory), stored_by_category: Object.fromEntries(storedEarlyByCategory), gaps: earlyGaps },
    tramo_1994_actual: { discovered_total: modern.length, gaps },
  };
  await fs.writeFile('audit-report.json', JSON.stringify(report, null, 2), 'utf8');

  console.log('\n=== RESUMEN ===');
  console.log('Tramo 1974-1993 (por categoría, total):');
  console.log(JSON.stringify(earlyGaps, null, 2));
  console.log(`\nTramo 1994-${CURRENT_YEAR} (por año/categoría) — ${gaps.length} brechas encontradas:`);
  console.log(JSON.stringify(gaps.slice(0, 40), null, 2));
  console.log('\nReporte completo en audit-report.json');
}

main().catch((error) => {
  console.error('ERROR:', error.message);
  process.exit(1);
});
