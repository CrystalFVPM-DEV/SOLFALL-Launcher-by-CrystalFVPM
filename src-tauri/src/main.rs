// SOLFALL Launcher — Tauri v2 (Windows: WebView2).
//
// Flow: the window starts on the local UI (src/index.html). LAUNCH, by default (0.2.1+, as in 0.1.0), navigates
// THAT SAME window to play.solfall.online as a top-level document (no iframe: the site sends X-Frame-Options: DENY),
// so the launcher document is discarded and only one webview remains. Optional (Settings → "When the game
// launches"): open the game in its own window and minimise/keep/hide/close the launcher.
// Every webview shares ONE WebView2 environment: same data directory and identical browser args (harden()).
// Diagnostics: rotating log in %LOCALAPPDATA%\SolfallLauncher\logs\launcher.log (see mod diag).
// The remote game page has NO IPC access: capabilities only cover the local "main" window, and F11 in the
// game is handled natively (WebView2 AcceleratorKeyPressed), without injecting anything into the page.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use std::sync::{
    atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering},
    Mutex,
};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, State, Url, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent,
};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};
use tauri_plugin_updater::{Update, UpdaterExt};

/// Windows AppUserModelID: groups every window of this process (launcher, game, login popups) and the
/// installer's SOLFALL.lnk shortcuts under one taskbar button labelled "SOLFALL".
pub const AUMID: &str = "online.solfall.launcher";
/// Launcher manifest/news base (backend contract). Fixed at COMPILE time (CI / E2E kit):
/// `SOLFALL_LAUNCHER_BASE=https://<solfall-domain>/launcher`. Placeholder until Solfall picks a host.
/// Runtime env override is honoured ONLY in debug builds.
const LAUNCHER_BASE: &str = match option_env!("SOLFALL_LAUNCHER_BASE") { Some(v) => v, None => "https://solfall.example/launcher" };
/// Hosts from which a manifest-provided updater endpoint is accepted. Anything else is ignored and the
/// compiled endpoints (tauri.conf.json → plugins.updater.endpoints) are used.
const ALLOWED_UPDATE_HOSTS: &[&str] = &["github.com"];
/// Allowed path prefix on github.com (stops a manifest from pointing at ANOTHER GitHub repo).
const ALLOWED_GITHUB_PREFIX: &str = "/CrystalFVPM-DEV/SOLFALL-Launcher-by-CrystalFVPM/releases/";
const DEFAULT_GAME_URL: &str = "https://play.solfall.online";
const DISCORD_INVITE: &str = "https://discord.gg/scyet8grSR";
const WINDOW_TITLE: &str = "SOLFALL";
/// Remote news feed (schema v2). Fetched by Rust (no CORS preflight; GitHub raw rejects preflights), with ETag.
const NEWS_URL: &str = "https://raw.githubusercontent.com/CrystalFVPM-DEV/SOLFALL-Launcher-by-CrystalFVPM/main/content/news.json";

/// In-window navigation allowlist (game + Discord login + hCaptcha). Everything else opens in the
/// system browser. Google OAuth does NOT work embedded (disallowed_useragent), so it is not listed.
const ALLOWED_HOSTS: &[&str] = &["play.solfall.online", "discord.com", "discordapp.com", "hcaptcha.com"];

/// WebView2 browser args (shared by every webview of the process: same environment).
/// --autoplay-policy: the launcher theme may start without a click (the UI also retries on first gesture).
const WEBVIEW2_ARGS: &str = "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection,Translate,AutofillServerCommunication --autoplay-policy=no-user-gesture-required";

// ---------------------------------------------------------------- diagnostics log
/// `diag!(...)`: stdout + rotating file log (%LOCALAPPDATA%\SolfallLauncher\logs\launcher.log, 512 KB × 3 files).
/// Never logs secrets, cookies, or anything typed in the game.
macro_rules! diag { ($($t:tt)*) => { crate::diag::log(&format!($($t)*)) } }
mod diag {
    use std::io::Write;
    use std::path::PathBuf;
    use std::sync::Mutex;
    static FILE: Mutex<Option<std::fs::File>> = Mutex::new(None);
    static PATH: Mutex<Option<PathBuf>> = Mutex::new(None);
    const MAX: u64 = 512 * 1024;
    const KEEP: u32 = 3;
    pub fn dir(app: &tauri::AppHandle) -> Option<PathBuf> {
        #[cfg(windows)]
        if let Ok(l) = std::env::var("LOCALAPPDATA") { return Some(PathBuf::from(l).join("SolfallLauncher").join("logs")); }
        use tauri::Manager;
        app.path().app_local_data_dir().ok().map(|d| d.join("logs"))
    }
    fn rotate(p: &PathBuf) {
        if std::fs::metadata(p).map(|m| m.len() < MAX).unwrap_or(true) { return; }
        for i in (1..KEEP).rev() {
            let from = if i == 1 { p.clone() } else { p.with_extension(format!("{}.log", i - 1)) };
            let _ = std::fs::rename(&from, p.with_extension(format!("{i}.log")));
        }
    }
    fn open(p: &PathBuf) -> Option<std::fs::File> {
        std::fs::OpenOptions::new().create(true).append(true).open(p).ok()
    }
    pub fn init(app: &tauri::AppHandle) {
        let Some(d) = dir(app) else { return };
        if std::fs::create_dir_all(&d).is_err() { return; }
        let p = d.join("launcher.log");
        rotate(&p);
        *FILE.lock().unwrap() = open(&p);
        *PATH.lock().unwrap() = Some(p);
    }
    pub fn log(msg: &str) {
        println!("{msg}");
        let mut f = FILE.lock().unwrap();
        if let Some(file) = f.as_mut() {
            let _ = writeln!(file, "{} {}", ts(), msg);
            if file.metadata().map(|m| m.len() >= MAX).unwrap_or(false) {
                if let Some(p) = PATH.lock().unwrap().as_ref() { *f = None; rotate(p); *f = open(p); }
            }
        }
    }
    /// UTC ISO-8601 timestamp without extra crates.
    fn ts() -> String {
        let d = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default();
        let s = d.as_secs() as i64;
        let z = s.div_euclid(86400) + 719468;
        let era = z.div_euclid(146097);
        let doe = z - era * 146097;
        let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
        let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
        let mp = (5 * doy + 2) / 153;
        let day = doy - (153 * mp + 2) / 5 + 1;
        let m = if mp < 10 { mp + 3 } else { mp - 9 };
        let y = yoe + era * 400 + if m <= 2 { 1 } else { 0 };
        let r = s.rem_euclid(86400);
        format!("{y:04}-{m:02}-{day:02}T{:02}:{:02}:{:02}.{:03}Z", r / 3600, r % 3600 / 60, r % 60, d.subsec_millis())
    }
}

