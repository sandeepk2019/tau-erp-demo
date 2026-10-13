"use client";
// ============================================================================
// Tau ERP — Equipment calibration calendar (Quality → Equipment).
// Month grid of calibration due-dates across all registered equipment.
// Chip per equipment on its due day, coloured by gate state (EXPIRED/DUE_SOON/OK).
// Prev/next month navigation, today ring, due-in-30-days summary. Click chip to
// schedule (+90d) when the user holds quality.inspect — same action as the table.
// ============================================================================
import React, { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/erp/api-client";
import { useErpStore } from "@/store/erp-store";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChevronLeft, ChevronRight, CalendarDays } from "lucide-react";

export type CalEquipment = {
  id: string; code: string; name: string; kind: string; stationCode: string;
  calibrationDue: string | null; status: string;
};
export type CalState = "OK" | "DUE_SOON" | "EXPIRED" | "NONE";

export function calStateOf(due?: string | null): CalState {
  if (!due) return "NONE";
  const days = Math.ceil((new Date(due).getTime() - Date.now()) / 86_400_000);
  if (days < 0) return "EXPIRED";
  if (days <= 14) return "DUE_SOON"; // matches the register's calState gate (≤14d)
  return "OK";
}

const CHIP: Record<CalState, string> = {
  EXPIRED: "border-red-500/50 bg-red-500/15 text-red-300 hover:bg-red-500/30",
  DUE_SOON: "border-amber-500/50 bg-amber-500/15 text-amber-300 hover:bg-amber-500/30",
  OK: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20",
  NONE: "border-border/50 bg-background/40 text-muted-foreground",
};

const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

export default function CalibrationCalendar({
  equipment,
  canSchedule,
  loading,
}: {
  equipment: CalEquipment[];
  canSchedule: boolean;
  loading?: boolean;
}) {
  const qc = useQueryClient();
  const toast = useErpStore((s) => s.toast);
  const now = new Date();
  const [cursor, setCursor] = useState({ y: now.getFullYear(), m: now.getMonth() });
  const [busyId, setBusyId] = useState<string | null>(null);

  const schedule = async (e: CalEquipment) => {
    if (!canSchedule || busyId) return;
    setBusyId(e.id);
    try {
      await api("/api/equipment", { body: { action: "schedule", id: e.id } });
      toast(`${e.code} calibration scheduled (+90 days) — audit logged`);
      void qc.invalidateQueries({ queryKey: ["equipment"] });
      void qc.invalidateQueries({ queryKey: ["inspections"] });
    } catch (err) {
      toast(err instanceof Error ? err.message : "Schedule failed", "err");
    } finally {
      setBusyId(null);
    }
  };

  const grid = useMemo(() => {
    const first = new Date(cursor.y, cursor.m, 1);
    const startOffset = (first.getDay() + 6) % 7; // Monday-based
    const daysInMonth = new Date(cursor.y, cursor.m + 1, 0).getDate();
    const cells: { date: Date | null }[] = [];
    for (let i = 0; i < startOffset; i++) cells.push({ date: null });
    for (let d = 1; d <= daysInMonth; d++) cells.push({ date: new Date(cursor.y, cursor.m, d) });
    while (cells.length % 7 !== 0) cells.push({ date: null });
    return cells;
  }, [cursor]);

  // due map: yyyy-mm-dd → equipment[]
  const dueMap = useMemo(() => {
    const map = new Map<string, CalEquipment[]>();
    for (const e of equipment) {
      if (!e.calibrationDue) continue;
      const d = new Date(e.calibrationDue);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      (map.get(key) ?? map.set(key, []).get(key)!).push(e);
    }
    return map;
  }, [equipment]);

  const dueSoon = equipment.filter((e) => calStateOf(e.calibrationDue) === "DUE_SOON").length;
  const expired = equipment.filter((e) => calStateOf(e.calibrationDue) === "EXPIRED").length;
  const monthLabel = new Date(cursor.y, cursor.m, 1).toLocaleDateString("en-IN", { month: "long", year: "numeric" });
  const today = new Date();

  const move = (delta: number) => {
    const d = new Date(cursor.y, cursor.m + delta, 1);
    setCursor({ y: d.getFullYear(), m: d.getMonth() });
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center justify-between gap-2 flex-wrap">
          <span className="flex items-center gap-1.5">
            <CalendarDays className="h-4 w-4 text-primary" /> Calibration calendar
            <span className="text-[11px] font-normal text-muted-foreground">
              — {dueSoon} due ≤14d · {expired} expired{expired ? " (gate active)" : ""}
            </span>
          </span>
          <span className="flex items-center gap-1">
            <button
              className="rounded border border-border/60 p-1 hover:bg-zinc-900 transition-colors"
              onClick={() => move(-1)}
              aria-label="Previous month"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
            <span className="min-w-[120px] text-center text-[12px] font-medium">{monthLabel}</span>
            <button
              className="rounded border border-border/60 p-1 hover:bg-zinc-900 transition-colors"
              onClick={() => move(1)}
              aria-label="Next month"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="h-56 rounded bg-muted animate-pulse" />
        ) : (
          <div className="min-w-[640px]">
            <div className="grid grid-cols-7 border-b border-border/60">
              {WEEKDAYS.map((w) => (
                <div key={w} className="px-1 py-1 text-center text-[10px] font-medium text-muted-foreground">{w}</div>
              ))}
            </div>
            <div className="grid grid-cols-7">
              {grid.map((cell, i) => {
                const key = cell.date
                  ? `${cell.date.getFullYear()}-${String(cell.date.getMonth() + 1).padStart(2, "0")}-${String(cell.date.getDate()).padStart(2, "0")}`
                  : `empty-${i}`;
                const isToday = cell.date && cell.date.toDateString() === today.toDateString();
                const dues = cell.date ? dueMap.get(key) ?? [] : [];
                const weekend = cell.date && [0, 6].includes(cell.date.getDay());
                return (
                  <div
                    key={key}
                    className={cn(
                      "min-h-[64px] border-b border-r border-border/30 p-1 space-y-0.5",
                      weekend && "bg-zinc-950/50",
                      !cell.date && "opacity-30",
                    )}
                  >
                    {cell.date && (
                      <div className={cn(
                        "text-[10px] tabular px-0.5",
                        isToday ? "font-bold text-primary" : "text-muted-foreground",
                      )}>
                        {cell.date.getDate()}
                      </div>
                    )}
                    {dues.map((e) => {
                      const st = calStateOf(e.calibrationDue);
                      return (
                        <button
                          key={e.id}
                          title={`${e.code} — ${e.name} · due ${new Date(e.calibrationDue!).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })} · ${st}${canSchedule ? " · click to schedule +90d" : ""}`}
                          disabled={!canSchedule || busyId === e.id}
                          onClick={() => schedule(e)}
                          className={cn(
                            "w-full truncate rounded border px-1 py-0.5 text-left text-[9px] font-mono transition-colors",
                            CHIP[st],
                            !canSchedule && "cursor-default",
                          )}
                        >
                          {e.code}
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-3 text-[10px] text-muted-foreground">
              {(["EXPIRED", "DUE_SOON", "OK"] as CalState[]).map((s) => (
                <span key={s} className="inline-flex items-center gap-1">
                  <span className={cn("inline-block h-2.5 w-2.5 rounded-sm border", CHIP[s].split(" ").slice(0, 2).join(" "))} /> {s.replace("_", " ")}
                </span>
              ))}
              {canSchedule ? (
                <span>click a chip to schedule calibration (+90 days, audited)</span>
              ) : (
                <span>quality.inspect required to schedule</span>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
