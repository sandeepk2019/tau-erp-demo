// ============================================================================
// Tau ERP — Production: Work Orders API
// GET  /api/work-orders            → list (+ stats + FINISHED items for create dialog)
// GET  /api/work-orders?wo=WO-…    → full detail (BOM/route revisions, job cards,
//                                    electronic traveller timeline, genealogy binds)
// POST /api/work-orders            → create WO (resolves RELEASED BOM + RouteRevision;
//                                    draft/obsolete engineering = spec release blocker)
// ============================================================================
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import {
  ApiError, body, getSessionUser, handle, logAudit, nextNumber, ok,
  type SessionUser,
} from "@/lib/erp/server";
import { hasPerm, type PermKey } from "@/lib/erp/constants";

/** Any-of permission guard (spec: e.g. create WO needs production.release OR planning.run). */
function requireAnyPerm(user: SessionUser | null, perms: PermKey[]): SessionUser {
  if (!user) throw new ApiError("No session — please select a user in the topbar", 401);
  if (!perms.some((p) => hasPerm(user.role, p))) {
    throw new ApiError(`Permission denied: role ${user.role} lacks '${perms.join("' or '")}' (server-side RBAC enforced)`, 403);
  }
  return user;
}

// ---------------------------------------------------------------------------
// GET — list or detail
// ---------------------------------------------------------------------------
export async function GET(req: NextRequest) {
  return handle(async () => {
    const woNumber = req.nextUrl.searchParams.get("wo");
    if (woNumber) return ok(await detail(woNumber.trim()));

    const status = req.nextUrl.searchParams.get("status");
    const where = status && status !== "ALL" ? { status } : {};

    const [wos, allCards, monthStart, ncrAgg, reworkAgg] = await Promise.all([
      db.workOrder.findMany({
        where,
        include: { item: { select: { partNumber: true, name: true, familyCode: true } } },
        orderBy: { woNumber: "desc" },
      }),
      db.jobCard.findMany({ select: { woId: true, status: true } }),
      Promise.resolve(new Date(new Date().getFullYear(), new Date().getMonth(), 1)),
      // quality exceptions per WO (NCR status: OPEN|CONTAINMENT|MRB|DISPOSITIONED are unresolved)
      db.ncr.groupBy({ by: ["woNumber", "status"], _count: { _all: true }, where: { woNumber: { not: "" } } }),
      db.reworkOrder.groupBy({ by: ["woNumber", "status"], _count: { _all: true }, where: { woNumber: { not: "" } } }),
    ]);

    const ncrByWo = new Map<string, { open: number; total: number }>();
    for (const row of ncrAgg) {
      const cur = ncrByWo.get(row.woNumber) ?? { open: 0, total: 0 };
      cur.total += row._count._all;
      if (!["CLOSED"].includes(row.status)) cur.open += row._count._all;
      ncrByWo.set(row.woNumber, cur);
    }
    const reworkByWo = new Map<string, number>();
    for (const row of reworkAgg) {
      if (["OPEN", "IN_PROGRESS"].includes(row.status)) {
        reworkByWo.set(row.woNumber, (reworkByWo.get(row.woNumber) ?? 0) + row._count._all);
      }
    }

    const cardStats = new Map<string, { total: number; done: number }>();
    for (const c of allCards) {
      const s = cardStats.get(c.woId) ?? { total: 0, done: 0 };
      s.total += 1;
      if (c.status === "COMPLETED") s.done += 1;
      cardStats.set(c.woId, s);
    }

    // Stat cards (computed on unfiltered data)
    const [openCount, wipAgg, completedAgg, blockedCards] = await Promise.all([
      db.workOrder.count({ where: { status: { in: ["CREATED", "RELEASED", "IN_PROGRESS"] } } }),
      db.workOrder.aggregate({ where: { status: "IN_PROGRESS" }, _sum: { qtyPlanned: true, qtyCompleted: true } }),
      db.workOrder.aggregate({
        where: { status: { in: ["COMPLETED", "CLOSED"] }, closedAt: { gte: monthStart } },
        _sum: { qtyCompleted: true },
      }),
      db.jobCard.count({ where: { status: "BLOCKED" } }),
    ]);

    const finishedItems = await db.item.findMany({
      where: { itemType: "FINISHED", lifecycle: { not: "OBSOLETE" } },
      select: { id: true, partNumber: true, name: true, familyCode: true },
      orderBy: { partNumber: "asc" },
    });

    const rows = wos.map((w) => {
      const cs = cardStats.get(w.id) ?? { total: 0, done: 0 };
      const ncr = ncrByWo.get(w.woNumber) ?? { open: 0, total: 0 };
      return {
        id: w.id, woNumber: w.woNumber, status: w.status, priority: w.priority,
        qtyPlanned: w.qtyPlanned, qtyCompleted: w.qtyCompleted, qtyScrapped: w.qtyScrapped,
        dueDate: w.dueDate, soNumber: w.soNumber, familyCode: w.familyCode,
        bomRevision: w.bomRevision, routeRevision: w.routeRevision,
        releasedBy: w.releasedBy, releasedAt: w.releasedAt, plannedStart: w.plannedStart,
        item: w.item, jcTotal: cs.total, jcDone: cs.done,
        ncrOpen: ncr.open, ncrTotal: ncr.total, reworkOpen: reworkByWo.get(w.woNumber) ?? 0,
      };
    });

    return ok({
      wos: rows,
      stats: {
        openWOs: openCount,
        wipQty: (wipAgg._sum.qtyPlanned ?? 0) - (wipAgg._sum.qtyCompleted ?? 0),
        completedThisMonth: completedAgg._sum.qtyCompleted ?? 0,
        blockedJobCards: blockedCards,
      },
      finishedItems,
    });
  });
}

