// ============================================================================
// Tau ERP — Planning / MRP API
// GET  /api/plan                       → forecast + live MRP preview + last run + history
// POST {action:"run-mrp"}              → compute + persist a new MrpRun          (planning.run)
// POST {action:"override"}             → planner override of net req (reason!)   (planning.run)
// POST {action:"create-wos"}           → create suggested CREATED work orders    (planning.run)
// MRP is computed purely server-side from live data — deterministic, fully
// recorded in MrpRun.paramsJson/summaryJson/exceptionsJson (spec §MPS/MRP).
// ============================================================================
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser, handle, ok, requirePerm, body, logAudit, nextNumber, parseJsonField, ApiError } from "@/lib/erp/server";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type PerItem = {
  item: string; name: string; family: string; uom: string;
  forecastQty: number; soQty: number; gross: number;
  stockQty: number; openWoQty: number; supply: number;
  net: number; override?: boolean; hasBom: boolean; hasRoute: boolean;
};
type MrpException = {
  type: "SHORTAGE" | "CAPACITY" | "DATA" | "OVERRIDE";
  item?: string; station?: string; need?: number | string; have?: number | string;
  action?: string; reason?: string; by?: string; at?: string; from?: number; to?: number; week?: string;
};
type CapacityRow = { kind: string; pending: number; capacityPerWeek: number; loadPct: number; weeksToClear: number };
type ComputeResult = {
  periods: { current: string; next: string };
  periodMode: "LIVE" | "STALE_FALLBACK";
  perItem: PerItem[];
  byFamily: { family: string; gross: number; net: number; items: number }[];
  exceptions: MrpException[];
  capacity: CapacityRow[];
  plannedWOs: number; shortages: number; capacityOverloads: number; suggestions: number;
};

const OPEN_WO_STATUSES = ["CREATED", "RELEASED", "IN_PROGRESS"];
const ACTIVE_SO_STATUSES = ["CONFIRMED", "IN_PRODUCTION", "READY", "PARTIAL"];
const COMPONENT_WH = ["WH-ACC", "WH-WIP"];
const CAPACITY_PER_KIND_PER_WEEK = 3;

function periodOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function clampInt(v: unknown, min: number, max: number, dflt: number): number {
  const n = typeof v === "number" ? Math.round(v) : NaN;
  if (!Number.isFinite(n)) return dflt;
  return Math.max(min, Math.min(max, n));
}

