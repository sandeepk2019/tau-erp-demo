"use client";
// ============================================================================
// Tau ERP — Shift Handover log (production module).
// Outgoing shift supervisor logs what happened / issues / carry-over; the
// incoming shift acknowledges under FOUR-EYES (acknowledger ≠ author,
// server-enforced). POST /api/shifts · GET /api/shifts
// ============================================================================
import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/erp/api-client";
import { useErpStore, type SessionUser } from "@/store/erp-store";
import { SHIFTS } from "@/lib/erp/constants";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  AlertTriangle, ArrowRightLeft, Check, ClipboardList, HardHat, Plus, ShieldAlert, Users, X,
} from "lucide-react";

type Issue = { issue: string; severity: string };
type Handover = {
  id: string; shiftDate: string; shift: string; area: string; woNumber: string;
  authorName: string; headcount: number; summary: string;
  issues: Issue[]; carryOver: string[]; safetyNote: string;
  status: string; acknowledgedBy: string; acknowledgedAt: string | null; createdAt: string;
};

const SEVERITY_TONE: Record<string, string> = {
  LOW: "border-zinc-500/40 bg-zinc-500/10 text-zinc-300",
  MEDIUM: "border-amber-500/40 bg-amber-500/10 text-amber-300",
  HIGH: "border-red-500/40 bg-red-500/10 text-red-300",
};

