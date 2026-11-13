# Noticias del launcher: guía de contenido

*English: [CONTENT-GUIDE.md](CONTENT-GUIDE.md)*

El panel de noticias del launcher (tarjeta destacada, filas del roadmap, línea "Last update" y enlaces) sale de **un solo archivo**:

- En el repo: [`content/news.json`](../content/news.json)
- Lo que descarga el launcher:
  `https://raw.githubusercontent.com/CrystalFVPM-DEV/SOLFALL-Launcher-by-CrystalFVPM/main/content/news.json`

No hace falta servidor ni release: se edita el archivo en github.com, se hace commit en `main` y listo.

## 1. Editarlo desde la web de GitHub

1. Abre el repo en github.com y entra en `content/news.json`.
2. Pulsa el **lápiz** (*Edit this file*). Necesitas permiso de escritura en el repo.
3. Haz el cambio (ver campos abajo). Respeta las comillas `"…"` y las comas que rodean tu texto.
4. Pulsa **Commit changes…**, escribe un mensaje corto (p. ej. `news: actualizar roadmap`), elige
   **Commit directly to the `main` branch** y pulsa **Commit changes**.
5. En unos segundos corre el check **validate-content** sobre ese commit. Tic verde = bien. X roja = el archivo tiene un
   error: abre el check para ver la línea o el campo y corrígelo con otra edición. Mientras esté roto, los jugadores siguen viendo
   la última versión buena (el launcher nunca muestra un archivo roto).

## 2. Qué hace cada campo

