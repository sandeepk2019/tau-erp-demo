// ============================================================================
// Tau ERP — /api/items : Item master + Product families (Engineering module)
// GET  → families (evidence classes + baseline route) + item list
// POST → create item  (requirePerm "engineering.edit", audited)
// ============================================================================
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ApiError, body, getSessionUser, handle, logAudit, ok, parseJsonField, requirePerm } from "@/lib/erp/server";

const ITEM_TYPES = ["RAW", "SUBASSEMBLY", "FINISHED", "CONSUMABLE", "PACKAGING"];
const TRACKING_TYPES = ["SERIAL", "BATCH", "NONE"];
const CRITICALITIES = ["CRITICAL", "STANDARD"];
const LIFECYCLES = ["ACTIVE", "PROTOTYPE", "OBSOLETE"];
const PN_PATTERN = /^[A-Z0-9][A-Z0-9-]{1,39}$/;

function reqStr(v: unknown, field: string, max = 80): string {
  if (typeof v !== "string" || !v.trim()) throw new ApiError(`${field} is required`, 422);
  const s = v.trim();
  if (s.length > max) throw new ApiError(`${field} exceeds ${max} characters`, 422);
  return s;
}

/** GET /api/items — families + items (read: engineering.view). */
export async function GET(req: NextRequest) {
  return handle(async () => {
    const user = await getSessionUser(req);
    requirePerm(user, "engineering.view");

    const [items, families] = await Promise.all([
      db.item.findMany({ orderBy: { partNumber: "asc" } }),
      db.productFamily.findMany({ orderBy: { code: "asc" } }),
    ]);

    return ok({
      items: items.map((i) => ({
        id: i.id, partNumber: i.partNumber, name: i.name, familyCode: i.familyCode,
        itemType: i.itemType, uom: i.uom, trackingType: i.trackingType,
        criticality: i.criticality, unitCost: i.unitCost, revision: i.revision,
        lifecycle: i.lifecycle, hsnCode: i.hsnCode, gstRate: i.gstRate,
        procLeadTimeDays: i.procLeadTimeDays,
      })),
      families: families.map((f) => ({
        id: f.id, code: f.code, name: f.name, description: f.description,
        evidenceClasses: parseJsonField<string[]>(f.evidenceClassesJson, []),
        routeBaseline: parseJsonField<string[]>(f.routeBaselineJson, []),
      })),
    });
  });
}

/** POST /api/items — create a new item master record. */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const editor = requirePerm(await getSessionUser(req), "engineering.edit");
    const b = await body<Record<string, unknown>>(req);

    const partNumber = reqStr(b.partNumber, "Part number", 40).toUpperCase();
    if (!PN_PATTERN.test(partNumber)) {
      throw new ApiError("Part number must be uppercase alphanumeric/dash, 2–40 chars (e.g. RM-XXX-01)", 422);
    }
    const name = reqStr(b.name, "Name", 120);

    const itemType = typeof b.itemType === "string" ? b.itemType : "RAW";
    if (!ITEM_TYPES.includes(itemType)) throw new ApiError(`Invalid item type '${itemType}'`, 422);

    const trackingType = typeof b.trackingType === "string" ? b.trackingType : "NONE";
    if (!TRACKING_TYPES.includes(trackingType)) throw new ApiError(`Invalid tracking type '${trackingType}'`, 422);

    const criticality = typeof b.criticality === "string" ? b.criticality : "STANDARD";
    if (!CRITICALITIES.includes(criticality)) throw new ApiError(`Invalid criticality '${criticality}'`, 422);

    const lifecycle = typeof b.lifecycle === "string" && b.lifecycle ? b.lifecycle : "ACTIVE";
    if (!LIFECYCLES.includes(lifecycle)) throw new ApiError(`Invalid lifecycle '${lifecycle}'`, 422);

    let familyCode = "";
    if (typeof b.familyCode === "string" && b.familyCode && b.familyCode !== "NONE") {
      familyCode = b.familyCode;
      const fam = await db.productFamily.findUnique({ where: { code: familyCode } });
      if (!fam) throw new ApiError(`Unknown product family '${familyCode}'`, 422);
    }

    const unitCost = b.unitCost === undefined || b.unitCost === "" ? 0 : Number(b.unitCost);
    if (!Number.isFinite(unitCost) || unitCost < 0) throw new ApiError("Unit cost must be a number ≥ 0", 422);

    const uom = typeof b.uom === "string" && b.uom.trim() ? b.uom.trim().slice(0, 12) : "Nos";

    // per-item procurement lead time (round 10): optional, 1–365 days
    let procLeadTimeDays: number | null = null;
    if (b.procLeadTimeDays !== undefined && b.procLeadTimeDays !== null && b.procLeadTimeDays !== "") {
      procLeadTimeDays = Number(b.procLeadTimeDays);
      if (!Number.isInteger(procLeadTimeDays) || procLeadTimeDays < 1 || procLeadTimeDays > 365) {
        throw new ApiError("Procurement lead time must be a whole number of days between 1 and 365", 422);
      }
    }

    const existing = await db.item.findUnique({ where: { partNumber } });
    if (existing) throw new ApiError(`Part number ${partNumber} already exists`, 409);

    const item = await db.item.create({
      data: { partNumber, name, familyCode, itemType, uom, trackingType, criticality, lifecycle, unitCost, procLeadTimeDays },
    });

    await logAudit(editor, "CREATE", "ITEM", item.id, `${partNumber} (${itemType}, ${trackingType}${procLeadTimeDays ? `, proc lead ${procLeadTimeDays}d` : ""}) created by ${editor.username}`);
    return ok({ item }, 201);
  });
}

/** PATCH /api/items — update the per-item procurement lead time (round 10).
 *  Narrow-scope edit: engineering.edit only, audited; feeds MRP create-pos data-driven ETA. */
export async function PATCH(req: NextRequest) {
  return handle(async () => {
    const editor = requirePerm(await getSessionUser(req), "engineering.edit");
    const b = await body<{ id?: string; procLeadTimeDays?: unknown }>(req);
    if (!b.id) throw new ApiError("Missing item id", 400);
    const item = await db.item.findUnique({ where: { id: b.id } });
    if (!item) throw new ApiError("Item not found", 404);

    let procLeadTimeDays: number | null = null;
    if (b.procLeadTimeDays !== undefined && b.procLeadTimeDays !== null && b.procLeadTimeDays !== "") {
      procLeadTimeDays = Number(b.procLeadTimeDays);
      if (!Number.isInteger(procLeadTimeDays) || procLeadTimeDays < 1 || procLeadTimeDays > 365) {
        throw new ApiError("Procurement lead time must be a whole number of days between 1 and 365", 422);
      }
    }
    const updated = await db.item.update({ where: { id: item.id }, data: { procLeadTimeDays } });
    await logAudit(
      editor, "UPDATE", "ITEM", item.partNumber,
      `procurement lead time ${item.procLeadTimeDays ?? "—"} → ${procLeadTimeDays ?? "cleared"} days (data-driven PO ETA source: item master)`,
    );
    return ok({ item: { id: updated.id, partNumber: updated.partNumber, procLeadTimeDays: updated.procLeadTimeDays } });
  });
}
