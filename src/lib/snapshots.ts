import type { ProviderSnapshot } from "../types";

export function mergeSnapshots(current: ProviderSnapshot[], incoming: ProviderSnapshot[]): ProviderSnapshot[] {
  return incoming.map((next) => {
    if (next.status === "ok") return next;
    if (next.status === "signed_out") return next;
    if (next.allowStale === false) return next;
    const previous = current.find((item) => item.provider === next.provider && item.scopeId === next.scopeId && item.primaryWindow);
    return previous
      ? { ...previous, status: "stale", message: next.message, updatedAt: previous.updatedAt }
      : next;
  });
}
