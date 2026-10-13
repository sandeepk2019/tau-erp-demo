"use client";
// ============================================================================
// Tau ERP — Skill Matrix (DR-006 route qualifications) — Production module tab.
// Matrix of shop-floor users × skill codes. admin.manage roles can toggle cells
// (POST /api/skills — audited + user notified); everyone else read-only.
// Also shows the demand side: which RELEASED route steps require which skill.
// ============================================================================
import React, { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/erp/api-client";
import { useErpStore, type SessionUser } from "@/store/erp-store";
import { skillLabel, hasPerm } from "@/lib/erp/constants";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SectionHeader, StatCard } from "../../shared";
import { BadgeCheck, Download, GraduationCap, Info, Lock, ShieldCheck, Users } from "lucide-react";
import type { SkillsPayload } from "../production";

const ROLE_TONE: Record<string, string> = {
  OPERATOR: "border-zinc-500/40 bg-zinc-500/10 text-zinc-300",
  PROD_SUP: "border-amber-500/40 bg-amber-500/10 text-amber-300",
  QUALITY_MGR: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
  CALIB_ENG: "border-teal-500/40 bg-teal-500/10 text-teal-300",
};

// ---------------------------------------------------------------------------
// CSV export (round-8) — audit-evidence extract of the live matrix + demand.
// Long format: one row per person × skill with QUALIFIED / NOT_QUALIFIED verdict
// (auditors prefer explicit negatives), followed by the route-demand block.
// ---------------------------------------------------------------------------
function csvEscape(v: string | number): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function exportSkillMatrixCsv(payload: SkillsPayload) {
  const skills = payload.skills ?? [];
  const matrix = payload.matrix ?? [];
  const demands = payload.stepDemands ?? [];
  const stamp = new Date().toISOString().slice(0, 10);
  const rows: (string | number)[][] = [];
  rows.push(["section", "username", "name", "role", "skill_code", "skill_label", "verdict", "exported_at"]);
  for (const m of matrix) {
    for (const s of skills) {
      rows.push(["qualification", m.username, m.name, m.role, s.code, s.label, m.skills.includes(s.code) ? "QUALIFIED" : "NOT_QUALIFIED", stamp]);
    }
    // people with no skills must still appear as evidence
    if (skills.length === 0) rows.push(["qualification", m.username, m.name, m.role, "", "", "NO_SKILLS_ON_FILE", stamp]);
  }
  rows.push([]);
  rows.push(["section", "skill_code", "skill_label", "route_steps_required", "holders", "coverage"]);
  for (const d of demands) {
    const holders = matrix.filter((m) => m.skills.includes(d.skill)).length;
    const label = skills.find((s) => s.code === d.skill)?.label ?? "";
    rows.push(["demand", d.skill, label, d.steps, holders, holders === 0 ? "UNCOVERED" : "COVERED"]);
  }
  const csv = "\uFEFF" + rows.map((r) => r.map(csvEscape).join(",")).join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `tau-skill-matrix-${stamp}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function SkillMatrixTab({
  sessionUser,
  skillsQ,
}: {
  sessionUser: SessionUser | null;
  skillsQ: { data?: SkillsPayload; isLoading?: boolean };
}) {
  const qc = useQueryClient();
  const toast = useErpStore((s) => s.toast);
  const [pendingCell, setPendingCell] = useState<string | null>(null);

  const canManage = hasPerm(sessionUser?.role, "admin.manage");
  const skills = skillsQ.data?.skills ?? [];
  const matrix = skillsQ.data?.matrix ?? [];
  const demands = skillsQ.data?.stepDemands ?? [];
  const me = skillsQ.data?.me;

  const exportCsv = () => {
    if (!skillsQ.data) return;
    exportSkillMatrixCsv(skillsQ.data);
    toast(`Skill matrix exported — ${matrix.length} people × ${skills.length} skills (audit evidence)`);
  };

  const setSkills = useMutation<unknown, Error, { username: string; skills: string[] }>({
    mutationFn: (p) => api("/api/skills", { body: p }),
    onSuccess: (_d, vars) => {
      toast(`Skill matrix updated for ${vars.username} (audited · user notified)`);
      void qc.invalidateQueries({ queryKey: ["skills"] });
      void qc.invalidateQueries({ queryKey: ["job-cards"] });
      setPendingCell(null);
    },
    onError: (e) => {
      toast(e.message, "err");
      setPendingCell(null);
    },
  });

  const toggle = (username: string, current: string[], code: string) => {
    if (!canManage || setSkills.isPending) return;
    const key = `${username}:${code}`;
    setPendingCell(key);
    const next = current.includes(code) ? current.filter((s) => s !== code) : [...current, code];
    setSkills.mutate({ username, skills: next });
  };

  const operators = matrix.filter((m) => m.role === "OPERATOR");
  const fullyCross = matrix.filter((m) => skills.length > 0 && m.skills.length === skills.length).length;
  const gaps = skills.map((s) => ({ skill: s, holders: matrix.filter((m) => m.skills.includes(s.code)).length }));
  const uncoveredSkills = gaps.filter((g) => g.holders === 0).length;

  return (
    <div className="space-y-4" data-testid="skill-matrix">
      <SectionHeader
        icon={GraduationCap}
        title="Operator Skill Matrix — DR-006"
        desc="Route qualifications enforced at job-card start/resume · maintained by admins, audited on every change"
        actions={
          <span className="flex flex-wrap items-center gap-1.5">
            <Button
              variant="outline" size="sm" className="h-7 gap-1 text-[11px]"
              disabled={!skillsQ.data || matrix.length === 0}
              onClick={exportCsv}
              title="Download the live matrix + route-demand coverage as CSV (audit evidence)"
            >
              <Download className="h-3.5 w-3.5" /> Export CSV
            </Button>
            {canManage ? (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1 text-[11px] text-emerald-300">
                <ShieldCheck className="h-3.5 w-3.5" /> edit mode — click cells to toggle
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-background/60 px-2.5 py-1 text-[11px] text-muted-foreground">
                <Lock className="h-3.5 w-3.5" /> read-only — admin.manage required
              </span>
            )}
          </span>
        }
      />

      {/* MY QUALIFICATIONS BANNER */}
      {me && (
        <div className={cn(
          "rounded-lg border p-3 flex flex-wrap items-center gap-2",
          me.skills.length ? "border-primary/30 bg-primary/5" : "border-red-500/30 bg-red-500/5",
        )}>
          <BadgeCheck className="h-4 w-4 text-primary" />
          <span className="text-[12.5px]">
            You (<strong>{me.name}</strong> · {me.role}) hold{" "}
            {me.skills.length ? (
              me.skills.map((s) => (
                <span key={s} className="mx-0.5 inline-flex items-center rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-[10.5px] font-medium text-primary-foreground/90">
                  {s}
                </span>
              ))
            ) : (
              <span className="text-red-300 font-medium">no skills</span>
            )}
            {" "}— skill-tagged operations outside this list are server-blocked (DR-006).
          </span>
        </div>
      )}

      {/* STATS */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Qualified staff" value={matrix.length} sub="operators + supervisors on matrix" icon={Users} />
        <StatCard label="Operators" value={operators.length} sub="line operators" icon={Users} />
        <StatCard label="Cross-qualified (all skills)" value={fullyCross} sub={`hold all ${skills.length} skill codes`} icon={BadgeCheck} tone="good" />
        <StatCard
          label="Skills with no holder"
          value={uncoveredSkills}
          sub={uncoveredSkills ? "coverage risk — qualify someone" : "every skill has ≥1 holder"}
          icon={Lock}
          tone={uncoveredSkills ? "bad" : "good"}
        />
      </div>

      {/* MATRIX */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Users className="h-4 w-4 text-primary" /> Qualification matrix
            <span className="text-[11px] font-normal text-muted-foreground">— {skills.length} skills × {matrix.length} people</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto erp-scroll">
          {skillsQ.isLoading ? (
            <p className="text-[12px] text-muted-foreground py-6 text-center">Loading matrix…</p>
          ) : matrix.length === 0 ? (
            <p className="text-[12px] text-muted-foreground py-6 text-center">No shop-floor users on the matrix yet.</p>
          ) : (
            <table className="w-full min-w-[640px] border-separate border-spacing-0 text-[12px]">
              <thead>
                <tr>
                  <th className="sticky left-0 z-10 bg-card px-2 py-2 text-left font-medium text-muted-foreground border-b border-border/70 min-w-[170px]">Person</th>
                  {skills.map((s) => (
                    <th key={s.code} className="px-1.5 py-2 border-b border-border/70 text-center" title={s.label}>
                      <div className="flex flex-col items-center gap-0.5">
                        <span className="font-mono text-[10px] tracking-wide text-foreground/80">{s.code}</span>
                        <span className="text-[9px] leading-tight text-muted-foreground font-normal max-w-[92px] truncate">{s.label}</span>
                      </div>
                    </th>
                  ))}
                  <th className="px-2 py-2 border-b border-border/70 text-right text-[10px] font-medium text-muted-foreground">HELD</th>
                </tr>
              </thead>
              <tbody>
                {matrix.map((m) => {
                  const isMe = me?.username === m.username;
                  return (
                    <tr key={m.username} className={cn("group", isMe && "bg-primary/5")}>
                      <td className={cn(
                        "sticky left-0 z-10 bg-card px-2 py-2 border-b border-border/40 group-hover:bg-zinc-900/60 transition-colors",
                        isMe && "bg-zinc-900/80",
                      )}>
                        <div className="flex items-center gap-1.5">
                          <span className="font-medium text-[12px] whitespace-nowrap">{m.name}{isMe && <span className="text-primary"> (you)</span>}</span>
                          <span className={cn("rounded-full border px-1.5 py-px text-[9px]", ROLE_TONE[m.role] ?? "border-border text-muted-foreground")}>{m.role}</span>
                        </div>
                        <span className="font-mono text-[10px] text-muted-foreground">{m.username}</span>
                      </td>
                      {skills.map((s) => {
                        const held = m.skills.includes(s.code);
                        const key = `${m.username}:${s.code}`;
                        return (
                          <td key={s.code} className="border-b border-border/40 text-center">
                            <button
                              type="button"
                              disabled={!canManage || setSkills.isPending}
                              onClick={() => toggle(m.username, m.skills, s.code)}
                              title={`${m.name} · ${s.code} (${s.label}) — ${held ? "qualified" : "not qualified"}${canManage ? " · click to toggle" : ""}`}
                              className={cn(
                                "mx-auto flex h-7 w-7 items-center justify-center rounded-md border transition-all",
                                held
                                  ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-300"
                                  : "border-border/50 bg-background/40 text-transparent",
                                canManage && "hover:scale-110 hover:border-primary/60 cursor-pointer",
                                !canManage && "cursor-default",
                                pendingCell === key && "animate-pulse",
                              )}
                            >
                              {held ? <BadgeCheck className="h-4 w-4" /> : <span className="text-muted-foreground/30 text-[11px]">·</span>}
                            </button>
                          </td>
                        );
                      })}
                      <td className="border-b border-border/40 px-2 text-right">
                        <span className={cn("tabular text-[12px] font-semibold", m.skills.length >= skills.length ? "text-emerald-300" : m.skills.length === 0 ? "text-red-300" : "text-amber-300")}>
                          {m.skills.length}/{skills.length}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-3 text-[10.5px] text-muted-foreground">
            <span className="inline-flex items-center gap-1"><span className="inline-block h-3 w-3 rounded border border-emerald-500/50 bg-emerald-500/15" /> qualified — may start/resume skill-tagged ops</span>
            <span className="inline-flex items-center gap-1"><span className="inline-block h-3 w-3 rounded border border-border/50 bg-background/40" /> not qualified — server-blocked (DR-006)</span>
            {canManage && <span className="inline-flex items-center gap-1"><Info className="h-3 w-3" /> changes are audited + the user is notified</span>}
          </div>
        </CardContent>
      </Card>

      {/* DEMAND SIDE */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <GraduationCap className="h-4 w-4 text-primary" /> Route step demands
            <span className="text-[11px] font-normal text-muted-foreground">— RELEASED route revisions requiring each skill</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {demands.length === 0 ? (
            <p className="text-[12px] text-muted-foreground">No skill-tagged steps on RELEASED routes.</p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {demands.map((d) => {
                const holders = matrix.filter((m) => m.skills.includes(d.skill));
                const short = holders.length === 0;
                return (
                  <div key={d.skill} className={cn("rounded-lg border p-2.5", short ? "border-red-500/30 bg-red-500/5" : "border-border/60 bg-background/40")}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-[11.5px] font-semibold">{d.skill}</span>
                      <span className={cn("text-[10.5px]", short ? "text-red-300" : "text-emerald-300")}>
                        {holders.length} holder{holders.length === 1 ? "" : "s"}
                      </span>
                    </div>
                    <p className="mt-0.5 text-[10.5px] text-muted-foreground">{skillLabel(d.skill)} · {d.steps} step{d.steps === 1 ? "" : "s"}</p>
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {d.operations.map((op) => (
                        <Badge key={op} variant="outline" className="text-[9.5px] px-1.5 py-0 font-mono">{op}</Badge>
                      ))}
                      <span className="text-[9.5px] text-muted-foreground self-center ml-0.5">{d.families.join(" · ")}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

