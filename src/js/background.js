// SOLFALL Launcher 0.4.0 — animated background: ships crossing (sometimes a pirate chasing a Dart) + flares on the star.
// CPU rules (docs/DEVELOPERS.md §6):
//  * Only `transform` / `opacity` change, written by ONE low-rate timer (no requestAnimationFrame, no infinite CSS
//    animations: WebKitGTK ticks those every frame even for steps(); rAF keeps firing in a visible but unfocused window).
//  * Nothing is scheduled unless the launcher is the active, visible, un-minimised window on the main screen with no
//    game window open, the setting is on, Performance mode is off and reduced motion (OS or Settings) is off.
//    Every pause clears the timer and the pending spawn, so a paused launcher runs no JS at all (0 % CPU).
//  * Sprites are pre-scaled, pre-tinted PNGs (no CSS filter while moving), drawn 1:1 at integer pixels.
// Inputs: window focus/blur, visibilitychange, and the native window state pushed by Rust (focused / minimised /
// game window open) through window.__solfall.win(): the page cannot see the game window, and the native events are a
// second, engine-independent source for focus and minimise.

const FLEET = { fps: 8, gapMin: 14000, gapMax: 34000, durMin: 22000, durMax: 30000, skirmish: 0.2, W: 1440 };
const SHIPS = ['dart', 'barracuda', 'toad'];
// Star: small flares along the visible limb flicker in turn (opacity in 0.2 steps, 4 updates/s at most, so a step
// repaints a few hundred pixels). The big corona ring pulses only where the engine composites opacity on the GPU
// (WebView2 / WKWebView); on software-rendered WebKitGTK a 200×200 px opacity step costs ~30 ms (docs §6), so there
// the ring stays static.
const SUN = { stepMs: 250, period: 7000, lo: 0.35, hi: 0.85, flarePeriod: 5600 };
const rnd = (a, b) => a + Math.random() * (b - a);

// Glass panels the ships pass behind. A sprite FULLY behind one is invisible anyway (the glass is ~70 % opaque and
// blurred), but every step would still repaint the panel's backdrop blur, the most expensive thing to repaint on a
// software renderer; so while fully hidden it is set visibility:hidden and not moved (no repaint at all).
const OCCLUDERS = ['.rcol'];

