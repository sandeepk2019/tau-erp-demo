// ============================================================================
// Tau ERP — Audit trail API (immutable log, spec §Audit)
// GET /api/audit?page=&action=&q= → 25/page, total count, distinct action filter list
// Requires "audit.view" (server-enforced RBAC).
// ============================================================================
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser, handle, ok, requirePerm } from "@/lib/erp/server";

const PAGE_SIZE = 25;

export async function GET(req: NextRequest) {
  return handle(async () => {
    requirePerm(await getSessionUser(req), "audit.view");

    const sp = req.nextUrl.searchParams;
    const page = Math.max(1, Number(sp.get("page") ?? "1") || 1);
    const action = (sp.get("action") ?? "").trim();
    const q = (sp.get("q") ?? "").trim();

    const where: {
      action?: string;
      OR?: { entityId?: { contains: string }; entityType?: { contains: string }; userName?: { contains: string }; detail?: { contains: string } }[];
    } = {};
    if (action) where.action = action;
    if (q) {
      where.OR = [
        { entityId: { contains: q } },
        { entityType: { contains: q } },
        { userName: { contains: q } },
        { detail: { contains: q } },
      ];
    }

    const [rows, total, actionRows] = await Promise.all([
      db.auditLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
      }),
      db.auditLog.count({ where }),
      db.auditLog.findMany({ select: { action: true }, distinct: ["action"], orderBy: { action: "asc" } }),
    ]);

    return ok({
      rows,
      total,
      page,
      pageSize: PAGE_SIZE,
      pages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
      actions: actionRows.map((a) => a.action),
    });
  });
}