async function detail(woNumber: string) {
  const wo = await db.workOrder.findUnique({
    where: { woNumber },
    include: {
      item: true,
      bom: { include: { lines: { include: { componentItem: true }, orderBy: { position: "asc" } } } },
      route: { include: { steps: { orderBy: { seq: "asc" } } } },
      jobCards: { orderBy: { sequence: "asc" } },
      travellerEvents: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!wo) throw new ApiError(`Work order not found: ${woNumber}`, 404);

  const genealogy = await db.genealogyLink.findMany({
    where: { woNumber },
    include: {
      parentLot: { select: { lotNumber: true, status: true, warehouseCode: true, item: { select: { partNumber: true } } } },
      childLot: { select: { lotNumber: true, status: true, warehouseCode: true, item: { select: { partNumber: true } } } },
    },
    orderBy: { createdAt: "asc" },
  });

  const opIds = [...new Set(wo.jobCards.map((c) => c.operatorId).filter((x): x is string => !!x))];
  const users = opIds.length
    ? await db.user.findMany({ where: { id: { in: opIds } }, select: { id: true, name: true } })
    : [];
  const operatorMap = new Map(users.map((u) => [u.id, u.name]));

  return {
    wo: {
      ...wo,
      jobCards: wo.jobCards.map((c) => ({
        ...c,
        operatorName: c.operatorId ? operatorMap.get(c.operatorId) ?? c.operatorId : "",
      })),
    },
    genealogy,
  };
}

// ---------------------------------------------------------------------------
// POST — create work order (CREATED + TravellerEvent CREATED)
// ---------------------------------------------------------------------------
export async function POST(req: NextRequest) {
  return handle(async () => {
    const user = requireAnyPerm(await getSessionUser(req), ["production.release", "planning.run"]);

    const b = await body<{ itemId?: string; qtyPlanned?: number; dueDate?: string; priority?: string; soNumber?: string }>(req);
    if (!b.itemId) throw new ApiError("itemId is required");
    const qty = Number(b.qtyPlanned);
    if (!Number.isInteger(qty) || qty <= 0) throw new ApiError("Planned quantity must be a positive whole number");

    const item = await db.item.findUnique({ where: { id: b.itemId } });
    if (!item) throw new ApiError("Item not found", 404);
    if (item.itemType !== "FINISHED") throw new ApiError("Work orders can only be created for FINISHED items");

    // Spec release blocker: production must resolve a RELEASED BOM + RELEASED route.
    const bom = await db.bom.findFirst({ where: { itemId: item.id, status: "RELEASED" }, orderBy: { revision: "desc" } });
    const route = item.familyCode
      ? await db.routeRevision.findFirst({ where: { familyCode: item.familyCode, status: "RELEASED" }, orderBy: { revision: "desc" } })
      : null;
    if (!bom || !route) {
      throw new ApiError("Production cannot use draft/obsolete BOM/route (spec release blocker)");
    }

    const priority = ["LOW", "NORMAL", "HIGH", "CRITICAL"].includes((b.priority ?? "").toUpperCase())
      ? (b.priority as string).toUpperCase()
      : "NORMAL";
    const woNumber = await nextNumber("WO", "workOrder");

    const wo = await db.workOrder.create({
      data: {
        woNumber,
        itemId: item.id,
        familyCode: item.familyCode,
        bomId: bom.id,
        routeId: route.id,
        bomRevision: bom.revision,
        routeRevision: route.revision,
        qtyPlanned: qty,
        status: "CREATED",
        priority,
        soNumber: (b.soNumber ?? "").trim(),
        dueDate: b.dueDate ? new Date(b.dueDate) : null,
      },
    });

    await db.travellerEvent.create({
      data: {
        woId: wo.id,
        kind: "CREATED",
        message: `Work order created for ${qty} × ${item.partNumber} (BOM ${bom.revision} / Route ${route.revision})`,
        userName: user.username,
      },
    });
    await logAudit(user, "CREATE", "WORK_ORDER", woNumber, `qty=${qty} item=${item.partNumber} bom=${bom.revision} route=${route.revision}`);

    return ok({ woNumber, status: wo.status, bomRevision: bom.revision, routeRevision: route.revision }, 201);
  });
}
