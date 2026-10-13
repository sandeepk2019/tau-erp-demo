"use client";
// ============================================================================
// Tau ERP — NotificationBell: role-scoped feed in the topbar.
// Unread badge, preview popover, mark-read on open, mark-all-read (POST).
// Round-8: per-user preferences (muted kinds / severity floor applied
// server-side) + optional digest mode (feed grouped by kind) + preferences
// dialog entry point.
// ============================================================================
import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/erp/api-client";
import { useErpStore } from "@/store/erp-store";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { StatusBadge } from "./shared";
import NotificationPrefsDialog, { NOTIF_KIND_META } from "./notification-prefs-dialog";
import { Bell, BellOff, CheckCheck, ExternalLink, Settings2 } from "lucide-react";
import { cn } from "@/lib/utils";

type Notif = {
  id: string; kind: string; severity: string; title: string; message: string;
  refType: string; refId: string; readAt: string | null; createdAt: string; muted?: boolean;
};
type NotifPrefs = { mutedKinds: string[]; minSeverity: "ALL" | "WARNING" | "CRITICAL"; digest: boolean };

const REF_NAV: Record<string, { view: string; tab: string }> = {
  NCR: { view: "quality", tab: "ncr" },
  EQUIPMENT: { view: "quality", tab: "equipment" },
  MRP: { view: "planning", tab: "mrp" },
  PO: { view: "procurement", tab: "pos" },
  INVOICE: { view: "sales", tab: "invoices" },
  CAPA: { view: "quality", tab: "capa" },
  SCAR: { view: "procurement", tab: "scars" },
};

