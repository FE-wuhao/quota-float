use reqwest::{
    header::{HeaderValue, AUTHORIZATION},
    Url,
};
use serde_json::Value;

use crate::models::{ProviderSnapshot, QuotaDetail, QuotaSettings, UsageWindow};

const MAX_RESPONSE_BYTES: usize = 1024 * 1024;

pub fn credential(base_url: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new("app.quotafloat.desktop.sub2api", base_url)
        .map_err(|_| "无法访问系统凭据库。".into())
}

pub fn load_key(base_url: &str) -> Result<Option<String>, String> {
    if base_url.is_empty() {
        return Ok(None);
    }
    match credential(base_url)?.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(_) => Err("无法读取系统凭据库中的 API Key。".into()),
    }
}

pub fn normalize_settings(mut settings: QuotaSettings) -> Result<QuotaSettings, String> {
    if !["codex", "sub2api"].contains(&settings.source.as_str()) {
        return Err("请选择有效的额度来源。".into());
    }
    if !["auto", "total", "5h", "1d", "7d"].contains(&settings.quota_window.as_str()) {
        return Err("请选择有效的额度周期。".into());
    }
    settings.base_url = settings.base_url.trim().trim_end_matches('/').to_string();
    if settings.base_url.len() > 2048 {
        return Err("服务地址过长。".into());
    }
    if settings.source == "codex" {
        return Ok(settings);
    }
    let mut url =
        Url::parse(&settings.base_url).map_err(|_| "请输入完整的服务地址。".to_string())?;
    let local = matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "[::1]"));
    if (url.scheme() != "https" && !(local && url.scheme() == "http"))
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err(
            "服务地址需使用 HTTPS，且不能包含账号、密码、查询参数或片段；本机地址可使用 HTTP。"
                .into(),
        );
    }
    let path = url.path().trim_end_matches('/').to_string();
    if path.ends_with("/responses") || path.ends_with("/usage") {
        return Err("请填写服务根地址或以 /v1 结尾的 API 地址。".into());
    }
    let path = path.strip_suffix("/v1").unwrap_or(&path).to_string();
    url.set_path(&path);
    settings.base_url = url.as_str().trim_end_matches('/').to_string();
    Ok(settings)
}

fn failure(status: &str, message: &str) -> ProviderSnapshot {
    let mut snapshot = ProviderSnapshot::failure(status, message);
    snapshot.provider = "sub2api".into();
    snapshot.display_name = "Sub2API".into();
    snapshot.allow_stale = false;
    snapshot
}

fn transient_failure(message: &str) -> ProviderSnapshot {
    let mut snapshot = failure("unavailable", message);
    snapshot.allow_stale = true;
    snapshot
}

fn parse_detail(value: &Value, window: &str) -> Option<QuotaDetail> {
    let limit = value
        .get("limit")?
        .as_f64()
        .filter(|n| n.is_finite() && *n > 0.0)?;
    let used = value
        .get("used")?
        .as_f64()
        .filter(|n| n.is_finite() && *n >= 0.0)?;
    let remaining = value
        .get("remaining")
        .and_then(Value::as_f64)
        .unwrap_or(limit - used);
    if !remaining.is_finite() {
        return None;
    }
    let resets_at = value
        .get("reset_at")
        .and_then(Value::as_str)
        .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
        .map(|date| date.to_rfc3339());
    Some(QuotaDetail {
        window: window.into(),
        limit,
        used,
        remaining: remaining.clamp(0.0, limit),
        unit: value
            .get("unit")
            .and_then(Value::as_str)
            .unwrap_or("USD")
            .into(),
        resets_at,
    })
}

