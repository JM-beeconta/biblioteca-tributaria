import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeDocuments } from '../lib/store.mjs';

test('mergeDocuments no borra documentos que comparten la misma source_url (regresión BCN)', () => {
  // Varios artículos de una misma norma BCN citan la misma URL oficial (la norma completa),
  // a diferencia de SII donde cada oficio/circular tiene su propia URL de descarga única.
  const sharedUrl = 'https://www.bcn.cl/leychile/navegar?idNorma=6368';
  const incoming = [
    { id: 'bcn-lir', source_url: sharedUrl, sha256: 'a' },
    { id: 'bcn-lir-art-1', source_url: sharedUrl, sha256: 'b' },
    { id: 'bcn-lir-art-2', source_url: sharedUrl, sha256: 'c' },
    { id: 'bcn-lir-art-3', source_url: sharedUrl, sha256: 'd' },
  ];

  const { documents } = mergeDocuments([], incoming);
  assert.equal(documents.length, 4, 'los 4 documentos que comparten source_url deben sobrevivir la fusión');
  assert.deepEqual(new Set(documents.map((d) => d.id)), new Set(incoming.map((d) => d.id)));
});

test('mergeDocuments sigue reconociendo por URL un documento único que cambió de id', () => {
  const existing = [{ id: 'sii-oficio-2025-100', source_url: 'https://sii.cl/of100.pdf', sha256: 'x', first_seen_at: '2025-01-01T00:00:00.000Z', categories: ['Renta'] }];
  const incoming = [{ id: 'sii-oficio-2025-100b', source_url: 'https://sii.cl/of100.pdf', sha256: 'x', categories: ['IVA'] }];

  const { documents } = mergeDocuments(existing, incoming);
  assert.equal(documents.length, 1, 'debe reconocerse como el mismo documento renombrado, no duplicarse');
  assert.equal(documents[0].id, 'sii-oficio-2025-100b');
  assert.equal(documents[0].first_seen_at, '2025-01-01T00:00:00.000Z', 'conserva first_seen_at del documento original');
  assert.deepEqual(new Set(documents[0].categories), new Set(['Renta', 'IVA']));
});

test('mergeDocuments actualiza un documento existente por id y marca changed_at si cambia el hash', () => {
  const existing = [{ id: 'bcn-ct', source_url: 'u1', sha256: 'old', first_seen_at: '2020-01-01T00:00:00.000Z' }];
  const incoming = [{ id: 'bcn-ct', source_url: 'u1', sha256: 'new' }];

  const { documents } = mergeDocuments(existing, incoming, { now: '2026-01-01T00:00:00.000Z' });
  assert.equal(documents.length, 1);
  assert.equal(documents[0].sha256, 'new');
  assert.equal(documents[0].changed_at, '2026-01-01T00:00:00.000Z');
  assert.equal(documents[0].first_seen_at, '2020-01-01T00:00:00.000Z');
});

test('mergeDocuments no toca documentos existentes no incluidos en la corrida actual', () => {
  const existing = [{ id: 'sii-oficio-1990-1', source_url: 'https://sii.cl/1990-1.pdf', sha256: 'z' }];
  const { documents, touched } = mergeDocuments(existing, []);
  assert.equal(documents.length, 1);
  assert.equal(touched.size, 0);
});
