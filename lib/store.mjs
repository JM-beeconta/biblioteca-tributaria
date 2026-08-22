import fs from 'node:fs/promises';
import path from 'node:path';

async function readJson(file, fallback = null) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch { return fallback; }
}

async function jsonFiles(dir) {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) files.push(...await jsonFiles(full));
      else if (entry.isFile() && entry.name.endsWith('.json')) files.push(full);
    }
    return files.sort();
  } catch {
    return [];
  }
}

function stableSort(documents) {
  return [...documents].sort((a, b) => {
    const dateA = a.date ?? `${a.year ?? 0}-01-01`;
    const dateB = b.date ?? `${b.year ?? 0}-01-01`;
    return dateB.localeCompare(dateA) || String(a.title ?? '').localeCompare(String(b.title ?? ''), 'es');
  });
}

export function shardName(doc) {
  if (doc.source === 'BCN') return 'bcn.json';
  if (Number.isInteger(Number(doc.year))) return `${Number(doc.year)}.json`;
  return 'sin-fecha.json';
}

export function libraryStats(documents) {
  const bySource = {};
  const byType = {};
  const byYear = {};
  for (const doc of documents) {
    const source = doc.source || 'Otro';
    const type = doc.type || 'otro';
    const year = doc.year ? String(doc.year) : 'sin-fecha';
    bySource[source] = (bySource[source] || 0) + 1;
    byType[type] = (byType[type] || 0) + 1;
    byYear[year] = (byYear[year] || 0) + 1;
  }
  const numericYears = Object.keys(byYear).map(Number).filter(Number.isFinite);
  return {
    total_documents: documents.length,
    by_source: bySource,
    by_type: byType,
    by_year: byYear,
    min_year: numericYears.length ? Math.min(...numericYears) : null,
    max_year: numericYears.length ? Math.max(...numericYears) : null,
  };
}

export async function loadDocuments(root = process.cwd()) {
  const dataDir = path.join(root, 'data');
  const indexDir = path.join(dataDir, 'index');
  const files = await jsonFiles(indexDir);
  const documents = [];

  for (const file of files) {
    const value = await readJson(file, []);
    if (Array.isArray(value)) documents.push(...value);
  }

  if (documents.length) return stableSort(documents);

  // Compatibilidad de migración: mientras no existan shards, leer el índice monolítico anterior.
  const legacy = await readJson(path.join(dataDir, 'index.json'), []);
  return Array.isArray(legacy) ? stableSort(legacy) : [];
}

export async function writeLibraryData(root, documents, meta = {}) {
  const dataDir = path.join(root, 'data');
  const indexDir = path.join(dataDir, 'index');
  const relationsDir = path.join(dataDir, 'relations');
  const sorted = stableSort(documents);
  const groups = new Map();

  for (const doc of sorted) {
    const key = shardName(doc);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(doc);
  }

  await fs.rm(indexDir, { recursive: true, force: true });
  await fs.rm(relationsDir, { recursive: true, force: true });
  await fs.mkdir(indexDir, { recursive: true });
  await fs.mkdir(relationsDir, { recursive: true });

  const shards = [];
  for (const [name, docs] of [...groups.entries()].sort(([a], [b]) => b.localeCompare(a))) {
    const indexPath = path.join(indexDir, name);
    const relationPath = path.join(relationsDir, name);
    const relations = Object.fromEntries(docs.map((doc) => [doc.id, doc.references ?? []]));
    await fs.writeFile(indexPath, `${JSON.stringify(docs)}\n`, 'utf8');
    await fs.writeFile(relationPath, `${JSON.stringify(relations)}\n`, 'utf8');
    shards.push({
      name,
      path: `data/index/${name}`,
      relations_path: `data/relations/${name}`,
      count: docs.length,
      source: name === 'bcn.json' ? 'BCN' : 'SII',
      year: /^\d{4}\.json$/.test(name) ? Number(name.slice(0, 4)) : null,
    });
  }

  const stats = libraryStats(sorted);
  const generatedAt = new Date().toISOString();
  const manifest = {
    generated_at: generatedAt,
    ...stats,
    shards,
  };
  await fs.writeFile(path.join(dataDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  await fs.writeFile(path.join(dataDir, 'meta.json'), `${JSON.stringify({
    generated_at: generatedAt,
    ...stats,
    sources: Object.keys(stats.by_source),
    canonical_legal_sources: ['LIR', 'LIVS', 'CT'],
    ...meta,
  }, null, 2)}\n`, 'utf8');

  // El índice monolítico deja de ser la fuente canónica: evita llegar al límite de 100 MB de GitHub.
  await fs.rm(path.join(dataDir, 'index.json'), { force: true });
  await fs.rm(path.join(dataDir, 'relations.json'), { force: true });

  return { documents: sorted, manifest };
}