// ---------------------------------------------------------------------------
// Deterministic MRP computation from live data
// ---------------------------------------------------------------------------
async function computeMrp(): Promise<ComputeResult> {
  const now = new Date();
  const clockCurrent = periodOf(now);
  const nextDate = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const clockNext = periodOf(nextDate);

  const [fgItems, allForecasts, soLines, stockLots, openWOs, releasedBoms, releasedRoutes, pendingJobs] = await Promise.all([
    db.item.findMany({ where: { itemType: "FINISHED", lifecycle: { not: "OBSOLETE" } }, orderBy: { partNumber: "asc" } }),
    db.forecast.findMany({}),
    db.soLine.findMany({ where: { so: { status: { in: ACTIVE_SO_STATUSES } } }, select: { itemId: true, qty: true, deliveredQty: true } }),
    db.stockLot.findMany({ where: { status: "IN_STOCK" }, select: { itemId: true, qty: true, warehouseCode: true } }),
    db.workOrder.findMany({
      where: { status: { in: OPEN_WO_STATUSES } },
      select: { itemId: true, qtyPlanned: true, qtyCompleted: true, qtyScrapped: true },
    }),
    db.bom.findMany({ where: { status: "RELEASED" }, orderBy: { revision: "desc" }, include: { lines: { include: { componentItem: { select: { partNumber: true, uom: true } } } } } }),
    db.routeRevision.findMany({ where: { status: "RELEASED" }, orderBy: { revision: "desc" }, select: { familyCode: true, revision: true } }),
    db.jobCard.findMany({
      where: { status: { in: ["PENDING", "READY"] }, wo: { status: { in: OPEN_WO_STATUSES } } },
      select: { step: { select: { workstationKind: true } } },
    }),
  ]);

  const itemById = new Map(fgItems.map((i) => [i.id, i]));

  // planning window: clock current+next period; if the approved forecast is stale
  // (seeded horizon behind the system clock) fall back deterministically to the
  // two latest periods that actually carry forecast rows — never silently zero demand.
  const availablePeriods = [...new Set(allForecasts.map((f) => f.period))].sort();
  let periods: { current: string; next: string } = { current: clockCurrent, next: clockNext };
  let periodMode: "LIVE" | "STALE_FALLBACK" = "LIVE";
  if (!allForecasts.some((f) => f.period === clockCurrent || f.period === clockNext) && availablePeriods.length > 0) {
    const lastTwo = availablePeriods.slice(-2);
    periods = { current: lastTwo[0], next: lastTwo[lastTwo.length - 1] };
    periodMode = "STALE_FALLBACK";
  }
  const forecasts = allForecasts.filter((f) => f.period === periods.current || f.period === periods.next);

  // per FINISHED item: gross / supply / net
  const perItem: PerItem[] = [];
  for (const it of fgItems) {
    const fc = forecasts.filter((f) => f.itemId === it.id).reduce((s, f) => s + f.qty, 0);
    const soQty = soLines.filter((l) => l.itemId === it.id).reduce((s, l) => s + (l.qty - l.deliveredQty), 0);
    const stockQty = stockLots.filter((l) => l.itemId === it.id).reduce((s, l) => s + l.qty, 0);
    const openWoQty = openWOs
      .filter((w) => w.itemId === it.id)
      .reduce((s, w) => s + Math.max(0, w.qtyPlanned - w.qtyCompleted - w.qtyScrapped), 0);
    const gross = fc + soQty;
    const supply = stockQty + openWoQty;
    perItem.push({
      item: it.partNumber, name: it.name, family: it.familyCode, uom: it.uom,
      forecastQty: fc, soQty, gross,
      stockQty, openWoQty, supply,
      net: Math.max(0, gross - supply),
      hasBom: releasedBoms.some((b) => b.itemId === it.id),
      hasRoute: releasedRoutes.some((r) => r.familyCode === it.familyCode),
    });
  }

  // explode released BOMs of items with net > 0 → component net needs vs available stock (WH-ACC / WH-WIP)
  const compNeed: Record<string, { need: number; uom: string }> = {};
  for (const row of perItem) {
    if (row.net <= 0 || !row.hasBom) continue;
    const item = itemById.get(fgItems.find((i) => i.partNumber === row.item)?.id ?? "");
    const bom = releasedBoms.find((b) => b.itemId === item?.id);
    if (!bom) continue;
    for (const line of bom.lines) {
      const pn = line.componentItem.partNumber;
      const req = row.net * line.qty * (1 + (line.scrapPct ?? 0) / 100);
      compNeed[pn] = { need: (compNeed[pn]?.need ?? 0) + req, uom: line.componentItem.uom };
    }
  }
  const exceptions: MrpException[] = [];
  const availByPn = new Map<string, number>();
  for (const [pn, id] of fgItems.map((i) => [i.partNumber, i.id] as const)) {
    availByPn.set(
      pn,
      stockLots.filter((l) => l.itemId === id && COMPONENT_WH.includes(l.warehouseCode)).reduce((s, l) => s + l.qty, 0),
    );
  }
  for (const [pn, { need, uom }] of Object.entries(compNeed).sort(([a], [b]) => a.localeCompare(b))) {
    const available = availByPn.get(pn) ?? 0;
    if (need - available > 0.001) {
      exceptions.push({
        type: "SHORTAGE", item: pn,
        need: `${round2(need - available)} ${uom}`, have: `${round2(available)} ${uom}`,
        action: "Expedite purchase / schedule alternate source — check open POs and NCR-blocked lots (WH-REJ excluded)",
      });
    }
  }

  // capacity: PENDING/READY job cards per workstation kind vs 3 per kind per week
  const byKind: Record<string, number> = {};
  for (const j of pendingJobs) {
    const kind = j.step.workstationKind || "UNASSIGNED";
    byKind[kind] = (byKind[kind] ?? 0) + 1;
  }
  const capacity: CapacityRow[] = Object.entries(byKind)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([kind, pending]) => ({
      kind, pending, capacityPerWeek: CAPACITY_PER_KIND_PER_WEEK,
      loadPct: Math.round((pending / CAPACITY_PER_KIND_PER_WEEK) * 100),
      weeksToClear: Math.ceil(pending / CAPACITY_PER_KIND_PER_WEEK),
    }));
  for (const c of capacity) {
    if (c.pending > CAPACITY_PER_KIND_PER_WEEK) {
      exceptions.push({
        type: "CAPACITY", station: c.kind, need: c.pending, have: c.capacityPerWeek, week: "W+1",
        action: `Overloaded — ${c.weeksToClear} weeks to clear at ${c.capacityPerWeek}/week. Level load, add a shift, or subcontract.`,
      });
    }
  }

  // master-data exceptions (cannot suggest WOs without released BOM/route)
  for (const row of perItem) {
    if (row.net > 0 && (!row.hasBom || !row.hasRoute)) {
      exceptions.push({
        type: "DATA", item: row.item,
        action: `Suggested WO blocked — ${!row.hasBom ? "no RELEASED BOM" : ""}${!row.hasBom && !row.hasRoute ? " + " : ""}${!row.hasRoute ? "no RELEASED route revision" : ""}`,
      });
    }
  }

  const famMap: Record<string, { gross: number; net: number; items: number }> = {};
  for (const r of perItem) {
    const f = (famMap[r.family] ??= { gross: 0, net: 0, items: 0 });
    f.gross += r.gross; f.net += r.net; f.items += 1;
  }
  const byFamily = Object.entries(famMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([family, v]) => ({ family, ...v }));

  return {
    periods,
    periodMode,
    perItem, byFamily, exceptions, capacity,
    plannedWOs: perItem.filter((r) => r.net > 0 && r.hasBom && r.hasRoute).length,
    shortages: exceptions.filter((e) => e.type === "SHORTAGE").length,
    capacityOverloads: exceptions.filter((e) => e.type === "CAPACITY").length,
    suggestions: perItem.reduce((s, r) => s + Math.ceil(r.net), 0),
  };
}

