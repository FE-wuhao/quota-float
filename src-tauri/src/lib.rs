mod codex;
mod models;
mod sub2api;

use std::{
    fs,
    io::Write,
    path::PathBuf,
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex,
    },
    time::{Duration, Instant},
};

use models::{ProviderSnapshot, QuotaSettings, QuotaSettingsView, WidgetPreferences};
use tauri::{
    menu::{CheckMenuItem, Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, LogicalSize, Manager, PhysicalPosition, Position, Size, State, WindowEvent,
};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};
use tauri_plugin_window_state::{Builder as WindowStateBuilder, StateFlags};

struct AppState {
    client: reqwest::Client,
    api_direct_client: reqwest::Client,
    api_system_client: reqwest::Client,
    preferences: Mutex<WidgetPreferences>,
    preferences_path: PathBuf,
    fetch_lock: tokio::sync::Mutex<()>,
    snapshot_cache: Mutex<Option<(Instant, Vec<ProviderSnapshot>)>>,
    quota_settings: Mutex<QuotaSettings>,
    quota_settings_path: PathBuf,
    scope_id: AtomicU64,
}

fn update_tray_quota(app: &AppHandle, snapshots: &[ProviderSnapshot]) {
    if let Some(balance) = snapshots.first().and_then(|snapshot| snapshot.balance.as_ref()) {
        if let Some(tray) = app.tray_by_id("main") {
            let amount = if balance.unit == "USD" { format!("${:.2}", balance.remaining) } else { format!("{:.2} {}", balance.remaining, balance.unit) };
            let scope = if balance.scope == "subscription" { "订阅" } else { "账户" };
            let _ = tray.set_title(Some(amount.clone()));
            let _ = tray.set_tooltip(Some(format!("当前 API Key 对应{scope}余额 {amount}")));
        }
        return;
    }
    let window = snapshots
        .first()
        .and_then(|snapshot| snapshot.primary_window.as_ref());
    if let Some(tray) = app.tray_by_id("main") {
        let title = window
            .map(|window| window.remaining_percent.round().clamp(0.0, 100.0) as u32)
            .map(|value| format!("{value}%"))
            .unwrap_or_else(|| "--%".to_string());
        let tooltip = window
            .map(|window| {
                let value = window.remaining_percent.round().clamp(0.0, 100.0) as u32;
                let label = if window.window_seconds.abs_diff(604_800) <= 60 {
                    "本周".to_string()
                } else if window.window_seconds > 0 && window.window_seconds % 3_600 == 0 {
                    format!("{} 小时", window.window_seconds / 3_600)
                } else {
                    "当前窗口".to_string()
                };
                let name = snapshots
                    .first()
                    .map(|s| s.display_name.as_str())
                    .unwrap_or("Quota Float");
                format!("{name} {label}额度剩余 {value}%")
            })
            .unwrap_or_else(|| "额度暂不可用；右键打开设置".to_string());
        let _ = tray.set_title(Some(title));
        let _ = tray.set_tooltip(Some(tooltip));
    }
}

async fn fetch_snapshots_uncached(state: &State<'_, AppState>) -> Vec<ProviderSnapshot> {
    let _guard = state.fetch_lock.lock().await;
    let values = fetch_current_source(state).await;
    if let Ok(mut cache) = state.snapshot_cache.lock() {
        *cache = Some((Instant::now(), values.clone()));
    }
    values
}

async fn fetch_current_source(state: &AppState) -> Vec<ProviderSnapshot> {
    let settings = state
        .quota_settings
        .lock()
        .map(|s| s.clone())
        .unwrap_or_default();
    let mut snapshot = if settings.source == "codex" {
        codex::fetch_snapshot(&state.client).await
    } else {
        sub2api::fetch_snapshot(api_client(state, &settings), &settings, None).await
    };
    snapshot.scope_id = state.scope_id.load(Ordering::SeqCst);
    vec![snapshot]
}

fn api_client<'a>(state: &'a AppState, settings: &QuotaSettings) -> &'a reqwest::Client {
    if settings.connection_mode == "system" { &state.api_system_client } else { &state.api_direct_client }
}

