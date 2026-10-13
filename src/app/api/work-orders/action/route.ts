// ============================================================================
// Tau ERP — Production: Work Order lifecycle actions (single action endpoint)
// POST /api/work-orders/action  { woNumber, action, ... }
//   release        CREATED→RELEASED, auto-creates job cards from route steps
//   cancel         CREATED/RELEASED→CANCELLED (audited)
//   issue-material {lotNumber}  → lot to WH-WIP, StockMovement ISSUE_TO_WO
//   complete-wo    all mandatory job cards COMPLETED + qtyCompleted==planned
//   receive-fg     {serials?|qty?} → FG serials SN-<FAM>-25-#### in WH-FG,
//                  genealogy binds (WIP serials oldest-first) + batch movements
// All timestamps are SERVER-generated (backdated posting impossible — audit note).
// ============================================================================
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import {
  ApiError, body, getSessionUser, handle, logAudit, ok, requirePerm, type SessionUser,
} from "@/lib/erp/server";
import { hasPerm, type PermKey } from "@/lib/erp/constants";

function requireAnyPerm(user: SessionUser | null, perms: PermKey[]): SessionUser {
  if (!user) throw new ApiError("No session — please select a user in the topbar", 401);
  if (!perms.some((p) => hasPerm(user.role, p))) {
    throw new ApiError(`Permission denied: role ${user.role} lacks '${perms.join("' or '")}' (server-side RBAC enforced)`, 403);
  }
  return user;
}

type ActionBody = {
  woNumber?: string;
  action?: string;
  lotNumber?: string;
  serials?: string[];
  qty?: number;
};

/** FG serial prefix from familyCode (spec: NOX/LAMBDA→LAM/DELTAP→DP/EGT/UQS). */
const FAMILY_PREFIX: Record<string, string> = { NOX: "NOX", LAMBDA: "LAM", DELTAP: "DP", EGT: "EGT", UQS: "UQS" };

export async function POST(req: NextRequest) {
  return handle(async () => {
    const user = await getSessionUser(req);
    const b = await body<ActionBody>(req);
    const woNumber = (b.woNumber ?? "").trim();
    if (!woNumber || !b.action) throw new ApiError("woNumber and action are required");

    const wo = await db.workOrder.findUnique({ where: { woNumber }, include: { item: true } });
    if (!wo) throw new ApiError(`Work order not found: ${woNumber}`, 404);

    switch (b.action) {
      case "release":
        return release(user, wo.id);
      case "cancel":
        return cancel(user, wo.id);
      case "issue-material":
        return issueMaterial(user, wo.id, (b.lotNumber ?? "").trim());
      case "complete-wo":
        return completeWo(user, wo.id);
      case "receive-fg":
        return receiveFg(user, wo.id, Array.isArray(b.serials) ? b.serials : undefined, b.qty);
      default:
        throw new ApiError(`Unknown action: ${b.action}`, 400);
    }
  });
}

// ---------------------------------------------------------------------------
// release — CREATED→RELEASED, generate job cards from route steps (first READY)
// ---------------------------------------------------------------------------
async function release(user: SessionUser | null, woId: string) {
  requirePerm(user, "production.release");
  const wo = await db.workOrder.findUnique({ where: { id: woId }, include: { item: true } });
  if (!wo) throw new ApiError("Work order not found", 404);
  if (wo.status !== "CREATED") {
    throw new ApiError(`Only CREATED work orders can be released (current status: ${wo.status})`);
  }

  const steps = await db.routeStep.findMany({ where: { routeId: wo.routeId ?? "" }, orderBy: { seq: "asc" } });
  const stations = await db.workstation.findMany({ where: { active: true }, orderBy: { code: "asc" } });
  const byKind = new Map(stations.map((s) => [s.kind, s.code]));

  let first = true;
  for (const s of steps) {
    await db.jobCard.create({
      data: {
        woId: wo.id,
        stepId: s.id,
        operationCode: s.operationCode,
        workstationCode: byKind.get(s.workstationKind) ?? "",
        status: first ? "READY" : "PENDING",
        sequence: s.seq,
      },
    });
    first = false;
  }

  await db.workOrder.update({
    where: { id: wo.id },
    data: { status: "RELEASED", releasedBy: user!.username, releasedAt: new Date() },
  });
  await db.travellerEvent.create({
    data: {
      woId: wo.id,
      kind: "RELEASED",
      message: `Work order released by ${user!.name} — ${steps.length} job cards generated from route ${wo.routeRevision} (step 1 READY)`,
      userName: user!.username,
    },
  });
  await logAudit(user, "RELEASE", "WORK_ORDER", wo.woNumber, `${steps.length} job cards generated from route rev ${wo.routeRevision}`);
  return ok({ woNumber: wo.woNumber, status: "RELEASED", jobCardsCreated: steps.length });
}