// ---------------------------------------------------------------------------
// Serialization helpers
// ---------------------------------------------------------------------------
type MrpRunRow = {
  id: string; number: string; ranAt: Date; ranBy: string; suggestionCount: number;
  paramsJson: string; summaryJson: string; exceptionsJson: string;
};
function serializeRun(r: MrpRunRow) {
  return {
    id: r.id, number: r.number, ranAt: r.ranAt, ranBy: r.ranBy, suggestionCount: r.suggestionCount,
    params: parseJsonField<Record<string, unknown>>(r.paramsJson, {}),
    summary: parseJsonField<Record<string, unknown>>(r.summaryJson, {}),
    exceptions: parseJsonField<MrpException[]>(r.exceptionsJson, []),
  };
}

/** Apply stored planner overrides (from a run's exceptionsJson) onto a live perItem calc. */
function applyOverrides(perItem: PerItem[], exceptions: MrpException[]): PerItem[] {
  const overrides = exceptions.filter((e) => e.type === "OVERRIDE" && e.item && typeof e.to === "number");
  if (!overrides.length) return perItem;
  return perItem.map((row) => {
    const ov = overrides.find((o) => o.item === row.item); // last stored wins (list is append-ordered)
    if (!ov) return row;
    return { ...row, net: ov.to as number, override: true };
  });
}