// ---------------------------------------------------------------- settings (JSON in the app config dir)
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
struct WinGeom { w: f64, h: f64, maximized: bool }
/// Defaults follow spec/settings/README.md + Product decisions (13-11-2026).
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(default)]
struct Settings {
    /// Mirror of the OS autostart entry (tauri-plugin-autostart, HKCU\...\Run). Read back from the OS.
    autostart: bool,
    /// With autostart: start hidden in the tray (autostart passes --minimised).
    start_minimized: bool,
    /// "quit" (default) | "tray"
    close_action: String,
    /// Game window starts full screen (F11 toggles).
    game_fullscreen: bool,
    /// After LAUNCH: "replace" (default, 0.2.1) → this window becomes the game (one webview, lowest RAM);
    /// "minimize" | "close" | "keep" | "tray" → the game opens in its own window.
    on_launch: String,
    /// Check + download launcher updates in the background at start-up.
    auto_update: bool,
    /// "1280x720" | "1440x900" | "1600x1000" | "1920x1080"
    window_size: String,
    remember_window: bool,
    window: Option<WinGeom>,
    /// "auto" (match Windows DPI) | "100" | "125" | "150"
    ui_scale: String,
    /// None = follow the OS (prefers-reduced-motion).
    reduce_motion: Option<bool>,
    /// Master volume 0–1 (spec default 0.8).
    volume: f64,
    /// Music on/off (spec default OFF) and its relative volume (default 0.6).
    music: bool,
    music_volume: f64,
    /// Settings format revision. Files without it (0.2.0) get the 0.2.1 default on_launch = "replace".
    #[serde(default)]
    rev: u32,
}
impl Settings {
    fn autostart_minimized_effective(&self) -> bool { self.start_minimized }
}
impl Default for Settings {
    fn default() -> Self {
        Settings {
            autostart: false, start_minimized: false, close_action: "quit".into(), game_fullscreen: false,
            on_launch: "replace".into(), auto_update: true, window_size: "1440x900".into(), remember_window: true,
            window: None, ui_scale: "auto".into(), reduce_motion: None, volume: 0.8, music: false, music_volume: 0.6, rev: SETTINGS_REV,
        }
    }
}
const SETTINGS_REV: u32 = 2;
fn settings_path(app: &AppHandle) -> Option<std::path::PathBuf> {
    app.path().app_config_dir().ok().map(|d| d.join("settings.json"))
}
fn load_settings(app: &AppHandle) -> Settings {
    settings_path(app)
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .map(sanitize)
        .unwrap_or_default()
}
fn unit(v: f64, d: f64) -> f64 { if v.is_finite() { v.clamp(0.0, 1.0) } else { d } }
fn sanitize(mut s: Settings) -> Settings {
    s.volume = unit(s.volume, 0.8);
    s.music_volume = unit(s.music_volume, 0.6);
    // 0.2.0 shipped on_launch = "minimize" (separate game window), which broke LAUNCH on Windows → reset once.
    if s.rev < 2 { s.on_launch = "replace".into(); s.rev = SETTINGS_REV; }
    if !matches!(s.on_launch.as_str(), "replace" | "minimize" | "close" | "keep" | "tray") { s.on_launch = "replace".into(); }
    if !matches!(s.close_action.as_str(), "quit" | "tray") { s.close_action = "quit".into(); }
    if parse_size(&s.window_size).is_none() { s.window_size = "1440x900".into(); }
    if !matches!(s.ui_scale.as_str(), "auto" | "100" | "125" | "150") { s.ui_scale = "auto".into(); }
    s
}
fn parse_size(v: &str) -> Option<(f64, f64)> {
    let (w, h) = v.split_once('x')?;
    let (w, h): (f64, f64) = (w.parse().ok()?, h.parse().ok()?);
    (w >= 1280.0 && h >= 720.0 && w <= 7680.0 && h <= 4320.0).then_some((w, h))
}
fn zoom_of(s: &Settings) -> f64 { match s.ui_scale.as_str() { "125" => 1.25, "150" => 1.5, _ => 1.0 } }
fn write_settings(app: &AppHandle, s: &Settings) -> Result<(), String> {
    let p = settings_path(app).ok_or("no config dir")?;
    if let Some(d) = p.parent() { std::fs::create_dir_all(d).map_err(|e| e.to_string())?; }
    std::fs::write(&p, serde_json::to_vec_pretty(s).unwrap()).map_err(|e| e.to_string())
}
#[tauri::command]
fn get_settings(app: AppHandle) -> Settings {
    use tauri_plugin_autostart::ManagerExt;
    let mut s = load_settings(&app);
    if let Ok(on) = app.autolaunch().is_enabled() { s.autostart = on; } // the OS is the source of truth
    s
}
/// Saves and APPLIES the settings (autostart entry, window size, UI zoom). Returns what was stored.
#[tauri::command]
fn set_settings(app: AppHandle, settings: Settings) -> Result<Settings, String> {
    use tauri_plugin_autostart::ManagerExt;
    let old = load_settings(&app);
    let mut s = sanitize(settings);
    s.window = old.window.clone(); // geometry is owned by Rust (saved on close)
    if s.autostart != app.autolaunch().is_enabled().unwrap_or(false) {
        let r = if s.autostart { app.autolaunch().enable() } else { app.autolaunch().disable() };
        if let Err(e) = r { diag!("[settings] autostart: {e}"); s.autostart = !s.autostart; }
    }
    if let Some(m) = app.get_webview_window("main") {
        if s.window_size != old.window_size && !m.is_maximized().unwrap_or(false) && !m.is_fullscreen().unwrap_or(false) {
            if let Some((w, h)) = parse_size(&s.window_size) { let _ = m.set_size(tauri::LogicalSize::new(w, h)); let _ = m.center(); }
        }
        if s.ui_scale != old.ui_scale { let _ = m.set_zoom(zoom_of(&s)); }
    }
    write_settings(&app, &s)?;
    Ok(s)
}
/// Remember size & maximised (main window, logical px), saved when the launcher window closes/hides.
fn save_geometry(app: &AppHandle) {
    let Some(m) = app.get_webview_window("main") else { return };
    let mut s = load_settings(app);
    if !s.remember_window { return; }
    let maximized = m.is_maximized().unwrap_or(false);
    let sf = m.scale_factor().unwrap_or(1.0);
    let g = match (maximized || m.is_fullscreen().unwrap_or(false), m.inner_size()) {
        (false, Ok(sz)) => { let l = sz.to_logical::<f64>(sf); WinGeom { w: l.width.max(1280.0), h: l.height.max(720.0), maximized } }
        _ => WinGeom { maximized, ..s.window.clone().unwrap_or(WinGeom { w: 1440.0, h: 900.0, maximized }) },
    };
    if s.window.as_ref() != Some(&g) { s.window = Some(g); let _ = write_settings(app, &s); }
}

