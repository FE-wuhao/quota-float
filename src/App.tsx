import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { CompactQuotaCard } from "./components/QuotaCard";
import { closeWidget, fetchSnapshots, getPreferences, isTauri, listenDesktopEvents, openSettings, reloadWidget, resizeWidget, showWidgetMenu, startDragging } from "./lib/bridge";
import { needsFastRefresh } from "./lib/format";
import { copy, normalizeLanguage } from "./lib/i18n";
import { mergeSnapshots } from "./lib/snapshots";
import type { ProviderSnapshot } from "./types";
import { defaultPreferences } from "./lib/preferences";

const DEFAULT_PREFS = defaultPreferences;
export default function App() {
  const [snapshots, setSnapshots] = useState<ProviderSnapshot[]>([]);
  const [preferences, setPreferences] = useState(DEFAULT_PREFS);
  const [activeIndex, setActiveIndex] = useState(0);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [isManualRefreshing, setIsManualRefreshing] = useState(false);
  const failures = useRef(0);
  const refreshSequence = useRef(0);
  const contentRef = useRef<HTMLDivElement>(null);
  const language = normalizeLanguage(preferences.language);
  const t = copy[language];

  useEffect(() => {
    const element = contentRef.current;
    if (!element) return;
    let lastSize = "";
    let pendingSize: { width: number; height: number } | null = null;
    let resizing = false;
    let cancelled = false;
    const flush = async () => {
      if (resizing) return;
      resizing = true;
      try {
        while (pendingSize && !cancelled) {
          const size = pendingSize;
          pendingSize = null;
          await resizeWidget(size.width, size.height);
        }
      } catch { /* A future content change retries resizing. */ }
      finally { resizing = false; }
    };
    const observer = new ResizeObserver(() => {
      const { width, height } = element.getBoundingClientRect();
      const size = { width: Math.max(32, Math.min(320, Math.ceil(width))), height: Math.max(20, Math.min(40, Math.ceil(height))) };
      const key = `${size.width}:${size.height}`;
      if (key === lastSize) return;
      lastSize = key; pendingSize = size;
      void flush();
    });
    observer.observe(element);
    return () => { cancelled = true; observer.disconnect(); };
  }, []);

  const refresh = useCallback(async (force = false) => {
    const sequence = ++refreshSequence.current;
    try {
      const values = await fetchSnapshots(force);
      if (sequence !== refreshSequence.current) return;
      const hasFailure = values.some((item) => item.status !== "ok");
      if (hasFailure) failures.current += 1;
      else failures.current = 0;
      setSnapshots((current) => mergeSnapshots(current, values));
    } catch {
      if (sequence !== refreshSequence.current) return;
      failures.current += 1;
      setSnapshots((current) => current.length > 0
        ? current.map((item) => ({ ...item, status: "stale", message: "Refresh failed. Please try again later." }))
        : [{ provider: "codex", displayName: "CODEX", plan: null, primaryWindow: null, secondaryWindow: null, resetCredits: null, resetCreditExpiresAt: [], updatedAt: new Date().toISOString(), status: "unavailable", message: "Quota is temporarily unavailable. It will retry automatically." }]);
    }
  }, []);

  useEffect(() => {
    void refresh(true);
    void getPreferences().then((value) => setPreferences({ ...DEFAULT_PREFS, ...value, language: normalizeLanguage(value.language) })).catch(() => undefined);
  }, [refresh]);

  useEffect(() => {
    let cancelled = false;
    let cleanup: () => void = () => {};
    void listenDesktopEvents({
      onPreferences: (value) => setPreferences({ ...DEFAULT_PREFS, ...value, language: normalizeLanguage(value.language) }),
      onRefresh: () => void refresh(true),
      onQuotaSettings: () => { setSnapshots([]); failures.current = 0; void refresh(true); },
    }).then((value) => {
      if (cancelled) value(); else cleanup = value;
    }).catch(() => undefined);
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

  const refreshManually = useCallback(async () => {
    if (isManualRefreshing) return;
    setIsManualRefreshing(true);
    try {
      await refresh(true);
    } finally {
      setIsManualRefreshing(false);
    }
  }, [isManualRefreshing, refresh]);

  const content = !current ? (
    <div className="loading-card compact-loading" aria-label={t.loadingQuota}><span /><span /><span /></div>
  ) : (
    <CompactQuotaCard
      snapshot={current}
      language={language}
      appearance={preferences}
      onDrag={() => { if (!preferences.locked) void startDragging(); }}
      onRefresh={() => void refreshManually()}
      isRefreshing={isManualRefreshing}
    />
  );

  return (
    <div
      className="widget-shell"
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        if (isTauri()) { void showWidgetMenu(); return; }
        const menuWidth = 116;
        const menuHeight = 120;
        setContextMenu({
          x: Math.max(4, Math.min(event.clientX, window.innerWidth - menuWidth - 4)),
          y: Math.max(4, Math.min(event.clientY, window.innerHeight - menuHeight - 4)),
        });
      }}
    >
      <div ref={contentRef} className="widget-content" style={{ "--widget-font-size": `${preferences.fontSize}px`, "--widget-opacity": preferences.opacity } as CSSProperties}>{content}</div>
      {contextMenu ? (
        <div className="widget-context-menu" role="menu" style={{ left: contextMenu.x, top: contextMenu.y }} onPointerDown={(event) => event.stopPropagation()}>
          <button role="menuitem" onClick={() => { setContextMenu(null); void openSettings(); }}>设置 / Settings</button>
          <button role="menuitem" onClick={() => { setContextMenu(null); void refreshManually(); }}>刷新额度</button>
          <button role="menuitem" onClick={() => { setContextMenu(null); reloadWidget(); }}>Reload</button>
          <button role="menuitem" onClick={() => { setContextMenu(null); void closeWidget(); }}>收进系统托盘</button>
        </div>
      ) : null}
    </div>
  );
}
