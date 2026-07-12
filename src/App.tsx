import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CompactQuotaCard, QuotaCard } from "./components/QuotaCard";
import { closeWidget, fetchSnapshots, getPreferences, listenDesktopEvents, reloadWidget, setAlwaysOnTop, setWidgetMode, startDragging, updatePreferences } from "./lib/bridge";
import { needsFastRefresh } from "./lib/format";
import { copy, nextLanguage, normalizeLanguage } from "./lib/i18n";
import { mergeSnapshots } from "./lib/snapshots";
import type { ProviderSnapshot, WidgetPreferences } from "./types";

const DEFAULT_PREFS: WidgetPreferences = { locked: false, alwaysOnTop: true, pinnedProvider: null, autoRotateSeconds: 12, language: "zh-CN" };
type ViewMode = "compact" | "detail" | "dragging";

export default function App() {
  const [snapshots, setSnapshots] = useState<ProviderSnapshot[]>([]);
  const [preferences, setPreferences] = useState(DEFAULT_PREFS);
  const [activeIndex, setActiveIndex] = useState(0);
  const [viewMode, setViewMode] = useState<ViewMode>("compact");
  const [consumingProviders, setConsumingProviders] = useState<Set<string>>(() => new Set());
  const [operationError, setOperationError] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const failures = useRef(0);
  const previousPrimary = useRef(new Map<string, number>());
  const consumptionTimers = useRef(new Map<string, number>());
  const language = normalizeLanguage(preferences.language);
  const t = copy[language];

  const refresh = useCallback(async (force = false) => {
    try {
      const values = await fetchSnapshots(force);
      const hasFailure = values.some((item) => item.status !== "ok");
      if (hasFailure) failures.current += 1;
      else failures.current = 0;
      for (const item of values) {
        const nextPrimary = item.shortWindow?.remainingPercent;
        const previous = previousPrimary.current.get(item.provider);
        if (nextPrimary !== undefined && previous !== undefined && nextPrimary < previous) {
          setConsumingProviders((current) => new Set(current).add(item.provider));
          const oldTimer = consumptionTimers.current.get(item.provider);
          if (oldTimer !== undefined) window.clearTimeout(oldTimer);
          const timer = window.setTimeout(() => {
            setConsumingProviders((current) => { const next = new Set(current); next.delete(item.provider); return next; });
            consumptionTimers.current.delete(item.provider);
          }, 5 * 60_000);
          consumptionTimers.current.set(item.provider, timer);
        }
        if (nextPrimary !== undefined) previousPrimary.current.set(item.provider, nextPrimary);
      }
      setSnapshots((current) => mergeSnapshots(current, values));
    } catch {
      failures.current += 1;
      setSnapshots((current) => current.length > 0
        ? current.map((item) => ({ ...item, status: "stale", message: "Refresh failed. Please try again later." }))
        : [{ provider: "codex", displayName: "CODEX", plan: null, shortWindow: null, weeklyWindow: null, resetCredits: null, resetCreditExpiresAt: [], updatedAt: new Date().toISOString(), status: "unavailable", message: "Quota is temporarily unavailable. It will retry automatically." }]);
    }
  }, []);

  useEffect(() => {
    void refresh(true);
    void getPreferences().then((value) => setPreferences({ ...DEFAULT_PREFS, ...value, language: normalizeLanguage(value.language) })).catch(() => setOperationError("Unable to read settings. Defaults are in use."));
    return () => { for (const timer of consumptionTimers.current.values()) window.clearTimeout(timer); consumptionTimers.current.clear(); };
  }, [refresh]);

  useEffect(() => {
    let cancelled = false;
    let cleanup: () => void = () => {};
    void listenDesktopEvents({
      onPreferences: (value) => setPreferences({ ...DEFAULT_PREFS, ...value, language: normalizeLanguage(value.language) }),
      onRefresh: () => void refresh(true),
      onShowCompact: () => { setViewMode("compact"); void setWidgetMode("compact"); },
    }).then((value) => {
      if (cancelled) value(); else cleanup = value;
    }).catch(() => setOperationError("Desktop event listener failed to start."));
    return () => { cancelled = true; cleanup(); };
  }, [refresh]);

  const refreshMs = useMemo(() => {
    const backoff = failures.current === 0 ? 5 * 60_000 : Math.min(30 * 60_000, 30_000 * 2 ** (failures.current - 1));
    if (failures.current === 0 && snapshots.some((item) => item.status === "ok" && needsFastRefresh(item))) return 60_000;
    return backoff;
  }, [snapshots]);

  useEffect(() => {
    const id = window.setInterval(() => void refresh(), refreshMs);
    return () => window.clearInterval(id);
  }, [refresh, refreshMs]);

  useEffect(() => {
    const refreshWhenActive = () => { if (document.visibilityState === "visible") void refresh(true); };
    window.addEventListener("focus", refreshWhenActive);
    document.addEventListener("visibilitychange", refreshWhenActive);
    return () => {
      window.removeEventListener("focus", refreshWhenActive);
      document.removeEventListener("visibilitychange", refreshWhenActive);
    };
  }, [refresh]);

  useEffect(() => {
    if (preferences.pinnedProvider || snapshots.length < 2) return;
    const id = window.setInterval(() => setActiveIndex((value) => (value + 1) % snapshots.length), preferences.autoRotateSeconds * 1000);
    return () => window.clearInterval(id);
  }, [preferences.autoRotateSeconds, preferences.pinnedProvider, snapshots.length]);

  useEffect(() => {
    if (!contextMenu) return;
    const dismiss = () => setContextMenu(null);
    window.addEventListener("pointerdown", dismiss);
    window.addEventListener("blur", dismiss);
    return () => {
      window.removeEventListener("pointerdown", dismiss);
      window.removeEventListener("blur", dismiss);
    };
  }, [contextMenu]);

  const current = preferences.pinnedProvider
    ? snapshots.find((item) => item.provider === preferences.pinnedProvider) ?? snapshots[0]
    : snapshots[activeIndex % Math.max(1, snapshots.length)];

  const savePreferences = useCallback((next: WidgetPreferences) => {
    const previous = preferences;
    setPreferences(next);
    setOperationError(null);
    void updatePreferences(next).catch(() => { setPreferences(previous); setOperationError("Settings could not be saved. Previous state restored."); });
  }, [preferences]);

  const changeMode = useCallback((mode: "compact" | "detail") => {
    setOperationError(null);
    void setWidgetMode(mode)
      .then(() => {
        setViewMode(mode);
        if (mode === "detail") void refresh(true);
      })
      .catch(() => setOperationError(mode === "detail" ? "Widget expand failed." : "Widget collapse failed."));
  }, [refresh]);

  const content = !current ? (
    <div className="loading-card compact-loading" aria-label={t.loadingQuota}><span /><span /><span /></div>
  ) : viewMode !== "detail" ? (
    <CompactQuotaCard
      snapshot={current}
      language={language}
      onDrag={() => startDragging()}
      onExpand={() => changeMode("detail")}
      onDraggingChange={(dragging) => setViewMode(dragging ? "dragging" : "compact")}
    />
  ) : (
    <QuotaCard
      snapshot={current}
      preferences={preferences}
      providerCount={snapshots.length}
      onPrevious={() => setActiveIndex((value) => (value - 1 + snapshots.length) % snapshots.length)}
      onNext={() => setActiveIndex((value) => (value + 1) % snapshots.length)}
      onTogglePin={() => savePreferences({ ...preferences, pinnedProvider: preferences.pinnedProvider ? null : current.provider })}
      onLanguage={() => savePreferences({ ...preferences, language: nextLanguage(language) })}
      onLock={() => { setOperationError(null); void setAlwaysOnTop(!preferences.alwaysOnTop).then((value) => setPreferences({ ...DEFAULT_PREFS, ...value, language: normalizeLanguage(value.language) })).catch(() => setOperationError("Always-on-top toggle failed.")); }}
      onDrag={() => startDragging()}
      onCollapse={() => changeMode("compact")}
      onRefresh={() => refresh(true)}
      isConsuming={consumingProviders.has(current.provider)}
      notice={operationError}
    />
  );

  return (
    <div
      className="widget-shell"
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        const menuWidth = 116;
        const menuHeight = 66;
        setContextMenu({
          x: Math.max(4, Math.min(event.clientX, window.innerWidth - menuWidth - 4)),
          y: Math.max(4, Math.min(event.clientY, window.innerHeight - menuHeight - 4)),
        });
      }}
    >
      {content}
      {contextMenu ? (
        <div className="widget-context-menu" role="menu" style={{ left: contextMenu.x, top: contextMenu.y }} onPointerDown={(event) => event.stopPropagation()}>
          <button role="menuitem" onClick={() => { setContextMenu(null); reloadWidget(); }}>Reload</button>
          <button role="menuitem" onClick={() => { setContextMenu(null); void closeWidget(); }}>Close</button>
        </div>
      ) : null}
    </div>
  );
}
