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

`source_url` siempre apunta a la fuente jurídica oficial SII o BCN. La copia Markdown sólo facilita búsqueda y lectura.

## Archivos importantes

- `data/index.json`: índice estructurado para humanos y agentes.
- `data/relations.json`: referencias detectadas entre Circulares, Oficios y artículos.
- `data/meta.json`: estado y fecha de actualización del corpus.
- `data/deploy-health.json`: última verificación automática de GitHub Pages.
- `content/`: copia de consulta en Markdown de cada documento extraído.
- `site/`: front estático.
- `scripts/build-site.mjs`: genera el sitio, `llms.txt`, `robots.txt` y `sitemap.xml`.
- `.github/workflows/library-pages.yml`: build, deploy y health check de GitHub Pages.
- `.github/workflows/library-update.yml`: actualización semanal y backfill histórico.

## Publicación

Cada cambio en `main` dispara `Publicar Biblioteca Tributaria`:

1. ejecuta tests;
2. construye el sitio estático;
3. publica en GitHub Pages;
4. comprueba por HTTP el front, `data/index.json` y `llms.txt`;
5. registra el resultado en `data/deploy-health.json`.

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

Las descargas usan timeout, reintentos y concurrencia baja para no sobrecargar los sitios públicos.

## Backfill histórico

La carga inicial se ejecuta por bloques de cuatro años y guarda checkpoints en Git. Si un tramo falla, el avance previo no se pierde.

Objetivo inicial:

- Circulares SII desde 1974;
- Jurisprudencia Administrativa SII desde el rango histórico disponible en los índices del Servicio;
- LIR, LIVS y Código Tributario vigentes desde BCN/LeyChile, separados también por artículos.

El marcador `.bootstrap-full-history` se elimina automáticamente una vez completado el backfill.

## Acceso para ChatGPT / Claude

Un agente debe comenzar por `llms.txt` o `data/index.json`. Cada registro incluye:

- `source_url`: URL oficial que debe citarse como respaldo jurídico;
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