fn parse_snapshot(value: &Value, selected: &str) -> ProviderSnapshot {
    if value.get("isValid").and_then(Value::as_bool) == Some(false) {
        return failure("signed_out", "API Key 无效或已停用，请在设置中更换。");
    }
    let mut details = Vec::new();
    if let Some(detail) = value.get("quota").and_then(|v| parse_detail(v, "total")) {
        details.push(detail);
    }
    if let Some(windows) = value.get("rate_limits").and_then(Value::as_array) {
        for name in ["5h", "1d", "7d"] {
            if let Some(detail) = windows
                .iter()
                .find(|v| v.get("window").and_then(Value::as_str) == Some(name))
                .and_then(|v| parse_detail(v, name))
            {
                details.push(detail);
            }
        }
    }
    let primary = if selected == "auto" {
        details
            .iter()
            .min_by(|a, b| (a.remaining / a.limit).total_cmp(&(b.remaining / b.limit)))
    } else {
        details.iter().find(|detail| detail.window == selected)
    };
    let Some(primary) = primary else {
        return failure(
            "unavailable",
            if details.is_empty() {
                "接口未返回此 API Key 的独立限额，请在 Sub2API 中为该 Key 配置额度；账户或订阅共享余额不作为 Key 额度展示。"
            } else {
                "此 API Key 未返回所选周期的限额，请在设置中切换周期或选择自动。"
            },
        );
    };
    let mut snapshot = failure("ok", "");
    snapshot.message = if value.get("status").and_then(Value::as_str) == Some("expired") {
        Some("此 API Key 已过期；当前显示其额度记录。".into())
    } else {
        None
    };
    snapshot.plan = Some(primary.window.clone());
    snapshot.primary_window = Some(UsageWindow {
        remaining_percent: primary.remaining / primary.limit * 100.0,
        resets_at: primary.resets_at.clone(),
        window_seconds: match primary.window.as_str() {
            "5h" => 18_000,
            "1d" => 86_400,
            "7d" => 604_800,
            _ => 0,
        },
    });
    snapshot.quota_details = details;
    snapshot
}

pub async fn fetch_snapshot(
    client: &reqwest::Client,
    settings: &QuotaSettings,
    key_override: Option<String>,
) -> ProviderSnapshot {
    let settings = match normalize_settings(settings.clone()) {
        Ok(value) => value,
        Err(_) => {
            return failure(
                "signed_out",
                "请打开设置，填写 Sub2API 服务地址和 API Key。",
            )
        }
    };
    let key = match key_override
        .map(Some)
        .map(Ok)
        .unwrap_or_else(|| load_key(&settings.base_url))
    {
        Ok(Some(value)) => value,
        Ok(None) => return failure("signed_out", "请打开设置，填写 API Key。"),
        Err(message) => return failure("unavailable", &message),
    };
    let mut authorization = match HeaderValue::from_str(&format!("Bearer {key}")) {
        Ok(value) => value,
        Err(_) => return failure("signed_out", "API Key 格式无效，请在设置中更换。"),
    };
    authorization.set_sensitive(true);
    let response = client
        .get(format!("{}/v1/usage", settings.base_url))
        .header(AUTHORIZATION, authorization)
        .header("Accept", "application/json")
        .send()
        .await;
    let mut response = match response {
        Ok(value) => value,
        Err(_) => return transient_failure("无法连接额度接口，将自动重试。"),
    };
    match response.status().as_u16() {
        200 => {}
        401 | 403 => {
            return failure(
                "signed_out",
                "API Key 无效、已停用或没有查询权限，请检查设置。",
            )
        }
        404 => {
            return failure(
                "unavailable",
                "服务未提供 /v1/usage，请检查地址与 Sub2API 版本。",
            )
        }
        429 => return transient_failure("额度查询过于频繁，将稍后重试。"),
        500..=599 => return transient_failure("额度服务暂时不可用，将稍后重试。"),
        _ => {
            return failure(
                "unavailable",
                "额度接口返回异常，请稍后重试或检查服务地址。",
            )
        }
    }
    if response
        .content_length()
        .is_some_and(|size| size > MAX_RESPONSE_BYTES as u64)
    {
        return failure("unavailable", "额度响应过大，已停止读取。");
    }
    let mut body = Vec::new();
    loop {
        match response.chunk().await {
            Ok(Some(chunk)) if body.len() + chunk.len() <= MAX_RESPONSE_BYTES => {
                body.extend_from_slice(&chunk)
            }
            Ok(Some(_)) => return failure("unavailable", "额度响应过大，已停止读取。"),
            Ok(None) => break,
            Err(_) => return transient_failure("额度响应读取失败，将自动重试。"),
        }
    }
    match serde_json::from_slice::<Value>(&body) {
        Ok(value) => parse_snapshot(
            value
                .get("data")
                .filter(|v| v.is_object())
                .unwrap_or(&value),
            &settings.quota_window,
        ),
        Err(_) => failure("unavailable", "额度响应格式无法识别，请检查服务地址。"),
    }
}