// ---------------------------------------------------------------- state
#[derive(Default)]
struct AppState {
    pending: Mutex<Option<Update>>,
    bytes: Mutex<Option<Vec<u8>>>,
    downloading: AtomicBool,
    error: Mutex<Option<String>>,
    in_game: AtomicBool,
}
static POPUP_SEQ: AtomicUsize = AtomicUsize::new(0);

fn host_allowed(host: &str) -> bool {
    ALLOWED_HOSTS.iter().any(|a| host == *a || host.ends_with(&format!(".{a}")))
}
/// May this URL load INSIDE a window?
fn nav_allowed(u: &Url) -> bool {
    match u.scheme() {
        // local launcher UI (Linux/macOS: tauri://localhost; Windows: http(s)://tauri.localhost)
        "tauri" => true,
        "http" | "https" if u.host_str() == Some("tauri.localhost") => true,
        "about" | "data" | "blob" => true,
        "https" => u.host_str().map(host_allowed).unwrap_or(false),
        _ => false,
    }
}
fn open_external(u: &Url) {
    if matches!(u.scheme(), "https" | "http" | "mailto") {
        diag!("[open] system browser: {u}");
        let _ = tauri_plugin_opener::open_url(u.as_str(), None::<&str>);
    }
}

#[derive(Serialize)]
struct LauncherInfo {
    version: String,
    launcher_base: String,
    platform: &'static str,
    default_game_url: &'static str,
    discord_invite: &'static str,
    demo_state: Option<String>,
    demo_view: Option<String>,
    updater_endpoints: Vec<String>,
    /// Debug UI (About → build row): debug builds or SOLFALL_DEBUG=1. Never shown by default.
    debug_ui: bool,
    /// minisign key id of the embedded updater pubkey (diagnostics / debug About only).
    pubkey_id: Option<String>,
    logs_dir: Option<String>,
}
#[tauri::command]
fn launcher_info(app: AppHandle) -> LauncherInfo {
    LauncherInfo {
        version: app.package_info().version.to_string(),
        launcher_base: if cfg!(debug_assertions) {
            std::env::var("SOLFALL_LAUNCHER_BASE").unwrap_or_else(|_| LAUNCHER_BASE.into()) // dev only
        } else {
            LAUNCHER_BASE.into()
        },
        platform: if cfg!(windows) { "windows" } else { std::env::consts::OS },
        default_game_url: DEFAULT_GAME_URL,
        discord_invite: DISCORD_INVITE,
        // Screenshots only, when a state cannot be produced for real.
        demo_state: std::env::var("SOLFALL_DEMO_STATE").ok(),
        demo_view: std::env::var("SOLFALL_DEMO_VIEW").ok(),
        updater_endpoints: compiled_endpoints(&app).iter().map(|u| u.to_string()).collect(),
        debug_ui: cfg!(debug_assertions) || std::env::var("SOLFALL_DEBUG").map(|v| v == "1").unwrap_or(false),
        pubkey_id: pubkey_id(&app),
        logs_dir: diag::dir(&app).map(|d| d.display().to_string()),
    }
}

/// UI → diagnostic log (nothing sensitive is ever logged).
#[tauri::command]
fn ui_log(msg: String) { diag!("[ui] {}", msg.chars().take(200).collect::<String>()); }
/// Key id of the embedded updater pubkey (base64 of "untrusted comment: minisign public key: <ID>\n…").
fn pubkey_id(app: &AppHandle) -> Option<String> {
    let k = app.config().plugins.0.get("updater")?.get("pubkey")?.as_str()?.to_string();
    let txt = String::from_utf8(b64(&k)?).ok()?;
    txt.lines().next()?.rsplit(": ").next().map(|s| s.trim().to_string())
}
fn b64(s: &str) -> Option<Vec<u8>> {
    let mut out = Vec::new(); let (mut acc, mut n) = (0u32, 0u32);
    for c in s.bytes() {
        let v = match c { b'A'..=b'Z' => c - b'A', b'a'..=b'z' => c - b'a' + 26, b'0'..=b'9' => c - b'0' + 52, b'+' => 62, b'/' => 63, b'=' | b'\n' | b'\r' => continue, _ => return None } as u32;
        acc = (acc << 6) | v; n += 6;
        if n >= 8 { n -= 8; out.push((acc >> n) as u8); acc &= (1 << n) - 1; }
    }
    Some(out)
}
/// Settings → "Open logs folder".
#[tauri::command]
fn open_logs(app: AppHandle) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let d = diag::dir(&app).ok_or("no logs dir")?;
    let _ = std::fs::create_dir_all(&d);
    diag!("[ui] open logs folder {}", d.display());
    app.opener().open_path(d.display().to_string(), None::<&str>).map_err(|e| e.to_string())
}