fn build_api_client(direct: bool) -> reqwest::Client {
    let builder = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(30))
        .redirect(reqwest::redirect::Policy::none())
        .user_agent(concat!("QuotaFloat/", env!("CARGO_PKG_VERSION")));
    let builder = if direct { builder.no_proxy() } else { builder };
    builder.build().expect("static API client configuration must be valid")
}

fn load_quota_settings(path: &PathBuf) -> QuotaSettings {
    [path.clone(), path.with_extension("json.bak")]
        .iter()
        .find_map(|candidate| {
            fs::read_to_string(candidate)
                .ok()
                .and_then(|raw| serde_json::from_str::<QuotaSettings>(&raw).ok())
                .and_then(|settings| sub2api::normalize_settings(settings).ok())
        })
        .unwrap_or_default()
}

#[tauri::command]
fn get_quota_settings(state: State<'_, AppState>) -> Result<QuotaSettingsView, String> {
    let settings = state
        .quota_settings
        .lock()
        .map_err(|_| "无法读取设置。".to_string())?
        .clone();
    let has_key = sub2api::load_key(&settings.base_url)?.is_some();
    Ok(QuotaSettingsView { settings, has_key })
}

fn resolve_settings_key(
    state: &AppState,
    settings: &QuotaSettings,
    key: &str,
) -> Result<Option<String>, String> {
    if settings.source == "codex" {
        return Ok(None);
    }
    let key = key.trim();
    if !key.is_empty() {
        if key.len() > 8192 || key.chars().any(char::is_whitespace) || !key.is_ascii() {
            return Err("API Key 格式无效，请检查是否粘贴了额外内容。".into());
        }
        return Ok(Some(key.to_string()));
    }
    let previous = state
        .quota_settings
        .lock()
        .map_err(|_| "无法读取设置。".to_string())?
        .clone();
    if previous.base_url != settings.base_url {
        return Err("更换服务地址时，请重新填写对应的 API Key。".into());
    }
    sub2api::load_key(&settings.base_url)?
        .map(Some)
        .ok_or_else(|| "请填写 API Key。".into())
}

#[tauri::command]
async fn check_quota_settings(
    settings: QuotaSettings,
    api_key: String,
    state: State<'_, AppState>,
) -> Result<ProviderSnapshot, String> {
    let settings = sub2api::normalize_settings(settings)?;
    let key = resolve_settings_key(&state, &settings, &api_key)?;
    Ok(if settings.source == "codex" {
        codex::fetch_snapshot(&state.client).await
    } else {
        sub2api::fetch_snapshot(api_client(&state, &settings), &settings, key).await
    })
}

#[tauri::command]
async fn save_quota_settings(
    settings: QuotaSettings,
    api_key: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<(), String> {
    let settings = sub2api::normalize_settings(settings)?;
    // Wait for existing reads before changing credentials and invalidating their cache.
    let _guard = state.fetch_lock.lock().await;
    let key = resolve_settings_key(&state, &settings, &api_key)?;
    let old_key = if settings.source == "sub2api" {
        sub2api::load_key(&settings.base_url)?
    } else {
        None
    };
    if let Some(key) = &key {
        sub2api::credential(&settings.base_url)?
            .set_password(key)
            .map_err(|_| "无法将 API Key 保存到系统凭据库。".to_string())?;
    }
    if let Err(error) = persist_preferences(&state.quota_settings_path, &settings) {
        if key.is_some() {
            if let Ok(entry) = sub2api::credential(&settings.base_url) {
                match old_key {
                    Some(value) => {
                        let _ = entry.set_password(&value);
                    }
                    None => {
                        let _ = entry.delete_credential();
                    }
                }
            }
        }
        return Err(error);
    }
    *state
        .quota_settings
        .lock()
        .map_err(|_| "无法保存设置。".to_string())? = settings;
    state.scope_id.fetch_add(1, Ordering::SeqCst);
    *state
        .snapshot_cache
        .lock()
        .map_err(|_| "无法清除额度缓存。".to_string())? = None;
    update_tray_quota(&app, &[]);
    let _ = app.emit_to("widget", "quota-settings-changed", ());
    Ok(())
}

fn show_settings_window(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("settings") {
        let _ = window.unminimize();
        window
            .show()
            .map_err(|_| "无法显示设置窗口。".to_string())?;
        return window.set_focus().map_err(|_| "无法打开设置窗口。".into());
    }
    tauri::WebviewWindowBuilder::new(
        &app,
        "settings",
        tauri::WebviewUrl::App("index.html?settings".into()),
    )
    .title("Quota Float · 设置")
    .inner_size(480.0, 640.0)
    .min_inner_size(420.0, 560.0)
    .resizable(true)
    .center()
    .build()
    .map_err(|_| "无法创建设置窗口。".to_string())?;
    Ok(())
}

#[tauri::command]
async fn open_settings(app: AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || show_settings_window(app))
        .await
        .map_err(|_| "无法打开设置窗口。".to_string())?
}

