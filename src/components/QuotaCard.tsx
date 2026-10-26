import { ArrowClockwise, ArrowDown, ArrowUp, ClockCounterClockwise, CloudSlash, CornersIn, PushPin, PushPinSlash, SignIn, WarningCircle } from "@phosphor-icons/react";
import { memo, useMemo, useRef, useState } from "react";
import { clampPercent, formatCompactResetTime, formatDateTime, formatResetDate, formatResetTime, formatWindowLabel, quotaTier } from "../lib/format";
import { exceedsDragThreshold, type PointerOrigin } from "../lib/gesture";
import { copy, normalizeLanguage } from "../lib/i18n";
import type { Language, ProviderSnapshot, WidgetPreferences } from "../types";
import { ProviderMark } from "./ProviderMark";
import { defaultPreferences } from "../lib/preferences";

interface Props {
  snapshot: ProviderSnapshot;
  preferences: WidgetPreferences;
  providerCount: number;
  onPrevious: () => void;
  onNext: () => void;
  onTogglePin: () => void;
  onLock: () => void;
  onLanguage: () => void;
  onDrag: () => void;
  onCollapse: () => void;
  onRefresh?: () => void;
  isRefreshing?: boolean;
  isConsuming?: boolean;
  notice?: string | null;
  initialShowCreditTip?: boolean;
}

function StatusIcon({ status, expired = false }: { status: ProviderSnapshot["status"]; expired?: boolean }) {
  if (status === "signed_out") return <SignIn weight="duotone" />;
  if (status === "stale" || expired) return <ClockCounterClockwise weight="duotone" />;
  if (status === "unavailable") return <CloudSlash weight="duotone" />;
  return <WarningCircle weight="duotone" />;
}

function localizedBackendMessage(message: string | null, language: Language): string | null {
  if (!message) return null;
  if (language === "en") return message;
  const normalized = message.toLowerCase();
  if (normalized.includes("sign in") || normalized.includes("login")) return "Codex 登录已失效，请重新登录。";
  if (normalized.includes("rate limited")) return "请求过于频繁，将稍后自动重试。";
  if (normalized.includes("network")) return "网络不可用，将自动重试。";
  if (normalized.includes("format")) return "额度响应格式已变化。";
  if (normalized.includes("missing a usage window")) return "额度响应缺少可用窗口。";
  if (normalized.includes("refresh is already running")) return "额度正在刷新，请稍候。";
  return message;
}

