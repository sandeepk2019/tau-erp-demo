// ============================================================================
// Tau ERP — /api/boms : Bill of Materials (Engineering module)
// GET  → BOM revisions with lines + component items
// POST → { action: "add-line" } (engineering.edit, DRAFT only)
//        { action: "release"  } (engineering.approve, DRAFT → RELEASED)
// Immutability: RELEASED revisions cannot be edited (spec rule 13).
// NOTE: production may only consume RELEASED BOMs — enforced later in WO API.
// ============================================================================
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ApiError, body, getSessionUser, handle, logAudit, ok, requirePerm } from "@/lib/erp/server";

type BomWithLines = Awaited<ReturnType<typeof loadBoms>>[number];

async function loadBoms() {
  return db.bom.findMany({
    include: {
      item: { select: { partNumber: true, name: true, familyCode: true } },
      lines: { include: { componentItem: { select: { partNumber: true, name: true, uom: true, lifecycle: true } } }, orderBy: { position: "asc" } },
    },
    orderBy: [{ item: { partNumber: "asc" } }, { revision: "asc" }],
  });
}

function toDto(b: BomWithLines) {
  return {
    id: b.id, itemId: b.itemId, revision: b.revision, status: b.status,
    partNumber: b.item.partNumber, itemName: b.item.name, familyCode: b.item.familyCode,
    effectiveFrom: b.effectiveFrom, releasedBy: b.releasedBy, releasedAt: b.releasedAt, notes: b.notes,
    lineCount: b.lines.length,
    lines: b.lines.map((l) => ({
      id: l.id, componentItemId: l.componentItemId, qty: l.qty, scrapPct: l.scrapPct, position: l.position,
      partNumber: l.componentItem?.partNumber ?? "", componentName: l.componentItem?.name ?? "MISSING ITEM",
      uom: l.componentItem?.uom ?? "", lifecycle: l.componentItem?.lifecycle ?? "",
    })),
  };
}

function immutabilityError(status: string): ApiError {
  return new ApiError(
    status === "RELEASED"
      ? "Released revision is immutable — issue a new revision (spec rule 13)"
      : `Revision is ${status} and cannot be modified`,
    422
  );
}

/** GET /api/boms — all BOM revisions incl. lines (read: engineering.view). */
export async function GET(req: NextRequest) {
  return handle(async () => {
    const user = await getSessionUser(req);
    requirePerm(user, "engineering.view");
    const boms = await loadBoms();
    return ok({ boms: boms.map(toDto) });
  });
}

/** POST /api/boms — action dispatch: add-line | release. */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const user = await getSessionUser(req);
    const b = await body<Record<string, unknown>>(req);
    const action = typeof b.action === "string" ? b.action : "";
    const bomId = typeof b.bomId === "string" ? b.bomId : "";
    if (!bomId) throw new ApiError("bomId is required", 422);

    if (action === "add-line") {
      requirePerm(user, "engineering.edit");
      const bom = await db.bom.findUnique({
        where: { id: bomId },
        include: { lines: true, item: { select: { partNumber: true } } },
      });
      if (!bom) throw new ApiError("BOM revision not found", 404);
      if (bom.status !== "DRAFT") throw immutabilityError(bom.status);

      const componentItemId = typeof b.componentItemId === "string" ? b.componentItemId : "";
      if (!componentItemId) throw new ApiError("componentItemId is required", 422);
      const comp = await db.item.findUnique({ where: { id: componentItemId } });
      if (!comp) throw new ApiError("Component item not found — pick a valid item master record", 422);
      if (comp.id === bom.itemId) throw new ApiError("A BOM cannot contain its own parent item", 422);
      if (bom.lines.some((l) => l.componentItemId === componentItemId)) {
        throw new ApiError(`${comp.partNumber} is already a line of this BOM revision`, 422);
      }
      const qty = Number(b.qty);
      if (!Number.isFinite(qty) || qty <= 0) throw new ApiError("Quantity must be a number > 0", 422);
      const scrapPct = b.scrapPct === undefined || b.scrapPct === "" ? 0 : Number(b.scrapPct);
      if (!Number.isFinite(scrapPct) || scrapPct < 0 || scrapPct > 100) throw new ApiError("Scrap % must be between 0 and 100", 422);

      const line = await db.bomLine.create({
        data: { bomId: bom.id, componentItemId, qty, scrapPct, position: comp.partNumber },
      });
      await logAudit(user, "CREATE", "BOM_LINE", line.id, `${comp.partNumber} × ${qty} ${comp.uom} added to ${bom.item.partNumber} rev ${bom.revision}`);
      return ok({ line }, 201);
    }

    if (action === "release") {
      const approver = requirePerm(user, "engineering.approve");
      const bom = await db.bom.findUnique({
        where: { id: bomId },
        include: { lines: { include: { componentItem: { select: { partNumber: true, lifecycle: true } } } }, item: { select: { partNumber: true } } },
      });
      if (!bom) throw new ApiError("BOM revision not found", 404);
      if (bom.status === "RELEASED") throw immutabilityError(bom.status);
      if (bom.status !== "DRAFT") throw new ApiError(`Only DRAFT revisions can be released (current: ${bom.status})`, 422);

      if (bom.lines.length === 0) {
        throw new ApiError("Cannot release a BOM with zero lines — add components first", 422);
      }
      const missing = bom.lines.filter((l) => !l.componentItem);
      if (missing.length > 0) {
        throw new ApiError(`Release rejected: ${missing.length} BOM line(s) reference a missing component item`, 422);
      }
      const obsolete = bom.lines.filter((l) => l.componentItem?.lifecycle === "OBSOLETE");
      if (obsolete.length > 0) {
        throw new ApiError(`Release rejected: line(s) use OBSOLETE component(s) — ${obsolete.map((l) => l.componentItem?.partNumber).join(", ")}`, 422);
      }

      const eff = b.effectiveFrom ? new Date(String(b.effectiveFrom)) : new Date();
      if (isNaN(eff.getTime())) throw new ApiError("effectiveFrom must be a valid date", 422);

      const updated = await db.bom.update({
        where: { id: bom.id },
        data: { status: "RELEASED", releasedBy: approver.username, releasedAt: new Date(), effectiveFrom: eff },
      });
      await logAudit(user, "RELEASE", "BOM", bom.id, `${bom.item.partNumber} rev ${bom.revision} released with ${bom.lines.length} lines; effective ${eff.toISOString().slice(0, 10)}`);
      return ok({ bom: { id: updated.id, status: updated.status, releasedBy: updated.releasedBy, releasedAt: updated.releasedAt, effectiveFrom: updated.effectiveFrom } });
    }

    throw new ApiError(`Unknown action '${action}' — expected add-line | release`, 400);
  });
}
