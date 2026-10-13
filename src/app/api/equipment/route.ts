import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ApiError, body, getSessionUser, handle, logAudit, ok, requirePerm } from "@/lib/erp/server";

// ============================================================================
// Tau ERP — Test equipment & gauge calibration register (GAUGE-LEAK-01 gate).
// ============================================================================

/** GET /api/equipment — equipment register with calibration due dates. */
export async function GET() {
  return handle(async () => {
    const equipment = await db.equipment.findMany({ orderBy: { code: "asc" } });
    return ok({ equipment });
  });
}

/** POST /api/equipment — action=schedule { id } → calibrationDue = now + 90d, status OK. */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const user = requirePerm(await getSessionUser(req), "quality.inspect");
    const b = await body<{ action?: string; id?: string; days?: number }>(req);
    if ((b.action ?? "schedule") !== "schedule") throw new ApiError(`Unknown action '${b.action}'`, 400);
    if (!b.id) throw new ApiError("Missing equipment id", 400);
    const eq = await db.equipment.findUnique({ where: { id: b.id } });
    if (!eq) throw new ApiError("Equipment not found", 404);
    const days = Number.isFinite(b.days) && (b.days as number) > 0 ? Math.min(Math.floor(b.days as number), 365) : 90;
    const due = new Date(Date.now() + days * 86_400_000);
    const updated = await db.equipment.update({
      where: { id: eq.id },
      data: { calibrationDue: due, status: "OK" },
    });
    await logAudit(user, "SCHEDULE", "EQUIPMENT", eq.code,
      `Calibration scheduled ${new Date(due).toISOString().slice(0, 10)} (+${days}d) by ${user.username}`);
    await db.notification.create({
      data: {
        role: "CALIB_ENG", kind: "CALIB", severity: "INFO",
        title: "Calibration scheduled",
        message: `${eq.code} (${eq.name}) scheduled for calibration on ${new Date(due).toISOString().slice(0, 10)}.`,
        refType: "EQUIPMENT", refId: eq.code,
      },
    });
    return ok({ equipment: updated });
  });
}