#[tauri::command]
fn show_widget_menu(app: AppHandle) -> Result<(), String> {
    let window = app.get_webview_window("widget").ok_or("悬浮窗不可用。")?;
    let settings = MenuItem::with_id(&app, "settings", "设置 / Settings…", true, None::<&str>);
    let reload = MenuItem::with_id(&app, "reload", "Reload", true, None::<&str>);
    let hide = MenuItem::with_id(&app, "hide", "Close", true, None::<&str>);
    let (settings, reload, hide) = (
        settings.map_err(|_| "菜单不可用。")?,
        reload.map_err(|_| "菜单不可用。")?,
        hide.map_err(|_| "菜单不可用。")?,
    );
    let menu = Menu::with_items(&app, &[&settings, &reload, &hide]).map_err(|_| "菜单不可用。")?;
    window
        .popup_menu(&menu)
        .map_err(|_| "无法打开菜单。".into())
}

fn load_preferences(path: &PathBuf) -> WidgetPreferences {
    let parse = |candidate: &PathBuf| {
        fs::read_to_string(candidate)
            .ok()
            .and_then(|raw| serde_json::from_str::<WidgetPreferences>(&raw).ok())
    };
    if let Some(value) = parse(path) {
        return value.normalized();
    }
    let backup = path.with_extension("json.bak");
    if let Some(value) = parse(&backup) {
        eprintln!("preferences recovered from backup");
        return value.normalized();
    }
    WidgetPreferences::default()
}

fn persist_preferences<T: serde::Serialize>(path: &PathBuf, value: &T) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|_| "failed to create settings directory".to_string())?;
    }
    let serialized = serde_json::to_vec_pretty(value)
        .map_err(|_| "failed to serialize settings".to_string())?;
    let temporary = path.with_extension("json.tmp");
    let backup = path.with_extension("json.bak");
    let mut file = fs::File::create(&temporary)
        .map_err(|_| "failed to create temporary settings file".to_string())?;
    file.write_all(&serialized)
        .and_then(|_| file.sync_all())
        .map_err(|_| "failed to write settings".to_string())?;
    if path.exists() {
        let _ = fs::remove_file(&backup);
        fs::rename(path, &backup).map_err(|_| "failed to back up settings".to_string())?;
    }
    if let Err(error) = fs::rename(&temporary, path) {
        let _ = fs::rename(&backup, path);
        return Err(format!("failed to commit settings: {error}"));
    }
    Ok(())
}

