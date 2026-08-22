# Biblioteca Tributaria Beeconta

Biblioteca pública de fuentes tributarias chilenas para consulta humana y por agentes.

- **BCN / LeyChile:** Ley sobre Impuesto a la Renta (DL 824), Ley sobre Impuesto a las Ventas y Servicios (DL 825) y Código Tributario (DL 830).
- **SII:** Circulares y Jurisprudencia Administrativa (Oficios) en Renta, IVA y Otras Normas.

**Sitio:** https://jm-beeconta.github.io/biblioteca-tributaria/

El proyecto no usa Supabase, n8n, Make, base de datos ni servidor permanente.

## Arquitectura

```text
BCN / LeyChile ─┐
                ├─> crawler Node ─> JSON + Markdown ─┐
SII público ────┘                                    │
                                                     ├─> GitHub Pages / buscador
                                                     ├─> ChatGPT / agentes web
                                                     └─> Claude / agentes web
```

La publicación y la recolección de datos están desacopladas: un problema temporal del SII no deja fuera de línea el buscador.

## Endpoints públicos

```text
https://jm-beeconta.github.io/biblioteca-tributaria/
https://jm-beeconta.github.io/biblioteca-tributaria/data/index.json
https://jm-beeconta.github.io/biblioteca-tributaria/data/relations.json
https://jm-beeconta.github.io/biblioteca-tributaria/data/meta.json
https://jm-beeconta.github.io/biblioteca-tributaria/llms.txt
https://jm-beeconta.github.io/biblioteca-tributaria/sitemap.xml
```

`source_url` siempre apunta a una fuente oficial SII o BCN. La copia Markdown facilita búsqueda y lectura, pero no reemplaza el documento oficial.

## Cómo obtiene los Oficios modernos del SII

Las páginas actuales de Jurisprudencia Administrativa no contienen enlaces HTML a los Oficios: cargan los datos dinámicamente. El crawler replica sólo ese flujo público del sitio oficial:

1. consulta el listado público `getPublicacionesCTByMateria`;
2. obtiene número, fecha, materia, resumen e identificador oficial del documento;
3. descarga el PDF desde `gabineteAdmInternet/descargaArchivo`;
4. extrae texto con `pdftotext`;
5. guarda metadata, texto, referencias detectadas, URL oficial y SHA-256.

Para páginas históricas se mantiene fallback a los índices HTML antiguos del SII.

## Archivos importantes

- `data/index.json`: índice estructurado para humanos y agentes.
- `data/relations.json`: referencias detectadas entre Circulares, Oficios y artículos.
- `data/meta.json`: estado y fecha de actualización del corpus.
- `content/`: copia de consulta en Markdown de cada documento extraído.
- `site/`: front estático.
- `scripts/build-site.mjs`: genera el sitio, `llms.txt`, `robots.txt` y `sitemap.xml`.
- `.github/workflows/library-pages.yml`: build, deploy y verificación HTTP de GitHub Pages.
- `.github/workflows/library-update.yml`: actualización semanal y backfill histórico.

## Publicación

Cada cambio en `main` dispara `Publicar Biblioteca Tributaria`:

1. ejecuta tests;
2. construye el sitio estático;
3. publica en GitHub Pages;
4. comprueba por HTTP el front, `data/index.json` y `llms.txt`.

La verificación no escribe commits, evitando loops de despliegue.

## Actualización semanal

`Actualizar Biblioteca Tributaria` corre cada lunes a las **06:17 America/Santiago**.

La corrida semanal:

- relee las tres normas base de BCN para detectar cambios;
- revisa el año actual y anterior de Circulares SII;
- revisa el año actual y anterior de Oficios SII en Renta, IVA y Otras Normas;
- calcula SHA-256 para detectar cambios de contenido;
- actualiza Markdown, índice y relaciones;
- guarda cambios en Git;
- publica nuevamente el sitio actualizado.

Las descargas usan timeout, reintentos y concurrencia máxima de dos documentos para ser conservadores con los servicios públicos.

## Backfill histórico

La carga inicial prioriza los dos años más recientes y después avanza por bloques de cuatro años, guardando checkpoints en Git. Si un tramo falla, el avance previo no se pierde.

Objetivo inicial:

- Circulares SII desde 1974;
- Jurisprudencia Administrativa SII desde 1975, combinando API pública actual e índices HTML históricos;
- LIR, LIVS y Código Tributario vigentes desde BCN/LeyChile, separados también por artículos.

El marcador `.bootstrap-full-history` se elimina automáticamente una vez completado el backfill.

## Acceso para ChatGPT / Claude

Un agente debe comenzar por `llms.txt` o `data/index.json`. Cada registro incluye:

- `source_url`: URL oficial que debe citarse como respaldo jurídico;
- `index_url`: índice oficial de origen cuando corresponde;
- `content_path`: texto extraído para lectura rápida;
- `references`: artículos, Oficios y Circulares detectados;
- `sha256`: huella del contenido para detectar modificaciones;
- metadata de fuente, tipo, número, fecha, año y materia.

## Buscador

El front busca localmente, sin backend. Permite filtrar por:

- BCN / SII;
- Norma / Artículo / Oficio / Circular;
- Materia;
- Año.

## Criterios de seguridad y respeto de fuentes

- sólo consulta información pública;
- no usa login ni credenciales;
- usa concurrencia baja, pausas, timeout y caché en Git;
- la revisión recurrente es semanal, no continua;
- cada documento conserva el enlace a la fuente oficial;
- la copia local puede contener errores de extracción y no sustituye el texto oficial.

## Desarrollo local

No hay dependencias npm.

```bash
npm test
npm run build
python -m http.server 8080 -d dist
```

Para extraer PDFs se requiere `pdftotext` (`poppler-utils`), instalado automáticamente en GitHub Actions.

```bash
npm run update
node scripts/update.mjs --from=2023 --to=2026
npm run bootstrap
```

## Alcance

La prioridad es un corpus confiable, rastreable y fácil de mantener. Embeddings, RAG, login y favoritos quedan fuera del núcleo: pueden agregarse después sin cambiar las URLs públicas ni la fuente de verdad.
