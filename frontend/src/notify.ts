// Desktop (browser) notification delivery for in-app notifications, gated by
// the user's preference, the browser permission and IST quiet hours.
import { useEffect, useRef } from "react";

export type BrowserPermission = "granted" | "denied" | "default" | "unsupported";

export function browserNotificationState(): BrowserPermission {
  return typeof Notification === "undefined" ? "unsupported" : Notification.permission;
}

export async function requestBrowserNotifications(): Promise<BrowserPermission> {
  if (typeof Notification === "undefined") return "unsupported";
  if (Notification.permission !== "default") return Notification.permission;
  try { return await Notification.requestPermission(); } catch { return "denied"; }
}

/** Minutes since IST midnight for an instant (IST has no DST: UTC+05:30). */
export function istMinutes(at: Date): number {
  return ((Math.floor(at.getTime() / 60_000) + 330) % 1440 + 1440) % 1440;
}

/** True inside [start, end) IST; a window may wrap midnight (22:00 → 07:00). */
export function inQuietHours(q: { enabled: boolean; start: string; end: string }, at: Date = new Date()): boolean {
  if (!q.enabled) return false;
  const toMin = (s: string) => { const [h, m] = s.split(":").map(Number); return (h ?? 0) * 60 + (m ?? 0); };
  const now = istMinutes(at), a = toMin(q.start), b = toMin(q.end);
  if (a === b) return false;
  return a < b ? now >= a && now < b : now >= a || now < b;
}

/**
 * Shows one desktop notification when the unread count rises. The first
 * reading after load only sets the baseline, so a reload never re-announces.
 */
export function useBrowserNotifications(unread: number | undefined, opts: {
  enabled: boolean; quiet: { enabled: boolean; start: string; end: string }; onOpen: () => void;
}): void {
  const last = useRef<number | null>(null);
  useEffect(() => {
    if (unread === undefined) return;
    const prev = last.current;
    last.current = unread;
    if (prev === null || unread <= prev) return;
    if (!opts.enabled || browserNotificationState() !== "granted" || inQuietHours(opts.quiet)) return;
    const added = unread - prev;
    try {
      const n = new Notification("Breakout", { body: `${added} new notification${added === 1 ? "" : "s"} — ${unread} unread`, tag: "breakout-notifications" });
      n.onclick = () => { window.focus(); opts.onOpen(); n.close(); };
    } catch { /* some browsers only allow notifications from a service worker */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unread]);
}
