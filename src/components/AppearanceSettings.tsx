import { useEffect, useState, type CSSProperties } from "react";
import { getPreferences, isTauri, listenDesktopEvents, updatePreferences } from "../lib/bridge";
import { defaultPreferences } from "../lib/preferences";
import type { ProviderSnapshot } from "../types";
import { CompactQuotaCard } from "./QuotaCard";

const sample: ProviderSnapshot = {
  provider: "sub2api", displayName: "Sub2API", plan: null, status: "ok", message: null,
  primaryWindow: { remainingPercent: 74, resetsAt: new Date(Date.now() + 3 * 86_400_000).toISOString(), windowSeconds: 604800 },
  secondaryWindow: null, resetCredits: null, updatedAt: new Date().toISOString(),
};
const sampleBalance: ProviderSnapshot = { ...sample, primaryWindow: null, balance: { remaining: 370.46, unit: "USD", scope: "account" } };
const colorPresets = [
  { color: "#ffffff", label: "亮白" }, { color: "#ffe066", label: "亮黄" },
  { color: "#ffb366", label: "橙色" }, { color: "#80c7ff", label: "天蓝" },
  { color: "#8ed6ac", label: "绿色" },
];

export function AppearanceSettings() {
  const [preferences, setPreferences] = useState(defaultPreferences);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ error: boolean; text: string } | null>(null);
  useEffect(() => {
    let cancelled = false;
    let cleanup = () => {};
    void getPreferences().then((value) => {
      if (!cancelled) setPreferences({ ...defaultPreferences, ...value });
    }).catch(() => {
      if (!cancelled) setNotice({ error: true, text: "无法读取展示设置，请重新打开设置页。" });
    }).finally(() => { if (!cancelled) setLoading(false); });
    void listenDesktopEvents({
      onPreferences: (value) => { if (!cancelled) setPreferences({ ...defaultPreferences, ...value }); },
      onRefresh: () => {}, onQuotaSettings: () => {},
    }).then((unlisten) => { if (cancelled) unlisten(); else cleanup = unlisten; }).catch(() => {});
    return () => { cancelled = true; cleanup(); };
  }, []);

  const change = (value: Partial<typeof preferences>) => { setPreferences((current) => ({ ...current, ...value })); setNotice(null); };
  return <form onSubmit={(event) => {
    event.preventDefault();
    if (loading || saving) return;
    setSaving(true); setNotice(null);
    void updatePreferences(preferences).then(() => {
      setNotice({ error: false, text: isTauri() ? "展示设置已保存，重启后仍会保留。" : "预览设置已应用；桌面版保存后会在重启时保留。" });
    }).catch(() => {
      setNotice({ error: true, text: "无法保存展示设置，请重试。" });
    }).finally(() => setSaving(false));
  }}>
    <fieldset disabled={loading || saving}>
      <div className="appearance-preview">
        {preferences.displayMode === "tray" ? <><span className="tray-preview" style={{ color: preferences.fontColor }} aria-label="托盘数字示例">370</span><small>仅托盘 · 桌面不显示悬浮窗，悬停查看完整额度。</small></> : <>
          <div className="widget-content" style={{ "--widget-font-size": `${preferences.fontSize}px`, "--widget-font-color": preferences.fontColor, "--widget-opacity": preferences.opacity } as CSSProperties}>
            <CompactQuotaCard snapshot={sampleBalance} appearance={preferences} onDrag={() => {}} />
            <CompactQuotaCard snapshot={sample} appearance={preferences} onDrag={() => {}} />
          </div><small>示例：余额 / 剩余比例 · 实际窗口按内容自动缩放</small>
        </>}
      </div>
      <label className="settings-field">展示方式
        <select value={preferences.displayMode} onChange={(event) => change({ displayMode: event.target.value as "floating" | "tray" })}>
          <option value="floating">极简悬浮条 + 数字托盘</option><option value="tray">仅数字托盘</option>
        </select>
        <small>托盘显示剩余比例或简写余额，悬停查看完整金额；右键打开设置或恢复悬浮条。</small>
      </label>
      <label className="settings-field"><span>字号 <output>{preferences.fontSize} px</output></span>
        <input aria-label="字号" type="range" min="10" max="16" step="1" value={preferences.fontSize} onChange={(event) => change({ fontSize: Number(event.target.value) })} />
      </label>
      <div className="settings-field">
        <label htmlFor="font-color">字体颜色 <output>{preferences.fontColor.toUpperCase()}</output></label>
        <div className="settings-color-presets">
          <input id="font-color" type="color" value={preferences.fontColor} onChange={(event) => change({ fontColor: event.target.value })} />
          {colorPresets.map(({ color, label }) => <button type="button" key={color} aria-label={label} aria-pressed={preferences.fontColor.toLowerCase() === color} title={label} style={{ "--swatch-color": color } as CSSProperties} onClick={() => change({ fontColor: color })}><span /></button>)}
        </div>
        <small>应用于悬浮条文字和托盘数字，可选预设或点击色块自定义。状态圆点仍表示额度状态。</small>
      </div>
      <label className="settings-field"><span>背景不透明度 <output>{Math.round(preferences.opacity * 100)}%</output></span>
        <input aria-label="背景不透明度" type="range" min="35" max="100" step="1" value={Math.round(preferences.opacity * 100)} onChange={(event) => change({ opacity: Number(event.target.value) / 100 })} />
      </label>
      <h2 className="settings-section-title">悬浮条显示项</h2>
      <label className="settings-toggle">状态圆点<input type="checkbox" checked={preferences.showStatus} onChange={(event) => change({ showStatus: event.target.checked })} /></label>
      <label className="settings-toggle">重置倒计时（比例额度）<input type="checkbox" checked={preferences.showResetTime} onChange={(event) => change({ showResetTime: event.target.checked })} /></label>
      <label className="settings-toggle">刷新按钮<input type="checkbox" checked={preferences.showRefreshButton} onChange={(event) => change({ showRefreshButton: event.target.checked })} /></label>
      <p className="settings-info">默认只显示额度。悬停查看详情，双击或右键可刷新。</p>
      <label className="settings-toggle">悬浮条置顶<input type="checkbox" checked={preferences.alwaysOnTop} onChange={(event) => change({ alwaysOnTop: event.target.checked })} /></label>
      <label className="settings-toggle">鼠标穿透（从托盘解除）<input type="checkbox" checked={preferences.locked} onChange={(event) => change({ locked: event.target.checked })} /></label>
      <div className="settings-actions">
        <button type="button" onClick={() => change({ fontSize: defaultPreferences.fontSize, fontColor: defaultPreferences.fontColor, opacity: defaultPreferences.opacity, showStatus: defaultPreferences.showStatus, showResetTime: defaultPreferences.showResetTime, showRefreshButton: defaultPreferences.showRefreshButton })}>恢复默认外观</button>
        <button type="submit" className="settings-save">{saving ? "正在保存…" : "保存展示设置"}</button>
      </div>
    </fieldset>
    {notice ? <p className={`settings-notice${notice.error ? " settings-notice--error" : ""}`} role={notice.error ? "alert" : "status"}>{notice.text}</p> : null}
  </form>;
}