export function createBackground({ app, layer, corona, flares = [], bigPulse = false, log, reduced }) {
  const nat = { focused: true, minimized: false, game: false }; // native window state (Rust); optimistic until told
  let enabled = true, perf = false;
  let tick = null, gap = null, flight = null, running = false, sunT0 = 0, sunPhase = 0, lastSun = -1;
  const lastFlare = flares.map(() => -1);
  let lastWhy = null;

  const winWhy = () => document.hidden ? 'hidden' : nat.minimized ? 'minimised' : nat.game ? 'game-open'
    : (!nat.focused || app.dataset.focused === 'false') ? 'unfocused' : '';
  const why = () => {
    if (!enabled) return 'setting-off';
    if (perf) return 'performance-mode';
    if (reduced()) return 'reduced-motion';
    const w = winWhy(); if (w) return w;
    if (app.dataset.view === 'settings') return 'settings';
    if (!['main', 'launcher-update'].includes(app.dataset.state)) return 'state-' + app.dataset.state;
    return '';
  };

  function spawn() {
    gap = null;
    const ltr = Math.random() < .5, sk = Math.random() < FLEET.skirmish, sfx = ltr ? '' : '-l';
    const el = document.createElement('div'); el.className = 'fl';
    if (sk) {
      // Compact formation (≈215 px wide): the repaint cost of a moving sprite group is proportional to its box.
      el.innerHTML = `<img src="assets/fleet/pirate${sfx}.png" alt="" style="left:${ltr ? 0 : 133}px;top:0"><i class="bolt"></i>` +
        `<img src="assets/fleet/dart${sfx}.png" alt="" style="left:${ltr ? 150 : 0}px;top:10px">`;
    } else {
      el.innerHTML = `<img src="assets/fleet/${SHIPS[Math.floor(Math.random() * SHIPS.length)]}${sfx}.png" alt="">`;
    }
    // Lane: below the title bar, above Jamie's comms strip (no glass on the left half).
    const w = sk ? 215 : 100, h = sk ? 80 : 62, y0 = Math.round(rnd(140, 400)), y1 = Math.round(Math.min(430, Math.max(120, y0 + rnd(-60, 60))));
    flight = { el, ltr, w, h, x0: ltr ? -w : FLEET.W + 10, x1: ltr ? FLEET.W + 10 : -w, y0, y1, dur: rnd(FLEET.durMin, FLEET.durMax), t: 0, k: 0,
      bolt: el.querySelector('.bolt'), lx: null, ly: null, lb: null, hidden: false, occ: occluders() };
    el.style.transform = `translate(${flight.x0}px,${flight.y0}px)`;
    layer.appendChild(el);
    log(`bg ${sk ? 'skirmish' : 'ship'} ${Math.round(flight.dur / 1000)}s`);
  }

  function occluders() {
    const a = app.getBoundingClientRect(), k = a.width / FLEET.W || 1, out = [];
    for (const sel of OCCLUDERS) {
      const el = app.querySelector(sel); if (!el || el.hidden || !el.offsetParent) continue;
      const r = el.getBoundingClientRect(); if (!r.width || !r.height) continue;
      out.push({ l: (r.left - a.left) / k, t: (r.top - a.top) / k, r: (r.right - a.left) / k, b: (r.bottom - a.top) / k });
    }
    return out;
  }

  function stepFleet(dt) {
    const f = flight; if (!f) return;
    f.t += dt;
    const p = Math.min(1, f.t / f.dur);
    const x = Math.round(f.x0 + (f.x1 - f.x0) * p), y = Math.round(f.y0 + (f.y1 - f.y0) * p);
    const behind = f.occ.some(o => x >= o.l && x + f.w <= o.r && y >= o.t && y + f.h <= o.b);
    if (behind !== f.hidden) { f.hidden = behind; f.el.style.visibility = behind ? 'hidden' : ''; }
    if (behind) { if (p >= 1) { f.el.remove(); flight = null; } return; }
    if (x !== f.lx || y !== f.ly) { f.el.style.transform = `translate(${x}px,${y}px)`; f.lx = x; f.ly = y; }
    if (f.bolt) {
      const ph = Math.floor(f.t / (1000 / FLEET.fps)) % 10, b = ph < 4 ? ph : -1; // 4 frames of laser, 6 off
      if (b !== f.lb) {
        f.lb = b;
        f.bolt.style.opacity = b < 0 ? '0' : '1';
        if (b >= 0) f.bolt.style.transform = `translateX(${f.ltr ? 82 + b * 14 : 117 - b * 14}px)`;
      }
    }
    if (p >= 1) { f.el.remove(); flight = null; }
  }

  function stepSun(now) {
    const t = now - sunT0;
    if (corona && bigPulse) {
      const s = (1 - Math.cos(2 * Math.PI * ((t / SUN.period + sunPhase) % 1))) / 2; // 0..1..0
      const o = Math.round((SUN.lo + (SUN.hi - SUN.lo) * s) * 100) / 100;            // 0.01 steps
      if (o !== lastSun) { corona.style.opacity = o; lastSun = o; }
    }
    for (let i = 0; i < flares.length; i++) {
      const ph = (t / SUN.flarePeriod + sunPhase + i * 0.37) % 1;
      const s = Math.max(0, Math.sin(2 * Math.PI * ph)); // each flare lit for half its period
      const o = Math.round((0.1 + 0.8 * s * s) * 5) / 5 || 0.1; // 0.1 … 1 in 0.2 steps: ~1.5 repaints/s per flare
      if (o !== lastFlare[i]) { flares[i].style.opacity = o; lastFlare[i] = o; }
    }
  }

  // One timer: 12 fps while a ship is flying, the corona rate otherwise.
  let last = 0;
  function loop() {
    tick = null;
    const now = performance.now(), dt = Math.min(250, now - last); last = now;
    stepFleet(dt); stepSun(now);
    if (!flight && !gap) gap = setTimeout(spawn, rnd(FLEET.gapMin, FLEET.gapMax));
    tick = setTimeout(loop, flight ? 1000 / FLEET.fps : SUN.stepMs);
  }

  function stop() {
    if (tick) { clearTimeout(tick); tick = null; }
    if (gap) { clearTimeout(gap); gap = null; }
    if (running) sunPhase = ((performance.now() - sunT0) / SUN.period + sunPhase) % 1; // resume where it was
  }

  function sync() {
    const r = why(), on = !r;
    // CSS side: when the WINDOW is inactive, every remaining CSS loop (spinner, Windows glow pulse) is paused too.
    if (winWhy()) app.dataset.win = 'inactive'; else delete app.dataset.win;
    app.classList.toggle('bg-off', !enabled || perf || reduced());
    if (r !== lastWhy) { lastWhy = r; log('bg ' + (on ? 'run' : 'pause ' + r)); } // every reason change (diagnostics)
    if (on === running) return;
    running = on;
    if (on) { sunT0 = performance.now(); last = sunT0; loop(); }
    else stop();
  }

  return {
    sync,
    setPrefs(p) { enabled = p.animated !== false; perf = !!p.perf; if (!enabled || perf) { flight?.el.remove(); flight = null; } sync(); },
    win(s) { if (s && typeof s === 'object') { for (const k of ['focused', 'minimized', 'game']) if (k in s) nat[k] = !!s[k]; } sync(); },
    setBigPulse(on) { bigPulse = !!on; if (!bigPulse && corona) { corona.style.opacity = ''; lastSun = -1; } },
    get running() { return running; },
  };
}
