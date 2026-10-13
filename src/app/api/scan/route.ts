// ============================================================================
// Tau ERP — Inventory & Traceability (Task 3-c)
// POST /api/scan — shop-floor barcode scan console.
//   type: LOT_INFO       → look up any serial/batch (read-only, audited as SCAN)
//   type: VALIDATE_ISSUE → lot must be IN_STOCK in WH-ACC/WH-WIP; if a woNumber
//                          is supplied the lot's item must appear in that WO's BOM
//   type: MOVE           → TRANSFER StockMovement + lot.warehouseCode update.
//                          Perm: inventory.move. Blocked for REJECTED/SHIPPED/
//                          SCRAPPED/CONSUMED lots with explicit ApiError.
// Spec rule: "Duplicate, malformed, unknown and wrong-status scans fail clearly."
// ============================================================================
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser, requirePerm, handle, ok, body, logAudit, ApiError } from "@/lib/erp/server";

type ScanBody = { type?: string; lot?: string; toWh?: string; woNumber?: string };

const MOVE_BLOCKED = new Set(["REJECTED", "SHIPPED", "SCRAPPED", "CONSUMED"]);
const ISSUE_OK_WH = new Set(["WH-ACC", "WH-WIP"]);

export async function POST(req: NextRequest) {
  return handle(async () => {
    const user = await getSessionUser(req);
    const b = await body<ScanBody>(req);
    const type = (b.type ?? "").trim().toUpperCase();
    const code = (b.lot ?? "").trim();

    // Malformed scan fails clearly (scanner keyboard-wedge can emit junk)
    if (!type) throw new ApiError("Malformed scan: missing scan type (LOT_INFO | VALIDATE_ISSUE | MOVE)", 422);
    if (!["LOT_INFO", "VALIDATE_ISSUE", "MOVE"].includes(type)) {
      throw new ApiError(`Malformed scan: unknown scan type '${type}'`, 422);
    }
    if (!code) throw new ApiError("Malformed scan: empty barcode — scan or type a serial/batch number", 422);

    const lot = await db.stockLot.findUnique({
      where: { lotNumber: code },
      include: { item: { select: { partNumber: true, name: true, itemType: true, trackingType: true, uom: true, unitCost: true } } },
    });
    if (!lot) throw new ApiError(`Unknown barcode: '${code}' — no stock lot with this number exists`, 404);

    if (type === "LOT_INFO") {
      const movements = await db.stockMovement.findMany({ where: { lotId: lot.id }, orderBy: { createdAt: "desc" }, take: 10 });
      const [genealogyChild, genealogyParent] = await Promise.all([
        db.genealogyLink.count({ where: { parentLotId: lot.id } }),
        db.genealogyLink.count({ where: { childLotId: lot.id } }),
      ]);
      await logAudit(user, "SCAN", "StockLot", lot.lotNumber, "LOT_INFO scan (read-only)");
      return ok({
        scan: "LOT_INFO", okScan: true,
        lot: {
          lotNumber: lot.lotNumber, status: lot.status, warehouseCode: lot.warehouseCode, qty: lot.qty,
          trackingType: lot.trackingType, supplierBatch: lot.supplierBatch, woNumber: lot.woNumber,
          item: lot.item, expiryDate: lot.expiryDate,
        },
        recentMovements: movements.map((m) => ({ id: m.id, type: m.type, fromWh: m.fromWh, toWh: m.toWh, refType: m.refType, refId: m.refId, createdAt: m.createdAt })),
        genealogy: { consumed: genealogyChild, usedIn: genealogyParent },
      });
    }

    if (type === "VALIDATE_ISSUE") {
      const woNumber = (b.woNumber ?? "").trim();
      const checks: { check: string; pass: boolean; detail: string }[] = [];
      checks.push({ check: "Lot exists", pass: true, detail: `${lot.item.partNumber} (${lot.item.trackingType})` });
      checks.push({ check: "Status = IN_STOCK", pass: lot.status === "IN_STOCK", detail: `current: ${lot.status}` });
      checks.push({ check: "Warehouse ∈ WH-ACC/WH-WIP", pass: ISSUE_OK_WH.has(lot.warehouseCode), detail: `current: ${lot.warehouseCode}` });

      let bomCheck: { check: string; pass: boolean; detail: string } | null = null;
      if (woNumber) {
        const wo = await db.workOrder.findUnique({ where: { woNumber }, include: { bom: { include: { lines: true } } } });
        if (!wo) {
          bomCheck = { check: `WO ${woNumber} exists`, pass: false, detail: "unknown work order" };
        } else {
          const inBom = (wo.bom?.lines ?? []).some((l) => l.componentItemId === lot.itemId);
          bomCheck = {
            check: `Item in WO ${woNumber} BOM`,
            pass: inBom,
            detail: inBom ? `${lot.item.partNumber} found in BOM rev ${wo.bomRevision || "A"}` : `${lot.item.partNumber} not in BOM rev ${wo.bomRevision || "A"}`,
          };
        }
        checks.push(bomCheck);
      }

      const pass = checks.every((c) => c.pass);
      await logAudit(user, "SCAN", "StockLot", lot.lotNumber, `VALIDATE_ISSUE scan → ${pass ? "PASS" : "FAIL"}`);
      return ok({
        scan: "VALIDATE_ISSUE", okScan: pass, woNumber,
        lot: { lotNumber: lot.lotNumber, status: lot.status, warehouseCode: lot.warehouseCode, qty: lot.qty, item: lot.item },
        checks,
        reason: pass ? "Valid for issue to work order" : "Validation failed — see checks",
      });
    }

    // MOVE — controlled inventory transition: RBAC + status guard + audited
    const actor = await requirePerm(user, "inventory.move");
    const toWh = (b.toWh ?? "").trim();
    if (!toWh) throw new ApiError("MOVE requires a destination warehouse (toWh)", 422);
    const wh = await db.warehouse.findUnique({ where: { code: toWh } });
    if (!wh) throw new ApiError(`Unknown destination warehouse: '${toWh}'`, 404);
    if (toWh === lot.warehouseCode) throw new ApiError(`Lot ${lot.lotNumber} is already in ${toWh} — source and destination identical`, 422);
    if (MOVE_BLOCKED.has(lot.status)) {
      throw new ApiError(
        `Movement blocked: lot ${lot.lotNumber} is ${lot.status}${lot.status === "REJECTED" ? " (MRB disposition required)" : lot.status === "SHIPPED" ? " (custody transferred to customer)" : lot.status === "CONSUMED" ? " (already issued to a work order)" : ""} — status change not allowed by scan`,
        409,
      );
    }

    const fromWh = lot.warehouseCode;
    const movement = await db.stockMovement.create({
      data: { lotId: lot.id, type: "TRANSFER", qty: lot.qty, fromWh, toWh, refType: "SCAN", refId: "SCAN-CONSOLE", userId: actor.username, note: `Scan-console transfer ${fromWh} → ${toWh}` },
    });
    await db.stockLot.update({ where: { id: lot.id }, data: { warehouseCode: toWh } });
    await logAudit(actor, "TRANSFER", "StockLot", lot.lotNumber, `SCAN MOVE ${fromWh} → ${toWh} (movement ${movement.id})`);

    return ok({
      scan: "MOVE", okScan: true, movementId: movement.id,
      lot: { lotNumber: lot.lotNumber, status: lot.status, warehouseCode: toWh, qty: lot.qty, item: lot.item },
      fromWh, toWh,
      reason: `Transferred ${lot.lotNumber}: ${fromWh} → ${toWh}`,
    });
  });
}