// ---------------------------------------------------------------- news (remote feed, ETag)
#[derive(Serialize)]
struct NewsResponse { status: u16, etag: Option<String>, body: Option<String> }
/// GET NEWS_URL (fixed: no arbitrary URL from the page) with If-None-Match. Short timeouts; max 512 KB.
/// The UI validates the JSON and falls back to its cache, then to the bundled feed.
#[tauri::command]
async fn fetch_news(etag: Option<String>) -> Result<NewsResponse, String> {
    let client = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(3))
        .timeout(std::time::Duration::from_secs(5))
        .user_agent(concat!("SolfallLauncher/", env!("CARGO_PKG_VERSION")))
        .build().map_err(|e| e.to_string())?;
    let mut rq = client.get(NEWS_URL).header("Accept", "application/json");
    if let Some(e) = etag.filter(|e| e.len() < 200 && e.is_ascii()) { rq = rq.header("If-None-Match", e); }
    let res = rq.send().await.map_err(|e| { diag!("[news] fetch failed: {e}"); e.to_string() })?;
    let status = res.status().as_u16();
    let etag = res.headers().get("etag").and_then(|v| v.to_str().ok()).map(String::from);
    diag!("[news] GET {NEWS_URL} -> {status}");
    if status != 200 { return Ok(NewsResponse { status, etag, body: None }); }
    let bytes = res.bytes().await.map_err(|e| e.to_string())?;
    if bytes.len() > 512 * 1024 { return Err("news.json too large".into()); }
    Ok(NewsResponse { status, etag, body: Some(String::from_utf8_lossy(&bytes).into_owned()) })
}

// ---------------------------------------------------------------- updates
#[derive(Serialize)]
struct UpdateInfo {
    available: bool,
    current: String,
    version: Option<String>,
    notes: Option<String>,
    notes_url: Option<String>,
    size: Option<u64>,
}
/// Backend contract v2 extras in latest.json: `notes_url` (root) and `size` (per platform).
fn raw_extras(raw: &serde_json::Value) -> (Option<String>, Option<u64>) {
    let notes_url = raw.get("notes_url").and_then(|v| v.as_str()).map(String::from);
    let keys: &[&str] = if cfg!(windows) { &["windows-x86_64-nsis", "windows-x86_64"] } else { &["linux-x86_64-appimage", "linux-x86_64"] };
    let size = keys.iter().find_map(|k| raw.get("platforms")?.get(*k)?.get("size")?.as_u64());
    (notes_url, size)
}
fn allowed_override(raw: &str) -> Option<Url> {
    let u: Url = raw.parse().ok()?;
    let host = u.host_str()?;
    // E2E kits only: compiled with SOLFALL_E2E_ALLOW_LOCALHOST=1 (never in a public build).
    let local_ok = option_env!("SOLFALL_E2E_ALLOW_LOCALHOST").is_some()
        && u.scheme() == "http" && (host == "127.0.0.1" || host == "localhost");
    if local_ok { return Some(u); }
    if u.scheme() != "https" || !ALLOWED_UPDATE_HOSTS.contains(&host) { return None; }
    if host == "github.com" && !u.path().starts_with(ALLOWED_GITHUB_PREFIX) { return None; }
    Some(u)
}
/// Compiled endpoints (tauri.conf.json + any --config overlay), used as fallback.
fn compiled_endpoints(app: &AppHandle) -> Vec<Url> {
    app.config().plugins.0.get("updater")
        .and_then(|u| u.get("endpoints")).and_then(|e| e.as_array())
        .map(|a| a.iter().filter_map(|v| v.as_str()?.parse().ok()).collect())
        .unwrap_or_default()
}
/// Checks latest.json. ALWAYS runs (with or without manifest). Order: manifest endpoint (only if it passes the
/// allowlist) → compiled endpoints. Debug builds also accept env SOLFALL_UPDATE_ENDPOINT.
#[tauri::command]
async fn check_update(app: AppHandle, state: State<'_, AppState>, endpoint: Option<String>) -> Result<UpdateInfo, String> {
    let mut endpoint = endpoint.filter(|s| !s.is_empty());
    if cfg!(debug_assertions) { if let Ok(e) = std::env::var("SOLFALL_UPDATE_ENDPOINT") { endpoint = Some(e); } }
    let mut b = app.updater_builder(); // default: compiled endpoints
    match endpoint.as_deref().map(|e| (e, allowed_override(e))) {
        Some((_, Some(url))) => {
            let mut eps = vec![url];
            for c in compiled_endpoints(&app) { if !eps.contains(&c) { eps.push(c); } }
            b = b.endpoints(eps).map_err(|e| e.to_string())?;
        }
        Some((raw, None)) => diag!("[updater] manifest endpoint ignored (not allowed): {raw}"),
        None => {}
    }
    let updater = b
        .header("X-Launcher-Version", app.package_info().version.to_string()).map_err(|e| e.to_string())?
        .header("X-Launcher-Platform", "windows-tauri").map_err(|e| e.to_string())?
        .build().map_err(|e| e.to_string())?;
    let current = app.package_info().version.to_string();
    match updater.check().await.map_err(|e| e.to_string())? {
        Some(u) => {
            let (notes_url, size) = raw_extras(&u.raw_json);
            if let Some(sz) = size { PROGRESS.total.store(sz, Ordering::SeqCst); }
            let info = UpdateInfo { available: true, current, version: Some(u.version.clone()), notes: u.body.clone(), notes_url, size };
            *state.pending.lock().unwrap() = Some(u);
            Ok(info)
        }
        None => Ok(UpdateInfo { available: false, current, version: None, notes: None, notes_url: None, size: None }),
    }
}
/// Background download. The minisign signature is verified inside download() against the pubkey
/// compiled from tauri.conf.json; on mismatch it fails and nothing is kept.
#[tauri::command]
async fn download_update(state: State<'_, AppState>) -> Result<(), String> {
    let upd = state.pending.lock().unwrap().clone().ok_or("no pending update")?;
    if state.downloading.swap(true, Ordering::SeqCst) { return Ok(()); }
    PROGRESS.done.store(0, Ordering::SeqCst);
    *state.error.lock().unwrap() = None;
    let res = upd.download(|chunk, total| PROGRESS.with_chunk(chunk as u64, total), || {}).await;
    state.downloading.store(false, Ordering::SeqCst);
    match res {
        Ok(bytes) => {
            diag!("[updater] download complete: {} bytes, signature verified OK (minisign)", bytes.len());
            *state.bytes.lock().unwrap() = Some(bytes);
            Ok(())
        }
        Err(e) => {
            diag!("[updater] ERROR in download/verification: {e}");
            *state.error.lock().unwrap() = Some(e.to_string());
            Err(e.to_string())
        }
    }
}
struct Progress { done: AtomicU64, total: AtomicU64 }
impl Progress {
    fn with_chunk(&self, c: u64, total: Option<u64>) {
        self.done.fetch_add(c, Ordering::SeqCst);
        if let Some(t) = total { self.total.store(t, Ordering::SeqCst); }
    }
}
static PROGRESS: Progress = Progress { done: AtomicU64::new(0), total: AtomicU64::new(0) };

