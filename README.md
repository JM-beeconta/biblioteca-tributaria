# Biblioteca Tributaria Beeconta

Biblioteca pública de fuentes tributarias chilenas para consulta humana y por agentes.

- **BCN / LeyChile:** Ley sobre Impuesto a la Renta (DL 824), Ley sobre Impuesto a las Ventas y Servicios (DL 825), Código Tributario (DL 830), Timbres y Estampillas (DL 3.475), Herencias y Donaciones (Ley 16.271), Reglamento del IVA (DS 55) y Rentas Municipales (DL 3.063), con artículos individualizados, versiones con vigencia diferida y el texto completo de cada norma que las modifica.
- **SII:** Circulares, Jurisprudencia Administrativa (Oficios) en Renta, IVA y Otras Normas, y Resoluciones Exentas (desde 2013).

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

Para páginas históricas mantiene fallback a los índices HTML antiguos del SII. En esos índices:

- cada oficio es un archivo `jaNNNN.htm` (o `renta14.htm`, `dic111.htm` en los años noventa) con una copia `.doc`/`.pdf`: se guarda **un** documento, con la `.htm` como fuente y las copias en `alternate_urls`;
- el número sale del nombre `jaNNNN` o de la cita propia que cierra la entrada — `(Ord. N° 4.936, de 28.12.2000)`, `Oficio N° 3.788, de 18.12.95` —, nunca de un oficio citado en el resumen;
- el año es el de la página (o el de la cita propia, si es del año vecino), no el de una norma citada;
- las páginas sin charset se leen como Windows-1252 cuando no son UTF-8 válido.

Las Circulares hasta 2012 se leen de `sii.cl/documentos/circulares/AÑO/indcirAÑO.htm`, siguiendo la redirección por JavaScript de los años previos a 2000.

## Originales archivados

Cada recarga guarda el archivo tal como lo publicó el SII (PDF, DOC o HTML) en el release [`originales-sii`](https://github.com/JM-beeconta/biblioteca-tributaria/releases/tag/originales-sii), en un `.zip` por año y tramo. La ficha de cada documento enlaza su zip e indica el nombre del archivo y su SHA-256 (`original_file`). La fuente jurídica sigue siendo `source_url`.

## Recarga con reemplazo

`.sii-gap-fill-request` con un `campaign` dispara *Rellenar Brechas SII* en modo reemplazo: cada tramo retira los documentos SII que había de esos años y deja los recién leídos. Si un año/tipo trae menos del 45% de lo que había (índice caído), se conserva lo anterior; lo que otro tramo de la misma campaña ya recargó no se toca.

## BCN / LeyChile

El crawler lee la vista oficial consolidada `leychile/navegar?idNorma=...` y separa cada norma base por artículo. Una validación de contenido impide reemplazar una norma correcta por la pantalla intermedia de carga de LeyChile.

Cada corrida, además:

- **Versiones con vigencia diferida:** guarda, completas y por artículo, las versiones que LeyChile ya publicó pero que rigen desde una fecha futura (p.ej. la LIR con la Ley 21.850 desde el 1-11-2026). Llevan `future_version: true` y `valid_from`; la ficha muestra "Rige desde …". Las versiones "por evento" (fecha centinela 2222-02-02 en LeyChile) quedan con `deferred_by_event: true` y sin fecha.
- **Normas modificatorias:** consulta el registro de vinculaciones de LeyChile ("Modificada por") de cada norma base y guarda el texto completo de cada ley o decreto modificatorio, incluidos sus artículos transitorios (`norm_kind: "modificatoria"`, categoría *Leyes modificatorias*). Las reformas 20.780, 21.210, 21.420, 21.713 y 21.850 están fijadas aunque LeyChile dejara de listarlas.
- **Cobertura:** `meta.json → bcn_coverage` informa cuántas modificatorias registra LeyChile, cuántas se guardaron y cuáles faltan (`missing`), además de las que LeyChile registra sin texto (`unavailable_in_leychile`).

## Publicación

Cada cambio en `main` dispara `Publicar Biblioteca Tributaria`:

1. ejecuta tests;
2. construye el sitio y genera `catalog.json`;
3. publica en GitHub Pages;
4. comprueba por HTTP el front, catálogo, índice completo y `llms.txt`;
5. valida que catálogo e índice contengan la misma cantidad de documentos.

La verificación no escribe commits, evitando loops de despliegue.

## Actualización diaria (3 veces al día)

`Actualizar Biblioteca Tributaria` corre todos los días a las **07:17, 13:17 y 19:17 America/Santiago** (GitHub puede atrasar un cron entre 5 y 30 minutos).

Cada corrida:

- sólo en la de las 07:17: relee las normas base de BCN, sus versiones con vigencia diferida y sus normas modificatorias;
- revisa año actual y anterior de Circulares SII;
- revisa año actual y anterior de Oficios SII;
- revisa año actual y anterior de Resoluciones SII;
- calcula SHA-256 para detectar cambios;
- actualiza Markdown, índice y relaciones;
- guarda cambios en Git y vuelve a publicar **sólo si hay documentos nuevos o modificados**; un documento que vuelve idéntico no se reescribe (ni siquiera `last_seen_at`), así que una corrida sin novedades no genera commit ni despliegue;
- conserva la referencia al original archivado (`original_file.release/asset/path`) cuando el archivo no cambió.

Por eso "Última actualización" en el sitio es la fecha de la última novedad, no de la última revisión; las revisiones se ven en la pestaña Actions del repositorio.

Las descargas usan timeout, reintentos y concurrencia máxima de dos documentos.

## Backfill histórico

La carga inicial prioriza los años recientes y después avanza por bloques de cuatro años, guardando checkpoints en Git. Si un tramo falla, el avance previo no se pierde. Al reanudar, BCN se actualiza primero sin reprocesar los años SII ya completados.

Objetivo:

- Circulares SII desde 1974;
- Jurisprudencia Administrativa SII desde 1975;
- Resoluciones Exentas SII desde 2013 (no existe índice agregado del SII para años anteriores);
- LIR, LIVS y Código Tributario vigentes desde BCN/LeyChile, también por artículo, con historial completo de versiones.

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
- la revisión recurrente es 3 veces al día y sólo la primera consulta LeyChile;
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
