// ============================================================================
// Tau ERP — Administration API
// GET  /api/admin                     → users + RBAC matrix + governance stats (admin.view)
// POST {action:"toggle-user-active"}  → activate/deactivate a user (admin.manage)
//    · SYSTEM_ADMIN / APP_MANAGER accounts are protected (SoD, server-enforced)
//    · self-deactivation blocked
// ============================================================================
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser, handle, ok, requirePerm, body, logAudit, ApiError } from "@/lib/erp/server";
import { ROLES, RBAC, type PermKey } from "@/lib/erp/constants";

const PERMS: PermKey[] = [...new Set(Object.values(RBAC).flat())] as PermKey[];

// ---------------------------------------------------------------------------
// GET /api/admin
// ---------------------------------------------------------------------------
export async function GET(req: NextRequest) {
  return handle(async () => {
    requirePerm(await getSessionUser(req), "admin.view");
    const [users, auditTotal, decisions, mrpRuns] = await Promise.all([
      db.user.findMany({ orderBy: [{ active: "desc" }, { username: "asc" }], select: { id: true, username: true, name: true, role: true, plant: true, active: true, createdAt: true } }),
      db.auditLog.count(),
      db.decisionRegister.findMany({ select: { status: true, dueDate: true } }),
      db.mrpRun.count(),
    ]);
    const now = new Date();
    return ok({
      users,
      roles: ROLES,
      rbac: RBAC,
      perms: PERMS,
      stats: {
        usersTotal: users.length,
        usersActive: users.filter((u) => u.active).length,
        auditTotal,
        decisionsOpen: decisions.filter((d) => d.status === "OPEN").length,
        decisionsOverdue: decisions.filter((d) => d.status === "OPEN" && d.dueDate && d.dueDate < now).length,
        mrpRuns,
      },
    });
  });
}

// ---------------------------------------------------------------------------
// POST /api/admin
// ---------------------------------------------------------------------------
export async function POST(req: NextRequest) {
  return handle(async () => {
    const b = await body<{ action?: string; userId?: string }>(req);

    if (b.action === "toggle-user-active") {
      const user = requirePerm(await getSessionUser(req), "admin.manage");
      if (!b.userId) throw new ApiError("toggle-user-active requires userId", 422);
      const target = await db.user.findUnique({ where: { id: b.userId } });
      if (!target) throw new ApiError("User not found", 404);
      // SoD guard: administrator-class accounts can never be disabled from the UI
      if (target.role === "SYSTEM_ADMIN" || target.role === "APP_MANAGER") {
        throw new ApiError(`Blocked: ${target.role} accounts cannot be deactivated (segregation-of-duties, enforced server-side)`, 403);
      }
      if (target.id === user.id) {
        throw new ApiError("Blocked: you cannot deactivate your own session user", 422);
      }
      const updated = await db.user.update({ where: { id: target.id }, data: { active: !target.active } });
      await logAudit(user, "UPDATE", "USER", target.username, `active ${target.active} → ${updated.active} (role ${target.role})`);
      return ok({
        user: { id: updated.id, username: updated.username, name: updated.name, role: updated.role, plant: updated.plant, active: updated.active, createdAt: updated.createdAt },
      });
    }

    throw new ApiError(`Unknown action '${b.action ?? ""}' — expected toggle-user-active`, 400);
  });
}
