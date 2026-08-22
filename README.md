# Biblioteca Tributaria Beeconta

Biblioteca pública de fuentes tributarias chilenas para consulta humana y por agentes.

- **BCN / LeyChile:** Ley sobre Impuesto a la Renta (DL 824), Ley sobre Impuesto a las Ventas y Servicios (DL 825) y Código Tributario (DL 830), con artículos individualizados.
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
https://jm-beeconta.github.io/biblioteca-tributaria/data/catalog.json
https://jm-beeconta.github.io/biblioteca-tributaria/data/index.json
https://jm-beeconta.github.io/biblioteca-tributaria/data/relations.json
https://jm-beeconta.github.io/biblioteca-tributaria/data/meta.json
https://jm-beeconta.github.io/biblioteca-tributaria/llms.txt
https://jm-beeconta.github.io/biblioteca-tributaria/sitemap.xml
```

- `catalog.json`: catálogo compacto recomendado para el front, ChatGPT y Claude. Sirve para descubrir documentos rápidamente.
- `index.json`: índice técnico completo, conservado para auditoría y procesos que necesiten más texto de búsqueda.
- `content_path`: permite abrir sólo el Markdown del documento relevante después de encontrarlo.
- `source_url`: siempre apunta a la fuente oficial SII o BCN y es la URL que debe usarse como respaldo jurídico.

## Cómo obtiene los Oficios modernos del SII

Las páginas actuales de Jurisprudencia Administrativa cargan los Oficios dinámicamente. El crawler replica sólo ese flujo público del sitio oficial:

1. consulta `getPublicacionesCTByMateria` con las materias oficiales `RENTA`, `IVA` y `OTROS`;
2. obtiene número, fecha, materia, resumen e identificador oficial;
3. descarga el documento desde `gabineteAdmInternet/descargaArchivo`;
4. extrae texto PDF con `pdftotext`;
5. deduplica Oficios publicados bajo más de una materia;
6. guarda metadata, texto, referencias detectadas, URL oficial y SHA-256.

Para páginas históricas mantiene fallback a los índices HTML antiguos del SII.

## BCN / LeyChile

El crawler lee la vista oficial consolidada `leychile/navegar?idNorma=...` y separa LIR, LIVS y Código Tributario por artículo. Una validación de contenido impide reemplazar una norma correcta por la pantalla intermedia de carga de LeyChile.

## Publicación

Cada cambio en `main` dispara `Publicar Biblioteca Tributaria`:

1. ejecuta tests;
2. construye el sitio y genera `catalog.json`;
3. publica en GitHub Pages;
4. comprueba por HTTP el front, catálogo, índice completo y `llms.txt`;
5. valida que catálogo e índice contengan la misma cantidad de documentos.

La verificación no escribe commits, evitando loops de despliegue.

## Actualización semanal

`Actualizar Biblioteca Tributaria` corre cada lunes a las **06:17 America/Santiago**.

La corrida semanal:

- relee las tres normas base de BCN;
- revisa año actual y anterior de Circulares SII;
- revisa año actual y anterior de Oficios SII;
- calcula SHA-256 para detectar cambios;
- actualiza Markdown, índice y relaciones;
- guarda cambios en Git y vuelve a publicar.

Las descargas usan timeout, reintentos y concurrencia máxima de dos documentos.

## Backfill histórico

La carga inicial prioriza los años recientes y después avanza por bloques de cuatro años, guardando checkpoints en Git. Si un tramo falla, el avance previo no se pierde. Al reanudar, BCN se actualiza primero sin reprocesar los años SII ya completados.

Objetivo:

- Circulares SII desde 1974;
- Jurisprudencia Administrativa SII desde 1975;
- LIR, LIVS y Código Tributario vigentes desde BCN/LeyChile, también por artículo.

El marcador `.bootstrap-full-history` y el checkpoint `.bootstrap-state.json` se eliminan automáticamente al finalizar.

## Acceso para ChatGPT / Claude

Un agente debe comenzar por `llms.txt` o `data/catalog.json`, filtrar los resultados relevantes y después abrir su `content_path`. `index.json` queda disponible para consultas técnicas más profundas.

Cada registro conserva tipo, número, fecha, año, materia, referencias, huella de contenido y URL oficial.

## Buscador

El front busca localmente en `catalog.json` y permite filtrar por:

- BCN / SII;
- Norma / Artículo / Oficio / Circular;
- Materia;
- Año.

## Criterios de seguridad y respeto de fuentes

- sólo consulta información pública;
- no usa login ni credenciales;
- usa concurrencia baja, pausas y timeout;
- la revisión recurrente es semanal;
- cada documento conserva el enlace oficial;
- la copia local facilita consulta, pero no sustituye la fuente oficial.

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

La prioridad es un corpus confiable, rastreable y fácil de mantener. Embeddings, RAG, login y favoritos pueden agregarse después sin cambiar el corpus ni las URLs públicas.
