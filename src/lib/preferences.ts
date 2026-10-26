import type { WidgetPreferences } from "../types";

export const defaultPreferences: WidgetPreferences = {
  locked: false, alwaysOnTop: true, pinnedProvider: null, autoRotateSeconds: 12,
  language: "zh-CN", displayMode: "floating", fontSize: 12, opacity: 0.92,
  showStatus: true, showResetTime: false, showRefreshButton: false,
};
