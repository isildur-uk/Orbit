// ORBIT desktop shell - native case-file services.
//
// Contract implemented here (see src/shim.js for the JS side):
//   caseFilePath() readCase() writeCase() acquireLock() releaseLock()
//   forceLock() lockHolder() onCaseChanged()
//
// THE CASE FILE IS AN EVIDENTIAL RECORD.
//   * Every write is atomic: temp file -> fsync -> rename over the target.
//     The case file is never truncated in place, so a crash mid-write cannot
//     leave a half-written case.
//   * The previous version is kept as <case>.prev on a best-effort basis.
//   * writeCase HARD-REJECTS if this process does not hold the lock.
//
// THE LOCK, AND HOW STALENESS IS DETECTED.
//   The lock is a real Windows file handle, not an advisory PID file:
//     <case>.lock is opened with dwShareMode = 0 (FILE_SHARE_NONE) and
//     FILE_FLAG_DELETE_ON_CLOSE, and the handle is held open for the lifetime
//     of the lock. A second process trying the same open gets
//     ERROR_SHARING_VIOLATION (32).
//   Staleness therefore needs no heuristics and there is no PID-reuse hazard:
//   when a holder crashes or is killed, Windows closes its handle and deletes
//   the file, so the very next exclusive open succeeds. A dead holder can never
//   deadlock the case. Human-readable holder details live in a SEPARATE file
//   (<case>.lock.json) which is only ever advisory - the handle is the truth.
//
// FORCED TAKEOVER.
//   You cannot rip an open handle out of a live process. forceLock() therefore
//   uses a cooperative yield: it writes <case>.lock.force, every ORBIT process
//   polls for it, and a live holder releases its handle and tells its webview it
//   has gone read-only. If the prior holder is dead its handle is already gone,
//   so the takeover is immediate. If a live holder is hung and never yields,
//   forceLock REJECTS after a timeout rather than pretending to have succeeded.

use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::Manager;

const POLL_MS: u64 = 750;
const SELF_WRITE_GRACE_MS: u64 = 1500;
const FORCE_TIMEOUT_MS: u64 = 4000;
const FORCE_STALE_MS: u128 = 15_000;
const RENAME_RETRIES: u32 = 6;

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

/// Shared ORBIT data directory. Deliberately NOT derived from the Tauri bundle
/// identifier: all five apps must land on the SAME directory so they see the
/// same case and contend for the same lock.
///   default:  %APPDATA%\ORBIT
///   override: ORBIT_DATA_DIR
pub fn orbit_dir() -> PathBuf {
    static CELL: OnceLock<PathBuf> = OnceLock::new();
    CELL.get_or_init(|| {
        if let Ok(d) = std::env::var("ORBIT_DATA_DIR") {
            if !d.trim().is_empty() {
                return PathBuf::from(d);
            }
        }
        let base = std::env::var("APPDATA")
            .or_else(|_| std::env::var("XDG_CONFIG_HOME"))
            .or_else(|_| std::env::var("HOME"))
            .unwrap_or_else(|_| ".".to_string());
        PathBuf::from(base).join("ORBIT")
    })
    .clone()
}

/// The case file.
///   default:  %APPDATA%\ORBIT\cases\current-case.json
///   override: ORBIT_CASE_FILE env var, or the CLI argument --case <path>
pub fn case_path() -> PathBuf {
    static CELL: OnceLock<PathBuf> = OnceLock::new();
    CELL.get_or_init(|| {
        if let Ok(p) = std::env::var("ORBIT_CASE_FILE") {
            if !p.trim().is_empty() {
                return PathBuf::from(p);
            }
        }
        let args: Vec<String> = std::env::args().collect();
        if let Some(i) = args.iter().position(|a| a == "--case") {
            if let Some(p) = args.get(i + 1) {
                if !p.trim().is_empty() {
                    return PathBuf::from(p);
                }
            }
        }
        orbit_dir().join("cases").join("current-case.json")
    })
    .clone()
}

fn prev_path() -> PathBuf {
    with_suffix(&case_path(), ".prev")
}
fn lock_path() -> PathBuf {
    with_suffix(&case_path(), ".lock")
}
fn lock_meta_path() -> PathBuf {
    with_suffix(&case_path(), ".lock.json")
}
fn force_path() -> PathBuf {
    with_suffix(&case_path(), ".lock.force")
}