#[derive(Serialize)]
struct UpdateStatus { downloaded: u64, total: u64, ready: bool, downloading: bool, error: Option<String> }
#[tauri::command]
fn update_status(state: State<'_, AppState>) -> UpdateStatus {
    UpdateStatus {
        downloaded: PROGRESS.done.load(Ordering::SeqCst),
        total: PROGRESS.total.load(Ordering::SeqCst),
        ready: state.bytes.lock().unwrap().is_some(),
        downloading: state.downloading.load(Ordering::SeqCst),
        error: state.error.lock().unwrap().clone(),
    }
}
fn do_install(app: &AppHandle) -> Result<(), String> {
    let state = app.state::<AppState>();
    let upd = state.pending.lock().unwrap().clone().ok_or("no pending update")?;
    let bytes = state.bytes.lock().unwrap().take().ok_or("update not downloaded")?;
    diag!("[updater] installing {} ...", upd.version);
    upd.install(bytes).map_err(|e| e.to_string())?;
    diag!("[updater] installed; restarting");
    app.restart();
}
/// "Restart to apply" (after the grace period of the blocking update state).
#[tauri::command]
fn apply_update(app: AppHandle) -> Result<(), String> { do_install(&app) }

// ---------------------------------------------------------------- windows
/// Common hardening + behaviour for every webview window we create (main, game, login popups).
/// The WebView2 user-data folder (= Tauri's default, made explicit so EVERY webview is provably identical).
/// WebView2 requires identical environment options per user-data folder; a mismatch fails the 2nd webview.
fn data_dir(app: &AppHandle) -> Option<std::path::PathBuf> { app.path().app_local_data_dir().ok() }
fn harden<'a>(app: &AppHandle, mut b: WebviewWindowBuilder<'a, tauri::Wry, AppHandle>) -> WebviewWindowBuilder<'a, tauri::Wry, AppHandle> {
    let app2 = app.clone();
    if let Some(d) = data_dir(app) { b = b.data_directory(d); }
    b.additional_browser_args(WEBVIEW2_ARGS)
        .on_page_load(|w, p| {
            let ev = match p.event() { tauri::webview::PageLoadEvent::Started => "started", tauri::webview::PageLoadEvent::Finished => "finished" };
            diag!("[page] {} {ev} {}", w.label(), p.url());
        })
        .background_color(tauri::window::Color(11, 6, 3, 255))
        .on_navigation(|u| {
            if nav_allowed(u) { true } else { diag!("[nav] external -> system browser: {u}"); open_external(u); false }
        })
        .on_new_window(move |u, features| {
            // Popups (e.g. OAuth): only allowlisted hosts, created as OUR window so they share the
            // process (AUMID / taskbar group), the allowlist and F11. Anything else → system browser.
            if u.scheme() == "https" && u.host_str().map(host_allowed).unwrap_or(false) {
                let label = format!("popup-{}", POPUP_SEQ.fetch_add(1, Ordering::SeqCst));
                let pb = WebviewWindowBuilder::new(&app2, &label, WebviewUrl::External("about:blank".parse().unwrap()))
                    .window_features(features)
                    .title(WINDOW_TITLE)
                    .on_document_title_changed(|w, t| { let _ = w.set_title(&t); });
                match harden(&app2, pb).build() {
                    Ok(w) => { after_build(&w); tauri::webview::NewWindowResponse::Create { window: w } }
                    Err(e) => { diag!("popup: {e}"); tauri::webview::NewWindowResponse::Deny }
                }
            } else {
                open_external(&u);
                tauri::webview::NewWindowResponse::Deny
            }
        })
}
/// Per-window native setup after build.
fn after_build(w: &WebviewWindow) {
    #[cfg(windows)]
    {
        win2::set_window_aumid(w);
        win2::tune(w);
        win2::f11_fullscreen(w);
        win2::watch(w);
    }
    let _ = w;
}

fn toggle_fullscreen_of(w: &tauri::Window) {
    let fs = w.is_fullscreen().unwrap_or(false);
    let _ = w.set_fullscreen(!fs);
}
#[tauri::command]
fn win_toggle_fullscreen(window: tauri::Window) { toggle_fullscreen_of(&window); }
#[tauri::command]
fn win_toggle_maximize(window: tauri::Window) {
    if window.is_fullscreen().unwrap_or(false) { let _ = window.set_fullscreen(false); return; }
    if window.is_maximized().unwrap_or(false) { let _ = window.unmaximize(); } else { let _ = window.maximize(); }
}
#[derive(Serialize)]
struct WinState { maximized: bool, fullscreen: bool }
#[tauri::command]
fn win_state(window: tauri::Window) -> WinState {
    WinState { maximized: window.is_maximized().unwrap_or(false), fullscreen: window.is_fullscreen().unwrap_or(false) }
}
#[tauri::command]
fn win_minimize(window: tauri::Window) { let _ = window.minimize(); }
#[tauri::command]
fn win_close(window: tauri::Window) { let _ = window.close(); }

