"use client";
// ============================================================================
// Tau ERP — Engineering ▸ Tab 4: APQP / PPAP (programme gates + submission)
// Gate timeline per project; advance-gate requires engineering.approve and
// is sequence-enforced server-side. PPAP evidence register shown as chips.
// ============================================================================
import React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/erp/api-client";
import { useErpStore } from "@/store/erp-store";
import {
  DateCell, EmptyState, Mono, Progress, StatusBadge,
} from "../../shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { ApqpPayload, ApqpProjectDto } from "./types";
import { ArrowRightCircle, CalendarDays, FileCheck2, Gauge, ListChecks } from "lucide-react";

type Props = { data?: ApqpPayload; loading: boolean; canApprove: boolean };

export default function ApqpTab({ data, loading, canApprove }: Props) {
  const toast = useErpStore((s) => s.toast);
  const qc = useQueryClient();
  const projects = data?.projects ?? [];

  const advanceGate = useMutation({
    mutationFn: (gateId: string) =>
      api("/api/apqp", { method: "POST", body: { action: "advance-gate", gateId } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["apqp"] });
      toast("Gate APPROVED — actual date recorded");
    },
    onError: (e: Error) => toast(e.message, "err"),
  });

  if (loading) return <div className="h-72 rounded-lg border bg-card animate-pulse" />;
  if (projects.length === 0) return <EmptyState icon={Gauge} message="No APQP programmes" />;

  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
      {projects.map((p) => (
        <ApqpCard key={p.id} project={p} canApprove={canApprove}
          advancing={advanceGate.isPending} onAdvance={(id) => advanceGate.mutate(id)} />
      ))}
    </div>
  );
}

function ApqpCard({ project: p, canApprove, onAdvance, advancing }: {
  project: ApqpProjectDto; canApprove: boolean; advancing: boolean; onAdvance: (gateId: string) => void;
}) {
  const approved = p.gates.filter((g) => g.status === "APPROVED").length;
  const pct = p.gates.length ? Math.round((approved / p.gates.length) * 100) : 0;
  const overdue = p.targetDate ? new Date(p.targetDate) < new Date() && p.status !== "CLOSED" : false;

  return (
    <Card className="bg-card/80 border-border/70">
      <CardContent className="p-4 space-y-3">
        {/* header */}
        <div className="flex items-start justify-between gap-2 flex-wrap">
          <div className="min-w-0">
            <p className="flex items-center gap-2 font-semibold text-[14px]">
              <Gauge className="h-4 w-4 text-primary shrink-0" />
              <Mono className="text-primary">{p.number}</Mono>
              <StatusBadge status={p.status} />
              {overdue && <StatusBadge status="DUE_SOON" />}
            </p>
            <p className="text-[12px] text-muted-foreground mt-0.5">{p.title}</p>
          </div>
          <div className="text-right text-[11px] text-muted-foreground leading-snug">
            <p><Mono className="text-foreground/80">{p.partNumber}</Mono></p>
            <p>{p.customerName || "—"} {p.programme && `· ${p.programme}`}</p>
            <p className="flex items-center justify-end gap-1">
              <CalendarDays className="h-3 w-3" /> <DateCell value={p.startDate} /> → <DateCell value={p.targetDate} />
            </p>
          </div>
        </div>

        <div className="space-y-1">
          <div className="flex justify-between text-[10px] uppercase tracking-wider text-muted-foreground">
            <span>Gate progress</span><span>{approved}/{p.gates.length}</span>
          </div>
          <Progress value={pct} tone={pct === 100 ? "good" : "primary"} />
        </div>

        {/* gates timeline */}
        <div className="space-y-1.5">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
            <ListChecks className="h-3.5 w-3.5" /> Gate timeline
          </p>
          {p.gates.map((g, idx) => {
            const prevOk = idx === 0 || p.gates[idx - 1].status === "APPROVED";
            const canAdvance = canApprove && g.status !== "APPROVED" && g.status !== "BLOCKED" && prevOk;
            return (
              <div key={g.id} className="flex items-center gap-2.5 rounded-md border border-border/50 bg-background/40 px-2.5 py-2">
                <span className={`rounded-full h-6 w-6 shrink-0 grid place-items-center text-[11px] font-mono ${
                  g.status === "APPROVED" ? "bg-emerald-500/15 text-emerald-300" : "bg-muted text-muted-foreground"
                }`}>{g.seq}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-[12px] font-medium truncate">{g.name}</p>
                  <p className="text-[10px] text-muted-foreground flex flex-wrap gap-x-3">
                    <span>planned <DateCell value={g.plannedDate} /></span>
                    <span>actual <DateCell value={g.actualDate} /></span>
                  </p>
                </div>
                <StatusBadge status={g.status} className="shrink-0" />
                {canAdvance && (
                  <Button size="sm" variant="outline" className="h-7 text-[11px] shrink-0"
                    disabled={advancing} onClick={() => onAdvance(g.id)}>
                    <ArrowRightCircle className="h-3.5 w-3.5" /> Approve
                  </Button>
                )}
              </div>
            );
          })}
        </div>

        {/* PPAP register */}
        {p.ppap.length > 0 && (
          <div className="space-y-1.5">
            <Separator />
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
              <FileCheck2 className="h-3.5 w-3.5" /> PPAP submissions
            </p>
            {p.ppap.map((s) => (
              <div key={s.id} className="rounded-md border border-border/50 bg-background/40 p-2.5 space-y-1.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <Mono className="text-primary">{s.number}</Mono>
                  <span className="text-[10px] rounded bg-muted px-1.5 py-0.5">Level {s.level}</span>
                  <StatusBadge status={s.status} />
                  {s.pswNumber && <span className="text-[11px] text-muted-foreground">PSW <Mono>{s.pswNumber}</Mono></span>}
                  <span className="text-[11px] text-muted-foreground ml-auto">submitted <DateCell value={s.submittedAt} /></span>
                </div>
                <div className="flex flex-wrap gap-1">
                  {s.evidence.map((e) => (
                    <span key={e} className="rounded border border-border/60 bg-muted/40 px-1.5 py-0.5 text-[10px] text-muted-foreground">{e}</span>
                  ))}
                </div>
                {s.disposition && <p className="text-[11px] text-muted-foreground">Disposition: {s.disposition}</p>}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