fn with_suffix(p: &Path, suffix: &str) -> PathBuf {
    let mut s = p.as_os_str().to_os_string();
    s.push(suffix);
    PathBuf::from(s)
}

fn window_state_path() -> PathBuf {
    orbit_dir().join(format!("window-{}.json", crate::SURFACE_KEY))
}

/// WebView2 user-data folder. Shared across all five apps by default, so the
/// origin (http://orbit.localhost) - and therefore localStorage and IndexedDB -
/// is genuinely one store across ORBIT.exe and the four surface apps.
///   override: ORBIT_WEBVIEW_DATA_DIR, or ORBIT_WEBVIEW_ISOLATE=1 for per-app.
pub fn webview_data_dir() -> PathBuf {
    if let Ok(d) = std::env::var("ORBIT_WEBVIEW_DATA_DIR") {
        if !d.trim().is_empty() {
            return PathBuf::from(d);
        }
    }
    let base = orbit_dir().join("webview2");
    let isolate = std::env::var("ORBIT_WEBVIEW_ISOLATE")
        .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
        .unwrap_or(false);
    if isolate {
        base.join(crate::SURFACE_KEY)
    } else {
        base
    }
}

fn ensure_parent(p: &Path) -> Result<(), String> {
    if let Some(d) = p.parent() {
        fs::create_dir_all(d).map_err(|e| format!("E_MKDIR: {}: {}", d.display(), e))?;
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Time (no chrono - one less crate to break on first compile)
// ---------------------------------------------------------------------------

fn now_unix_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

fn mtime_ms(p: &Path) -> Option<u128> {
    fs::metadata(p)
        .ok()?
        .modified()
        .ok()?
        .duration_since(UNIX_EPOCH)
        .ok()
        .map(|d| d.as_millis())
}

fn iso_now() -> String {
    iso_from_unix_ms(now_unix_ms())
}

fn iso_from_unix_ms(ms: u128) -> String {
    let secs = (ms / 1000) as i64;
    let millis = (ms % 1000) as u32;
    let days = secs.div_euclid(86_400);
    let rem = secs.rem_euclid(86_400);
    let (y, m, d) = civil_from_days(days);
    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}.{:03}Z",
        y,
        m,
        d,
        rem / 3600,
        (rem % 3600) / 60,
        rem % 60,
        millis
    )
}

// Howard Hinnant's civil_from_days, proleptic Gregorian.
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = (if z >= 0 { z } else { z - 146_096 }) / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = (if mp < 10 { mp + 3 } else { mp - 9 }) as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}

fn hostname() -> String {
    std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .unwrap_or_else(|_| "unknown".to_string())
}

// ---------------------------------------------------------------------------
// Exclusive lock file
// ---------------------------------------------------------------------------

#[cfg(windows)]
fn open_lock_exclusive(p: &Path) -> std::io::Result<File> {
    use std::os::windows::fs::OpenOptionsExt;
    const FILE_FLAG_DELETE_ON_CLOSE: u32 = 0x0400_0000;
    ensure_parent(p).ok();
    OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .share_mode(0)
        .custom_flags(FILE_FLAG_DELETE_ON_CLOSE)
        .open(p)
}

#[cfg(windows)]
fn open_lock_probe(p: &Path) -> std::io::Result<File> {
    use std::os::windows::fs::OpenOptionsExt;
    OpenOptions::new().read(true).write(true).share_mode(0).open(p)
}

// Non-Windows build exists only so the crate can be syntax-checked and unit
// tested off-target. It uses create_new as a crude advisory lock and does NOT
// give the crash-safe semantics documented above. Windows is the ship target.
#[cfg(not(windows))]
fn open_lock_exclusive(p: &Path) -> std::io::Result<File> {
    ensure_parent(p).ok();
    OpenOptions::new().read(true).write(true).create_new(true).open(p)
}

#[cfg(not(windows))]
fn open_lock_probe(p: &Path) -> std::io::Result<File> {
    // No share-mode exclusion off-Windows: an existing lock file is treated as
    // held. Syntax-check / unit-test path only.
    if p.exists() {
        Err(std::io::Error::from_raw_os_error(32))
    } else {
        OpenOptions::new().read(true).write(true).create_new(true).open(p)
    }
}

