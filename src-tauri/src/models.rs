use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageWindow {
    pub remaining_percent: f64,
    pub resets_at: Option<String>,
    pub window_seconds: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderSnapshot {
    pub provider: String,
    pub display_name: String,
    pub plan: Option<String>,
    pub primary_window: Option<UsageWindow>,
    pub secondary_window: Option<UsageWindow>,
    pub reset_credits: Option<u64>,
    pub reset_credit_expires_at: Vec<String>,
    pub updated_at: String,
    pub status: String,
    pub message: Option<String>,
    pub scope_id: u64,
    pub quota_details: Vec<QuotaDetail>,
    pub allow_stale: bool,
    pub balance: Option<QuotaBalance>,
}

impl ProviderSnapshot {
    pub fn failure(status: &str, message: &str) -> Self {
        Self {
            provider: "codex".into(),
            display_name: "CODEX".into(),
            plan: None,
            primary_window: None,
            secondary_window: None,
            reset_credits: None,
            reset_credit_expires_at: Vec::new(),
            updated_at: chrono::Utc::now().to_rfc3339(),
            status: status.into(),
            message: Some(message.into()),
            scope_id: 0,
            quota_details: Vec::new(),
            allow_stale: true,
            balance: None,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuotaBalance {
    pub remaining: f64,
    pub unit: String,
    pub scope: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuotaDetail {
    pub window: String,
    pub limit: f64,
    pub used: f64,
    pub remaining: f64,
    pub unit: String,
    pub resets_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct QuotaSettings {
    pub source: String,
    pub base_url: String,
    pub quota_window: String,
    pub connection_mode: String,
}

impl Default for QuotaSettings {
    fn default() -> Self {
        Self {
            source: "sub2api".into(),
            base_url: String::new(),
            quota_window: "auto".into(),
            connection_mode: "direct".into(),
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuotaSettingsView {
    #[serde(flatten)]
    pub settings: QuotaSettings,
    pub has_key: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WidgetPreferences {
    pub locked: bool,
    #[serde(default = "default_always_on_top")]
    pub always_on_top: bool,
    pub pinned_provider: Option<String>,
    pub auto_rotate_seconds: u64,
    #[serde(default = "default_language")]
    pub language: String,
    #[serde(default = "default_display_mode")]
    pub display_mode: String,
    #[serde(default = "default_font_size")]
    pub font_size: u32,
    #[serde(default = "default_opacity")]
    pub opacity: f64,
    #[serde(default = "default_always_on_top")]
    pub show_status: bool,
    #[serde(default)]
    pub show_reset_time: bool,
    #[serde(default)]
    pub show_refresh_button: bool,
}

fn default_display_mode() -> String {
    "floating".into()
}
fn default_font_size() -> u32 {
    12
}
fn default_opacity() -> f64 {
    0.92
}

fn default_always_on_top() -> bool {
    true
}
fn default_language() -> String {
    "zh-CN".into()
}

impl Default for WidgetPreferences {
    fn default() -> Self {
        Self {
            locked: false,
            always_on_top: true,
            pinned_provider: None,
            auto_rotate_seconds: 12,
            language: default_language(),
            display_mode: default_display_mode(),
            font_size: default_font_size(),
            opacity: default_opacity(),
            show_status: true,
            show_reset_time: false,
            show_refresh_button: false,
        }
    }
}

impl WidgetPreferences {
    pub fn normalized(mut self) -> Self {
        if !matches!(self.display_mode.as_str(), "floating" | "tray") {
            self.display_mode = default_display_mode();
        }
        self.font_size = self.font_size.clamp(10, 16);
        self.opacity = if self.opacity.is_finite() {
            self.opacity.clamp(0.35, 1.0)
        } else {
            default_opacity()
        };
        self.auto_rotate_seconds = self.auto_rotate_seconds.clamp(5, 300);
        if self.pinned_provider.as_deref() != Some("codex") {
            self.pinned_provider = None;
        }
        if self.language != "en" && self.language != "zh-CN" {
            self.language = default_language();
        }
        self
    }
}
