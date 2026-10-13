// ============================================================================
// Tau ERP — /api/suppliers/scorecard?code=SUP-XXX
// 12-month supplier performance trend COMPUTED from transactional history
// (GRNs × IQC dispositions × PO expected dates). No hand-edited numbers —
// the master Supplier.ppm/onTimePct stay as the master-data scorecard;
// this endpoint reconstructs the month-by-month evidence behind them.
// SYNTHETIC demo data only.
// ============================================================================
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ApiError, handle, ok, getSessionUser, requirePerm } from "@/lib/erp/server";

type MonthBucket = {
  month: string; // YYYY-MM
  label: string; // e.g. "Nov 25"
  receipts: number; // GRNs received
  linesTotal: number; // GRN lines
  accepted: number;
  rejected: number;
  pendingIqc: number;
  qtyReceived: number;
  qtyRejected: number;
  ppm: number | null; // qty-based defect PPM (null when no qty that month)
  onTimePct: number | null; // vs PO expectedDate (null when no dated receipts)
  lateReceipts: number;
};

export async function GET(req: NextRequest) {
  return handle(async () => {
    const user = await getSessionUser(req);
    if (!user) throw new ApiError("No session", 401);
    requirePerm(user, "procurement.view");

    const code = (req.nextUrl.searchParams.get("code") ?? "").trim();
    if (!code) throw new ApiError("code query parameter is required", 400);
    const supplier = await db.supplier.findUnique({ where: { code } });
    if (!supplier) throw new ApiError(`Unknown supplier ${code}`, 404);

    // 12-month window (inclusive of current month)
    const now = new Date();
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11, 1));

    const grns = await db.goodsReceipt.findMany({
      where: { supplierId: supplier.id, receivedAt: { gte: start } },
      include: {
        po: { select: { expectedDate: true, poNumber: true } },
        lines: { select: { qty: true, disposition: true } },
      },
      orderBy: { receivedAt: "asc" },
    });

    const pos = await db.purchaseOrder.findMany({
      where: { supplierId: supplier.id, orderDate: { gte: start } },
      select: { poNumber: true, status: true, orderDate: true, expectedDate: true, totalAmount: true },
      orderBy: { orderDate: "desc" },
    });

    // Supplier corrective actions (SCARs) — full history, newest first.
    // Active = OPEN / UNDER_REVIEW / VERIFICATION (not CLOSED / CANCELLED).
    const ACTIVE_SCAR = ["OPEN", "UNDER_REVIEW", "VERIFICATION"];
    const scars = await db.scar.findMany({
      where: { supplierId: supplier.id },
      orderBy: { createdAt: "desc" },
      select: {
        scarNumber: true, status: true, severity: true, defectDescription: true,
        partSummary: true, grnNumber: true, responseDue: true, respondedAt: true,
        closedAt: true, createdAt: true,
      },
    });
    const nowMs = Date.now();
    const scarTotals = {
      total: scars.length,
      active: scars.filter((s) => ACTIVE_SCAR.includes(s.status)).length,
      criticalOpen: scars.filter((s) => s.severity === "CRITICAL" && ACTIVE_SCAR.includes(s.status)).length,
      overdue: scars.filter(
        (s) => ACTIVE_SCAR.includes(s.status) && s.responseDue && s.responseDue.getTime() < nowMs,
      ).length,
      closed: scars.filter((s) => s.status === "CLOSED").length,
    };
    // 12-month SCAR-raise trend (same bucketing as the suppliers-table sparkline)
    const scarTrend: number[] = [];
    {
      const buckets = new Map<string, number>();
      for (const s of scars) {
        const k = `${s.createdAt.getUTCFullYear()}-${String(s.createdAt.getUTCMonth() + 1).padStart(2, "0")}`;
        buckets.set(k, (buckets.get(k) ?? 0) + 1);
      }
      for (let i = 11; i >= 0; i--) {
        const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
        scarTrend.push(buckets.get(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`) ?? 0);
      }
    }

    const months: MonthBucket[] = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
      const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
      months.push({
        month: key,
        label: d.toLocaleDateString("en-IN", { month: "short", year: "2-digit", timeZone: "UTC" }),
        receipts: 0, linesTotal: 0, accepted: 0, rejected: 0, pendingIqc: 0,
        qtyReceived: 0, qtyRejected: 0, ppm: null, onTimePct: null, lateReceipts: 0,
      });
    }
    const byKey = new Map(months.map((m) => [m.month, m]));

    let totalReceipts = 0, totalQty = 0, totalRejectedQty = 0, totalAcceptedLines = 0, totalRejectedLines = 0, totalPendingLines = 0, datedReceipts = 0, lateReceipts = 0;

    for (const grn of grns) {
      const key = `${grn.receivedAt.getUTCFullYear()}-${String(grn.receivedAt.getUTCMonth() + 1).padStart(2, "0")}`;
      const bucket = byKey.get(key);
      if (!bucket) continue;
      totalReceipts += 1;
      bucket.receipts += 1;
      for (const line of grn.lines) {
        bucket.linesTotal += 1;
        bucket.qtyReceived += line.qty;
        totalQty += line.qty;
        if (line.disposition === "ACCEPTED") { bucket.accepted += 1; totalAcceptedLines += 1; }
        else if (line.disposition === "REJECTED") {
          bucket.rejected += 1; bucket.qtyRejected += line.qty; totalRejectedLines += 1;
          totalRejectedQty += line.qty;
        } else { bucket.pendingIqc += 1; totalPendingLines += 1; }
      }
      if (grn.po?.expectedDate) {
        datedReceipts += 1;
        const onTime = grn.receivedAt.getTime() <= grn.po.expectedDate.getTime() + 24 * 3600 * 1000; // 1-day grace
        if (!onTime) { bucket.lateReceipts += 1; lateReceipts += 1; }
      }
    }

    for (const m of months) {
      if (m.qtyReceived > 0) m.ppm = Math.round((m.qtyRejected / m.qtyReceived) * 1_000_000);
      if (m.receipts > 0 && datedReceipts > 0) {
        // on-time % per month only when the month has dated receipts
        const dated = m.receipts; // approximation: each receipt counted once
        m.onTimePct = Math.round(((dated - m.lateReceipts) / dated) * 100);
      }
    }

    return ok({
      supplier: {
        id: supplier.id, code: supplier.code, name: supplier.name, city: supplier.city,
        category: supplier.category, approved: supplier.approved, rating: supplier.rating,
        ppm: supplier.ppm, onTimePct: supplier.onTimePct, notes: supplier.notes,
      },
      window: { from: start.toISOString().slice(0, 10), to: now.toISOString().slice(0, 10) },
      totals: {
        receipts: totalReceipts,
        qtyReceived: totalQty,
        qtyRejected: totalRejectedQty,
        ppm: totalQty > 0 ? Math.round((totalRejectedQty / totalQty) * 1_000_000) : null,
        linesAccepted: totalAcceptedLines,
        linesRejected: totalRejectedLines,
        linesPendingIqc: totalPendingLines,
        onTimePct: datedReceipts > 0 ? Math.round(((datedReceipts - lateReceipts) / datedReceipts) * 100) : null,
        openPos: pos.filter((p) => ["APPROVED", "PARTIAL", "PENDING_APPROVAL"].includes(p.status)).length,
        spend: pos.filter((p) => p.status !== "CANCELLED").reduce((s, p) => s + p.totalAmount, 0),
      },
      months,
      recentPos: pos.slice(0, 8).map((p) => ({
        poNumber: p.poNumber, status: p.status, orderDate: p.orderDate.toISOString(),
        expectedDate: p.expectedDate?.toISOString() ?? null, totalAmount: p.totalAmount,
      })),
      scars: {
        totals: scarTotals,
        trend: scarTrend,
        rows: scars.slice(0, 12).map((s) => ({
          scarNumber: s.scarNumber, status: s.status, severity: s.severity,
          defectDescription: s.defectDescription, partSummary: s.partSummary,
          grnNumber: s.grnNumber,
          responseDue: s.responseDue?.toISOString() ?? null,
          createdAt: s.createdAt.toISOString(),
          closedAt: s.closedAt?.toISOString() ?? null,
        })),
      },
    });
  });
}