/// Hosts the launcher UI may open in the system browser (links can come from the REMOTE news feed, so no
/// arbitrary schemes or hosts). Subdomains included.
const OPEN_HOSTS: &[&str] = &["solfall.online", "discord.gg", "discord.com", "patreon.com", "github.com"];
fn open_allowed(u: &Url) -> bool {
    u.scheme() == "https" && u.username().is_empty() && u.password().is_none()
        && u.host_str().map(|h| OPEN_HOSTS.iter().any(|a| h == *a || h.ends_with(&format!(".{a}")))).unwrap_or(false)
}
#[tauri::command]
fn open_link(url: String) -> Result<(), String> {
    let u: Url = url.parse().map_err(|e| format!("{e}"))?;
    if !open_allowed(&u) { diag!("[open] refused (not https / not an allowed host): {u}"); return Err("link not allowed".into()); }
    open_external(&u);
    Ok(())
}

fn ui_call(app: &AppHandle, f: &str) {
    if let Some(m) = app.get_webview_window("main") {
        let local = m.url().map(|u| nav_allowed(&u) && !u.host_str().map(host_allowed).unwrap_or(false)).unwrap_or(false);
        if local { let _ = m.eval(format!("window.__solfall && window.__solfall.{f} && window.__solfall.{f}()")); }
    }
}
fn show_launcher(app: &AppHandle) {
    if let Some(m) = app.get_webview_window("main") {
        let _ = m.show(); let _ = m.unminimize(); let _ = m.set_focus();
    }
    if let Some(t) = app.remove_tray_by_id("solfall-tray") { drop(t); }
}
fn make_tray(app: &AppHandle) -> tauri::Result<()> {
    if app.tray_by_id("solfall-tray").is_some() { return Ok(()); }
    let show = MenuItem::with_id(app, "show", "Open launcher", true, None::<&str>)?;
    let launch = MenuItem::with_id(app, "launch", "Launch Solfall", true, None::<&str>)?;
    let check = MenuItem::with_id(app, "check", "Check for updates", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &launch, &check, &quit])?;
    let mut tb = TrayIconBuilder::with_id("solfall-tray").tooltip("SOLFALL").menu(&menu).show_menu_on_left_click(false)
        .on_menu_event(|app, ev| match ev.id().as_ref() {
            "show" => show_launcher(app),
            // Local launcher page only (never the game page): calls hooks exposed by app.js.
            "launch" => { show_launcher(app); ui_call(app, "launch"); }
            "check" => { show_launcher(app); ui_call(app, "checkUpdates"); }
            "quit" => { save_geometry(app); app.exit(0) }
            _ => {}
        })
        .on_tray_icon_event(|t, ev| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = ev { show_launcher(t.app_handle()); }
        });
    if let Some(i) = app.default_window_icon() { tb = tb.icon(i.clone()); }
    tb.build(app)?;
    Ok(())
}

/// LAUNCH. The game is always a TOP-LEVEL document (no iframe; the site sends X-Frame-Options: DENY).
/// "replace": this window navigates to the game and the launcher UI is freed (lowest RAM).
/// "minimize" (default) / "keep" / "tray" / "close": the game opens in its own "game" window and the launcher
/// is minimised / left as is / hidden to the tray / closed. Closing the game window brings the launcher back.
/// ASYNC on purpose: on Windows, building a WebviewWindow inside a SYNCHRONOUS command deadlocks (Tauri docs,
/// WebviewWindowBuilder::new "Known issues") — the 0.2.0 black game window.
#[tauri::command]
async fn launch_game(app: AppHandle, url: String) -> Result<String, String> {
    let u: Url = url.parse().map_err(|e| format!("invalid URL: {e}"))?;
    if u.scheme() != "https" || !u.host_str().map(host_allowed).unwrap_or(false) {
        return Err("game URL is not on the allowlist".into());
    }
    let s = load_settings(&app);
    let main = app.get_webview_window("main").ok_or("no window")?;
    app.state::<AppState>().in_game.store(true, Ordering::SeqCst);
    diag!("[launch] on_launch={} fullscreen={} -> {u}", s.on_launch, s.game_fullscreen);
    if s.on_launch == "replace" {
        save_geometry(&app);
        let _ = main.set_title(WINDOW_TITLE);
        let _ = main.set_decorations(true); // native frame + buttons while in the game
        let _ = main.set_zoom(1.0);
        if s.game_fullscreen { let _ = main.set_fullscreen(true); }
        main.navigate(u).map_err(|e| { diag!("[launch] navigate failed: {e}"); e.to_string() })?;
        return Ok("replace".into());
    }
    if let Some(g) = app.get_webview_window("game") { let _ = g.unminimize(); let _ = g.set_focus(); return Ok("focus".into()); }
    let (w, h) = parse_size(&s.window_size).unwrap_or((1440.0, 900.0));
    let b = WebviewWindowBuilder::new(&app, "game", WebviewUrl::External(u))
        .title(WINDOW_TITLE)
        .inner_size(w, h)
        .min_inner_size(1024.0, 640.0)
        .resizable(true)
        .maximized(main.is_maximized().unwrap_or(false))
        .fullscreen(s.game_fullscreen);
    let g = harden(&app, b).build().map_err(|e| { diag!("[launch] game window failed: {e}"); e.to_string() })?;
    after_build(&g);
    diag!("[launch] game window created");
    match s.on_launch.as_str() {
        "tray" => { make_tray(&app).map_err(|e| e.to_string())?; save_geometry(&app); let _ = main.hide(); }
        "close" => { save_geometry(&app); let _ = main.destroy(); }
        "keep" => {}
        _ => { let _ = main.minimize(); }
    }
    Ok(s.on_launch)
}

/// Hide the launcher to the tray (Close button = "To tray", start minimised, on-launch = tray).
fn hide_to_tray(app: &AppHandle) {
    if let Err(e) = make_tray(app) { diag!("tray: {e}"); return; }
    save_geometry(app);
    if let Some(m) = app.get_webview_window("main") { let _ = m.hide(); }
}

// ---------------------------------------------------------------- Windows-only (WebView2 / shell)
#[cfg(windows)]
mod win2 {
    use webview2_com::Microsoft::Web::WebView2::Win32::*;
    use webview2_com::AcceleratorKeyPressedEventHandler;
    use windows_core::Interface;