export default function ShiftHandoverTab({ sessionUser }: { sessionUser: SessionUser | null }) {
  const qc = useQueryClient();
  const toast = useErpStore((s) => s.toast);
  const [createOpen, setCreateOpen] = useState(false);

  const q = useQuery<{ shifts: Handover[] }>({
    queryKey: ["shifts"],
    queryFn: () => api<{ shifts: Handover[] }>("/api/shifts"),
  });
  const shifts = q.data?.shifts ?? [];
  const openCount = shifts.filter((s) => s.status === "OPEN").length;

  const ack = useMutation({
    mutationFn: (id: string) => api("/api/shifts", { body: { action: "acknowledge", id } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["shifts"] });
      toast("Handover acknowledged — incoming shift has read the log (audited)");
    },
    onError: (e: Error) => toast(e.message, "err"),
  });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-[11px] text-muted-foreground flex-1 min-w-[220px]">
          Outgoing supervisor logs the shift → incoming shift <b>acknowledges</b> under four-eyes
          (acknowledger must differ from the author — server-enforced). Open handovers: <b className="text-amber-300">{openCount}</b>
        </p>
        <Button size="sm" className="h-8 gap-1.5" onClick={() => setCreateOpen(true)}>
          <Plus className="h-3.5 w-3.5" /> New handover
        </Button>
      </div>

      {q.isLoading && <div className="h-32 rounded bg-muted animate-pulse" />}
      {!q.isLoading && shifts.length === 0 && (
        <div className="rounded-lg border border-dashed border-border/60 p-8 text-center text-[13px] text-muted-foreground">
          No handovers logged yet — the first shift of the day should record one before handover.
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
        {shifts.map((s) => {
          const shiftMeta = SHIFTS.find((x) => x.code === s.shift);
          const isAuthor = s.authorName === sessionUser?.username;
          return (
            <div
              key={s.id}
              className={cn(
                "rounded-lg border bg-background/40 p-4 space-y-3 transition-colors",
                s.status === "OPEN" ? "border-amber-500/30" : "border-border/60"
              )}
            >
              <div className="flex items-start justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant="outline" className="border-primary/40 bg-primary/10 text-primary font-mono text-[10px]">
                    SHIFT {s.shift}
                  </Badge>
                  <span className="text-[13px] font-medium">{shiftMeta?.name ?? s.shift}</span>
                  {s.area && <Badge variant="outline" className="text-[10px] border-zinc-500/40 text-zinc-300">{s.area}</Badge>}
                  {s.woNumber && <Badge variant="outline" className="text-[10px] border-teal-500/40 text-teal-300 font-mono">{s.woNumber}</Badge>}
                </div>
                {s.status === "OPEN" ? (
                  <Badge variant="outline" className="text-[10px] border-amber-500/40 bg-amber-500/10 text-amber-300 gap-1">
                    <AlertTriangle className="h-3 w-3" /> OPEN — awaiting acknowledgment
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-[10px] border-emerald-500/40 bg-emerald-500/10 text-emerald-300 gap-1">
                    <Check className="h-3 w-3" /> ack by {s.acknowledgedBy}
                  </Badge>
                )}
              </div>

              <p className="text-[12.5px] leading-relaxed">{s.summary}</p>

              {s.issues.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3 text-amber-400" /> Open issues
                  </p>
                  {s.issues.map((i, idx) => (
                    <div key={idx} className="flex items-start gap-2 text-[12px]">
                      <Badge variant="outline" className={cn("text-[9px] px-1.5 py-0 shrink-0", SEVERITY_TONE[i.severity] ?? SEVERITY_TONE.LOW)}>
                        {i.severity}
                      </Badge>
                      <span className="min-w-0">{i.issue}</span>
                    </div>
                  ))}
                </div>
              )}

              {s.carryOver.length > 0 && (
                <div className="space-y-1">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                    <ArrowRightLeft className="h-3 w-3 text-teal-300" /> Carry-over into next shift
                  </p>
                  <ul className="list-disc pl-4 space-y-0.5">
                    {s.carryOver.map((c, idx) => <li key={idx} className="text-[12px]">{c}</li>)}
                  </ul>
                </div>
              )}

              {s.safetyNote && (
                <div className="rounded-md border border-red-500/30 bg-red-500/5 px-2.5 py-1.5 text-[12px] text-red-300 flex items-start gap-1.5">
                  <ShieldAlert className="h-3.5 w-3.5 mt-0.5 shrink-0" /> {s.safetyNote}
                </div>
              )}

              <div className="flex items-center justify-between gap-2 flex-wrap pt-1 border-t border-border/40">
                <span className="text-[11px] text-muted-foreground flex items-center gap-2 flex-wrap">
                  <HardHat className="h-3.5 w-3.5" /> by <span className="font-mono text-foreground/80">{s.authorName}</span>
                  <span className="inline-flex items-center gap-1"><Users className="h-3 w-3" />{s.headcount} on shift</span>
                  · {new Date(s.shiftDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}
                </span>
                {s.status === "OPEN" && (
                  <Button
                    size="sm" variant={isAuthor ? "ghost" : "outline"}
                    className="h-7 gap-1 text-[11px]"
                    disabled={isAuthor || ack.isPending}
                    title={isAuthor ? "Four-eyes: the incoming shift must acknowledge (switch user)" : "Acknowledge on behalf of the incoming shift"}
                    onClick={() => ack.mutate(s.id)}
                  >
                    <Check className="h-3 w-3" /> Acknowledge
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {createOpen && <CreateHandoverDialog onClose={() => setCreateOpen(false)} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Create dialog
// ---------------------------------------------------------------------------
function CreateHandoverDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useErpStore((s) => s.toast);
  const [shift, setShift] = useState("A");
  const [shiftDate, setShiftDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [area, setArea] = useState("");
  const [woNumber, setWoNumber] = useState("");
  const [headcount, setHeadcount] = useState("6");
  const [summary, setSummary] = useState("");
  const [safetyNote, setSafetyNote] = useState("");
  const [carryOver, setCarryOver] = useState("");
  const [issues, setIssues] = useState<Issue[]>([{ issue: "", severity: "MEDIUM" }]);

  const create = useMutation({
    mutationFn: () =>
      api("/api/shifts", {
        body: {
          action: "create", shift, shiftDate,
          area: area.trim(), woNumber: woNumber.trim().toUpperCase(),
          headcount: Math.max(0, Math.floor(Number(headcount) || 0)),
          summary: summary.trim(),
          issues: issues.filter((i) => i.issue.trim()),
          carryOver: carryOver.split("\n").map((l) => l.trim()).filter(Boolean),
          safetyNote: safetyNote.trim(),
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["shifts"] });
      toast("Shift handover logged — incoming shift notified (PROD_SUP role broadcast)");
      onClose();
    },
    onError: (e: Error) => toast(e.message, "err"),
  });

  const valid = summary.trim().length >= 5;

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[88vh] overflow-y-auto erp-scroll">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base"><ClipboardList className="h-4 w-4 text-primary" /> Log shift handover</DialogTitle>
          <DialogDescription>
            Tell the incoming shift what they must know. Every mutation is audited; the handover then requires acknowledgment by a different user.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3.5">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="space-y-1.5">
              <Label className="text-[12px]">Shift</Label>
              <Select value={shift} onValueChange={setShift}>
                <SelectTrigger className="h-8 bg-input/60 text-[12px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {SHIFTS.map((s) => <SelectItem key={s.code} value={s.code}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-[12px]">Date</Label>
              <Input type="date" className="h-8 bg-input/60" value={shiftDate} onChange={(e) => setShiftDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[12px]">Area / line</Label>
              <Input className="h-8 bg-input/60" placeholder="e.g. LINE-NOX" value={area} onChange={(e) => setArea(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[12px]">Headcount</Label>
              <Input type="number" min={0} className="h-8 bg-input/60" value={headcount} onChange={(e) => setHeadcount(e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-[12px]">Focus work order <span className="text-muted-foreground">(optional)</span></Label>
              <Input className="h-8 bg-input/60 font-mono" placeholder="WO-2025-0004" value={woNumber} onChange={(e) => setWoNumber(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[12px]">Safety note <span className="text-muted-foreground">(optional)</span></Label>
              <Input className="h-8 bg-input/60" placeholder="e.g. Oven area barricaded until maintenance clears" value={safetyNote} onChange={(e) => setSafetyNote(e.target.value)} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-[12px]">Shift summary <span className="text-red-400">*</span></Label>
            <Textarea
              className="min-h-[64px] bg-input/60 text-[12.5px]"
              placeholder="What happened during the shift: output, down-time, quality events, staffing…"
              value={summary} onChange={(e) => setSummary(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label className="text-[12px]">Open issues</Label>
              <Button size="sm" variant="ghost" className="h-6 gap-1 text-[11px]" onClick={() => setIssues((v) => [...v, { issue: "", severity: "MEDIUM" }])}>
                <Plus className="h-3 w-3" /> Add issue
              </Button>
            </div>
            {issues.map((i, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <Select
                  value={i.severity}
                  onValueChange={(v) => setIssues((arr) => arr.map((x, j) => (j === idx ? { ...x, severity: v } : x)))}
                >
                  <SelectTrigger className="h-8 w-[110px] bg-input/60 text-[11px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["LOW", "MEDIUM", "HIGH"].map((sv) => <SelectItem key={sv} value={sv}>{sv}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Input
                  className="h-8 flex-1 bg-input/60 text-[12px]"
                  placeholder="e.g. Potting oven T-2 overtemp alarm — maintenance informed"
                  value={i.issue}
                  onChange={(e) => setIssues((arr) => arr.map((x, j) => (j === idx ? { ...x, issue: e.target.value } : x)))}
                />
                <Button
                  size="sm" variant="ghost" className="h-8 px-2 text-muted-foreground hover:text-red-300"
                  disabled={issues.length === 1}
                  onClick={() => setIssues((arr) => arr.filter((_, j) => j !== idx))}
                  aria-label="Remove issue"
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>

          <div className="space-y-1.5">
            <Label className="text-[12px]">Carry-over tasks <span className="text-muted-foreground">(one per line)</span></Label>
            <Textarea
              className="min-h-[48px] bg-input/60 text-[12px]"
              placeholder={"Complete OP-SUBASSY start on WO-2025-0004 first thing\nFollow up oven T-2 maintenance ticket"}
              value={carryOver} onChange={(e) => setCarryOver(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" disabled={!valid || create.isPending} onClick={() => create.mutate()}>
            Log handover
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
