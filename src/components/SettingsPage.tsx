import { useEffect, useState } from "react";
import { checkQuotaSettings, getQuotaSettings, isTauri, saveQuotaSettings } from "../lib/bridge";
import type { ProviderSnapshot, QuotaSettings, QuotaSettingsView } from "../types";

const initial: QuotaSettingsView = { source: "sub2api", baseUrl: "", quotaWindow: "auto", hasKey: false };
const labels: Record<string, string> = { total: "总额度", "5h": "5 小时", "1d": "每日", "7d": "每周" };
function normalizedBase(value: string): string {
  try { return new URL(value.trim()).toString().replace(/\/+$/, "").replace(/\/v1$/, ""); }
  catch { return value.trim(); }
}

export function SettingsPage() {
  const [settings, setSettings] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"check" | "save" | null>(null);
  const [notice, setNotice] = useState<{ error: boolean; text: string } | null>(null);
  const [preview, setPreview] = useState<ProviderSnapshot | null>(null);
  const apiMode = settings.source === "sub2api";
  const canReuseKey = saved.hasKey && normalizedBase(settings.baseUrl) === normalizedBase(saved.baseUrl);

  useEffect(() => {
    let cancelled = false;
    void getQuotaSettings().then((value) => {
      if (!cancelled) { setSettings(value); setSaved(value); }
    }).catch(() => {
      if (!cancelled) setNotice({ error: true, text: "无法读取设置或系统凭据库，请重试。" });
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const update = (value: Partial<QuotaSettings>) => {
    setSettings((current) => ({ ...current, ...value }));
    setNotice(null); setPreview(null);
  };

  async function run(action: "check" | "save") {
    if (busy) return;
    if (apiMode && (!settings.baseUrl.trim() || (!apiKey.trim() && !canReuseKey))) {
      setNotice({ error: true, text: "请填写服务地址和对应的 API Key。" }); return;
    }
    setBusy(action); setNotice(null); setPreview(null);
    const value: QuotaSettings = { source: settings.source, baseUrl: settings.baseUrl, quotaWindow: settings.quotaWindow };
    try {
      if (action === "check") {
        const result = await checkQuotaSettings(value, apiKey);
        setPreview(result);
        setNotice({ error: result.status !== "ok", text: result.status === "ok" ? "查询成功，当前配置可读取额度。" : result.message ?? "暂时无法查询额度。" });
      } else {
        await saveQuotaSettings(value, apiKey);
        // Never request the saved secret back from the desktop process.
        setApiKey(""); setShowKey(false);
        const current = await getQuotaSettings();
        setSettings(current); setSaved(current);
        setNotice({ error: false, text: "已保存，悬浮窗正在刷新对应额度。" });
      }
    } catch (error) {
      setNotice({ error: true, text: typeof error === "string" ? error : "操作失败，请检查设置后重试。" });
    } finally { setBusy(null); }
  }

  return (
    <main className="settings-page">
      <header className="settings-heading"><span>QUOTA FLOAT</span><h1>额度设置</h1><p>选择额度来源，让悬浮窗显示你正在使用的份额。</p></header>
      {!isTauri() ? <p className="settings-preview-note">浏览器预览：查询结果为示例，Key 不会保存或发送。</p> : null}
      <form onSubmit={(event) => { event.preventDefault(); void run("save"); }}>
        <fieldset disabled={loading || busy !== null}>
          <label className="settings-field">额度来源
            <select value={settings.source} onChange={(event) => update({ source: event.target.value as QuotaSettings["source"] })}>
              <option value="sub2api">Sub2API · API Key 额度</option><option value="codex">Codex · 官方账号额度</option>
            </select>
          </label>
          {apiMode ? <>
            <label className="settings-field">服务地址
              <input type="url" value={settings.baseUrl} placeholder="https://your-sub2api.example.com" autoComplete="off" spellCheck={false} maxLength={2048} onChange={(event) => update({ baseUrl: event.target.value })} />
              <small>填写服务根地址或 /v1 地址。</small>
            </label>
            <label className="settings-field">API Key
              <div className="settings-key-input">
                <input type={showKey ? "text" : "password"} value={apiKey} placeholder={canReuseKey ? "已保存 Key，留空保留" : "输入此服务的 API Key"} autoComplete="new-password" autoCapitalize="none" spellCheck={false} maxLength={8192} onChange={(event) => { setApiKey(event.target.value); setNotice(null); setPreview(null); }} />
                <button type="button" aria-label={showKey ? "隐藏 API Key" : "显示 API Key"} aria-pressed={showKey} onClick={() => setShowKey((value) => !value)}>{showKey ? "隐藏" : "显示"}</button>
              </div>
              <small>Key 保存在本机系统凭据库。更换服务地址时需重新填写。</small>
            </label>
            <label className="settings-field">展示额度
              <select value={settings.quotaWindow} onChange={(event) => update({ quotaWindow: event.target.value as QuotaSettings["quotaWindow"] })}>
                <option value="auto">自动 · 显示剩余比例最低的限额</option><option value="7d">每周额度</option><option value="5h">5 小时额度</option><option value="1d">每日额度</option><option value="total">总额度</option>
              </select>
              <small>仅展示当前 Key 的独立限额；账户或订阅共享余额不计入。</small>
            </label>
          </> : <p className="settings-info">读取本机 Codex 登录账号的官方额度与重置时间。</p>}
          <div className="settings-actions">
            <button type="button" onClick={() => void run("check")}>{busy === "check" ? "正在查询…" : "测试查询"}</button>
            <button type="submit" className="settings-save">{busy === "save" ? "正在保存…" : "保存并刷新"}</button>
          </div>
        </fieldset>
      </form>
      {notice ? <p className={`settings-notice${notice.error ? " settings-notice--error" : ""}`} role={notice.error ? "alert" : "status"}>{notice.text}</p> : null}
      {preview?.status === "ok" ? <section className="settings-result" aria-label="额度查询结果">
        <div><span>当前剩余</span><strong>{Math.round(preview.primaryWindow?.remainingPercent ?? 0)}<small>%</small></strong></div>
        {preview.quotaDetails?.map((detail) => <p key={detail.window}><span>{labels[detail.window]}</span><span>{detail.remaining.toFixed(2)} / {detail.limit.toFixed(2)} {detail.unit}</span></p>)}
      </section> : null}
    </main>
  );
}
