"use client";
// ============================================================================
// Tau ERP — WO Schedule Board (Gantt) — Production module tab.
// Timeline of work orders from plannedStart (fallback: today) to dueDate with
// progress fill (qtyCompleted/qtyPlanned), status colour, priority mark, SO link
// and an overdue treatment. Pure client-side render over /api/work-orders data.
// ============================================================================
import React, { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { FAMILIES } from "@/lib/erp/constants";
import { Mono, SectionHeader, StatCard } from "../../shared";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CalendarRange, Factory, ShieldAlert, TriangleAlert, Truck } from "lucide-react";

export type SchedWo = {
  id: string; woNumber: string; status: string; priority: string;
  qtyPlanned: number; qtyCompleted: number; qtyScrapped: number;
  dueDate: string | null; soNumber: string; familyCode: string;
  plannedStart: string | null;
  item: { partNumber: string; name: string; familyCode: string };
  ncrOpen?: number; ncrTotal?: number; reworkOpen?: number;
};

const DAY = 86_400_000;
const STATUS_BAR: Record<string, string> = {
  CREATED: "bg-zinc-400/70",
  RELEASED: "bg-amber-400",
  IN_PROGRESS: "bg-amber-400",
  COMPLETED: "bg-emerald-400",
  CANCELLED: "bg-zinc-600",
};
const FAMILY_COLORS: Record<string, string> = Object.fromEntries(FAMILIES.map((f) => [f.code, f.color]));

