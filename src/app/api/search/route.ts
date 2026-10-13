// ============================================================================
// Tau ERP — /api/search — cross-entity global search for the ⌘K palette.
// Role-scoped: each entity group only returned when the session role has its
// view permission (server-enforced RBAC applies to search too).
// ============================================================================
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ApiError, handle, getSessionUser, ok } from "@/lib/erp/server";
import { hasPerm } from "@/lib/erp/constants";

export type SearchHit = {
  kind: string; // LOT|WO|NCR|INVOICE|SO|PO|ITEM|SUPPLIER|CUSTOMER|ECO|RELEASE
  id: string;
  title: string;
  sub: string;
  view: string;
  tab: string;
  param: string;
};

/** GET /api/search?q=... — top hits per entity kind (≤5 each). */
export async function GET(req: NextRequest) {
  return handle(async () => {
    const user = await getSessionUser(req);
    if (!user) throw new ApiError("No session", 401);
    const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
    if (q.length < 2) return ok({ hits: [], q });
    const like = { contains: q };

    const hits: SearchHit[] = [];

    if (hasPerm(user.role, "inventory.view")) {
      const lots = await db.stockLot.findMany({
        where: { OR: [{ lotNumber: like }, { supplierBatch: like }, { woNumber: like }] },
        include: { item: { select: { partNumber: true, name: true } } },
        take: 5, orderBy: { createdAt: "desc" },
      });
      for (const l of lots) hits.push({ kind: "LOT", id: l.id, title: l.lotNumber, sub: `${l.item.partNumber} · ${l.status} · ${l.warehouseCode}`, view: "inventory", tab: "lots", param: l.lotNumber });
    }
    if (hasPerm(user.role, "production.view")) {
      const wos = await db.workOrder.findMany({
        where: { OR: [{ woNumber: like }, { soNumber: like }, { familyCode: like }] },
        include: { item: { select: { partNumber: true } } },
        take: 5, orderBy: { woNumber: "desc" },
      });
      for (const w of wos) hits.push({ kind: "WO", id: w.id, title: w.woNumber, sub: `${w.item.partNumber} · ${w.status} · ${w.qtyCompleted}/${w.qtyPlanned}`, view: "production", tab: "", param: w.woNumber });
    }
    if (hasPerm(user.role, "quality.view")) {
      const ncrs = await db.ncr.findMany({ where: { OR: [{ ncrNumber: like }, { lotNumber: like }, { description: like }] }, take: 4, orderBy: { createdAt: "desc" } });
      for (const n of ncrs) hits.push({ kind: "NCR", id: n.id, title: n.ncrNumber, sub: `${n.severity} · ${n.status} · ${n.lotNumber || "—"}`, view: "quality", tab: "ncr", param: n.ncrNumber });
      const rels = await db.productRelease.findMany({ where: { OR: [{ releaseNumber: like }, { lotNumber: like }] }, take: 4, orderBy: { createdAt: "desc" } });
      for (const r of rels) hits.push({ kind: "RELEASE", id: r.id, title: r.releaseNumber, sub: `${r.lotNumber} · ${r.status}`, view: "quality", tab: "release", param: r.lotNumber });
      const insp = await db.inspection.findMany({ where: { inspNumber: like }, take: 4, orderBy: { inspNumber: "desc" } });
      for (const i of insp) hits.push({ kind: "INSP", id: i.id, title: i.inspNumber, sub: `${i.kind} · ${i.status} · ${i.lotNumber || i.woNumber || "—"}`, view: "quality", tab: "inspections", param: i.inspNumber });
    }
    if (hasPerm(user.role, "sales.view")) {
      const invs = await db.salesInvoice.findMany({ where: { OR: [{ invoiceNumber: like }, { irn: like }] }, take: 4, orderBy: { createdAt: "desc" } });
      for (const i of invs) hits.push({ kind: "INVOICE", id: i.id, title: i.invoiceNumber, sub: `₹${i.total.toLocaleString("en-IN")} · ${i.status}${i.irn ? " · IRN" : ""}`, view: "sales", tab: "invoices", param: i.invoiceNumber });
      const sos = await db.salesOrder.findMany({ where: { OR: [{ soNumber: like }, { programme: like }] }, take: 4, orderBy: { orderDate: "desc" } });
      for (const s of sos) hits.push({ kind: "SO", id: s.id, title: s.soNumber, sub: `${s.status} · ₹${s.totalAmount.toLocaleString("en-IN")} · ${s.programme || "—"}`, view: "sales", tab: "orders", param: s.soNumber });
    }
    if (hasPerm(user.role, "procurement.view")) {
      const supsFirst = await db.supplier.findMany({ where: { OR: [{ code: like }, { name: like }, { gstin: like }] }, take: 2 });
      const pos = await db.purchaseOrder.findMany({
        where: { OR: [{ poNumber: like }, { supplierId: { in: supsFirst.map((s) => s.id) } }] },
        include: { supplier: { select: { code: true, name: true } } },
        take: 4, orderBy: { orderDate: "desc" },
      });
      for (const p of pos) hits.push({ kind: "PO", id: p.id, title: p.poNumber, sub: `${p.supplier.name} · ${p.status}`, view: "procurement", tab: "orders", param: p.poNumber });
      const sups = await db.supplier.findMany({ where: { OR: [{ code: like }, { name: like }, { gstin: like }] }, take: 4 });
      for (const s of sups) hits.push({ kind: "SUPPLIER", id: s.id, title: s.name, sub: `${s.code} · ${s.approved ? "approved" : "NOT approved"} · PPM ${s.ppm}`, view: "procurement", tab: "suppliers", param: s.code });
    }
    if (hasPerm(user.role, "engineering.view")) {
      const items = await db.item.findMany({ where: { OR: [{ partNumber: like }, { name: like }] }, take: 5 });
      for (const i of items) hits.push({ kind: "ITEM", id: i.id, title: i.partNumber, sub: `${i.name} · ${i.itemType} · ${i.trackingType}`, view: "engineering", tab: "items", param: i.partNumber });
      const ecos = await db.engineeringChange.findMany({ where: { OR: [{ number: like }, { title: like }] }, take: 4 });
      for (const e of ecos) hits.push({ kind: "ECO", id: e.id, title: e.number, sub: `${e.kind} · ${e.status} · ${e.title.slice(0, 40)}`, view: "engineering", tab: "eco", param: e.number });
    }

    return ok({ hits, q });
  });
}
