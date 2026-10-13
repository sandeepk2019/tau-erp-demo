import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { handle, ok } from "@/lib/erp/server";

/**
 * GET /api/suppliers — supplier master with approval state + scorecard metrics
 * + a 12-month SCAR trend per supplier (round-8: sparkline column in the
 * suppliers table; the full history lives in /api/suppliers/scorecard).
 * Module: Procurement (Task 3-b).
 */
const ACTIVE_SCAR = ["OPEN", "UNDER_REVIEW", "VERIFICATION"];

export async function GET(_req: NextRequest) {
  return handle(async () => {
    const suppliers = await db.supplier.findMany({
      orderBy: { code: "asc" },
      select: {
        id: true, code: true, name: true, gstin: true, city: true, category: true,
        approved: true, approvedDate: true, rating: true, ppm: true, onTimePct: true, notes: true,
        _count: { select: { purchaseOrders: true } },
      },
    });

    // SCAR trend — 12 trailing month buckets (oldest → newest) + lifecycle totals.
    const scars = await db.scar.findMany({
      select: { supplierId: true, status: true, responseDue: true, createdAt: true },
    });
    const now = new Date();
    const bySupplier = new Map<string, { total: number; active: number; overdue: number; closed: number; byMonth: number[] }>();
    for (const s of scars) {
      let st = bySupplier.get(s.supplierId);
      if (!st) { st = { total: 0, active: 0, overdue: 0, closed: 0, byMonth: Array(12).fill(0) }; bySupplier.set(s.supplierId, st); }
      st.total += 1;
      if (ACTIVE_SCAR.includes(s.status)) {
        st.active += 1;
        if (s.responseDue && s.responseDue < now) st.overdue += 1;
      } else if (s.status === "CLOSED") st.closed += 1;
      // 12 trailing months, oldest → newest: month-diff from today
      const diff = (now.getFullYear() - s.createdAt.getFullYear()) * 12 + (now.getMonth() - s.createdAt.getMonth());
      if (diff >= 0 && diff <= 11) st.byMonth[11 - diff] += 1;
    }

    return ok({
      suppliers: suppliers.map((s) => ({
        id: s.id, code: s.code, name: s.name, gstin: s.gstin, city: s.city,
        category: s.category, approved: s.approved, approvedDate: s.approvedDate,
        rating: s.rating, ppm: s.ppm, onTimePct: s.onTimePct, notes: s.notes,
        poCount: s._count.purchaseOrders,
        scarStats: bySupplier.get(s.id) ?? { total: 0, active: 0, overdue: 0, closed: 0, byMonth: Array(12).fill(0) },
      })),
    });
  });
}
