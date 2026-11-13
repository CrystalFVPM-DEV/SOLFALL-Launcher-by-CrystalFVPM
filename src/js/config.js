// SOLFALL Launcher — external links, in ONE place. A link set to null is HIDDEN in the UI.
// Roadmap / patch-notes URLs are pending Backend's passive checks; set them here when confirmed.
// (The launcher manifest's "links" object, if any, overrides these at runtime.)
export const LINKS = {
  roadmap: null,      // e.g. 'https://solfall.online/#/roadmap'  (titlebar tab; hidden while null)
  patchNotes: null,   // fallback "Patch notes →" URL when the newest patch item has no url (hidden while null)
  status: null,       // error panel "Status page ↗" (hidden while null)
  discord: 'https://discord.gg/scyet8grSR',
  patreon: 'https://www.patreon.com/cw/solfall',
  web: 'https://solfall.online',
};