    /// Process-wide AppUserModelID. Must run before any window is created.
    pub fn set_process_aumid() {
        let w: Vec<u16> = super::AUMID.encode_utf16().chain(std::iter::once(0)).collect();
        unsafe {
            let _ = windows::Win32::UI::Shell::SetCurrentProcessExplicitAppUserModelID(windows_core::PCWSTR(w.as_ptr()));
        }
    }
    /// Same ID on the window itself (belt and braces for popups / the game window).
    pub fn set_window_aumid(w: &tauri::WebviewWindow) {
        use windows::Win32::Foundation::HWND;
        use windows::Win32::Storage::EnhancedStorage::PKEY_AppUserModel_ID;
        use windows::Win32::System::Com::StructuredStorage::PROPVARIANT;
        use windows::Win32::System::Variant::VT_LPWSTR;
        use windows::Win32::UI::Shell::PropertiesSystem::{IPropertyStore, SHGetPropertyStoreForWindow};
        let Ok(h) = w.hwnd() else { return };
        let mut wide: Vec<u16> = super::AUMID.encode_utf16().chain(std::iter::once(0)).collect();
        unsafe {
            if let Ok(store) = SHGetPropertyStoreForWindow::<IPropertyStore>(HWND(h.0)) {
                let mut pv = PROPVARIANT::default();
                (*pv.Anonymous.Anonymous).vt = VT_LPWSTR;
                (*pv.Anonymous.Anonymous).Anonymous.pwszVal = windows_core::PWSTR(wide.as_mut_ptr());
                let _ = store.SetValue(&PKEY_AppUserModel_ID, &pv);
                let _ = store.Commit();
                std::mem::forget(pv); // buffer is ours (Vec), PropVariantClear must not free it
            }
        }
        drop(wide);
    }
    /// No DevTools (release), no status bar, no password/autofill saving.
    pub fn tune(w: &tauri::WebviewWindow) {
        let _ = w.with_webview(|wv| unsafe {
            if let Ok(core) = wv.controller().CoreWebView2() {
                if let Ok(st) = core.Settings() {
                    #[cfg(not(debug_assertions))]
                    let _ = st.SetAreDevToolsEnabled(false);
                    let _ = st.SetIsStatusBarEnabled(false);
                    if let Ok(st4) = st.cast::<ICoreWebView2Settings4>() {
                        let _ = st4.SetIsPasswordAutosaveEnabled(false);
                        let _ = st4.SetIsGeneralAutofillEnabled(false);
                    }
                }
            }
        });
    }
    /// F11 → true fullscreen, handled NATIVELY on the WebView2 controller (AcceleratorKeyPressed):
    /// no script is injected into the game page and the remote origin gets no IPC permission.
    pub fn f11_fullscreen(w: &tauri::WebviewWindow) {
        let win = w.as_ref().window();
        let _ = w.with_webview(move |wv| unsafe {
            let ctl = wv.controller();
            let win = win.clone();
            let handler = AcceleratorKeyPressedEventHandler::create(Box::new(move |_, args| {
                if let Some(a) = args {
                    let mut vk = 0u32; let mut kind = COREWEBVIEW2_KEY_EVENT_KIND_KEY_UP;
                    let _ = a.VirtualKey(&mut vk); let _ = a.KeyEventKind(&mut kind);
                    if vk == 0x7A /* VK_F11 */ {
                        let _ = a.SetHandled(true);
                        if kind == COREWEBVIEW2_KEY_EVENT_KIND_KEY_DOWN { super::toggle_fullscreen_of(&win); }
                    }
                }
                Ok(())
            }));
            let mut token = 0i64;
            let _ = ctl.add_AcceleratorKeyPressed(&handler, &mut token);
        });
    }
    /// Diagnostics: renderer/browser process failures and failed navigations → log.
    pub fn watch(w: &tauri::WebviewWindow) {
        let label = w.label().to_string();
        let _ = w.with_webview(move |wv| unsafe {
            let Ok(core) = wv.controller().CoreWebView2() else { return };
            let l1 = label.clone();
            let pf = webview2_com::ProcessFailedEventHandler::create(Box::new(move |_, args| {
                if let Some(a) = args {
                    let mut kind = COREWEBVIEW2_PROCESS_FAILED_KIND(0);
                    let _ = a.ProcessFailedKind(&mut kind);
                    let (mut reason, mut code) = (COREWEBVIEW2_PROCESS_FAILED_REASON(0), 0i32);
                    if let Ok(a2) = a.cast::<ICoreWebView2ProcessFailedEventArgs2>() { let _ = a2.Reason(&mut reason); let _ = a2.ExitCode(&mut code); }
                    super::diag::log(&format!("[webview2] {l1} PROCESS FAILED kind={} reason={} exit={code}", kind.0, reason.0));
                }
                Ok(())
            }));
            let mut t = 0i64;
            let _ = core.add_ProcessFailed(&pf, &mut t);
            let l2 = label.clone();
            let nc = webview2_com::NavigationCompletedEventHandler::create(Box::new(move |_, args| {
                if let Some(a) = args {
                    let mut ok = windows::core::BOOL::default();
                    let _ = a.IsSuccess(&mut ok);
                    if !ok.as_bool() {
                        let mut st = COREWEBVIEW2_WEB_ERROR_STATUS(0);
                        let _ = a.WebErrorStatus(&mut st);
                        super::diag::log(&format!("[webview2] {l2} navigation FAILED web_error_status={}", st.0));
                    }
                }
                Ok(())
            }));
            let mut t2 = 0i64;
            let _ = core.add_NavigationCompleted(&nc, &mut t2);
        });
    }
    /// MemoryUsageTargetLevel Low while minimised, Normal when restored.
    pub fn set_memory_low(w: &tauri::WebviewWindow, low: bool) {
        let _ = w.with_webview(move |wv| unsafe {
            if let Ok(core) = wv.controller().CoreWebView2() {
                if let Ok(c19) = core.cast::<ICoreWebView2_19>() {
                    let lvl = if low { COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW } else { COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL };
                    let _ = c19.SetMemoryUsageTargetLevel(lvl);
                }
            }
        });
    }
}

