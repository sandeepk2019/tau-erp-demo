"use client";
// ============================================================================
// Tau ERP — NotificationPrefsDialog: per-user notification delivery preferences
// (round-8). Controls: muted event kinds (toggle chips), minimum severity floor
// (segmented) and digest mode (group feed by kind in the bell). Persisted via
// PUT /api/notifications (validated + audited). Live impact preview from the
// includeMuted feed shows exactly how many stored events will be hidden.
// ============================================================================
import React, { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/erp/api-client";
import { useErpStore } from "@/store/erp-store";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { AlertTriangle, Bell, BellOff, CircleAlert, Factory, Layers, Plug, Save, Users } from "lucide-react";

export type NotifPrefs = { mutedKinds: string[]; minSeverity: "ALL" | "WARNING" | "CRITICAL"; digest: boolean };

export const NOTIF_KIND_META: { kind: string; label: string; desc: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { kind: "QUALITY", label: "Quality events", desc: "NCRs, IQC failures, CAPA reminders, calibration alerts", icon: CircleAlert },
  { kind: "INFO", label: "General broadcasts", desc: "dispatches, releases, shift-handover findings", icon: Factory },
  { kind: "INTEGRATION", label: "Integration events", desc: "e-Invoice / IRN generation results", icon: Plug },
  { kind: "SKILL_MATRIX", label: "Skill matrix changes", desc: "your route qualifications were changed (direct)", icon: Users },
  { kind: "CALIB", label: "Calibration due", desc: "equipment you own is due for calibration (direct)", icon: Layers },
];

const FLOORS: { value: NotifPrefs["minSeverity"]; label: string; hint: string }[] = [
  { value: "ALL", label: "All", hint: "INFO · WARNING · CRITICAL" },
  { value: "WARNING", label: "Warning+", hint: "WARNING · CRITICAL only" },
  { value: "CRITICAL", label: "Critical", hint: "CRITICAL only" },
];

type FullFeed = { notifications: { id: string; kind: string; severity: string; readAt: string | null; muted: boolean }[]; prefs: NotifPrefs };

const SEV_RANK: Record<string, number> = { INFO: 0, WARNING: 1, CRITICAL: 2 };

export default function NotificationPrefsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useErpStore((s) => s.toast);
  const user = useErpStore((s) => s.sessionUser);

  const { data } = useQuery<FullFeed>({
    queryKey: ["notifications-full", user?.username],
    queryFn: () => api<FullFeed>("/api/notifications?includeMuted=1"),
    enabled: open && !!user,
  });

  const [draft, setDraft] = useState<NotifPrefs | null>(null);
  const prefs: NotifPrefs = draft ?? data?.prefs ?? { mutedKinds: [], minSeverity: "ALL", digest: false };

  /** Close + drop the local draft so the next open re-syncs from the server. */
  const closeAndReset = () => {
    setDraft(null);
    onClose();
  };

  const save = useMutation({
    mutationFn: (p: NotifPrefs) => api("/api/notifications", { method: "PUT", body: p }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["notifications"] });
      void qc.invalidateQueries({ queryKey: ["notifications-full"] });
      toast("Notification preferences saved (audited)");
      closeAndReset();
    },
    onError: (e: Error) => toast(e.message, "err"),
  });

  // impact preview against the stored feed
  const stored = data?.notifications ?? [];
  const wouldHide = stored.filter(
    (n) => prefs.mutedKinds.includes(n.kind) || (SEV_RANK[n.severity] ?? 0) < (SEV_RANK[prefs.minSeverity] ?? 0),
  );
  const wouldHideUnread = wouldHide.filter((n) => !n.readAt).length;

  const toggleKind = (kind: string) =>
    setDraft((d0) => {
      const cur = d0 ?? data?.prefs ?? { mutedKinds: [], minSeverity: "ALL" as const, digest: false };
      return { ...cur, mutedKinds: cur.mutedKinds.includes(kind) ? cur.mutedKinds.filter((k) => k !== kind) : [...cur.mutedKinds, kind] };
    });

  return (
    <Dialog open={open} onOpenChange={(v) => !v && closeAndReset()}>
      <DialogContent className="max-h-[88vh] max-w-lg overflow-y-auto erp-scroll bg-zinc-950 border-border/80">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base"><Bell className="h-4 w-4 text-primary" /> Notification preferences — {user?.name ?? "—"}</DialogTitle>
          <DialogDescription>Per-user delivery rules. Muted kinds and sub-floor severities stay stored — they are hidden from the bell badge &amp; feed (audited on save).</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* severity floor */}
          <div>
            <Label className="text-[12px]">Minimum severity floor</Label>
            <div className="mt-1.5 grid grid-cols-3 gap-1.5" role="radiogroup" aria-label="Minimum severity">
              {FLOORS.map((f) => {
                const active = prefs.minSeverity === f.value;
                return (
                  <button
                    key={f.value}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => setDraft((d0) => ({ ...(d0 ?? prefs), minSeverity: f.value }))}
                    className={cn(
                      "rounded-md border px-2 py-2 text-left transition-colors",
                      active ? "border-primary/60 bg-primary/10" : "border-border/60 bg-background/40 hover:bg-accent/30",
                    )}
                  >
                    <span className={cn("block text-[12px] font-medium", active && "text-primary-foreground")}>{f.label}</span>
                    <span className="block text-[9.5px] leading-tight text-muted-foreground">{f.hint}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* muted kinds */}
          <div>
            <Label className="text-[12px]">Muted event kinds <span className="font-normal text-muted-foreground">— {prefs.mutedKinds.length} of {NOTIF_KIND_META.length} muted</span></Label>
            <div className="mt-1.5 space-y-1.5">
              {NOTIF_KIND_META.map((m) => {
                const muted = prefs.mutedKinds.includes(m.kind);
                const Icon = muted ? BellOff : m.icon;
                return (
                  <button
                    key={m.kind}
                    type="button"
                    onClick={() => toggleKind(m.kind)}
                    aria-pressed={muted}
                    className={cn(
                      "flex w-full items-center gap-2.5 rounded-md border px-2.5 py-2 text-left transition-colors",
                      muted ? "border-red-500/30 bg-red-500/5" : "border-border/60 bg-background/40 hover:bg-accent/30",
                    )}
                  >
                    <Icon className={cn("h-3.5 w-3.5 shrink-0", muted ? "text-red-400" : "text-muted-foreground")} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[12px] font-medium">{m.label} <span className="ml-1 font-mono text-[9.5px] text-muted-foreground">{m.kind}</span></span>
                      <span className="block text-[10.5px] leading-tight text-muted-foreground">{m.desc}</span>
                    </span>
                    <span className={cn("shrink-0 rounded-full border px-2 py-0.5 text-[9.5px] uppercase tracking-wide", muted ? "border-red-500/40 bg-red-500/10 text-red-300" : "border-border/60 text-muted-foreground")}>
                      {muted ? "muted" : "on"}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* digest mode */}
          <div className="flex items-center justify-between gap-3 rounded-md border border-border/60 bg-background/40 px-3 py-2.5">
            <div>
              <Label className="text-[12px]">Digest mode</Label>
              <p className="text-[10.5px] leading-tight text-muted-foreground">Bell shows a per-kind digest with counts instead of the full feed.</p>
            </div>
            <Switch
              checked={prefs.digest}
              onCheckedChange={(v) => setDraft((d0) => ({ ...(d0 ?? prefs), digest: v }))}
              aria-label="Toggle digest mode"
            />
          </div>

          {/* impact preview */}
          <div className={cn("rounded-md border px-3 py-2.5 text-[12px]", wouldHide.length ? "border-amber-500/30 bg-amber-500/5 text-amber-300" : "border-emerald-500/30 bg-emerald-500/5 text-emerald-300")}>
            <span className="flex items-start gap-2">
              {wouldHide.length ? <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : <Bell className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
              <span>
                {stored.length === 0
                  ? "No stored notifications for your role yet."
                  : wouldHide.length
                    ? <>Preview: <b>{wouldHide.length}</b> of {stored.length} stored events will be hidden{wouldHideUnread ? <> — including <b>{wouldHideUnread}</b> unread</> : ""}. Nothing is deleted; unmute to see them again.</>
                    : "Preview: every stored event will remain visible."}
              </span>
            </span>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={closeAndReset}>Cancel</Button>
          <Button size="sm" className="gap-1.5" disabled={save.isPending || !draft} onClick={() => draft && save.mutate(draft)}>
            <Save className="h-3.5 w-3.5" /> {save.isPending ? "Saving…" : "Save preferences"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