// ---------------------------------------------------------------------------
// GET /api/plan
// ---------------------------------------------------------------------------
export async function GET() {
  return handle(async () => {
    const [forecastRows, runsRaw, live] = await Promise.all([
      db.forecast.findMany({
        orderBy: [{ period: "asc" }, { familyCode: "asc" }],
        include: { item: { select: { partNumber: true, name: true } } },
      }),
      db.mrpRun.findMany({ orderBy: { ranAt: "desc" }, take: 20 }),
      computeMrp(),
    ]);

    const runs = runsRaw.map(serializeRun);
    const lastRun = runs[0] ?? null;
    // merge planner overrides from the last run onto the live preview
    const perItem = lastRun ? applyOverrides(live.perItem, lastRun.exceptions) : live.perItem;
    const shortagesLive = live.exceptions.filter((e) => e.type === "SHORTAGE");

    // chart: forecast qty by family for the NEXT period
    const familyNextMap: Record<string, number> = {};
    for (const f of forecastRows) {
      if (f.period === live.periods.next) familyNextMap[f.familyCode] = (familyNextMap[f.familyCode] ?? 0) + f.qty;
    }
    const familyNext = Object.entries(familyNextMap).map(([family, qty]) => ({ family, qty }));

    return ok({
      periods: live.periods,
      periodMode: live.periodMode,
      stats: {
        forecastLines: forecastRows.length,
        forecastQty: forecastRows.reduce((s, f) => s + f.qty, 0),
        plannedWOs: lastRun ? Number(lastRun.summary.plannedWOs ?? lastRun.suggestionCount) : live.plannedWOs,
        shortages: shortagesLive.length,
        capacityOverloads: live.capacityOverloads,
        lastRunNumber: lastRun?.number ?? null,
        lastRunAt: lastRun?.ranAt ?? null,
      },
      forecast: forecastRows.map((f) => ({
        id: f.id, partNumber: f.item.partNumber, itemName: f.item.name,
        familyCode: f.familyCode, period: f.period, qty: f.qty, source: f.source,
      })),
      familyNext,
      preview: {
        perItem,
        byFamily: live.byFamily,
        exceptions: live.exceptions,
        capacity: live.capacity,
        plannedWOs: live.plannedWOs,
        suggestions: live.suggestions,
      },
      lastRun,
      runs,
    });
  });
}