fn offer_restart_on_close(app: &AppHandle) -> bool {
    let st = app.state::<AppState>();
    if !(st.in_game.load(Ordering::SeqCst) && st.bytes.lock().unwrap().is_some()) { return false; }
    let ver = st.pending.lock().unwrap().as_ref().map(|u| u.version.clone()).unwrap_or_default();
    let app2 = app.clone();
    app.dialog()
        .message(format!("SOLFALL Launcher {ver} is ready. Restart to apply it now?"))
        .title("SOLFALL")
        .buttons(MessageDialogButtons::OkCancelCustom("Restart to apply".into(), "Later".into()))
        .show(move |yes| {
            if yes { if let Err(e) = do_install(&app2) { diag!("install: {e}"); app2.exit(0); } }
            else { app2.exit(0); } // the new version is applied on the next start
        });
    true
}

fn main() {
    // AUMID first, before any window exists (taskbar grouping "SOLFALL").
    #[cfg(windows)]
    win2::set_process_aumid();

    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, Some(vec!["--minimised"])))
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            launcher_info, ui_log, get_settings, set_settings, check_update, download_update, update_status,
            apply_update, launch_game, open_link, win_minimize, win_close, win_toggle_maximize,
            win_toggle_fullscreen, win_state, open_logs, fetch_news
        ])
        .setup(|app| {
            let h = app.handle().clone();
            diag::init(&h);
            let s = load_settings(&h);
            diag!("==== SOLFALL Launcher {} start ({} {}) args={:?}", h.package_info().version, std::env::consts::OS, std::env::consts::ARCH, std::env::args().skip(1).collect::<Vec<_>>());
            diag!("[env] webview runtime={}", tauri::webview_version().unwrap_or_else(|e| format!("unavailable: {e}")));
            diag!("[env] browser args=\"{WEBVIEW2_ARGS}\" (identical for every webview)");
            diag!("[env] data dir={} (WebView2 adds EBWebView\\)", data_dir(&h).map(|d| d.display().to_string()).unwrap_or("-".into()));
            diag!("[env] updater endpoints={:?} pubkey id={}", compiled_endpoints(&h).iter().map(|u| u.to_string()).collect::<Vec<_>>(), pubkey_id(&h).unwrap_or_else(|| "-".into()));
            diag!("[env] settings on_launch={} close_action={} rev={}", s.on_launch, s.close_action, s.rev);
            let (mut w0, mut h0) = parse_size(&s.window_size).unwrap_or((1440.0, 900.0));
            let mut maximized = false;
            if let (true, Some(g)) = (s.remember_window, s.window.as_ref()) { w0 = g.w; h0 = g.h; maximized = g.maximized; }
            let autostarted = std::env::args().any(|a| a == "--minimised");
            let hidden = autostarted && s.autostart_minimized_effective();
            let b = WebviewWindowBuilder::new(&h, "main", WebviewUrl::App("index.html".into()))
                .title(WINDOW_TITLE)
                .inner_size(w0, h0)
                .min_inner_size(1280.0, 720.0)
                .resizable(true)
                .maximized(maximized)
                .visible(!hidden)
                .shadow(true)
                .decorations(false);
            let w = harden(&h, b).build()?;
            after_build(&w);
            if zoom_of(&s) != 1.0 { let _ = w.set_zoom(zoom_of(&s)); }
            if hidden { make_tray(&h)?; diag!("[start] autostart → hidden in the tray"); }
            Ok(())
        })
        .on_window_event(|window, event| {
            let app = window.app_handle().clone();
            match event {
                WindowEvent::Focused(_) | WindowEvent::Resized(_) => {
                    let _low = window.is_minimized().unwrap_or(false);
                    #[cfg(windows)]
                    if let Some(w) = app.get_webview_window(window.label()) { win2::set_memory_low(&w, _low); }
                }
                // Product decision: if the game was launched with an update ready, offer the restart ON CLOSE.
                WindowEvent::CloseRequested { api, .. } => {
                    // Close button = "To tray": the launcher hides (updates keep downloading); Quit from the tray menu.
                    if window.label() == "main" && load_settings(&app).close_action == "tray" && !app.state::<AppState>().in_game.load(Ordering::SeqCst) {
                        api.prevent_close(); hide_to_tray(&app); return;
                    }
                    if window.label() == "main" { save_geometry(&app); }
                    let closes_game = window.label() == "game" || (window.label() == "main" && app.get_webview_window("game").is_none());
                    if closes_game && offer_restart_on_close(&app) { api.prevent_close(); }
                }
                WindowEvent::Destroyed => {
                    // Separate game window closed → bring the launcher back (minimised or in the tray).
                    if window.label() == "game" {
                        app.state::<AppState>().in_game.store(false, Ordering::SeqCst);
                        show_launcher(&app);
                    }
                }
                _ => {}
            }
        })
        .run(tauri::generate_context!())
        .expect("error while starting the SOLFALL Launcher");
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn open_allowlist() {
        let ok = |s: &str| open_allowed(&s.parse().unwrap());
        assert!(ok("https://discord.gg/scyet8grSR"));
        assert!(ok("https://www.patreon.com/cw/solfall"));
        assert!(ok("https://solfall.online/#/roadmap"));
        assert!(!ok("http://discord.gg/x"));
        assert!(!ok("file:///C:/Windows/System32/calc.exe"));
        assert!(!ok("https://evil.example/discord.gg"));
        assert!(!ok("https://discord.gg.evil.example/"));
        assert!(!ok("https://user@solfall.online/"));
    }
}
#[cfg(test)]
mod tests_b64 {
    #[test]
    fn decodes_minisign_pub() {
        let k = "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IEQ3OEYwMEE4NkNCMDQ0QzcKUldUSFJMQnNxQUNQMStNeGNJZWM5cm96K1dJajBrZFJ0WlBsY0lYcm12L25oSGpYU3ZhOXZiMVcK";
        let t = String::from_utf8(super::b64(k).unwrap()).unwrap();
        assert!(t.starts_with("untrusted comment: minisign public key: D78F00A86CB044C7\n"));
    }
}
