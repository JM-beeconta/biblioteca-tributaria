# Biblioteca Tributaria Beeconta

MVP de biblioteca pública para consultar en un mismo lugar:

- **BCN / LeyChile:** Ley sobre Impuesto a la Renta (DL 824), Ley sobre Impuesto a las Ventas y Servicios (DL 825) y Código Tributario (DL 830).
- **SII:** Circulares y Jurisprudencia Administrativa (Oficios) en Renta, IVA y Otras Normas.

El proyecto no usa Supabase, n8n, Make, base de datos ni servidor permanente.

## Arquitectura

```text
BCN / LeyChile ─┐
                ├─> Node crawler ─> JSON + Markdown ─> GitHub Pages
SII público ────┘                         │
                                          ├─> navegador humano
                                          ├─> ChatGPT / agentes web
                                          └─> Claude / agentes web
```

## Archivos importantes

- `data/index.json`: índice estructurado para humanos y agentes.
- `data/relations.json`: referencias entre circulares, oficios y artículos detectadas automáticamente.
- `content/`: copia de consulta en Markdown de cada documento extraído.
- `site/`: front estático.
- `llms.txt`: se genera en cada build para facilitar el acceso de agentes.
- `.github/workflows/library-pages.yml`: actualización semanal + despliegue.

## Primera puesta en marcha

1. Crear un repositorio público en GitHub, por ejemplo `JM-beeconta/biblioteca-tributaria`.
2. Subir el contenido completo de este proyecto a `main`.
3. En GitHub: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
4. Ir a **Actions → Actualizar y publicar biblioteca → Run workflow** y marcar `full_history = true`.
5. La primera carga hará el backfill histórico y publicará el sitio.
6. Desde entonces, la Action corre **cada lunes a las 06:00 America/Santiago**.

## Actualización semanal

La corrida semanal:

- vuelve a leer las tres normas base de BCN para detectar cambios;
- revisa el año actual y anterior de Circulares SII;
- revisa el año actual y anterior de Oficios SII en Renta, IVA y Otras Normas;
- calcula SHA-256 para detectar cambios de contenido;
- actualiza Markdown, índice y relaciones;
- guarda los cambios en Git;
- vuelve a publicar GitHub Pages.

La carga histórica inicial recorre Circulares desde 1974 y Jurisprudencia Administrativa desde 1998. Años o rutas que no existan se omiten sin detener el proceso.

## Acceso para ChatGPT / Claude

Una vez publicado, un agente puede comenzar por:

```text
https://<dominio>/data/index.json
https://<dominio>/data/relations.json
https://<dominio>/llms.txt
```

Cada entrada del índice contiene:

- `source_url`: enlace oficial SII o BCN que debe usarse como fuente jurídica;
- `content_path`: texto local extraído para búsqueda/lectura rápida;
- `references`: artículos, Oficios y Circulares detectados;
- `sha256`: huella para identificar cambios.

## Buscador

El front busca localmente, sin backend. Prioriza coincidencias en título y resumen y luego texto de búsqueda. Permite filtrar por:

- BCN / SII;
- Norma / Artículo / Oficio / Circular;
- Materia;
- Año.

## Criterios de seguridad y respeto de fuentes

- sólo consulta páginas públicas;
- no usa login ni credenciales;
- las solicitudes son secuenciales y con pausa;
- la revisión recurrente es semanal, no continua;
- no reemplaza la fuente oficial: cada ficha mantiene su URL original;
- el front advierte que la copia local puede contener errores de extracción.

## Desarrollo local

No hay dependencias npm.

```bash
npm test
npm run build
python -m http.server 8080 -d dist
```

Para ejecutar el crawler se requiere `pdftotext` (paquete `poppler-utils`). En GitHub Actions se instala automáticamente.

```bash
npm run update       # semana actual + anterior
npm run bootstrap    # carga histórica completa
```

## Alcance de este MVP

Esta versión prioriza que la biblioteca **funcione y sea fácil de mantener**. No incluye todavía embeddings, RAG, login, favoritos ni un backend de IA. La búsqueda semántica puede agregarse más adelante sin cambiar el corpus ni las URLs públicas.
