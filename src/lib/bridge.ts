import type { ProviderSnapshot, QuotaSettings, QuotaSettingsView, WidgetPreferences } from "../types";

const defaultPreferences: WidgetPreferences = { locked: false, alwaysOnTop: true, pinnedProvider: null, autoRotateSeconds: 12, language: "zh-CN" };

const mockSnapshot: ProviderSnapshot = {
  provider: "codex",
  displayName: "CODEX",
  plan: "PRO",
  primaryWindow: { remainingPercent: 74, resetsAt: new Date(Date.now() + 3.2 * 86_400_000).toISOString(), windowSeconds: 604_800 },
  secondaryWindow: null,
  resetCredits: 1,
  resetCreditExpiresAt: [new Date(Date.now() + 9 * 86_400_000).toISOString()],
  updatedAt: new Date().toISOString(),
  status: "ok",
  message: null,
};

export const isTauri = () => "__TAURI_INTERNALS__" in window;

let previewSettings: QuotaSettingsView = { source: "sub2api", baseUrl: "", quotaWindow: "auto", connectionMode: "direct", hasKey: false };

export async function getQuotaSettings(): Promise<QuotaSettingsView> {
  if (!isTauri()) return { ...previewSettings };
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<QuotaSettingsView>("get_quota_settings");
}

export async function saveQuotaSettings(settings: QuotaSettings, apiKey: string): Promise<void> {
  if (!isTauri()) { previewSettings = { ...settings, hasKey: Boolean(apiKey.trim()) || previewSettings.hasKey }; return; }
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("save_quota_settings", { settings, apiKey });
}

export async function checkQuotaSettings(settings: QuotaSettings, apiKey: string): Promise<ProviderSnapshot> {
  if (!isTauri()) return {
    ...mockSnapshot, provider: "sub2api", displayName: "Sub2API", plan: "7d", resetCredits: null,
    quotaDetails: [{ window: "7d", limit: 600, used: 150, remaining: 450, unit: "USD", resetsAt: mockSnapshot.primaryWindow?.resetsAt ?? null }],
    primaryWindow: { ...mockSnapshot.primaryWindow!, remainingPercent: 75 },
  };
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<ProviderSnapshot>("check_quota_settings", { settings, apiKey });
}

export async function openSettings(): Promise<void> {
  if (!isTauri()) { window.open(`${window.location.pathname}?settings`, "quota-settings"); return; }
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("open_settings");
}

export async function showWidgetMenu(): Promise<void> {
  if (!isTauri()) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("show_widget_menu");
}

export async function fetchSnapshots(force = false): Promise<ProviderSnapshot[]> {
  if (!isTauri()) return [mockSnapshot];
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<ProviderSnapshot[]>(force ? "refresh_snapshots" : "get_snapshots");
}

export async function getPreferences(): Promise<WidgetPreferences> {
  if (!isTauri()) return defaultPreferences;
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<WidgetPreferences>("get_preferences");
}

export async function updatePreferences(value: WidgetPreferences): Promise<void> {
  if (!isTauri()) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("set_preferences", { preferences: value });
}

export async function setClickThrough(locked: boolean): Promise<WidgetPreferences> {
  if (!isTauri()) return { ...defaultPreferences, locked };
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<WidgetPreferences>("set_widget_locked", { locked });
}

export async function setAlwaysOnTop(alwaysOnTop: boolean): Promise<WidgetPreferences> {
  if (!isTauri()) return { ...defaultPreferences, alwaysOnTop };
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<WidgetPreferences>("set_widget_always_on_top", { alwaysOnTop });
}

export async function startDragging(): Promise<void> {
  if (!isTauri()) return;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  await getCurrentWindow().startDragging();
}

export function reloadWidget(): void {
  window.location.reload();
}

export async function closeWidget(): Promise<void> {
  if (!isTauri()) return;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  await getCurrentWindow().hide();
}

export async function listenDesktopEvents(handlers: {
  onPreferences: (value: WidgetPreferences) => void;
  onRefresh: () => void;
  onQuotaSettings: () => void;
}): Promise<() => void> {
  if (!isTauri()) return () => undefined;
  const { listen } = await import("@tauri-apps/api/event");
  const unlistenPreferences = await listen<WidgetPreferences>("preferences-changed", (event) => handlers.onPreferences(event.payload));
  const unlistenRefresh = await listen("refresh-requested", handlers.onRefresh);
  const unlistenQuotaSettings = await listen("quota-settings-changed", handlers.onQuotaSettings);
  const unlistenReload = await listen("reload-requested", reloadWidget);
  return () => { unlistenPreferences(); unlistenRefresh(); unlistenQuotaSettings(); unlistenReload(); };
}
