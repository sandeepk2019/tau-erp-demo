import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { handle, ok, parseJsonField } from "@/lib/erp/server";

/** GET /api/dashboard — KPI aggregation for the executive dashboard. */
export async function GET(_req: NextRequest) {
  return handle(async () => {
    const [openWOs, wipWoRows, fgReady, shipped, inspections, ncrs, capas, sos, lots, pos, audit, notifications] = await Promise.all([
      db.workOrder.count({ where: { status: { in: ["RELEASED", "IN_PROGRESS"] } } }),
      // WIP units must match the Production module definition: open (planned−completed−scrapped) on IN_PROGRESS WOs
      db.workOrder.findMany({ where: { status: "IN_PROGRESS" }, select: { qtyPlanned: true, qtyCompleted: true, qtyScrapped: true } }),
      db.stockLot.count({ where: { status: "IN_STOCK", warehouseCode: "WH-FG", itemId: { not: "" } } }),
      db.stockLot.count({ where: { status: "SHIPPED" } }),
      db.inspection.findMany({ where: { kind: { in: ["IQC", "EOL"] } }, select: { kind: true, status: true, attempt: true, submittedAt: true } }),
      db.ncr.count({ where: { status: { in: ["OPEN", "CONTAINMENT", "MRB"] } } }),
      db.capa.count({ where: { status: { in: ["OPEN", "ACTIONS_PENDING", "VERIFICATION"] } } }),
      db.salesOrder.count({ where: { status: { in: ["CONFIRMED", "IN_PRODUCTION", "READY", "PARTIAL"] } } }),
      db.stockLot.findMany({ include: { item: { select: { unitCost: true } } } }),
      db.purchaseOrder.findMany({ where: { status: { in: ["DRAFT", "PENDING_APPROVAL"] } }, select: { id: true } }),
      db.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: 12 }),
      db.notification.findMany({ orderBy: { createdAt: "desc" }, take: 8 }),
    ]);

    const wipUnits = wipWoRows.reduce((s, w) => s + Math.max(0, w.qtyPlanned - w.qtyCompleted - w.qtyScrapped), 0);

    const iqc = inspections.filter((i) => i.kind === "IQC");
    const iqcPassRate = iqc.length ? Math.round((iqc.filter((i) => i.status === "PASSED").length / iqc.length) * 100) : 100;
    const eol = inspections.filter((i) => i.kind === "EOL");
    const eolFirst = eol.filter((i) => i.attempt === 1);
    const fpy = eolFirst.length ? Math.round((eolFirst.filter((i) => i.status === "PASSED").length / eolFirst.length) * 100) : 100;

    const stockValue = lots
      .filter((l) => l.status === "IN_STOCK")
      .reduce((s, l) => s + l.qty * (l.item?.unitCost ?? 0), 0);

    // family mix: released serials by family (via item familyCode)
    const fgLots = await db.stockLot.findMany({
      where: { trackingType: "SERIAL" },
      select: { status: true, item: { select: { familyCode: true, itemType: true } } },
    });
    const mix: Record<string, number> = {};
    for (const l of fgLots) {
      if (l.item.itemType === "FINISHED" && (l.status === "SHIPPED" || l.status === "IN_STOCK")) {
        mix[l.item.familyCode] = (mix[l.item.familyCode] ?? 0) + 1;
      }
    }

    // production trend last 14 days (completed = FG serial created per day)
    const trend: { day: string; completed: number; scrapped: number }[] = [];
    for (let i = 13; i >= 0; i--) {
      const day = new Date(Date.now() - i * 86400_000);
      trend.push({
        day: day.toLocaleDateString("en-IN", { day: "2-digit", month: "short" }),
        completed: 0,
        scrapped: 0,
      });
    }
    const fgCreated = await db.stockLot.findMany({
      where: { trackingType: "SERIAL", item: { itemType: "FINISHED" } },
      select: { createdAt: true, status: true },
    });
    for (const f of fgCreated) {
      const idx = trend.findIndex((t) => {
        const dd = new Date(t.day + " " + new Date().getFullYear());
        return dd.toDateString() === new Date(f.createdAt).toDateString();
      });
      if (idx >= 0) {
        if (f.status === "SCRAPPED") trend[idx].scrapped++;
        else trend[idx].completed++;
      }
    }

    const overdueActions = await db.capa.count({
      where: { status: { in: ["OPEN", "ACTIONS_PENDING", "VERIFICATION"] }, dueDate: { lt: new Date() } },
    });

    // Exception radar (round 10) — one strip: supplier-quality raises + purchase
    // expedites + late deliveries + overdue corrective actions.
    const nowMs = Date.now();
    const EXPEDITE_WINDOW_MS = 7 * 86400_000;
    const activeScarRows = await db.scar.findMany({
      where: { status: { in: ["OPEN", "UNDER_REVIEW", "VERIFICATION"] } },
      select: { scarNumber: true, severity: true, status: true, responseDue: true, supplierId: true },
    });
    const activePoRows = await db.purchaseOrder.findMany({
      where: { status: { in: ["DRAFT", "PENDING_APPROVAL", "APPROVED", "PARTIAL"] }, expectedDate: { not: null } },
      select: { poNumber: true, status: true, expectedDate: true, supplier: { select: { code: true } } },
      orderBy: { expectedDate: "asc" },
    });
    const scarSupplierCodes = await db.supplier.findMany({
      where: { id: { in: [...new Set(activeScarRows.map((s) => s.supplierId))] } },
      select: { id: true, code: true },
    });
    const scarCodeById = new Map(scarSupplierCodes.map((s) => [s.id, s.code]));
    const expeditePos = activePoRows
      .filter((p) => p.expectedDate && p.expectedDate.getTime() - nowMs <= EXPEDITE_WINDOW_MS)
      .slice(0, 4)
      .map((p) => ({
        poNumber: p.poNumber, supplierCode: p.supplier.code, status: p.status,
        expectedDate: p.expectedDate!.toISOString(),
        daysLeft: Math.max(0, Math.ceil((p.expectedDate!.getTime() - nowMs) / 86400_000)),
      }));
    const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
    const etaBreaches = activePoRows
      .filter((p) => p.expectedDate && p.expectedDate.getTime() < startOfToday.getTime())
      .slice(0, 3)
      .map((p) => ({
        poNumber: p.poNumber, supplierCode: p.supplier.code, status: p.status,
        expectedDate: p.expectedDate!.toISOString(),
        daysLate: Math.ceil((startOfToday.getTime() - p.expectedDate!.getTime()) / 86400_000),
      }));
    const overdueScars = activeScarRows.filter(
      (s) => (s.status === "OPEN" || s.status === "UNDER_REVIEW") && s.responseDue && s.responseDue.getTime() < nowMs,
    ).length;
    const radar = {
      scarsActive: activeScarRows.length,
      scarsCritical: activeScarRows.filter((s) => s.severity === "CRITICAL").length,
      scarsOverdueResponses: overdueScars,
      expediteCount: activePoRows.filter((p) => p.expectedDate && p.expectedDate.getTime() - nowMs <= EXPEDITE_WINDOW_MS).length,
      expeditePos,
      etaBreachCount: activePoRows.filter((p) => p.expectedDate && p.expectedDate.getTime() < startOfToday.getTime()).length,
      etaBreaches,
      overdueCapas: overdueActions,
    };

    // Demand coverage — SO → WO linkage (open SO lines vs WOs created against the SO)
    const openSoRows = await db.salesOrder.findMany({
      where: { status: { in: ["CONFIRMED", "IN_PRODUCTION", "READY", "PARTIAL"] } },
      select: {
        soNumber: true, status: true, programme: true,
        lines: { select: { itemId: true, qty: true, deliveredQty: true, item: { select: { partNumber: true, name: true } } } },
      },
      orderBy: { soNumber: "asc" },
    });
    const openWoRows = await db.workOrder.findMany({
      where: { status: { in: ["CREATED", "RELEASED", "IN_PROGRESS"] }, soNumber: { not: "" } },
      select: { soNumber: true, itemId: true, qtyPlanned: true, qtyCompleted: true, qtyScrapped: true },
    });
    const woOpenBySoItem = new Map<string, number>();
    for (const w of openWoRows) {
      const k = `${w.soNumber}|${w.itemId}`;
      woOpenBySoItem.set(k, (woOpenBySoItem.get(k) ?? 0) + Math.max(0, w.qtyPlanned - w.qtyCompleted - w.qtyScrapped));
    }
    const demandLines: { soNumber: string; partNumber: string; itemName: string; open: number; covered: number; pct: number }[] = [];
    let demandOpen = 0;
    let demandCovered = 0;
    for (const so of openSoRows) {
      for (const l of so.lines) {
        const open = Math.max(0, l.qty - l.deliveredQty);
        if (open <= 0) continue;
        const woOpen = woOpenBySoItem.get(`${so.soNumber}|${l.itemId}`);
        demandOpen += open;
        const covered = Math.min(open, Math.max(0, woOpen ?? 0));
        demandCovered += covered;
        demandLines.push({
          soNumber: so.soNumber, partNumber: l.item.partNumber, itemName: l.item.name,
          open, covered, pct: open > 0 ? Math.round((covered / open) * 100) : 0,
        });
      }
    }
    demandLines.sort((a, b) => a.pct - b.pct || a.open - b.open);
    const demandCoverage = {
      openQty: demandOpen,
      coveredQty: demandCovered,
      coveragePct: demandOpen > 0 ? Math.round((demandCovered / demandOpen) * 100) : 100,
      uncovered: demandLines.filter((l) => l.pct < 100).slice(0, 5),
      linesTotal: demandLines.length,
    };

    return ok({
      kpis: {
        openWOs, wipUnits, fgReady, shippedThisMonth: shipped,
        iqcPassRate, fpy, openNcrs: ncrs, openCapas: capas,
        stockValue, openSo: sos, pendingApprovals: pos.length, overdueActions,
      },
      familyMix: Object.entries(mix).map(([family, released]) => ({ family, released })),
      productionTrend: trend,
      alerts: notifications.map((n) => ({ id: n.id, severity: n.severity, title: n.title, message: n.message, kind: n.kind })),
      recentAudit: audit.map((a) => ({ id: a.id, userName: a.userName, action: a.action, entityType: a.entityType, entityId: a.entityId, createdAt: a.createdAt })),
      demandCoverage,
      radar,
    });
  });
}

void parseJsonField;