fn is_busy(e: &std::io::Error) -> bool {
    matches!(e.raw_os_error(), Some(32) | Some(33))
        || e.kind() == std::io::ErrorKind::PermissionDenied
        || e.kind() == std::io::ErrorKind::AlreadyExists
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Holder {
    pub app: String,
    pub pid: u32,
    #[serde(rename = "sinceISO")]
    pub since_iso: String,
    #[serde(default)]
    pub host: String,
}

fn write_lock_meta(h: &Holder) {
    let p = lock_meta_path();
    if ensure_parent(&p).is_err() {
        return;
    }
    if let Ok(s) = serde_json::to_string_pretty(h) {
        let _ = fs::write(&p, s);
    }
}

fn read_lock_meta() -> Option<Holder> {
    let raw = fs::read_to_string(lock_meta_path()).ok()?;
    serde_json::from_str(&raw).ok()
}

/// Who holds the lock right now, according to the OS. Returns None when the
/// lock is free - including the case where a crashed holder left metadata
/// behind, because the exclusive open succeeding IS the proof it is stale.
fn probe_holder() -> Option<Holder> {
    let p = lock_path();
    if !p.exists() {
        let _ = fs::remove_file(lock_meta_path());
        return None;
    }
    match open_lock_probe(&p) {
        Ok(_f) => {
            let _ = fs::remove_file(lock_meta_path());
            None
        }
        Err(ref e) if is_busy(e) => Some(read_lock_meta().unwrap_or(Holder {
            app: "unknown ORBIT process".to_string(),
            pid: 0,
            since_iso: String::new(),
            host: String::new(),
        })),
        Err(_) => None,
    }
}

fn self_holder() -> Holder {
    Holder {
        app: crate::PRODUCT_NAME.to_string(),
        pid: std::process::id(),
        since_iso: iso_now(),
        host: hostname(),
    }
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

struct LockHold {
    _file: File,
    meta: Holder,
}

#[derive(Default)]
struct Inner {
    lock: Option<LockHold>,
    last_self_write_ms: Option<u128>,
    last_self_write_at: Option<Instant>,
}

#[derive(Default)]
pub struct Native {
    inner: Mutex<Inner>,
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn case_file_path() -> String {
    case_path().to_string_lossy().to_string()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaseRead {
    pub json: String,
    pub mtime_ms: f64,
}

#[tauri::command]
pub fn read_case() -> Result<Option<CaseRead>, String> {
    let p = case_path();
    match fs::read(&p) {
        Ok(b) => {
            let json = String::from_utf8(b).map_err(|e| format!("E_CASE_NOT_UTF8: {}", e))?;
            Ok(Some(CaseRead {
                json,
                mtime_ms: mtime_ms(&p).unwrap_or(0) as f64,
            }))
        }
        Err(ref e) if e.kind() == std::io::ErrorKind::NotFound => {
            let prev = prev_path();
            match fs::read(&prev) {
                Ok(b) => {
                    let json = String::from_utf8(b).map_err(|e| format!("E_CASE_NOT_UTF8: {}", e))?;
                    Ok(Some(CaseRead {
                        json,
                        mtime_ms: mtime_ms(&prev).unwrap_or(0) as f64,
                    }))
                }
                Err(_) => Ok(None),
            }
        }
        Err(e) => Err(format!("E_READ: {}: {}", p.display(), e)),
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteRes {
    pub mtime_ms: f64,
}

#[tauri::command]
pub fn write_case(json: String, state: tauri::State<'_, Native>) -> Result<WriteRes, String> {
    {
        let g = state.inner.lock().map_err(|_| "E_STATE".to_string())?;
        if g.lock.is_none() {
            return Err(
                "E_NO_LOCK: this ORBIT window does not hold the case lock. Call acquireLock() (or forceLock()) before writeCase()."
                    .to_string(),
            );
        }
    }

    let p = case_path();
    ensure_parent(&p)?;
    let tmp = with_suffix(&p, &format!(".tmp-{}", std::process::id()));

    {
        let mut f = File::create(&tmp).map_err(|e| format!("E_TMP: {}: {}", tmp.display(), e))?;
        f.write_all(json.as_bytes())
            .map_err(|e| format!("E_WRITE: {}", e))?;
        f.sync_all().map_err(|e| format!("E_FSYNC: {}", e))?;
    }

    // Best-effort previous-version copy. Never allowed to block the save.
    if p.exists() {
        let _ = fs::copy(&p, prev_path());
    }

    rename_with_retry(&tmp, &p)?;

    let m = mtime_ms(&p).unwrap_or_else(now_unix_ms);
    {
        let mut g = state.inner.lock().map_err(|_| "E_STATE".to_string())?;
        g.last_self_write_ms = Some(m);
        g.last_self_write_at = Some(Instant::now());
    }
    Ok(WriteRes { mtime_ms: m as f64 })
}

// std::fs::rename maps to MoveFileEx(MOVEFILE_REPLACE_EXISTING) on Windows, which
// is the atomic same-volume replace we want. It can still fail transiently if an
// antivirus or the search indexer has the target open, hence the retry.
fn rename_with_retry(from: &Path, to: &Path) -> Result<(), String> {
    let mut last = String::new();
    for attempt in 0..RENAME_RETRIES {
        match fs::rename(from, to) {
            Ok(()) => return Ok(()),
            Err(e) => {
                last = e.to_string();
                std::thread::sleep(Duration::from_millis(25 * (attempt as u64 + 1)));
            }
        }
    }
    let _ = fs::remove_file(from);
    Err(format!(
        "E_REPLACE: could not replace {} after {} attempts: {}",
        to.display(),
        RENAME_RETRIES,
        last
    ))
}

#[derive(Serialize)]
pub struct AcquireRes {
    pub ok: bool,
    #[serde(rename = "heldBy", skip_serializing_if = "Option::is_none")]
    pub held_by: Option<Holder>,
}

#[tauri::command]
pub fn acquire_lock(state: tauri::State<'_, Native>) -> Result<AcquireRes, String> {
    let mut g = state.inner.lock().map_err(|_| "E_STATE".to_string())?;
    if g.lock.is_some() {
        return Ok(AcquireRes {
            ok: true,
            held_by: None,
        });
    }
    match open_lock_exclusive(&lock_path()) {
        Ok(f) => {
            let meta = self_holder();
            write_lock_meta(&meta);
            g.lock = Some(LockHold { _file: f, meta });
            Ok(AcquireRes {
                ok: true,
                held_by: None,
            })
        }
        Err(ref e) if is_busy(e) => Ok(AcquireRes {
            ok: false,
            held_by: probe_holder(),
        }),
        Err(e) => Err(format!("E_LOCK: {}: {}", lock_path().display(), e)),
    }
}

#[derive(Serialize)]
pub struct OkRes {
    pub ok: bool,
}

#[tauri::command]
pub fn release_lock(state: tauri::State<'_, Native>) -> Result<OkRes, String> {
    let mut g = state.inner.lock().map_err(|_| "E_STATE".to_string())?;
    if g.lock.take().is_some() {
        let _ = fs::remove_file(lock_meta_path());
    }
    Ok(OkRes { ok: true })
}

#[derive(Serialize)]
pub struct ForceRes {
    pub ok: bool,
    #[serde(rename = "tookFrom", skip_serializing_if = "Option::is_none")]
    pub took_from: Option<Holder>,
}

#[tauri::command]
pub fn force_lock(state: tauri::State<'_, Native>) -> Result<ForceRes, String> {
    {
        let g = state.inner.lock().map_err(|_| "E_STATE".to_string())?;
        if let Some(h) = g.lock.as_ref() {
            return Ok(ForceRes {
                ok: true,
                took_from: Some(h.meta.clone()),
            });
        }
    }

    let prior = probe_holder();
    write_force_request();

    let deadline = Instant::now() + Duration::from_millis(FORCE_TIMEOUT_MS);
    loop {
        {
            let mut g = state.inner.lock().map_err(|_| "E_STATE".to_string())?;
            match open_lock_exclusive(&lock_path()) {
                Ok(f) => {
                    let meta = self_holder();
                    write_lock_meta(&meta);
                    g.lock = Some(LockHold { _file: f, meta });
                    drop(g);
                    clear_force_request();
                    return Ok(ForceRes {
                        ok: true,
                        took_from: prior,
                    });
                }
                Err(ref e) if is_busy(e) => {}
                Err(e) => {
                    drop(g);
                    clear_force_request();
                    return Err(format!("E_LOCK: {}", e));
                }
            }
        }
        if Instant::now() >= deadline {
            break;
        }
        std::thread::sleep(Duration::from_millis(100));
    }

    clear_force_request();
    let who = match prior {
        Some(h) => format!("{} (pid {})", h.app, h.pid),
        None => "another process".to_string(),
    };
    Err(format!(
        "E_FORCE_TIMEOUT: {} still holds the case lock and did not yield within {} ms. It may be hung; close it and retry.",
        who, FORCE_TIMEOUT_MS
    ))
}

#[tauri::command]
pub fn lock_holder(state: tauri::State<'_, Native>) -> Result<Option<Holder>, String> {
    {
        let g = state.inner.lock().map_err(|_| "E_STATE".to_string())?;
        if let Some(h) = g.lock.as_ref() {
            return Ok(Some(h.meta.clone()));
        }
    }
    Ok(probe_holder())
}

fn write_force_request() {
    let p = force_path();
    if ensure_parent(&p).is_err() {
        return;
    }
    let body = json!({
        "requesterPid": std::process::id(),
        "app": crate::PRODUCT_NAME,
        "atMs": now_unix_ms() as f64,
        "atISO": iso_now(),
    });
    let _ = fs::write(&p, body.to_string());
}

fn clear_force_request() {
    let _ = fs::remove_file(force_path());
}

// ---------------------------------------------------------------------------
// Poller: case-file change detection + cooperative lock yield
// ---------------------------------------------------------------------------

pub fn start_poller(app: tauri::AppHandle) {
    std::thread::spawn(move || {
        let case = case_path();
        let mut last = mtime_ms(&case);
        loop {
            std::thread::sleep(Duration::from_millis(POLL_MS));
            let now = mtime_ms(&case);
            if now != last {
                last = now;
                if !was_self_write(&app, now) {
                    push(
                        &app,
                        "_emitCaseChanged",
                        json!({
                            "path": case.to_string_lossy(),
                            "mtimeMs": now.map(|v| v as f64),
                        }),
                    );
                }
            }
            check_force(&app);
        }
    });
}

fn was_self_write(app: &tauri::AppHandle, now: Option<u128>) -> bool {
    let st = app.state::<Native>();
    let g = match st.inner.lock() {
        Ok(g) => g,
        Err(_) => return false,
    };
    match (g.last_self_write_ms, g.last_self_write_at) {
        (Some(m), Some(t)) => {
            now == Some(m) || t.elapsed() < Duration::from_millis(SELF_WRITE_GRACE_MS)
        }
        _ => false,
    }
}

fn check_force(app: &tauri::AppHandle) {
    let fp = force_path();
    let raw = match fs::read_to_string(&fp) {
        Ok(r) => r,
        Err(_) => return,
    };
    let v: serde_json::Value = match serde_json::from_str(&raw) {
        Ok(v) => v,
        Err(_) => {
            let _ = fs::remove_file(&fp);
            return;
        }
    };
    let req_pid = v["requesterPid"].as_u64().unwrap_or(0) as u32;
    if req_pid == std::process::id() {
        return;
    }
    let at = v["atMs"].as_f64().unwrap_or(0.0) as u128;
    if now_unix_ms().saturating_sub(at) > FORCE_STALE_MS {
        let _ = fs::remove_file(&fp);
        return;
    }

    let yielded = {
        let st = app.state::<Native>();
        let mut g = match st.inner.lock() {
            Ok(g) => g,
            Err(_) => return,
        };
        if g.lock.take().is_some() {
            let _ = fs::remove_file(lock_meta_path());
            true
        } else {
            false
        }
    };

    if yielded {
        push(
            app,
            "_emitLockChanged",
            json!({
                "holder": serde_json::Value::Null,
                "reason": "yielded",
                "to": v["app"].clone(),
            }),
        );
    }
}

// Push into the page by evaluating a call on the shim. Deliberately NOT the
// Tauri event plugin: that would need a plugin permission in capabilities and
// couples us to the event JS API. serde_json does the escaping.
fn push(app: &tauri::AppHandle, method: &str, payload: serde_json::Value) {
    if let Some(w) = app.get_webview_window("main") {
        let js = format!(
            "try{{window.__ORBIT_NATIVE__&&window.__ORBIT_NATIVE__.{}({})}}catch(e){{}}",
            method, payload
        );
        let _ = w.eval(js.as_str());
    }
}

// ---------------------------------------------------------------------------
// Window state (hand-rolled: no extra crate, no plugin permission)
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize)]
pub struct WindowState {
    pub width: f64,
    pub height: f64,
    pub x: Option<f64>,
    pub y: Option<f64>,
    pub maximized: bool,
}

impl Default for WindowState {
    fn default() -> Self {
        Self {
            width: crate::WIN_WIDTH,
            height: crate::WIN_HEIGHT,
            x: None,
            y: None,
            maximized: false,
        }
    }
}

pub fn load_window_state() -> WindowState {
    let raw = match fs::read_to_string(window_state_path()) {
        Ok(r) => r,
        Err(_) => return WindowState::default(),
    };
    let mut s: WindowState = match serde_json::from_str(&raw) {
        Ok(s) => s,
        Err(_) => return WindowState::default(),
    };
    // Sanity clamp: a saved geometry from a monitor that is no longer attached
    // must not put the window somewhere the analyst cannot reach it.
    if !(s.width.is_finite() && s.height.is_finite()) {
        return WindowState::default();
    }
    s.width = s.width.max(crate::MIN_WIDTH).min(20_000.0);
    s.height = s.height.max(crate::MIN_HEIGHT).min(20_000.0);
    let ok_pos = |v: Option<f64>| match v {
        Some(n) if n.is_finite() && n > -64.0 && n < 16_000.0 => Some(n),
        _ => None,
    };
    let (x, y) = (ok_pos(s.x), ok_pos(s.y));
    if x.is_none() || y.is_none() {
        s.x = None;
        s.y = None;
    }
    s
}

pub fn save_window_state(win: &tauri::WebviewWindow) {
    let sf = win.scale_factor().unwrap_or(1.0);
    let sf = if sf.is_finite() && sf > 0.0 { sf } else { 1.0 };
    let maximized = win.is_maximized().unwrap_or(false);
    let mut st = WindowState {
        maximized,
        ..WindowState::default()
    };
    if !maximized {
        if let Ok(sz) = win.inner_size() {
            st.width = sz.width as f64 / sf;
            st.height = sz.height as f64 / sf;
        }
        if let Ok(pos) = win.outer_position() {
            st.x = Some(pos.x as f64 / sf);
            st.y = Some(pos.y as f64 / sf);
        }
    }
    let p = window_state_path();
    if ensure_parent(&p).is_err() {
        return;
    }
    if let Ok(s) = serde_json::to_string_pretty(&st) {
        let _ = fs::write(&p, s);
    }
}

/// Save geometry and drop the case lock when the analyst closes the window.
/// The lock would be released by the OS anyway when the process exits; doing it
/// explicitly means a sibling app can take over without waiting for teardown.
pub fn attach_window_hooks(win: &tauri::WebviewWindow) {
    let w = win.clone();
    win.on_window_event(move |ev| match ev {
        tauri::WindowEvent::CloseRequested { .. } | tauri::WindowEvent::Destroyed => {
            save_window_state(&w);
            let st = w.app_handle().state::<Native>();
            // The trailing semicolon is load-bearing. Without it the if-let is the
            // block's tail expression, so its temporary MutexGuard outlives `st`
            // and the borrow checker rejects it (E0597, 21 Aug 2026).
            if let Ok(mut g) = st.inner.lock() {
                if g.lock.take().is_some() {
                    let _ = fs::remove_file(lock_meta_path());
                }
            };
        }
        _ => {}
    });
}

/// Static facts about this build, injected before the payload runs.
pub fn info_script() -> String {
    let info = json!({
        "surface": crate::SURFACE_KEY,
        "app": crate::PRODUCT_NAME,
        "title": crate::APP_TITLE,
        "shellVersion": crate::APP_VERSION,
        "buildStamp": crate::PAYLOAD_STAMP,
        "payloadSource": crate::PAYLOAD_SOURCE,
        "payloadBytes": crate::PAYLOAD_RAW_LEN as f64,
        "placeholderPayload": crate::PAYLOAD_IS_PLACEHOLDER,
        "pid": std::process::id(),
        "dataDir": orbit_dir().to_string_lossy(),
        "caseFile": case_path().to_string_lossy(),
    });
    format!("window.__ORBIT_INFO__ = Object.freeze({});", info)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn iso_formats_known_instants() {
        assert_eq!(iso_from_unix_ms(0), "1970-01-01T00:00:00.000Z");
        assert_eq!(iso_from_unix_ms(1_000), "1970-01-01T00:00:01.000Z");
        // Cross-checked against Python datetime, including the 2000 leap day.
        assert_eq!(
            iso_from_unix_ms(1_787_315_696_789),
            "2026-08-21T12:34:56.789Z"
        );
        assert_eq!(iso_from_unix_ms(951_782_400_000), "2000-02-29T00:00:00.000Z");
    }

    #[test]
    fn suffix_paths_are_siblings() {
        let p = PathBuf::from("C:/x/current-case.json");
        assert!(with_suffix(&p, ".lock").ends_with("current-case.json.lock"));
    }
}
