export type ProviderId = "codex" | "claude" | "sub2api";
export type SnapshotStatus = "ok" | "stale" | "loading" | "unavailable" | "signed_out";
export type Language = "zh-CN" | "en";

export interface UsageWindow {
  remainingPercent: number;
  resetsAt: string | null;
  windowSeconds: number;
}

export interface ProviderSnapshot {
  provider: ProviderId;
  displayName: string;
  plan: string | null;
  primaryWindow: UsageWindow | null;
  secondaryWindow: UsageWindow | null;
  resetCredits: number | null;
  resetCreditExpiresAt?: string[];
  updatedAt: string;
  status: SnapshotStatus;
  message: string | null;
  scopeId?: number;
  quotaDetails?: QuotaDetail[];
  allowStale?: boolean;
  balance?: { remaining: number; unit: string; scope: "account" | "subscription" } | null;
}

export interface QuotaDetail {
  window: "total" | "5h" | "1d" | "7d";
  limit: number;
  used: number;
  remaining: number;
  unit: string;
  resetsAt: string | null;
}

export interface QuotaSettings {
  source: "sub2api" | "codex";
  baseUrl: string;
  quotaWindow: "auto" | QuotaDetail["window"];
  connectionMode: "direct" | "system";
}

export interface QuotaSettingsView extends QuotaSettings { hasKey: boolean }

export interface WidgetPreferences {
  locked: boolean;
  alwaysOnTop: boolean;
  pinnedProvider: ProviderId | null;
  autoRotateSeconds: number;
  language: Language;
}
