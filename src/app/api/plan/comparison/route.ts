// ============================================================================
// Tau ERP — MRP planned vs actual comparison (per MRP run)
// GET /api/plan/comparison?runId=<id>   (runId optional → latest run)
// For every per-item suggestion stored on the run (net > 0 → planned = ⌈net⌉),
// finds the work orders actually created FROM that run (TravellerEvent kind=CREATED
// whose message references the run number) and compares planned vs actual quantity,
// WO status, completion progress and the resulting gap.
// Read-only, planning.view.
// ============================================================================
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ApiError, getSessionUser, handle, ok, parseJsonField, requirePerm } from "@/lib/erp/server";

type PerItemRow = { item: string; family?: string; net: number; override?: boolean };

export async function GET(req: NextRequest) {
  return handle(async () => {
    requirePerm(await getSessionUser(req), "planning.view");

    const runId = req.nextUrl.searchParams.get("runId")?.trim();
    const run = runId
      ? await db.mrpRun.findUnique({ where: { id: runId } })
      : await db.mrpRun.findFirst({ orderBy: { ranAt: "desc" } });
    if (!run) throw new ApiError("No MRP run found — run MRP first", 404);

    const summary = parseJsonField<{ perItem?: PerItemRow[] }>(run.summaryJson, {});
    const suggestions = (summary.perItem ?? []).filter((r) => r.net > 0);

    // Work orders actually created from this run (traveller CREATED events reference it)
    const events = await db.travellerEvent.findMany({
      where: { kind: "CREATED", message: { contains: run.number } },
      select: { woId: true, message: true },
    });
    const wos = events.length
      ? await db.workOrder.findMany({
          where: { id: { in: events.map((e) => e.woId) } },
          select: {
            woNumber: true, itemId: true, qtyPlanned: true, qtyCompleted: true, qtyScrapped: true,
            status: true, priority: true, dueDate: true,
            item: { select: { partNumber: true } },
          },
          orderBy: { woNumber: "asc" },
        })
      : [];

    const byItem = new Map<string, typeof wos>();
    for (const w of wos) {
      const pn = w.item.partNumber;
      let list = byItem.get(pn);
      if (!list) { list = []; byItem.set(pn, list); }
      list.push(w);
    }

    const rows = suggestions
      .map((r) => {
        const planned = Math.ceil(r.net);
        const linked = byItem.get(r.item) ?? [];
        const actualQty = linked.reduce((s, w) => s + w.qtyPlanned, 0);
        const doneQty = linked.reduce((s, w) => s + w.qtyCompleted, 0);
        const gap = actualQty - planned;
        const status = linked.length === 0 ? "NONE" : gap === 0 ? "EXACT" : gap > 0 ? "OVER" : "UNDER";
        return {
          item: r.item,
          family: r.family ?? "",
          override: !!r.override,
          planned,
          actualQty,
          doneQty,
          gap,
          status,
          wos: linked.map((w) => ({
            woNumber: w.woNumber, qtyPlanned: w.qtyPlanned, qtyCompleted: w.qtyCompleted,
            qtyScrapped: w.qtyScrapped, status: w.status, priority: w.priority, dueDate: w.dueDate,
          })),
        };
      })
      .sort((a, b) => a.item.localeCompare(b.item));

    const plannedTotal = rows.reduce((s, r) => s + r.planned, 0);
    const actualTotal = rows.reduce((s, r) => s + r.actualQty, 0);
    const itemsConverted = rows.filter((r) => r.wos.length > 0).length;

    return ok({
      run: { id: run.id, number: run.number, ranAt: run.ranAt, ranBy: run.ranBy, suggestionCount: run.suggestionCount },
      rows,
      totals: {
        plannedTotal, actualTotal, itemsTotal: rows.length, itemsConverted,
        coveragePct: plannedTotal > 0 ? Math.round((Math.min(actualTotal, plannedTotal) / plannedTotal) * 100) : 0,
      },
    });
  });
}