#[tauri::command]
async fn get_snapshots(
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Vec<ProviderSnapshot>, String> {
    const CACHE_TTL: Duration = Duration::from_secs(30);
    if let Ok(cache) = state.snapshot_cache.lock() {
        if let Some((time, values)) = &*cache {
            if time.elapsed() < CACHE_TTL {
                update_tray_quota(&app, values);
                return Ok(values.clone());
            }
        }
    }
    let _guard = match state.fetch_lock.try_lock() {
        Ok(guard) => guard,
        Err(_) => {
            if let Ok(cache) = state.snapshot_cache.lock() {
                if let Some((_, values)) = &*cache {
                    update_tray_quota(&app, values);
                    return Ok(values.clone());
                }
            }
            return Ok(vec![ProviderSnapshot::failure(
                "unavailable",
                "Quota refresh is already running.",
            )]);
        }
    };
    if let Ok(cache) = state.snapshot_cache.lock() {
        if let Some((time, values)) = &*cache {
            if time.elapsed() < CACHE_TTL {
                update_tray_quota(&app, values);
                return Ok(values.clone());
            }
        }
    }
    let values = fetch_current_source(&state).await;
    if let Ok(mut cache) = state.snapshot_cache.lock() {
        *cache = Some((Instant::now(), values.clone()));
    }
    update_tray_quota(&app, &values);
    Ok(values)
}

#[tauri::command]
async fn refresh_snapshots(
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Vec<ProviderSnapshot>, String> {
    let values = fetch_snapshots_uncached(&state).await;
    update_tray_quota(&app, &values);
    Ok(values)
}

#[tauri::command]
fn get_preferences(state: State<'_, AppState>) -> Result<WidgetPreferences, String> {
    state
        .preferences
        .lock()
        .map(|value| value.clone())
        .map_err(|_| "settings unavailable".into())
}

#[tauri::command]
fn set_preferences(
    preferences: WidgetPreferences,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let preferences = preferences.normalized();
    persist_preferences(&state.preferences_path, &preferences)?;
    *state
        .preferences
        .lock()
        .map_err(|_| "settings unavailable".to_string())? = preferences;
    Ok(())
}

fn apply_lock(app: &AppHandle, locked: bool) -> Result<(), String> {
    let window = app
        .get_webview_window("widget")
        .ok_or_else(|| "widget window missing".to_string())?;
    window
        .set_ignore_cursor_events(locked)
        .map_err(|_| "failed to toggle click-through".to_string())
}

fn reset_widget_to_compact(window: &tauri::WebviewWindow) {
    let _ = window.set_size(LogicalSize::new(112.0, 32.0));
}

fn show_widget_below_tray(window: &tauri::WebviewWindow, rect: tauri::Rect) {
    reset_widget_to_compact(window);
    let fallback_scale = window.scale_factor().unwrap_or(1.0);
    let (rect_x, rect_y) = match rect.position {
        Position::Physical(position) => (position.x as f64, position.y as f64),
        Position::Logical(position) => {
            let physical = position.to_physical::<f64>(fallback_scale);
            (physical.x, physical.y)
        }
    };
    let (rect_width, rect_height) = match rect.size {
        Size::Physical(size) => (size.width as f64, size.height as f64),
        Size::Logical(size) => {
            let physical = size.to_physical::<f64>(fallback_scale);
            (physical.width, physical.height)
        }
    };
    let monitors = window.available_monitors().unwrap_or_default();
    let monitor = monitors.iter().find(|monitor| {
        let origin = monitor.position();
        let size = monitor.size();
        rect_x >= origin.x as f64
            && rect_x < (origin.x as f64 + size.width as f64)
            && rect_y >= origin.y as f64
            && rect_y < (origin.y as f64 + size.height as f64)
    });
    let scale = monitor.map(|value| value.scale_factor()).unwrap_or(fallback_scale);
    let panel_width = 112.0 * scale;
    let panel_height = 32.0 * scale;
    let mut x = rect_x + rect_width / 2.0 - panel_width / 2.0;
    let mut y = rect_y + rect_height + 6.0 * scale;
    if let Some(monitor) = monitor {
        let origin = monitor.position();
        let size = monitor.size();
        let min_x = origin.x as f64 + 6.0 * scale;
        let max_x = origin.x as f64 + size.width as f64 - panel_width - 6.0 * scale;
        let min_y = origin.y as f64;
        let max_y = origin.y as f64 + size.height as f64 - panel_height;
        x = x.clamp(min_x, max_x.max(min_x));
        y = y.clamp(min_y, max_y.max(min_y));
    }
    let _ = window.set_position(PhysicalPosition::new(x.round() as i32, y.round() as i32));
    let _ = window.show();
    let _ = window.set_focus();
}

#[tauri::command]
fn set_widget_locked(
    locked: bool,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<WidgetPreferences, String> {
    let previous = state
        .preferences
        .lock()
        .map_err(|_| "settings unavailable".to_string())?
        .clone();
    let mut next = previous.clone();
    next.locked = locked;
    persist_preferences(&state.preferences_path, &next)?;
    if let Err(error) = apply_lock(&app, locked) {
        let _ = persist_preferences(&state.preferences_path, &previous);
        return Err(error);
    }
    *state
        .preferences
        .lock()
        .map_err(|_| "settings unavailable".to_string())? = next.clone();
    Ok(next)
}

#[tauri::command]
fn set_widget_always_on_top(
    always_on_top: bool,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<WidgetPreferences, String> {
    let previous = state
        .preferences
        .lock()
        .map_err(|_| "settings unavailable".to_string())?
        .clone();
    let mut next = previous.clone();
    next.always_on_top = always_on_top;
    persist_preferences(&state.preferences_path, &next)?;
    let window = app
        .get_webview_window("widget")
        .ok_or_else(|| "widget window missing".to_string())?;
    if let Err(error) = window.set_always_on_top(always_on_top) {
        let _ = persist_preferences(&state.preferences_path, &previous);
        return Err(format!("failed to toggle always-on-top: {error}"));
    }
    *state
        .preferences
        .lock()
        .map_err(|_| "settings unavailable".to_string())? = next.clone();
    let _ = app.emit_to("widget", "preferences-changed", next.clone());
    Ok(next)
}

fn setup_tray(app: &tauri::App) -> tauri::Result<()> {
    let settings = MenuItem::with_id(app, "settings", "设置 / Settings…", true, None::<&str>)?;
    let show = MenuItem::with_id(app, "show", "Show / Hide", true, None::<&str>)?;
    let refresh = MenuItem::with_id(app, "refresh", "Refresh now", true, None::<&str>)?;
    let unlock = MenuItem::with_id(app, "unlock", "Unlock widget", true, None::<&str>)?;
    let pin = MenuItem::with_id(app, "pin", "Pin / Unpin Codex", true, None::<&str>)?;
    let language = MenuItem::with_id(app, "language", "Switch Language / 切换语言", true, None::<&str>)?;
    let autostart_enabled = app.autolaunch().is_enabled().unwrap_or(false);
    let autostart = CheckMenuItem::with_id(
        app,
        "autostart",
        "Start at login",
        true,
        autostart_enabled,
        None::<&str>,
    )?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &settings, &refresh, &unlock, &pin, &language, &autostart, &quit])?;
    let mut builder = TrayIconBuilder::with_id("main")
        .menu(&menu)
        .tooltip("Codex 额度加载中")
        .title("--%")
        .show_menu_on_left_click(false);
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    let autostart_menu = autostart.clone();
    builder
        .on_menu_event(move |app, event| match event.id.as_ref() {
            "show" => {
                if let Some(window) = app.get_webview_window("widget") {
                    if window.is_visible().unwrap_or(false) {
                        let _ = window.hide();
                    } else {
                        reset_widget_to_compact(&window);
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
            }
            "refresh" => {
                let _ = app.emit_to("widget", "refresh-requested", ());
            }
            "unlock" => {
                let _ = apply_lock(app, false);
                if let Some(state) = app.try_state::<AppState>() {
                    if let Ok(mut prefs) = state.preferences.lock() {
                        prefs.locked = false;
                        let _ = persist_preferences(&state.preferences_path, &*prefs);
                        let _ = app.emit_to("widget", "preferences-changed", prefs.clone());
                    }
                }
            }
            "pin" => {
                if let Some(state) = app.try_state::<AppState>() {
                    if let Ok(mut prefs) = state.preferences.lock() {
                        prefs.pinned_provider = if prefs.pinned_provider.is_some() {
                            None
                        } else {
                            Some("codex".into())
                        };
                        let _ = persist_preferences(&state.preferences_path, &*prefs);
                        let _ = app.emit_to("widget", "preferences-changed", prefs.clone());
                    }
                }
            }
            "language" => {
                if let Some(state) = app.try_state::<AppState>() {
                    if let Ok(mut prefs) = state.preferences.lock() {
                        prefs.language = if prefs.language == "en" {
                            "zh-CN".into()
                        } else {
                            "en".into()
                        };
                        let normalized = prefs.clone().normalized();
                        *prefs = normalized.clone();
                        let _ = persist_preferences(&state.preferences_path, &normalized);
                        let _ = app.emit_to("widget", "preferences-changed", normalized);
                    }
                }
            }
            "autostart" => {
                let manager = app.autolaunch();
                let enabled = manager.is_enabled().unwrap_or(false);
                let result = if enabled {
                    manager.disable()
                } else {
                    manager.enable()
                };
                match result {
                    Ok(()) => {
                        let _ = autostart_menu.set_checked(!enabled);
                    }
                    Err(_) => eprintln!("autostart update failed"),
                }
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .build(app)?;
    Ok(())
}

pub fn run() {
    let app = tauri::Builder::default()
        .on_menu_event(|app, event| match event.id.as_ref() {
            "settings" => {
                let handle = app.clone();
                tauri::async_runtime::spawn(async move { let _ = open_settings(handle).await; });
            }
            "reload" => { let _ = app.emit_to("widget", "reload-requested", ()); }
            "hide" => {
                if let Some(window) = app.get_webview_window("widget") { let _ = window.hide(); }
            }
            _ => {}
        })
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(window) = app.get_webview_window("widget") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            None,
        ))
        // The widget has a fixed footprint; only its desktop position should persist.
        .plugin(
            WindowStateBuilder::default()
                .with_state_flags(StateFlags::POSITION)
                .build(),
        )
        .setup(|app| {
            let data_dir = app.path().app_config_dir()?;
            let preferences_path = data_dir.join("preferences.json");
            let preferences = load_preferences(&preferences_path);
            let quota_settings_path = data_dir.join("quota-settings.json");
            let needs_setup = !quota_settings_path.exists();
            let quota_settings = load_quota_settings(&quota_settings_path);
            let client = reqwest::Client::builder()
                .timeout(Duration::from_secs(12))
                .redirect(reqwest::redirect::Policy::none())
                .user_agent("QuotaFloat/0.1")
                .build()
                .expect("static HTTP client configuration must be valid");
            app.manage(AppState {
                client,
                api_direct_client: build_api_client(true),
                api_system_client: build_api_client(false),
                preferences: Mutex::new(preferences.clone()),
                preferences_path,
                fetch_lock: tokio::sync::Mutex::new(()),
                snapshot_cache: Mutex::new(None),
                quota_settings: Mutex::new(quota_settings),
                quota_settings_path,
                scope_id: AtomicU64::new(1),
            });
            if setup_tray(app).is_err() {
                eprintln!("tray setup failed; enabling taskbar fallback");
                if let Some(window) = app.get_webview_window("widget") {
                    let _ = window.set_skip_taskbar(false);
                }
            }
            if preferences.locked {
                let _ = apply_lock(app.handle(), true);
            }
            if let Some(window) = app.get_webview_window("widget") {
                let _ = window.set_size(LogicalSize::new(112.0, 32.0));
                let _ = window.set_always_on_top(preferences.always_on_top);
            }
            if needs_setup {
                let handle = app.handle().clone();
                tauri::async_runtime::spawn(async move { let _ = open_settings(handle).await; });
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_snapshots,
            refresh_snapshots,
            get_preferences,
            set_preferences,
            set_widget_locked,
            set_widget_always_on_top,
            get_quota_settings,
            save_quota_settings,
            check_quota_settings,
            open_settings,
            show_widget_menu,
        ])
        .on_tray_icon_event(|app, event| {
            if let TrayIconEvent::Click {
                rect,
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                if let Some(window) = app.get_webview_window("widget") {
                    if window.is_visible().unwrap_or(false) {
                        let _ = window.show();
                        let _ = window.set_focus();
                    } else {
                        show_widget_below_tray(&window, rect);
                    }
                }
            }
        })
        .on_window_event(|window, event| {
            match event {
                WindowEvent::CloseRequested { api, .. } => {
                    if window.label() == "widget" {
                        api.prevent_close();
                        let _ = window.hide();
                        let _ = window.set_size(LogicalSize::new(112.0, 32.0));
                    }
                }
                _ => {}
            }
        })
        .build(tauri::generate_context!())
        .expect("failed to build Quota Float");
    app.run(|app_handle, event| {
        if matches!(event, tauri::RunEvent::Resumed) {
            let _ = app_handle.emit_to("widget", "refresh-requested", ());
        }
    });
}