export const QuotaCard = memo(function QuotaCard({
  snapshot,
  preferences,
  providerCount,
  onPrevious,
  onNext,
  onTogglePin: _onTogglePin,
  onLock,
  onLanguage,
  onDrag,
  onCollapse,
  onRefresh,
  isConsuming = false,
  notice = null,
  initialShowCreditTip = false,
}: Props) {
  const [showCreditTip, setShowCreditTip] = useState(initialShowCreditTip);
  const language = normalizeLanguage(preferences.language);
  const t = copy[language];
  const primaryWindow = snapshot.primaryWindow;
  const secondaryWindow = snapshot.secondaryWindow;
  const primary = primaryWindow ? clampPercent(primaryWindow.remainingPercent) : null;
  const secondary = secondaryWindow ? clampPercent(secondaryWindow.remainingPercent) : null;
  const primaryLabel = formatWindowLabel(primaryWindow?.windowSeconds ?? 0, language);
  const secondaryLabel = formatWindowLabel(secondaryWindow?.windowSeconds ?? 0, language);
  const staleAge = Date.now() - new Date(snapshot.updatedAt).getTime();
  const staleExpired = snapshot.status === "stale" && staleAge > 30 * 60_000;
  const available = snapshot.status === "ok" || (snapshot.status === "stale" && !staleExpired);
  const tier = quotaTier(primary);
  const indicatorState = isConsuming ? "active" : snapshot.status === "ok" ? "ok" : snapshot.status === "stale" ? "stale" : "error";
  const indicatorLabel = isConsuming
    ? t.active
    : snapshot.status === "ok"
      ? t.dataSynced
      : snapshot.status === "stale"
        ? t.dataStale
        : snapshot.status === "signed_out"
          ? t.notSignedIn
          : t.unavailableStatus;
  const message = localizedBackendMessage(snapshot.message, language);
  const creditExpirations = useMemo(() => (snapshot.resetCreditExpiresAt ?? []).map((value, index) => {
    return t.creditItem(index, formatDateTime(value, language));
  }), [language, snapshot.resetCreditExpiresAt, t]);

  return (
    <main
      className={`quota-card quota-card--${snapshot.status} quota-card--${tier}`}
    >
      <div className="aurora" aria-hidden="true" />
      <span className="sr-only" aria-live="polite">{available && primary !== null ? t.availableLabel(primaryLabel, primary) : message}</span>
      {notice ? <p className="operation-notice" role="status">{notice}</p> : null}
      <header className="card-header" onPointerDown={(event) => { if (event.button === 0) void onDrag(); }}>
        <div>
          <p className="eyebrow">{snapshot.displayName} · {snapshot.plan ?? t.accountFallback}</p>
          {snapshot.status !== "stale" ? <p className="updated">{t.windowRemaining(primaryLabel)}</p> : null}
        </div>
        {!preferences.locked ? (
          <nav className="card-actions" aria-label={t.controls} onPointerDown={(event) => event.stopPropagation()}>
            <button onClick={onCollapse} aria-label={language === "en" ? "Collapse details" : "收起详情"} title={language === "en" ? "Collapse details" : "收起详情"}><CornersIn /></button>
            {providerCount > 1 ? <button onClick={onPrevious} aria-label={t.servicePrevious}><ArrowUp /></button> : null}
            {providerCount > 1 ? <button onClick={onNext} aria-label={t.serviceNext}><ArrowDown /></button> : null}
            <span className={`usage-indicator usage-indicator--${indicatorState}`} role="status" aria-label={indicatorLabel} title={indicatorLabel}><i /></span>
            <button className="language-button" onClick={onLanguage} aria-label={t.switchLanguage} title={t.switchLanguage}>{language === "en" ? "中" : "EN"}</button>
            <button onClick={onLock} aria-label={preferences.alwaysOnTop ? t.pinOff : t.pinOn} title={preferences.alwaysOnTop ? t.pinOff : t.pinOn}>
              {preferences.alwaysOnTop ? <PushPin /> : <PushPinSlash />}
            </button>
          </nav>
        ) : null}
      </header>

      {available && primary !== null ? (
        <>
          <section className="primary-metric" aria-label={t.availableLabel(primaryLabel, primary)}>
            <span>{primary}</span><small>%</small>
          </section>
          <div className="progress" role="progressbar" aria-label={t.availableLabel(primaryLabel, primary)} aria-valuemin={0} aria-valuemax={100} aria-valuenow={primary}>
            <span style={{ width: `${primary}%` }} />
          </div>
          <p className="reset-time">{formatResetTime(primaryWindow?.resetsAt ?? null, new Date(), language)}</p>
          <footer className="card-footer">
            <div className="weekly-metric">
              <p>{t.windowUntil(secondaryWindow ? secondaryLabel : primaryLabel, formatResetDate((secondaryWindow ?? primaryWindow)?.resetsAt ?? null, language))}</p>
              {secondaryWindow ? <strong>{secondary}<small>{secondary === null ? "" : "%"}</small></strong> : null}
              <div className="reset-credit-row" onMouseDown={(event) => event.stopPropagation()}>
                <span>{snapshot.resetCredits === null ? t.resetCreditUnknown : t.resetCredits(snapshot.resetCredits)}</span>
                {snapshot.resetCredits !== null && snapshot.resetCredits > 0 ? (
                  <button type="button" className="reset-credit-button" onClick={() => setShowCreditTip((value) => !value)} aria-expanded={showCreditTip} aria-label={t.view}>{t.view}</button>
                ) : null}
              </div>
              {showCreditTip ? (
                <div className="reset-credit-tip" role="status" onMouseDown={(event) => event.stopPropagation()}>
                  {creditExpirations.length > 0 ? creditExpirations.map((item) => <p key={item}>{item}</p>) : <p>{t.noCreditExpiration}</p>}
                </div>
              ) : null}
            </div>
            <ProviderMark />
          </footer>
        </>
      ) : (
        <section className="error-state" aria-live="polite">
          <div className="status-icon" aria-hidden="true"><StatusIcon status={snapshot.status} expired={staleExpired} /></div>
          <strong>{snapshot.status === "signed_out" ? t.signedInRequired : staleExpired ? t.staleExpired : t.temporarilyUnavailable}</strong>
          <p>{message ?? t.errorUnavailable}</p>
          {snapshot.status === "stale" ? (
            <button type="button" className="error-refresh-button" onMouseDown={(event) => event.stopPropagation()} onClick={onRefresh} disabled={!onRefresh} aria-label={t.refreshQuota}>
              <ArrowClockwise />
              <span>{t.refresh}</span>
            </button>
          ) : null}
        </section>
      )}
    </main>
  );
});