// ---------------------------------------------------------------------------
// cancel — CREATED/RELEASED→CANCELLED
// ---------------------------------------------------------------------------
async function cancel(user: SessionUser | null, woId: string) {
  requirePerm(user, "production.release");
  const wo = await db.workOrder.findUnique({ where: { id: woId } });
  if (!wo) throw new ApiError("Work order not found", 404);
  if (!["CREATED", "RELEASED"].includes(wo.status)) {
    throw new ApiError(`Only CREATED or RELEASED work orders can be cancelled (current: ${wo.status})`);
  }

  await db.workOrder.update({ where: { id: wo.id }, data: { status: "CANCELLED" } });
  await db.travellerEvent.create({
    data: {
      woId: wo.id,
      kind: "BLOCK",
      message: `Work order cancelled by ${user!.name} (from ${wo.status}) — no further operations permitted`,
      userName: user!.username,
    },
  });
  await logAudit(user, "CANCEL", "WORK_ORDER", wo.woNumber, `cancelled from ${wo.status}`);
  return ok({ woNumber: wo.woNumber, status: "CANCELLED" });
}

// ---------------------------------------------------------------------------
// issue-material — component lot from WH-ACC/WH-WIP to the work order (WH-WIP)
// ---------------------------------------------------------------------------
async function issueMaterial(user: SessionUser | null, woId: string, lotNumber: string) {
  requireAnyPerm(user, ["inventory.move", "production.release"]);
  const wo = await db.workOrder.findUnique({ where: { id: woId }, include: { item: true } });
  if (!wo) throw new ApiError("Work order not found", 404);
  if (!["RELEASED", "IN_PROGRESS"].includes(wo.status)) {
    throw new ApiError(`Material can only be issued to RELEASED/IN_PROGRESS work orders (current: ${wo.status})`);
  }
  if (!lotNumber) throw new ApiError("lotNumber is required");

  const lot = await db.stockLot.findUnique({ where: { lotNumber }, include: { item: true } });
  if (!lot) throw new ApiError(`Lot not found: ${lotNumber}`, 404);
  if (lot.status !== "IN_STOCK") {
    throw new ApiError(`Lot ${lotNumber} is not available for issue (status: ${lot.status})`);
  }
  if (!["WH-ACC", "WH-WIP"].includes(lot.warehouseCode)) {
    throw new ApiError(`Lot ${lotNumber} must be in WH-ACC or WH-WIP to issue (currently ${lot.warehouseCode})`);
  }

  const lines = await db.bomLine.findMany({ where: { bomId: wo.bomId ?? "" }, include: { componentItem: true } });
  const line = lines.find((l) => l.componentItemId === lot.itemId);
  if (!line) throw new ApiError("Component not in BOM for this WO");

  const moveQty = lot.trackingType === "SERIAL" ? 1 : line.qty;
  await db.stockLot.update({
    where: { id: lot.id },
    // SERIAL lots become WIP; BATCH lots stay IN_STOCK (partial consumption) — movement records the issue
    data: { warehouseCode: "WH-WIP", ...(lot.trackingType === "SERIAL" ? { status: "WIP" } : {}) },
  });
  await db.stockMovement.create({
    data: {
      lotId: lot.id, type: "ISSUE_TO_WO", qty: moveQty,
      fromWh: lot.warehouseCode, toWh: "WH-WIP", refType: "WO", refId: wo.woNumber,
      userId: user!.username,
      note: `Issued to ${wo.woNumber} — BOM line ${line.componentItem.partNumber} × ${line.qty}`,
    },
  });
  await db.travellerEvent.create({
    data: {
      woId: wo.id,
      kind: "ISSUE",
      message: `Issued ${lotNumber} (${line.componentItem.partNumber}${lot.trackingType === "BATCH" ? ` × ${moveQty}` : ""}) from ${lot.warehouseCode} to WH-WIP`,
      userName: user!.username,
      payloadJson: JSON.stringify({ lotNumber, itemId: lot.itemId, qty: moveQty }),
    },
  });
  await db.scanSession.create({
    data: {
      woNumber: wo.woNumber, kind: "ISSUE_TO_WO", status: "COMMITTED",
      scansJson: JSON.stringify([{ lotNumber, itemId: lot.itemId, at: new Date().toISOString() }]),
      userName: user!.username,
    },
  });
  await logAudit(user, "ISSUE", "WORK_ORDER", wo.woNumber, `lot ${lotNumber} → WH-WIP (timestamps server-generated — backdated posting impossible)`);
  return ok({ lotNumber, woNumber: wo.woNumber, toWh: "WH-WIP", lotStatus: lot.trackingType === "SERIAL" ? "WIP" : "IN_STOCK" });
}