export default function ScheduleBoard({
  wos,
  loading,
  onOpenWo,
}: {
  wos: SchedWo[];
  loading?: boolean;
  onOpenWo: (woNumber: string) => void;
}) {
  const [focus, setFocus] = useState<string | null>(null); // clicked WO row highlight

  const board = useMemo(() => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const open = wos.filter((w) => !["CANCELLED"].includes(w.status));
    const starts = open.map((w) => w.plannedStart ? new Date(w.plannedStart).getTime() : today.getTime());
    const dues = open.map((w) => w.dueDate ? new Date(w.dueDate).getTime() : today.getTime() + 14 * DAY);
    const min = Math.min(today.getTime() - 5 * DAY, ...starts);
    const max = Math.max(today.getTime() + 7 * DAY, ...dues);
    const startDay = new Date(min); startDay.setHours(0, 0, 0, 0);
    const endDay = new Date(max); endDay.setHours(0, 0, 0, 0);
    const span = Math.max(7, Math.round((endDay.getTime() - startDay.getTime()) / DAY) + 1);
    return { startDay, span, today };
  }, [wos]);

  const dayWidth = Math.max(26, Math.min(44, Math.round(1080 / board.span)));
  const trackWidth = board.span * dayWidth;

  const dayMarks = useMemo(() => {
    const marks: { date: Date; isMonday: boolean; isWeekend: boolean }[] = [];
    for (let i = 0; i < board.span; i++) {
      const d = new Date(board.startDay.getTime() + i * DAY);
      marks.push({ date: d, isMonday: d.getDay() === 1, isWeekend: d.getDay() === 0 || d.getDay() === 6 });
    }
    return marks;
  }, [board]);

  const rows = useMemo(
    () =>
      [...wos]
        .filter((w) => w.status !== "CANCELLED")
        .sort((a, b) => {
          const ad = a.dueDate ? new Date(a.dueDate).getTime() : Infinity;
          const bd = b.dueDate ? new Date(b.dueDate).getTime() : Infinity;
          return ad - bd;
        }),
    [wos],
  );

  const openCount = rows.filter((w) => ["CREATED", "RELEASED", "IN_PROGRESS"].includes(w.status)).length;
  const overdue = rows.filter(
    (w) => w.dueDate && new Date(w.dueDate) < new Date() && ["CREATED", "RELEASED", "IN_PROGRESS"].includes(w.status),
  ).length;
  const dueThisWeek = rows.filter((w) => {
    if (!w.dueDate) return false;
    const t = new Date(w.dueDate).getTime();
    return t >= board.today.getTime() && t < board.today.getTime() + 7 * DAY && openStatus(w.status);
  }).length;

  // Quality anomaly: scrap rate > 5% OR open NCR(s) OR open rework order(s)
  const scrapPctOf = (w: SchedWo) => (w.qtyPlanned > 0 ? (w.qtyScrapped / w.qtyPlanned) * 100 : 0);
  const anomalyOf = (w: SchedWo) => {
    const scrapPct = scrapPctOf(w);
    const reasons: string[] = [];
    if (scrapPct > 5) reasons.push(`scrap ${scrapPct.toFixed(1)}%`);
    if ((w.ncrOpen ?? 0) > 0) reasons.push(`${w.ncrOpen} open NCR${(w.ncrOpen ?? 0) === 1 ? "" : "s"}`);
    if ((w.reworkOpen ?? 0) > 0) reasons.push(`${w.reworkOpen} open rework`);
    return reasons;
  };
  const flagged = rows.map((w) => ({ w, reasons: anomalyOf(w) })).filter((x) => x.reasons.length > 0);

  const pct = (w: SchedWo) => (w.qtyPlanned ? Math.min(100, Math.round(((w.qtyCompleted + w.qtyScrapped) / w.qtyPlanned) * 100)) : 0);

  return (
    <div className="space-y-4" data-testid="schedule-board">
      <SectionHeader
        icon={CalendarRange}
        title="WO Schedule Board"
        desc="plannedStart → dueDate timeline with live progress · click a bar to open the work order"
        actions={
          <Badge variant="outline" className="text-[10px] border-border/70 text-muted-foreground">
            {board.span}-day window from {fmtDay(board.startDay)}
          </Badge>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Open on board" value={openCount} sub="created + released + in progress" icon={Factory} />
        <StatCard label="Due within 7 days" value={dueThisWeek} sub="upcoming deadlines" icon={Truck} tone={dueThisWeek > 0 ? "warn" : "good"} />
        <StatCard label="Overdue" value={overdue} sub={overdue ? "past due date, still open" : "everything on time"} icon={TriangleAlert} tone={overdue ? "bad" : "good"} />
        <StatCard
          label="Quality exceptions"
          value={flagged.length}
          sub={flagged.length ? "scrap >5% · NCR · rework (see ⚠)" : "no scrap/NCR anomalies"}
          icon={ShieldAlert}
          tone={flagged.length ? "warn" : "good"}
        />
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2 flex-wrap">
            <CalendarRange className="h-4 w-4 text-primary" /> Timeline
            <span className="text-[11px] font-normal text-muted-foreground">— bar fill = completed+scrapped share · today marker · weekend shading</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto erp-scroll">
          {loading ? (
            <div className="h-48 rounded bg-muted animate-pulse" />
          ) : rows.length === 0 ? (
            <p className="text-[12px] text-muted-foreground py-8 text-center">No work orders to schedule.</p>
          ) : (
            <div className="min-w-fit">
              {/* DAY HEADER */}
              <div className="flex">
                <div className="sticky left-0 z-20 bg-card w-[210px] shrink-0 border-b border-r border-border/60 px-2 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                  Work order
                </div>
                <div className="relative border-b border-border/60" style={{ width: trackWidth }}>
                  <div className="flex">
                    {dayMarks.map((m, i) => (
                      <div
                        key={i}
                        className={cn(
                          "shrink-0 py-1 text-center text-[9px] leading-tight border-l border-border/40",
                          m.isWeekend && "bg-zinc-900/60",
                        )}
                        style={{ width: dayWidth }}
                      >
                        <div className={cn(m.date.toDateString() === board.today.toDateString() ? "text-primary font-bold" : "text-muted-foreground")}>
                          {m.date.getDate()}
                        </div>
                        <div className="text-[8px] text-muted-foreground/60">{["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"][m.date.getDay()]}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* ROWS */}
              {rows.map((w) => {
                const s = w.plannedStart ? new Date(w.plannedStart) : board.today;
                s.setHours(0, 0, 0, 0);
                const due = w.dueDate ? new Date(w.dueDate) : new Date(board.today.getTime() + 14 * DAY);
                due.setHours(0, 0, 0, 0);
                const offset = Math.max(0, Math.round((s.getTime() - board.startDay.getTime()) / DAY));
                const len = Math.max(1, Math.round((due.getTime() - s.getTime()) / DAY) + 1);
                const isOverdue = w.dueDate && new Date(w.dueDate) < new Date() && openStatus(w.status);
                const progress = pct(w);
                const focused = focus === w.woNumber;
                const reasons = anomalyOf(w);
                const scrapPct = scrapPctOf(w);
                return (
                  <div
                    key={w.id}
                    className={cn(
                      "flex items-stretch border-b border-border/30 cursor-pointer transition-colors hover:bg-zinc-900/50",
                      focused && "bg-primary/5",
                      reasons.length > 0 && !focused && "bg-red-500/[0.03]",
                    )}
                    onClick={() => { setFocus(focused ? null : w.woNumber); onOpenWo(w.woNumber); }}
                  >
                    {/* LABEL */}
                    <div className="sticky left-0 z-10 bg-card w-[210px] shrink-0 px-2 py-1.5 border-r border-border/40 group-hover:bg-zinc-900/50">
                      <div className="flex items-center gap-1.5">
                        <Mono className="text-primary text-[11px]">{w.woNumber}</Mono>
                        {w.priority === "HIGH" && <span className="text-[9px] text-amber-400 font-bold">HIGH</span>}
                        {w.priority === "CRITICAL" && <span className="text-[9px] text-red-400 font-bold">CRIT</span>}
                        {reasons.length > 0 && (
                          <span
                            className="ml-auto inline-flex items-center gap-0.5 rounded-full border border-red-500/40 bg-red-500/10 px-1.5 py-px text-[9px] font-semibold text-red-300"
                            title={`Quality exceptions: ${reasons.join(" · ")} — open the WO for the NCR/rework trail`}
                          >
                            ⚠ {reasons.length}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                        <span
                          className="inline-block h-1.5 w-1.5 rounded-full"
                          style={{ background: FAMILY_COLORS[w.familyCode] ?? "#a1a1aa" }}
                        />
                        <span className="truncate max-w-[92px]">{w.item.partNumber}</span>
                        <span>· {w.qtyCompleted}/{w.qtyPlanned}</span>
                        {w.qtyScrapped > 0 && <span className="tabular text-red-300/90" title={`${w.qtyScrapped} scrapped (${scrapPct.toFixed(1)}%)`}>· ✕{w.qtyScrapped}</span>}
                        {w.soNumber && <Mono className="text-teal-300/80 text-[9px]">{w.soNumber.replace("SO-", "")}</Mono>}
                      </div>
                    </div>

                    {/* TRACK */}
                    <div className="relative py-2" style={{ width: trackWidth }}>
                      {/* weekend + grid */}
                      <div className="absolute inset-0 flex pointer-events-none">
                        {dayMarks.map((m, i) => (
                          <div key={i} className={cn("shrink-0 border-l border-border/30 h-full", m.isWeekend && "bg-zinc-900/40")} style={{ width: dayWidth }} />
                        ))}
                      </div>
                      {/* today marker */}
                      {board.today >= board.startDay && board.today <= new Date(board.startDay.getTime() + board.span * DAY) && (
                        <div
                          className="absolute top-0 bottom-0 w-px bg-primary/70 z-10 pointer-events-none"
                          style={{ left: Math.round((board.today.getTime() - board.startDay.getTime()) / DAY) * dayWidth + dayWidth / 2 }}
                        />
                      )}
                      {/* BAR */}
                      <div
                        className={cn(
                          "absolute h-5 rounded-md overflow-hidden border bg-zinc-800/70 transition-all",
                          isOverdue ? "border-red-400/70" : "border-border/70",
                          focused && "ring-1 ring-primary/60",
                        )}
                        style={{ left: offset * dayWidth + 2, width: len * dayWidth - 4, top: 10 }}
                        title={`${w.woNumber} · ${fmtDay(s)} → ${fmtDay(due)} · ${progress}% done${isOverdue ? " · OVERDUE" : ""}${reasons.length ? ` · QUALITY: ${reasons.join(", ")}` : ""}`}
                      >
                        <div className={cn("h-full opacity-90", STATUS_BAR[w.status] ?? "bg-zinc-500")} style={{ width: `${Math.max(progress, 4)}%` }} />
                        <div className="absolute inset-0 flex items-center px-1.5">
                          <span className="text-[9px] font-semibold text-zinc-950/90 mix-blend-plus-lighter truncate">
                            {progress}%{isOverdue ? " · overdue" : ""}
                          </span>
                        </div>
                        {reasons.length > 0 && (
                          <span className="absolute right-1 top-1/2 -translate-y-1/2 h-1.5 w-1.5 rounded-full bg-red-400" />
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}

              {/* LEGEND */}
              <div className="flex flex-wrap items-center gap-3 pt-3 text-[10.5px] text-muted-foreground">
                {["CREATED", "RELEASED", "IN_PROGRESS", "COMPLETED"].map((s) => (
                  <span key={s} className="inline-flex items-center gap-1">
                    <span className={cn("inline-block h-2.5 w-4 rounded-sm", STATUS_BAR[s])} /> {s.replace(/_/g, " ")}
                  </span>
                ))}
                <span className="inline-flex items-center gap-1">
                  <span className="inline-block h-3 w-px bg-primary/70" /> today
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="inline-block h-2.5 w-4 rounded-sm border border-red-400/70" /> overdue border
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="inline-flex h-4 items-center rounded-full border border-red-500/40 bg-red-500/10 px-1.5 text-[9px] font-semibold text-red-300">⚠ n</span>
                  quality exception (scrap &gt;5% · open NCR · open rework)
                </span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <p className="text-[10.5px] text-muted-foreground">
        Scheduling is advisory on the board — the binding gates remain server-side (route sequence, DR-006 qualification,
        BOM/route release checks). WOs without plannedStart are shown starting today; window auto-fits the data.
      </p>
    </div>
  );
}

function openStatus(s: string) {
  return ["CREATED", "RELEASED", "IN_PROGRESS"].includes(s);
}
function fmtDay(d: Date) {
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
}