// ---------------------------------------------------------------------------
// POST /api/plan — run-mrp | override | create-wos
// ---------------------------------------------------------------------------
export async function POST(req: NextRequest) {
  return handle(async () => {
    const b = await body<{
      action?: string; horizonWeeks?: number; frozenWeeks?: number;
      runId?: string; item?: string; net?: number; reason?: string;
    }>(req);

    if (b.action === "run-mrp") {
      const user = requirePerm(await getSessionUser(req), "planning.run");
      const horizonWeeks = clampInt(b.horizonWeeks, 1, 26, 8);
      const frozenWeeks = clampInt(b.frozenWeeks, 0, horizonWeeks, 2);
      const live = await computeMrp();
      const number = await nextNumber("MRP", "mrpRun");
      const created = await db.mrpRun.create({
        data: {
          number,
          ranBy: user.username,
          paramsJson: JSON.stringify({
            horizonWeeks, frozenWeeks, respectRejectedStock: true,
            capacityPerKindPerWeek: CAPACITY_PER_KIND_PER_WEEK,
            periodWindow: live.periods, periodMode: live.periodMode,
          }),
          summaryJson: JSON.stringify({
            perItem: live.perItem, byFamily: live.byFamily, capacity: live.capacity, periods: live.periods,
            plannedWOs: live.plannedWOs, shortages: live.shortages,
            capacityOverloads: live.capacityOverloads, suggestions: live.suggestions,
          }),
          exceptionsJson: JSON.stringify(live.exceptions),
          suggestionCount: live.plannedWOs,
        },
      });
      await logAudit(
        user, "CREATE", "MRP_RUN", number,
        `MRP run — horizon ${horizonWeeks}w / frozen ${frozenWeeks}w · plannedWOs ${live.plannedWOs} · shortages ${live.shortages} · capacity overloads ${live.capacityOverloads}`,
      );
      return ok({ run: serializeRun(created), computed: live });
    }

    if (b.action === "override") {
      const user = requirePerm(await getSessionUser(req), "planning.run");
      if (!b.item) throw new ApiError("Override requires an item partNumber", 422);
      if (typeof b.net !== "number" || !Number.isFinite(b.net) || b.net < 0) {
        throw new ApiError("Override requires a valid net requirement ≥ 0", 422);
      }
      if (!b.reason || !b.reason.trim()) throw new ApiError("Planner override requires a mandatory reason (audit evidence)", 422);
      const run = b.runId
        ? await db.mrpRun.findUnique({ where: { id: b.runId } })
        : await db.mrpRun.findFirst({ orderBy: { ranAt: "desc" } });
      if (!run) throw new ApiError("No MRP run to override — run MRP first", 404);
      const summary = parseJsonField<{ perItem?: PerItem[] }>(run.summaryJson, {});
      const exceptions = parseJsonField<MrpException[]>(run.exceptionsJson, []);
      const perItem = summary.perItem?.length ? [...summary.perItem] : (await computeMrp()).perItem;
      const idx = perItem.findIndex((p) => p.item === b.item);
      if (idx < 0) throw new ApiError(`Item ${b.item} is not part of run ${run.number}`, 404);
      const from = perItem[idx].net;
      perItem[idx] = { ...perItem[idx], net: b.net, override: true };
      const overrideRec: MrpException = {
        type: "OVERRIDE", item: b.item, from, to: b.net,
        reason: b.reason.trim().slice(0, 300), by: user.username, at: new Date().toISOString(),
      };
      const updated = await db.mrpRun.update({
        where: { id: run.id },
        data: {
          summaryJson: JSON.stringify({ ...summary, perItem }),
          exceptionsJson: JSON.stringify([...exceptions, overrideRec]),
        },
      });
      await logAudit(user, "UPDATE", "MRP_RUN", run.number, `Planner override ${b.item} net ${from} → ${b.net} — reason: ${b.reason.trim().slice(0, 160)}`);
      return ok({ run: serializeRun(updated) });
    }

    if (b.action === "create-wos") {
      const user = requirePerm(await getSessionUser(req), "planning.run");
      const run = b.runId
        ? await db.mrpRun.findUnique({ where: { id: b.runId } })
        : await db.mrpRun.findFirst({ orderBy: { ranAt: "desc" } });
      if (!run) throw new ApiError("No MRP run found — run MRP first", 404);
      const runExceptions = parseJsonField<MrpException[]>(run.exceptionsJson, []);
      const live = await computeMrp();
      const perItem = applyOverrides(live.perItem, runExceptions);
      const horizonWeeks = clampInt(
        parseJsonField<{ horizonWeeks?: number }>(run.paramsJson, {}).horizonWeeks, 1, 26, 8,
      );

      const createdWOs: string[] = [];
      const skipped: MrpException[] = [];
      for (const row of perItem) {
        if (row.net <= 0) continue;
        const item = await db.item.findUnique({ where: { partNumber: row.item } });
        if (!item) { skipped.push({ type: "DATA", item: row.item, action: "Suggested WO skipped — item not found" }); continue; }
        // validate released BOM + route revision exist (same gate as production release)
        const bom = await db.bom.findFirst({
          where: { itemId: item.id, status: "RELEASED" }, orderBy: { revision: "desc" },
          include: { lines: { select: { id: true } } },
        });
        const route = await db.routeRevision.findFirst({
          where: { familyCode: item.familyCode, status: "RELEASED" }, orderBy: { revision: "desc" },
          include: { steps: { select: { id: true } } },
        });
        if (!bom || !route || !bom.lines.length || !route.steps.length) {
          skipped.push({
            type: "DATA", item: row.item,
            action: `Suggested WO skipped — no valid RELEASED ${!bom ? "BOM" : ""}${!bom && !route ? " + " : ""}${!route ? "route revision" : ""}`,
          });
          continue;
        }
        const woNumber = await nextNumber("WO", "workOrder");
        const qty = Math.ceil(row.net);
        const wo = await db.workOrder.create({
          data: {
            woNumber, itemId: item.id, familyCode: item.familyCode,
            bomId: bom.id, routeId: route.id, bomRevision: bom.revision, routeRevision: route.revision,
            qtyPlanned: qty, status: "CREATED", priority: row.override ? "HIGH" : "NORMAL",
            dueDate: new Date(Date.now() + horizonWeeks * 7 * 86400_000), plannedStart: new Date(),
          },
        });
        await db.travellerEvent.create({
          data: {
            woId: wo.id, kind: "CREATED", userName: user.username,
            message: `Suggested by MRP run ${run.number} — net requirement ${row.net}${row.override ? " (planner override applied)" : ""}`,
          },
        });
        createdWOs.push(woNumber);
        await logAudit(user, "CREATE", "WORK_ORDER", woNumber, `MRP suggestion from ${run.number} · ${item.partNumber} qty ${qty}${row.override ? " (override applied)" : ""}`);
      }
      if (skipped.length) {
        await db.mrpRun.update({
          where: { id: run.id },
          data: { exceptionsJson: JSON.stringify([...runExceptions, ...skipped]) },
        });
      }
      await logAudit(user, "CREATE", "MRP_RUN", run.number, `Created ${createdWOs.length} suggested WO(s) [${createdWOs.join(", ") || "none"}]; skipped ${skipped.length}`);
      return ok({ createdWOs, skipped, runNumber: run.number });
    }

    if (b.action === "create-pos") {
      // MRP shortage → DRAFT purchase orders (plan-to-procure loop).
      // RBAC: planner acts (planning.run). SoD preserved: POs are born DRAFT —
      // four-eyes PO approval (PURCHASE_MGR) is still required before release.
      const user = requirePerm(await getSessionUser(req), "planning.run");
      const run = b.runId
        ? await db.mrpRun.findUnique({ where: { id: b.runId } })
        : await db.mrpRun.findFirst({ orderBy: { ranAt: "desc" } });
      if (!run) throw new ApiError("No MRP run found — run MRP first", 404);

      const runExceptions = parseJsonField<MrpException[]>(run.exceptionsJson, []);
      // dedupe shortage rows by item (append-ordered → keep the LARGEST gap)
      const gapByItem = new Map<string, number>();
      for (const e of runExceptions) {
        if (e.type !== "SHORTAGE" || !e.item) continue;
        const m = String(e.need ?? "").match(/^([\d.]+)\s*(.+)$/);
        if (!m) continue;
        const qty = Math.ceil(parseFloat(m[1]));
        if (!Number.isFinite(qty) || qty <= 0) continue;
        gapByItem.set(e.item, Math.max(gapByItem.get(e.item) ?? 0, qty));
      }
      if (gapByItem.size === 0) {
        throw new ApiError("This run has no usable SHORTAGE exceptions to convert into purchase orders", 422);
      }

      // open (undelivered) PO quantity per item — MRP nets demand against open orders
      const openPoLines = await db.poLine.findMany({
        where: { po: { status: { in: ["DRAFT", "PENDING_APPROVAL", "APPROVED", "PARTIAL"] } } },
        select: { itemId: true, qty: true, receivedQty: true, po: { select: { poNumber: true } } },
      });
      const openQtyByItem = new Map<string, number>();
      const openPoRef = new Map<string, string>();
      for (const l of openPoLines) {
        openQtyByItem.set(l.itemId, (openQtyByItem.get(l.itemId) ?? 0) + Math.max(0, l.qty - l.receivedQty));
        if (!openPoRef.has(l.itemId)) openPoRef.set(l.itemId, l.po.poNumber);
      }

      // sourcing evidence: last PO price per item (+ supplier), quotations per item
      const lastPoLine = await db.poLine.findMany({
        orderBy: { po: { orderDate: "desc" } },
        select: {
          itemId: true, unitPrice: true, po: { select: { supplierId: true, orderDate: true, supplier: { select: { code: true, approved: true } } } },
        },
      });
      const lastPriceByItem = new Map<string, number>();
      const lastSupplierByItem = new Map<string, string>();
      for (const l of lastPoLine) {
        if (!lastPriceByItem.has(l.itemId)) lastPriceByItem.set(l.itemId, l.unitPrice);
        if (!lastSupplierByItem.has(l.itemId)) lastSupplierByItem.set(l.itemId, l.po.supplierId);
      }
      const quotes = await db.supplierQuotation.findMany({
        where: { status: { in: ["RECEIVED", "SELECTED"] }, rfq: { status: { in: ["OPEN", "QUOTED", "AWARDED"] } } },
        orderBy: { unitPrice: "asc" },
        select: { unitPrice: true, supplierId: true, leadTimeDays: true, supplier: { select: { approved: true } }, rfq: { select: { itemId: true } } },
      });
      const quoteByItem = new Map<string, { unitPrice: number; supplierId: string; approved: boolean; leadTimeDays: number }>();
      for (const q of quotes) {
        const prev = quoteByItem.get(q.rfq.itemId);
        // prefer approved suppliers, then lowest price
        if (!prev || (q.supplier.approved && !prev.approved) || (q.supplier.approved === prev.approved && q.unitPrice < prev.unitPrice)) {
          quoteByItem.set(q.rfq.itemId, { unitPrice: q.unitPrice, supplierId: q.supplierId, approved: q.supplier.approved, leadTimeDays: q.leadTimeDays });
        }
      }

      const skipped: { item: string; reason: string }[] = [];
      type EtaSource = "quote" | "item master" | "default";
      type DraftLine = { itemId: string; partNumber: string; qty: number; unitPrice: number; priceSource: string; gstRate: number; soDriven: boolean; etaDays: number; etaSource: EtaSource };
      const bySupplier = new Map<string, DraftLine[]>();
      const STD_LEAD_DAYS = 14;
      const EXPEDITE_LEAD_DAYS = 7; // firm SO demand → supplier must deliver inside a week

      // demand urgency (round-9): firm customer demand = open SO qty. An item is
      // SO-driven when it (or any component inside a RELEASED BOM of an SO-driven
      // finish-good) carries open SO demand → its PO gets an expedite ETA (+7d
      // vs +14d forecast-only). Computed live at conversion time from SO + BOM data.
      const runSummary = parseJsonField<{ perItem?: { item?: string; soQty?: number }[] }>(run.summaryJson, {});
      const openSoLines = await db.soLine.findMany({
        where: { so: { status: { in: ["CONFIRMED", "IN_PRODUCTION", "READY", "PARTIAL"] } } },
        select: { itemId: true, qty: true, deliveredQty: true, so: { select: { soNumber: true } } },
      });
      const soDrivenItemIds = new Set<string>();
      for (const l of openSoLines) {
        if (l.qty - l.deliveredQty > 0) soDrivenItemIds.add(l.itemId);
      }
      const soDrivenBomComponents = new Set<string>(); // component partNumbers consumed by SO-driven FGs
      if (soDrivenItemIds.size > 0) {
        const bomLines = await db.bomLine.findMany({
          where: { bom: { status: "RELEASED", item: { id: { in: [...soDrivenItemIds] } } } },
          select: { componentItemId: true },
        });
        for (const bl of bomLines) soDrivenBomComponents.add(bl.componentItemId);
      }
      const isSoDriven = (itemId: string, partNumber: string) =>
        soDrivenItemIds.has(itemId) || soDrivenBomComponents.has(itemId) ||
        (runSummary.perItem ?? []).some((r) => r.item === partNumber && (r.soQty ?? 0) > 0);

      for (const [partNumber, gap] of [...gapByItem.entries()].sort(([a], [bb]) => a.localeCompare(bb))) {
        const item = await db.item.findUnique({ where: { partNumber } });
        if (!item) { skipped.push({ item: partNumber, reason: "item not found in master" }); continue; }
        if (item.itemType === "FINISHED") {
          skipped.push({ item: partNumber, reason: "make item — convert to work orders via 'Create suggested WOs'" });
          continue;
        }
        if (item.lifecycle === "OBSOLETE") { skipped.push({ item: partNumber, reason: "item is OBSOLETE — resolve engineering first" }); continue; }
        // net against open POs (excluding what was already counted in the MRP stock check)
        const openQty = openQtyByItem.get(item.id) ?? 0;
        const orderQty = gap - openQty;
        if (orderQty <= 0) {
          skipped.push({ item: partNumber, reason: `gap ${gap} already covered by open PO ${openPoRef.get(item.id) ?? "(open lines)"}` });
          continue;
        }
        // supplier sourcing: last PO supplier → best quotation → none
        let supplierId = lastSupplierByItem.get(item.id) ?? null;
        let unitPrice = lastPriceByItem.get(item.id) ?? item.unitCost;
        let priceSource = "last PO price";
        if (!supplierId && quoteByItem.has(item.id)) {
          const q = quoteByItem.get(item.id)!;
          supplierId = q.supplierId;
          unitPrice = q.unitPrice;
          priceSource = "RFQ quotation";
        }
        if (!supplierId) { skipped.push({ item: partNumber, reason: "no source — raise an RFQ to approved suppliers first" }); continue; }
        const supplier = await db.supplier.findUnique({ where: { id: supplierId } });
        if (!supplier) { skipped.push({ item: partNumber, reason: "sourced supplier no longer exists" }); continue; }
        if (item.criticality === "CRITICAL" && !supplier.approved) {
          skipped.push({ item: partNumber, reason: `sourced supplier ${supplier.code} is unapproved — controlled item (spec rule)` });
          continue;
        }
        const lines = bySupplier.get(supplierId) ?? [];
        const soDriven = isSoDriven(item.id, partNumber);
        // Data-driven ETA (round 10): quotation lead of the sourced supplier → per-item
        // procurement lead (Item.procLeadTimeDays) → static default. Firm SO demand
        // compresses the ETA to the expedite floor — supplier commitments yield to customer demand.
        const quoteLead = supplierId && quoteByItem.get(item.id)?.supplierId === supplierId ? quoteByItem.get(item.id)!.leadTimeDays : null;
        let etaDays: number;
        let etaSource: EtaSource;
        if (quoteLead) { etaDays = quoteLead; etaSource = "quote"; }
        else if (item.procLeadTimeDays && item.procLeadTimeDays > 0) { etaDays = item.procLeadTimeDays; etaSource = "item master"; }
        else { etaDays = soDriven ? EXPEDITE_LEAD_DAYS : STD_LEAD_DAYS; etaSource = "default"; }
        if (soDriven && etaDays > EXPEDITE_LEAD_DAYS) { etaDays = EXPEDITE_LEAD_DAYS; }
        lines.push({ itemId: item.id, partNumber, qty: orderQty, unitPrice: Math.round(unitPrice * 100) / 100, priceSource, gstRate: item.gstRate, soDriven, etaDays, etaSource });
        bySupplier.set(supplierId, lines);
      }

      const createdPos: { poNumber: string; supplier: string; lines: number; amount: number; etaDays: number; urgent: boolean; etaLines: { partNumber: string; qty: number; etaDays: number; etaSource: EtaSource; soDriven: boolean }[] }[] = [];
      for (const [supplierId, lines] of bySupplier) {
        const supplier = await db.supplier.findUnique({ where: { id: supplierId } });
        if (!supplier) continue;
        const totalAmount = Math.round(lines.reduce((s, l) => s + l.qty * l.unitPrice, 0) * 100) / 100;
        // PO ETA = the earliest need-by among its lines; urgent when ANY line is SO-driven
        const etaDays = Math.min(...lines.map((l) => l.etaDays));
        const urgent = lines.some((l) => l.soDriven);
        const expectedDate = new Date(Date.now() + etaDays * 86400_000);
        const poNumber = await nextNumber("PO", "purchaseOrder");
        await db.purchaseOrder.create({
          data: {
            poNumber, supplierId, status: "DRAFT", expectedDate, totalAmount,
            lines: {
              create: lines.map((l) => ({
                itemId: l.itemId, qty: l.qty, unitPrice: l.unitPrice, gstRate: l.gstRate,
              })),
            },
          },
        });
        createdPos.push({
          poNumber, supplier: `${supplier.code} · ${supplier.name}`, lines: lines.length, amount: totalAmount, etaDays, urgent,
          etaLines: lines.map((l) => ({ partNumber: l.partNumber, qty: l.qty, etaDays: l.etaDays, etaSource: l.etaSource, soDriven: l.soDriven })),
        });
        await logAudit(
          user, "CREATE", "PURCHASE_ORDER", poNumber,
          `MRP shortage conversion from ${run.number} · ${supplier.code} · ${lines.map((l) => `${l.partNumber}×${l.qty} (ETA +${l.etaDays}d ${l.etaSource}${l.soDriven ? " · SO-driven expedite" : ""})`).join(", ")} · ₹${totalAmount} ex-GST · PO ETA +${etaDays}d${urgent ? " EXPEDITE (firm SO demand)" : ""} · DRAFT (awaiting four-eyes approval)`,
        );
        // Expedite escalation (round 10): SO-driven POs alert the purchase manager
        // so approval & release happen without delay (notification deep-links to the PO).
        if (urgent) {
          await db.notification.create({
            data: {
              role: "PURCHASE_MGR", kind: "STOCK", severity: "WARNING",
              title: `EXPEDITE PO — ${supplier.code}`,
              message: `${poNumber} · ${lines.length} line(s) · ETA +${etaDays}d (firm SO demand via ${run.number}) — approve and release without delay; supplier ${supplier.code} to be informed via portal (mock).`,
              refType: "PO", refId: poNumber,
            },
          });
        }
      }
      await logAudit(
        user, "CREATE", "MRP_RUN", run.number,
        `Converted ${createdPos.length} draft PO(s) from shortage exceptions; skipped ${skipped.length} item(s)`,
      );
      return ok({ createdPos, skipped, runNumber: run.number }, 201);
    }

    throw new ApiError(`Unknown action '${b.action ?? ""}' — expected run-mrp | override | create-wos | create-pos`, 400);
  });
}