// ---------------------------------------------------------------------------
// complete-wo — gate: mandatory job cards + full quantity received
// ---------------------------------------------------------------------------
async function completeWo(user: SessionUser | null, woId: string) {
  requirePerm(user, "production.release");
  const wo = await db.workOrder.findUnique({ where: { id: woId } });
  if (!wo) throw new ApiError("Work order not found", 404);
  if (!["RELEASED", "IN_PROGRESS"].includes(wo.status)) {
    throw new ApiError(`Only RELEASED/IN_PROGRESS work orders can be completed (current: ${wo.status})`);
  }

  const cards = await db.jobCard.findMany({ where: { woId: wo.id }, include: { step: true }, orderBy: { sequence: "asc" } });
  const incomplete = cards.find((c) => c.step.mandatory && c.status !== "COMPLETED");
  if (incomplete) {
    throw new ApiError(`Cannot complete WO: mandatory job card for ${incomplete.operationCode} (step ${incomplete.sequence}) is ${incomplete.status}`);
  }

  const fresh = await db.workOrder.findUnique({ where: { id: wo.id } });
  if (!fresh || fresh.qtyCompleted < fresh.qtyPlanned) {
    throw new ApiError(`Cannot complete WO: qtyCompleted (${fresh?.qtyCompleted ?? 0}) ≠ planned (${fresh?.qtyPlanned ?? 0}) — receive finished goods first`);
  }

  await db.workOrder.update({ where: { id: wo.id }, data: { status: "COMPLETED", closedAt: new Date() } });
  await db.travellerEvent.create({
    data: {
      woId: wo.id,
      kind: "OP_COMPLETE",
      message: `Work order completed — ${fresh.qtyCompleted}/${fresh.qtyPlanned} units, scrapped ${fresh.qtyScrapped}. Closed by ${user!.name}`,
      userName: user!.username,
    },
  });
  await logAudit(user, "COMPLETE", "WORK_ORDER", wo.woNumber, `qty ${fresh.qtyCompleted}/${fresh.qtyPlanned} — closedAt server-generated`);
  return ok({ woNumber: wo.woNumber, status: "COMPLETED", closedAt: new Date().toISOString() });
}

