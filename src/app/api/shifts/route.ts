// ============================================================================
// Tau ERP — /api/shifts — SHOP-FLOOR SHIFT HANDOVER LOG (spec §Communication).
// GET  ?wo=WO-…            latest handovers (optionally scoped to a work order)
// POST action=create       { shift, shiftDate?, area?, woNumber?, headcount?,
//                            summary, issues?, carryOver?, safetyNote? }
//                          (production.execute) → OPEN handover + notify PROD_SUP
// POST action=acknowledge  { id } (production.execute) — four-eyes:
//                          acknowledger must differ from the author.
// All data SYNTHETIC. Every mutation audited.
// ============================================================================
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ApiError, handle, ok, getSessionUser, requirePerm, logAudit, parseJsonField } from "@/lib/erp/server";
import { SHIFTS } from "@/lib/erp/constants";

type Issue = { issue: string; severity: string };

export async function GET(req: NextRequest) {
  return handle(async () => {
    const user = await getSessionUser(req);
    if (!user) throw new ApiError("No session", 401);
    requirePerm(user, "production.view");

    const wo = (req.nextUrl.searchParams.get("wo") ?? "").trim();
    const shifts = await db.shiftHandover.findMany({
      where: wo ? { woNumber: wo } : undefined,
      orderBy: [{ shiftDate: "desc" }, { createdAt: "desc" }],
      take: 100,
    });
    return ok({
      shifts: shifts.map((s) => ({
        id: s.id,
        shiftDate: s.shiftDate.toISOString(),
        shift: s.shift,
        area: s.area,
        woNumber: s.woNumber,
        authorName: s.authorName,
        headcount: s.headcount,
        summary: s.summary,
        issues: parseJsonField<Issue[]>(s.issuesJson, []),
        carryOver: parseJsonField<string[]>(s.carryOverJson, []),
        safetyNote: s.safetyNote,
        status: s.status,
        acknowledgedBy: s.acknowledgedBy,
        acknowledgedAt: s.acknowledgedAt?.toISOString() ?? null,
        createdAt: s.createdAt.toISOString(),
      })),
    });
  });
}

export async function POST(req: NextRequest) {
  return handle(async () => {
    const user = await getSessionUser(req);
    if (!user) throw new ApiError("No session", 401);
    requirePerm(user, "production.execute");
    const b = (await req.json()) as {
      action: string; id?: string; shift?: string; shiftDate?: string; area?: string;
      woNumber?: string; headcount?: number; summary?: string; issues?: Issue[];
      carryOver?: string[]; safetyNote?: string;
    };

    if (b.action === "create") {
      const shift = SHIFTS.some((s) => s.code === b.shift) ? b.shift! : "A";
      const summary = (b.summary ?? "").trim();
      if (summary.length < 5) throw new ApiError("Handover summary is required (min 5 chars) — say what the incoming shift must know", 422);
      const shiftDate = b.shiftDate ? new Date(b.shiftDate) : new Date();
      if (isNaN(shiftDate.getTime())) throw new ApiError("Invalid shiftDate", 422);
      const issues = (b.issues ?? [])
        .filter((i) => (i.issue ?? "").trim())
        .slice(0, 20)
        .map((i) => ({ issue: String(i.issue).slice(0, 300), severity: ["LOW", "MEDIUM", "HIGH"].includes(i.severity) ? i.severity : "MEDIUM" }));
      const carryOver = (b.carryOver ?? []).filter((c) => (c ?? "").trim()).slice(0, 20).map((c) => String(c).slice(0, 200));

      const created = await db.shiftHandover.create({
        data: {
          shiftDate,
          shift,
          area: (b.area ?? "").trim().slice(0, 40),
          woNumber: (b.woNumber ?? "").trim().slice(0, 30),
          authorName: user.username,
          headcount: Math.max(0, Math.min(999, Math.floor(b.headcount ?? 0))),
          summary: summary.slice(0, 2000),
          issuesJson: JSON.stringify(issues),
          carryOverJson: JSON.stringify(carryOver),
          safetyNote: (b.safetyNote ?? "").trim().slice(0, 500),
          status: "OPEN",
        },
      });

      // notify the incoming shift supervisor role (broadcast)
      await db.notification.create({
        data: {
          role: "PROD_SUP",
          kind: "INFO",
          severity: issues.some((i) => i.severity === "HIGH") ? "WARNING" : "INFO",
          title: `Shift ${shift} handover ready — ${shiftDate.toISOString().slice(0, 10)}`,
          message: `${user.name} logged the ${shift}-shift handover${b.area ? ` for ${b.area}` : ""}${issues.length ? ` with ${issues.length} open issue(s)` : ""}. Read + acknowledge before start-of-shift.`,
          refType: "SHIFT",
          refId: created.id,
        },
      });
      await logAudit(user, "SHIFT_HANDOVER_CREATE", "ShiftHandover", created.id, `shift ${shift} · ${issues.length} issue(s) · ${carryOver.length} carry-over item(s)`);
      return ok({ shift: { id: created.id, status: created.status } }, 201);
    }

    if (b.action === "acknowledge") {
      if (!b.id) throw new ApiError("id is required", 422);
      const rec = await db.shiftHandover.findUnique({ where: { id: b.id } });
      if (!rec) throw new ApiError("Handover not found", 404);
      if (rec.status === "ACKNOWLEDGED") throw new ApiError("Handover already acknowledged", 409);
      if (rec.authorName === user.username) {
        throw new ApiError("Four-eyes control: the incoming-shift acknowledger must be a different user than the outgoing author (server-enforced)", 403);
      }
      const updated = await db.shiftHandover.update({
        where: { id: rec.id },
        data: { status: "ACKNOWLEDGED", acknowledgedBy: user.username, acknowledgedAt: new Date() },
      });
      await logAudit(user, "SHIFT_HANDOVER_ACK", "ShiftHandover", rec.id, `acknowledged author=${rec.authorName} shift=${rec.shift}`);
      return ok({ shift: { id: updated.id, status: updated.status, acknowledgedBy: updated.acknowledgedBy } });
    }

    throw new ApiError(`Unknown action '${b.action}'`, 400);
  });
}