(Ver el bloque de ejemplo de la estructura en [CONTENT-GUIDE.md](CONTENT-GUIDE.md#2-what-each-field-does).)

| Campo | Obligatorio | Qué es | Reglas |
|---|---|---|---|
| `$schema` | no | Permite que los editores revisen el archivo. Déjalo. | — |
| `schema_version` | **sí** | Versión del formato. | Siempre `3`. |
| `updated` | **sí** | Día de tu última edición. | `AAAA-MM-DD` |
| `links.roadmap` | no | Enlace/botón "Roadmap". | `https://…` o `null` (= oculto) |
| `links.patch_notes` | no | Enlace "Patch notes →". | igual |
| `links.website`, `links.patreon`, `links.discord` | no | Enlaces del pie. | igual |
| `featured` | **sí** | Tarjeta grande de la pantalla principal. | objeto, o `null` para ocultarla |
| `featured.title` | sí (si hay tarjeta) | Título. | 1–60 caracteres |
| `featured.text` | sí (si hay tarjeta) | Una o dos frases. | 1–280 caracteres |
| `featured.status` | no | Etiqueta de la tarjeta. | `done`, `in_progress`, `next_up`, `planned` |
| `featured.url` | no | A dónde enlaza la tarjeta. | `https://…` o `null` |
| `featured.image` | no | Imagen (ver §3). | `https://…` o `null` |
| `roadmap` | **sí** | Filas del roadmap en orden. **El launcher muestra las 3 primeras.** | lista (máx. 6); `[]` oculta el panel |
| `roadmap[].title` | sí | Nombre del hito. | 1–40 caracteres |
| `roadmap[].status` | sí | Etiqueta. | `done` → "Done", `in_progress` → "In progress", `next_up` → "Next up", `planned` → "Planned" |
| `roadmap[].when` | no | Rótulo corto de tiempo. | hasta 20 caracteres, p. ej. `OCT 2026`, `NOW`, `NEXT` |
| `patch_notes` | **sí** | Actualizaciones recientes, **la más nueva primero**. La más nueva se convierte en "Last update 11 Nov · <título>". | lista (máx. 20); `[]` la oculta |
| `patch_notes[].date` | sí | Día de salida. | `AAAA-MM-DD` (fecha real) |
| `patch_notes[].kind` | no | Tipo. | `FEATURE`, `FIX`, `BALANCE`, `HOTFIX`, `ART` |
| `patch_notes[].title` | sí | Titular. | 1–80 caracteres |
| `patch_notes[].summary` | no | Hasta 3 líneas cortas. | lista de hasta 3 textos de 400 caracteres |
| `patch_notes[].url` | no | Enlace "leer más". Por defecto, `links.patch_notes`. | `https://…` o `null` |
| `*.source` | no | De dónde se copió el texto (para revisión; no se muestra). | `https://…` |

Reglas básicas:
- **Solo contenido real.** Se copia de solfall.online (página del roadmap, sección "The log") y `source` apunta allí. Nada de
  textos de relleno o de ejemplo: el validador rechaza palabras como `SAMPLE` o `TODO`.
- **¿No hay nada que mostrar? Déjalo vacío.** `"featured": null`, `"roadmap": []`, `"patch_notes": []`: el launcher oculta esa parte.
- No hay campos libres: un error de tipeo como `"titel"` se marca como error en vez de ignorarse sin aviso.

### Ediciones habituales

- **Avanzó el roadmap:** cambia el `status` de las filas (p. ej. `in_progress` → `done`), añade la fila nueva y deja arriba las 3 que deben verse.
- **Parche nuevo:** copia el primer objeto de `patch_notes`, pégalo **arriba** de la lista seguido de una coma y cambia `date`,
  `kind`, `title` y `summary`. Borra el más viejo si la lista crece. Actualiza `updated`.
- **Ocultar la tarjeta destacada:** sustituye todo el `{ … }` que va después de `"featured":` por `null`.

## 3. Imágenes (opcional)

Solo `featured.image` usa imagen. Dos opciones:

1. **Una imagen que ya esté en solfall.online:** pega su URL `https://solfall.online/…`.
2. **Subirla a este repo:** entra en la carpeta `content/img/` → **Add file → Upload files** → arrastra el archivo
   (PNG/JPG/WebP, idealmente menos de 500 KB, unos 1200×630, **sin espacios en el nombre**) → commit en `main`. Luego usa:
   `https://raw.githubusercontent.com/CrystalFVPM-DEV/SOLFALL-Launcher-by-CrystalFVPM/main/content/img/<nombre-del-archivo>`

Sube la imagen **antes** del cambio en `news.json` que la usa (o en el mismo commit): el validador comprueba que el archivo
exista. Otros hosts y `http://` se rechazan.

## 4. Cuánto tarda en verse

- `raw.githubusercontent.com` sirve los archivos con `Cache-Control: max-age=300` (comprobado el 13-11-2026 con un HEAD a un
  archivo raw público), así que un cambio puede tardar **hasta unos 5 minutos** en aparecer.
- El launcher lee las noticias **al arrancar** (con `ETag`, así que si no cambiaron casi no gasta nada). Los jugadores ven el
  cambio en su siguiente arranque pasados esos ~5 minutos.
- Si el archivo no se puede descargar o está roto, el launcher muestra la última copia buena. En un primer arranque sin red
  muestra la copia que va dentro del instalador.

## 5. Validar el archivo antes (o después) del commit

- **En la web:** pega el contenido en un validador JSON como <https://jsonlint.com> para detectar comas o comillas de más o
  de menos. (Solo revisa la sintaxis JSON, no los campos.)
- **En local (revisión completa):** `node scripts/validate-content.mjs` (sin instalar nada, Node 18+). Indica el campo y el
  motivo de cada problema, p. ej. `roadmap[0].status: must be one of "done", "in_progress", "next_up", "planned" (got "Done")`.
- **Automático:** el GitHub Action `validate-content` (`.github/workflows/validate-content.yml`) ejecuta el mismo script en
  cada push y pull request que toque `content/`.

Errores típicos: falta una coma entre dos bloques `{ … }`, sobra una coma tras el último elemento de una lista, comillas
"tipográficas" pegadas desde un documento en vez de `"` rectas, y fechas como `11/11/2026` en vez de `2026-11-11`.