export default function NotificationBell() {
  const sessionUser = useErpStore((s) => s.sessionUser);
  const navigate = useErpStore((s) => s.navigate);
  const toast = useErpStore((s) => s.toast);
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [prefsOpen, setPrefsOpen] = useState(false);

  const { data } = useQuery<{ notifications: Notif[]; unread: number; hiddenCount: number; prefs: NotifPrefs }>({
    queryKey: ["notifications", sessionUser?.username],
    queryFn: () => api("/api/notifications"),
    enabled: !!sessionUser,
    refetchInterval: 45_000,
  });

  const markOne = useMutation({
    mutationFn: (id: string) => api("/api/notifications", { method: "PATCH", body: { id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });
  const markAll = useMutation({
    mutationFn: () => api("/api/notifications", { method: "POST", body: {} }),
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ["notifications"] }); toast(`Marked ${(r as { updated: number }).updated} notification(s) read`); },
    onError: (e: Error) => toast(e.message, "err"),
  });

  const unread = data?.unread ?? 0;
  const all = data?.notifications ?? [];
  const prefs = data?.prefs ?? { mutedKinds: [], minSeverity: "ALL" as const, digest: false };
  const digest = prefs.digest;

  // digest grouping — visible kinds only (server already filtered muted)
  const groups = React.useMemo(() => {
    const m = new Map<string, { kind: string; count: number; unread: number; latest: Notif }>();
    for (const n of all) {
      const g = m.get(n.kind);
      if (g) {
        g.count += 1;
        if (!n.readAt) g.unread += 1;
      } else {
        m.set(n.kind, { kind: n.kind, count: 1, unread: n.readAt ? 0 : 1, latest: n });
      }
    }
    return [...m.values()].sort((a, b) => b.unread - a.unread || b.count - a.count);
  }, [all]);

  const list = all.slice(0, 6);

  const openRef = (n: Notif) => {
    if (!n.readAt) markOne.mutate(n.id);
    const nav = REF_NAV[n.refType];
    if (nav && n.refId) {
      setOpen(false);
      navigate(nav.view, nav.tab, n.refId);
    }
  };

  const openFullList = () => { setOpen(false); navigate("sales", "notifications"); };

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="icon" className="relative" aria-label={`Notifications — ${unread} unread`}>
            <Bell className="h-4.5 w-4.5" />
            {unread > 0 && (
              <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center shadow">
                {unread > 9 ? "9+" : unread}
              </span>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-96 p-0">
          <div className="flex items-center justify-between px-3 py-2 border-b">
            <div className="text-[12px] font-semibold">
              Notifications
              {digest && <span className="ml-1.5 rounded-full border border-primary/40 bg-primary/10 px-1.5 py-px text-[9px] uppercase tracking-wide text-primary-foreground/90">digest</span>}
            </div>
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Notification preferences" title="Notification preferences" onClick={() => { setOpen(false); setPrefsOpen(true); }}>
                <Settings2 className="h-3.5 w-3.5" />
              </Button>
              <Button variant="ghost" size="sm" className="h-7 text-[11px] gap-1" disabled={unread === 0 || markAll.isPending} onClick={() => markAll.mutate()}>
                <CheckCheck className="h-3.5 w-3.5" /> Mark all read
              </Button>
              <Button variant="ghost" size="sm" className="h-7 text-[11px] gap-1" onClick={openFullList}>
                <ExternalLink className="h-3 w-3" /> All
              </Button>
            </div>
          </div>

          {digest ? (
            /* -------- DIGEST VIEW — grouped by kind -------- */
            <div className="max-h-80 overflow-y-auto erp-scroll divide-y divide-border/50">
              {groups.length === 0 && (
                <div className="py-8 text-center text-[12px] text-muted-foreground">No notifications for your role.</div>
              )}
              {groups.map((g) => {
                const meta = NOTIF_KIND_META.find((m) => m.kind === g.kind);
                const Icon = meta?.icon ?? Bell;
                return (
                  <button
                    key={g.kind}
                    onClick={openFullList}
                    className="w-full text-left px-3 py-2.5 flex gap-2.5 hover:bg-accent/50 transition-colors"
                    title={`${meta?.label ?? g.kind} — open the full list`}
                  >
                    <span className={cn(
                      "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border",
                      g.unread ? "border-primary/40 bg-primary/10 text-primary-foreground" : "border-border/60 bg-background/40 text-muted-foreground",
                    )}>
                      <Icon className="h-3.5 w-3.5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="text-[12px] font-medium">{meta?.label ?? g.kind}</span>
                        <span className="rounded-full border border-border/60 bg-background/40 px-1.5 py-px text-[9.5px] tabular text-muted-foreground">{g.count}</span>
                        {g.unread > 0 && (
                          <span className="rounded-full bg-primary px-1.5 py-px text-[9.5px] font-semibold tabular text-primary-foreground">{g.unread} new</span>
                        )}
                      </span>
                      <span className="block text-[11px] text-muted-foreground truncate">{g.latest.title}</span>
                      <span className="block text-[10px] text-muted-foreground/70 mt-0.5">
                        latest · {new Date(g.latest.createdAt).toLocaleString("en-IN", { dateStyle: "short", timeStyle: "short" })}
                      </span>
                    </span>
                  </button>
                );
              })}
              {(data?.hiddenCount ?? 0) > 0 && (
                <p className="px-3 py-2 text-[10.5px] text-muted-foreground/80 flex items-center gap-1.5">
                  <BellOff className="h-3 w-3" /> {data?.hiddenCount} event(s) hidden by your preferences — adjust in settings
                </p>
              )}
            </div>
          ) : (
            /* -------- FLAT VIEW — classic feed -------- */
            <div className="max-h-80 overflow-y-auto erp-scroll divide-y divide-border/50">
              {list.length === 0 && (
                <div className="py-8 text-center text-[12px] text-muted-foreground">No notifications for your role.</div>
              )}
              {list.map((n) => (
                <button
                  key={n.id}
                  onClick={() => openRef(n)}
                  className={cn(
                    "w-full text-left px-3 py-2.5 flex gap-2.5 hover:bg-accent/50 transition-colors",
                    !n.readAt && "bg-primary/5"
                  )}
                >
                  <span className={cn("mt-1 h-1.5 w-1.5 rounded-full shrink-0", n.readAt ? "bg-muted" : n.severity === "CRITICAL" ? "bg-red-500" : "bg-amber-400")} />
                  <span className="min-w-0">
                    <span className="flex items-center gap-2">
                      <span className="text-[12px] font-medium truncate">{n.title}</span>
                      <StatusBadge status={n.severity} className="shrink-0 scale-90 origin-left" />
                    </span>
                    <span className="block text-[11px] text-muted-foreground line-clamp-2">{n.message}</span>
                    <span className="block text-[10px] text-muted-foreground/70 mt-0.5">
                      {n.refType}{n.refId ? ` · ${n.refId}` : ""} · {new Date(n.createdAt).toLocaleString("en-IN", { dateStyle: "short", timeStyle: "short" })}
                    </span>
                  </span>
                </button>
              ))}
              {(data?.hiddenCount ?? 0) > 0 && (
                <p className="px-3 py-2 text-[10.5px] text-muted-foreground/80 flex items-center gap-1.5 border-t border-border/50">
                  <BellOff className="h-3 w-3" /> {data?.hiddenCount} event(s) hidden by your preferences — adjust in settings
                </p>
              )}
            </div>
          )}
        </PopoverContent>
      </Popover>

      <NotificationPrefsDialog open={prefsOpen} onClose={() => setPrefsOpen(false)} />
    </>
  );
}
