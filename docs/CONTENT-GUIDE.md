# Launcher news: content guide

*Español: [CONTENT-GUIDE.es.md](CONTENT-GUIDE.es.md)*

The launcher's news panel (featured card, roadmap rows, "Last update" line, links) comes from **one file**:

- In the repo: [`content/news.json`](../content/news.json)
- What the launcher downloads:
  `https://raw.githubusercontent.com/CrystalFVPM-DEV/SOLFALL-Launcher-by-CrystalFVPM/main/content/news.json`

No server and no release are needed: edit the file on github.com, commit to `main`, done.

## 1. Edit it from the GitHub website

1. Open the repo on github.com and go to `content/news.json`.
2. Click the **pencil** icon (*Edit this file*). You need write access to the repo.
3. Make your change (see the fields below). Keep the quotes `"…"` and commas exactly as they are around your text.
4. Click **Commit changes…**, write a short message (e.g. `news: roadmap update`),
   choose **Commit directly to the `main` branch** and click **Commit changes**.
5. Within a few seconds the **validate-content** check runs on that commit. Green check = OK. Red X = the file has an
   error: open the check to see which line/field, and fix it with another edit. While it's broken, players keep seeing
   the last good version (the launcher never shows a broken file).

## 2. What each field does

```json
{
  "$schema": "./news.schema.json",
  "schema_version": 3,
  "updated": "2026-11-13",
  "links": { "roadmap": "https://…", "patch_notes": "https://…", "website": "https://…", "patreon": "https://…", "discord": "https://discord.gg/scyet8grSR" },
  "featured": { "title": "…", "text": "…", "status": "in_progress", "url": "https://…", "image": null, "source": "https://…" },
  "roadmap": [ { "title": "…", "status": "done", "when": "OCT 2026", "source": "https://…" } ],
  "patch_notes": [ { "date": "2026-11-11", "kind": "FIX", "title": "…", "summary": ["…"], "url": "https://…", "source": "https://…" } ]
}
```

| Field | Required | What it is | Rules |
|---|---|---|---|
| `$schema` | no | Lets code editors check the file. Leave it. | — |
| `schema_version` | **yes** | Format version. | Always `3`. |
| `updated` | **yes** | Day you last edited the file. | `YYYY-MM-DD` |
| `links.roadmap` | no | "Roadmap" link/button. | `https://…` or `null` (= hidden) |
| `links.patch_notes` | no | "Patch notes →" link. | same |
| `links.website`, `links.patreon`, `links.discord` | no | Footer links. | same |
| `featured` | **yes** | Big card on the main screen. | object, or `null` to hide it |
| `featured.title` | yes (if card) | Card title. | 1–60 characters |
| `featured.text` | yes (if card) | One or two sentences. | 1–280 characters |
| `featured.status` | no | Tag on the card. | `done`, `in_progress`, `next_up`, `planned` |
| `featured.url` | no | Where the card links to. | `https://…` or `null` |
| `featured.image` | no | Card image (see §3). | `https://…` or `null` |
| `roadmap` | **yes** | Roadmap rows, in display order. **The launcher shows the first 3.** | list (max 6); `[]` hides the panel |
| `roadmap[].title` | yes | Milestone name. | 1–40 characters |
| `roadmap[].status` | yes | Tag. | `done` → "Done", `in_progress` → "In progress", `next_up` → "Next up", `planned` → "Planned" |
| `roadmap[].when` | no | Short time label. | up to 20 characters, e.g. `OCT 2026`, `NOW`, `NEXT` |
| `patch_notes` | **yes** | Recent updates, **newest first**. The newest one becomes "Last update 11 Nov · <title>". | list (max 20); `[]` hides it |
| `patch_notes[].date` | yes | Release day. | `YYYY-MM-DD` (a real date) |
| `patch_notes[].kind` | no | Type tag. | `FEATURE`, `FIX`, `BALANCE`, `HOTFIX`, `ART` |
| `patch_notes[].title` | yes | Headline. | 1–80 characters |
| `patch_notes[].summary` | no | Up to 3 short lines. | list of up to 3 texts, 400 characters each |
| `patch_notes[].url` | no | "Read more" link. Defaults to `links.patch_notes`. | `https://…` or `null` |
| `*.source` | no | Where the text was copied from (for reviewers; not shown to players). | `https://…` |

Rules of thumb:
- **Only real content.** Copy from solfall.online (roadmap page, "The log") and keep `source` pointing at it. No placeholder or
  sample text; the validator rejects words like `SAMPLE` or `TODO`.
- **Nothing to show? Leave it empty.** `"featured": null`, `"roadmap": []`, `"patch_notes": []`: the launcher hides that part.
- No unknown fields: a typo like `"titel"` is reported as an error instead of being silently ignored.

### Common edits

- **Roadmap moved on:** change the `status` of the rows (e.g. `in_progress` → `done`), add the new row, keep 3 rows on top.
- **New patch:** copy the first object in `patch_notes`, paste it at the **top** of the list followed by a comma, and change
  `date`, `kind`, `title`, `summary`. Remove the oldest one if the list gets long. Update `updated`.
- **Hide the featured card:** replace the whole `{ … }` after `"featured":` with `null`.

## 3. Images (optional)

Only `featured.image` uses an image. Two options:

1. **An image already on solfall.online:** paste its `https://solfall.online/…` URL.
2. **Upload one to this repo:** go to the `content/img/` folder → **Add file → Upload files** → drop the file
   (PNG/JPG/WebP, ideally under 500 KB, about 1200×630, **no spaces in the file name**) → commit to `main`. Then use:
   `https://raw.githubusercontent.com/CrystalFVPM-DEV/SOLFALL-Launcher-by-CrystalFVPM/main/content/img/<file-name>`

Upload the image **before** (or in the same commit as) the `news.json` change that uses it: the validator checks that the file
exists. Other hosts and `http://` are rejected.

## 4. How long until players see it

- `raw.githubusercontent.com` serves files with `Cache-Control: max-age=300` (checked on 2026-11-13 with a HEAD request to a
  public raw file), so a change can take **up to about 5 minutes** to show up.
- The launcher reads the news **when it starts** (and uses `ETag`, so unchanged news costs almost nothing). Players see the
  change on their next launcher start after those ~5 minutes.
- If the file is unreachable or broken, the launcher shows its last good copy; on a first run with no network it shows the
  copy bundled in the installer.

## 5. Check the file before (or after) committing

- **Online:** paste the content into a JSON checker such as <https://jsonlint.com> to catch missing/extra commas and quotes.
  (This only checks JSON syntax, not the fields.)
- **Locally (full check):** `node scripts/validate-content.mjs` (no install needed, Node 18+). It prints the field and the
  reason for every problem, e.g. `roadmap[0].status: must be one of "done", "in_progress", "next_up", "planned" (got "Done")`.
- **Automatically:** the `validate-content` GitHub Action (`.github/workflows/validate-content.yml`) runs the same script on
  every push and pull request that touches `content/`.

Typical mistakes: a missing comma between two `{ … }` blocks, a comma after the last item of a list, "curly quotes" pasted
from a document instead of straight `"`, and dates like `11/11/2026` instead of `2026-11-11`.