export const CompactQuotaCard = memo(function CompactQuotaCard({
  snapshot,
  onDrag,
  onRefresh,
  isRefreshing = false,
  language = "zh-CN",
  appearance = defaultPreferences,
}: Pick<Props, "snapshot" | "onDrag" | "onRefresh" | "isRefreshing"> & { language?: Language; appearance?: WidgetPreferences }) {
  const pointerOrigin = useRef<PointerOrigin | null>(null);
  const dragging = useRef(false);
  const activeLanguage = normalizeLanguage(language);
  const t = copy[activeLanguage];
  const primaryWindow = snapshot.primaryWindow;
  const primary = primaryWindow ? clampPercent(primaryWindow.remainingPercent) : null;
  const primaryLabel = formatWindowLabel(primaryWindow?.windowSeconds ?? 0, activeLanguage);
  const resetLabel = formatResetTime(primaryWindow?.resetsAt ?? null, new Date(), activeLanguage);
  const compactResetLabel = formatCompactResetTime(primaryWindow?.resetsAt ?? null, new Date(), activeLanguage);
  const balance = snapshot.balance;
  const balanceAmount = balance ? new Intl.NumberFormat("en-US", { ...(balance.unit === "USD" ? { style: "currency", currency: "USD" } as const : {}), notation: Math.abs(balance.remaining) >= 10_000 ? "compact" : "standard", maximumFractionDigits: 2 }).format(balance.remaining) : "";
  const balanceScope = balance?.scope === "subscription" ? (activeLanguage === "en" ? "subscription" : "订阅") : (activeLanguage === "en" ? "account" : "账户");
  const tier = balance ? (balance.remaining <= 0 ? "critical" : "unknown") : quotaTier(primary);
  const staleExpired = snapshot.status === "stale" && Date.now() - new Date(snapshot.updatedAt).getTime() > 30 * 60_000;
  const available = (snapshot.status === "ok" || (snapshot.status === "stale" && !staleExpired)) && (primary !== null || Boolean(balance));
  const statusLabel = snapshot.provider === "sub2api" && snapshot.status === "signed_out" ? "请设置 Key" : snapshot.status === "signed_out" ? t.notSignedIn : t.unavailableStatus;
  const detailLabels: Record<string, string> = activeLanguage === "en"
    ? { total: "Total", "5h": "5-hour", "1d": "Daily", "7d": "Weekly" }
    : { total: "总额度", "5h": "5 小时", "1d": "每日", "7d": "每周" };
  const details = (snapshot.quotaDetails ?? []).map((detail) => `${detailLabels[detail.window]}：${detail.remaining.toFixed(2)} / ${detail.limit.toFixed(2)} ${detail.unit}`);
  const accessibleLabel = available && balance
    ? `${activeLanguage === "en" ? `Current Key's ${balanceScope} balance` : `当前 Key 对应${balanceScope}余额`}：${balance.remaining.toFixed(2)} ${balance.unit}${snapshot.status === "stale" ? `\n${t.dataStale}` : ""}`
    : available && primary !== null
    ? `${snapshot.provider === "sub2api" ? "API Key · " : ""}${t.availableLabel(primaryLabel, primary)}，${primaryWindow?.windowSeconds === 0 ? (activeLanguage === "en" ? "No automatic reset" : "总额度无自动重置") : resetLabel}${details.length ? `\n${details.join("\n")}` : ""}${snapshot.status === "stale" ? `\n${t.dataStale}` : ""}${snapshot.message ? `\n${snapshot.message}` : ""}`
    : localizedBackendMessage(snapshot.message, activeLanguage) ?? t.unavailableStatus;

  const resetGesture = () => {
    pointerOrigin.current = null;
    dragging.current = false;
  };

  return (
    <main
      className={`compact-quota-card quota-card--${snapshot.status} quota-card--${tier}`}
      onDoubleClick={() => { if (!isRefreshing) onRefresh?.(); }}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        pointerOrigin.current = { x: event.screenX, y: event.screenY };
        dragging.current = false;
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        const origin = pointerOrigin.current;
        if (!origin || dragging.current || !exceedsDragThreshold(origin, event.screenX, event.screenY)) return;
        dragging.current = true;
        void onDrag();
      }}
      onPointerUp={(event) => {
        if (!pointerOrigin.current) return;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
        resetGesture();
      }}
      onPointerCancel={resetGesture}
      aria-label={accessibleLabel}
      title={`${accessibleLabel}\n${activeLanguage === "en" ? "Double-click to refresh · Right-click for settings" : "双击刷新 · 右键设置"}`}
    >
      <div className="aurora" aria-hidden="true" />
      {available ? (
        <>
          <section className={`compact-primary compact-primary--single${balance ? " compact-primary--balance" : ""}`}>
            {appearance.showStatus ? <i className={`compact-status compact-status--${snapshot.status}`} aria-hidden="true" /> : null}
            {balance ? <strong>{balanceAmount}{balance.unit !== "USD" ? <small>{balance.unit}</small> : null}</strong> : <>
              <strong>{primary}<small>%</small></strong>
              {appearance.showResetTime ? <><span className="compact-separator" aria-hidden="true">·</span>
              <span className="compact-reset-time">{snapshot.provider === "sub2api" && primaryWindow?.windowSeconds === 0 ? (activeLanguage === "en" ? "total" : "总额") : compactResetLabel}</span></> : null}
            </>}
          </section>
        </>
      ) : (
        <section className="compact-unavailable">
          <StatusIcon status={snapshot.status} />
          <div><strong>{statusLabel}</strong></div>
        </section>
      )}
      {appearance.showRefreshButton ? <button
        type="button"
        className={`compact-refresh-button${isRefreshing ? " compact-refresh-button--active" : ""}`}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          onRefresh?.();
        }}
        disabled={!onRefresh || isRefreshing}
        aria-label={t.refreshQuota}
        title={t.refreshQuota}
      >
        <ArrowClockwise aria-hidden="true" />
      </button> : null}
    </main>
  );
});
