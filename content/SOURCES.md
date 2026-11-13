# Sources for content/news.json

Every value in `news.json` was copied from public pages of solfall.online. Nothing is invented and nothing is a
sample. Retrieved on **2026-11-13, 17:03–17:05 (America/Santiago, UTC-3)** with passive GET/HEAD requests only
(robots.txt: `Allow: /`).

| news.json field | Value | Source |
|---|---|---|
| `links.roadmap` | `https://solfall.online/#/roadmap` | Listed in https://solfall.online/sitemap.xml; nav link "ROADMAP" on https://solfall.online/. Page title set by the site: "ROADMAP · SOLFALL". |
| `links.patch_notes` | `https://solfall.online/#/roadmap` | There is **no separate patch-notes page** (`/changelog`, `/patch-notes`, `/roadmap` return 404; not in the sitemap). Patch notes are the section "The log. What changed, and when." on the roadmap page, with "FULL PATCH NOTES" per post. |
| `links.website` | `https://solfall.online/` | Site root (200, title "SOLFALL · One galaxy. Run by you."). |
| `links.patreon` | `https://www.patreon.com/cw/solfall` | "SUPPORT ON PATREON" button on https://solfall.online/ and the roadmap page. |
| `links.discord` | `https://discord.gg/scyet8grSR` | Official invite provided by Voiden (project collaborator), 2026-11-13. Not published on solfall.online. |
| `featured` | "Strange New Worlds", status in progress, text verbatim | Roadmap row marked NOW / IN PROGRESS on https://solfall.online/#/roadmap (data rendered from https://solfall.online/js/roadmap.js, "TO BOLDLY GO" bar). |
| `featured.image` | `null` | No image chosen. |
| `roadmap[0]` | "Boots on the Deck" · done · OCT 2026 | Same page, last DONE row of the "TO BOLDLY GO" bar. |
| `roadmap[1]` | "Strange New Worlds" · in_progress · NOW | Same page, the "WE ARE HERE" row. |
| `roadmap[2]` | "Ships Revisited" · next_up · NEXT | Same page, first NEXT UP row. |
| `patch_notes[0..5]` | 6 newest posts (2026-11-11 ×4, 2026-11-07 ×2): date, kind, title, summary = the post's `tldr` lines verbatim | "The log" on https://solfall.online/#/roadmap, whose data file is https://solfall.online/data/updates.json (18 posts on that date). |

Status mapping used (site → news.json): DONE → `done`, IN PROGRESS → `in_progress`, NEXT UP → `next_up`, PLANNED → `planned`.

Not used: the site's built-in `?demo` "SAMPLE" posts in js/roadmap.js (they are design samples, not real updates).