// ---------------------------------------------------------------------------
// receive-fg — FG serials into WH-FG + genealogy binds + batch consumption
// ---------------------------------------------------------------------------
async function receiveFg(user: SessionUser | null, woId: string, serials: string[] | undefined, qty: number | undefined) {
  requireAnyPerm(user, ["production.execute", "inventory.move"]);
  const wo = await db.workOrder.findUnique({ where: { id: woId }, include: { item: true } });
  if (!wo) throw new ApiError("Work order not found", 404);
  if (!["RELEASED", "IN_PROGRESS"].includes(wo.status)) {
    throw new ApiError(`Finished goods can only be received on RELEASED/IN_PROGRESS work orders (current: ${wo.status})`);
  }

  // Spec release blocker — operations must be finished before FG receipt.
  const cards = await db.jobCard.findMany({ where: { woId: wo.id }, include: { step: true }, orderBy: { sequence: "asc" } });
  const incomplete = cards.find((c) => c.step.mandatory && c.status !== "COMPLETED");
  if (incomplete) {
    throw new ApiError("Finished goods cannot be received without required operation completion (spec release blocker)");
  }

  const fresh = await db.workOrder.findUnique({ where: { id: wo.id } });
  const remaining = (fresh?.qtyPlanned ?? 0) - (fresh?.qtyCompleted ?? 0);
  if (remaining <= 0) throw new ApiError(`Planned quantity (${fresh?.qtyPlanned ?? 0}) already received for this WO`);

  let n: number;
  const custom: string[] = [];
  if (serials && serials.length) {
    for (const s of serials) {
      const v = String(s).trim();
      if (v) custom.push(v);
    }
    const dup = custom.find((s, i) => custom.indexOf(s) !== i);
    if (dup) throw new ApiError(`Duplicate serial in request: ${dup}`);
    const existing = await db.stockLot.findFirst({ where: { lotNumber: { in: custom } }, select: { lotNumber: true } });
    if (existing) throw new ApiError(`Serial already exists in stock: ${existing.lotNumber}`);
    n = custom.length;
  } else {
    n = Math.floor(Number(qty ?? 1));
  }
  if (!Number.isInteger(n) || n <= 0) throw new ApiError("Receive quantity must be a positive whole number");
  if (n > remaining) throw new ApiError(`Receive qty (${n}) exceeds remaining planned qty (${remaining})`);
  if (wo.item.trackingType !== "SERIAL") throw new ApiError("FG receipt requires a SERIAL-tracked finished good");

  const prefix = (FAMILY_PREFIX[wo.familyCode] ?? wo.familyCode.slice(0, 3)) || "FG";
  const lines = await db.bomLine.findMany({ where: { bomId: wo.bomId ?? "" }, include: { componentItem: true } });
  const serialLines = lines.filter((l) => l.componentItem.trackingType === "SERIAL");
  const batchLines = lines.filter((l) => l.componentItem.trackingType === "BATCH");
  const asmOp = (await db.routeStep.findFirst({
    where: { routeId: wo.routeId ?? "", workstationKind: "ASSEMBLY" },
    orderBy: { seq: "asc" },
  }))?.operationCode ?? "";

  const created: string[] = [];
  let counter = await db.stockLot.count({ where: { lotNumber: { startsWith: `SN-${prefix}-25-` } } });

  for (let i = 0; i < n; i++) {
    let lotNumber: string;
    if (custom[i]) {
      lotNumber = custom[i];
    } else {
      counter += 1;
      lotNumber = `SN-${prefix}-25-${String(counter).padStart(4, "0")}`;
      // ensure uniqueness even if the counter is behind historical data
      while (await db.stockLot.findUnique({ where: { lotNumber }, select: { id: true } })) {
        counter += 1;
        lotNumber = `SN-${prefix}-25-${String(counter).padStart(4, "0")}`;
      }
    }

    const fgLot = await db.stockLot.create({
      data: { lotNumber, itemId: wo.itemId, trackingType: "SERIAL", status: "IN_STOCK", warehouseCode: "WH-FG", qty: 1, woNumber: wo.woNumber },
    });
    created.push(lotNumber);

    await db.stockMovement.create({
      data: { lotId: fgLot.id, type: "FG_RECEIPT", qty: 1, fromWh: "", toWh: "WH-FG", refType: "WO", refId: wo.woNumber, userId: user!.username, note: `FG receipt against ${wo.woNumber}` },
    });

    // Genealogy: bind available WIP serial lots of SERIAL subassemblies (oldest first, 1 each)
    for (const sl of serialLines) {
      const sba = await db.stockLot.findFirst({
        where: {
          itemId: sl.componentItemId, trackingType: "SERIAL",
          warehouseCode: "WH-WIP", status: { in: ["IN_STOCK", "WIP"] },
          genealogyChild: { none: {} }, // never double-bind an already-consumed serial
        },
        orderBy: { createdAt: "asc" },
      });
      if (!sba) continue;
      await db.genealogyLink.create({
        data: { parentLotId: fgLot.id, childLotId: sba.id, woNumber: wo.woNumber, operationCode: asmOp, quantity: 1 },
      });
      await db.stockLot.update({ where: { id: sba.id }, data: { status: "CONSUMED" } });
      await db.stockMovement.create({
        data: { lotId: sba.id, type: "CONSUME", qty: 1, fromWh: "WH-WIP", toWh: "", refType: "WO", refId: wo.woNumber, userId: user!.username, note: `Serial bound into ${lotNumber}` },
      });
    }

    // BATCH lines: movement record only, qty per BomLine (no serial genealogy)
    for (const bl of batchLines) {
      const batchLot = await db.stockLot.findFirst({
        where: { itemId: bl.componentItemId, trackingType: "BATCH", status: { in: ["IN_STOCK", "WIP"] } },
        orderBy: { createdAt: "asc" },
      });
      if (!batchLot) continue;
      await db.stockMovement.create({
        data: {
          lotId: batchLot.id, type: "CONSUME", qty: bl.qty, fromWh: batchLot.warehouseCode, toWh: "",
          refType: "WO", refId: wo.woNumber, userId: user!.username,
          note: `Batch consumption for ${lotNumber} (${bl.componentItem.partNumber} × ${bl.qty})`,
        },
      });
    }
  }

  const newCompleted = (fresh?.qtyCompleted ?? 0) + n;
  await db.workOrder.update({
    where: { id: wo.id },
    data: { qtyCompleted: newCompleted, ...(fresh?.status === "RELEASED" ? { status: "IN_PROGRESS" } : {}) },
  });
  await db.travellerEvent.create({
    data: {
      woId: wo.id,
      kind: "FG_RECEIPT",
      message: `${n} finished serial(s) received into WH-FG: ${created.join(", ")}`,
      userName: user!.username,
      payloadJson: JSON.stringify({ serials: created }),
    },
  });
  await db.scanSession.create({
    data: {
      woNumber: wo.woNumber, kind: "FG_RECEIPT", status: "COMMITTED",
      scansJson: JSON.stringify(created.map((s) => ({ lotNumber: s, at: new Date().toISOString() }))),
      userName: user!.username,
    },
  });
  await logAudit(user, "FG_RECEIPT", "WORK_ORDER", wo.woNumber, `${created.join(", ")} → WH-FG (serials ${custom.length ? "client-labelled" : "server-generated"}; qtyCompleted=${newCompleted})`);
  return ok({ woNumber: wo.woNumber, serials: created, qtyCompleted: newCompleted });
}
