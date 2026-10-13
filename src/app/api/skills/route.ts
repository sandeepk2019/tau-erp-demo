// ============================================================================
// Tau ERP — Operator skill matrix (DR-006 route qualifications)
// GET  /api/skills → { skills, me, matrix, stepDemands }
//      - skills: SKILL catalogue (code + label)
//      - me: current session user's held skills
//      - matrix: shop-floor-relevant users (OPERATOR/PROD_SUP + anyone holding skills)
//        with held skill codes
//      - stepDemands: RELEASED route steps that require a skill (the demand side)
// POST /api/skills → { username, skills: string[] }  (admin.manage)
//      - replaces the user's skill set; validated against the catalogue;
//        audited (SKILL_MATRIX UPDATE) + INFO notification to the affected user.
// ============================================================================
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { SKILLS, SKILL_CODES } from "@/lib/erp/constants";
import { ApiError, body, getSessionUser, handle, logAudit, ok, parseJsonField, requirePerm } from "@/lib/erp/server";

export async function GET(req: NextRequest) {
  return handle(async () => {
    requirePerm(await getSessionUser(req), "dashboard.view");

    const [users, stepRows] = await Promise.all([
      db.user.findMany({
        where: { active: true },
        select: { id: true, username: true, name: true, role: true, skillCodesJson: true },
        orderBy: [{ role: "asc" }, { name: "asc" }],
      }),
      db.routeStep.findMany({
        where: { skillRequired: { not: "" }, route: { status: "RELEASED" } },
        select: { operationCode: true, skillRequired: true, route: { select: { familyCode: true, revision: true, status: true } } },
        orderBy: { operationCode: "asc" },
      }),
    ]);

    const matrix = users
      .filter((u) => ["OPERATOR", "PROD_SUP"].includes(u.role) || parseJsonField<string[]>(u.skillCodesJson, []).length > 0)
      .map((u) => ({
        username: u.username,
        name: u.name,
        role: u.role,
        skills: parseJsonField<string[]>(u.skillCodesJson, []),
      }));

    // aggregate step demands: skill → operations (+families) using it
    const demandMap = new Map<string, { skill: string; ops: Set<string>; families: Set<string>; steps: number }>();
    for (const s of stepRows) {
      const e = demandMap.get(s.skillRequired) ?? { skill: s.skillRequired, ops: new Set<string>(), families: new Set<string>(), steps: 0 };
      e.ops.add(s.operationCode);
      e.families.add(s.route.familyCode);
      e.steps += 1;
      demandMap.set(s.skillRequired, e);
    }
    const stepDemands = [...demandMap.values()]
      .map((e) => ({ skill: e.skill, operations: [...e.ops].sort(), families: [...e.families].sort(), steps: e.steps }))
      .sort((a, b) => a.skill.localeCompare(b.skill));

    const session = await getSessionUser(req);
    const meRow = session ? users.find((u) => u.username === session.username) : null;
    return ok({
      skills: SKILLS,
      me: session ? { username: session.username, name: session.name, role: session.role, skills: meRow ? parseJsonField<string[]>(meRow.skillCodesJson, []) : [] } : null,
      matrix,
      stepDemands,
    });
  });
}

export async function POST(req: NextRequest) {
  return handle(async () => {
    const user = requirePerm(await getSessionUser(req), "admin.manage");
    const b = await body<{ username?: string; skills?: string[] }>(req);
    if (!b.username) throw new ApiError("username is required", 422);
    if (!Array.isArray(b.skills)) throw new ApiError("skills must be an array of skill codes", 422);

    const invalid = b.skills.filter((s) => !SKILL_CODES.includes(s));
    if (invalid.length) throw new ApiError(`Unknown skill code(s): ${invalid.join(", ")} — valid: ${SKILL_CODES.join(", ")}`, 422);
    const unique = [...new Set(b.skills)];

    const target = await db.user.findUnique({ where: { username: b.username } });
    if (!target) throw new ApiError(`User not found: ${b.username}`, 404);
    if (["AUDITOR", "EXEC_VIEWER"].includes(target.role)) {
      throw new ApiError(`Skill matrix applies to shop-floor roles — ${target.username} is ${target.role} (read-only viewer)`, 422);
    }

    const before = parseJsonField<string[]>(target.skillCodesJson, []);
    const updated = await db.user.update({
      where: { id: target.id },
      data: { skillCodesJson: JSON.stringify(unique) },
    });

    await logAudit(
      user, "UPDATE", "SKILL_MATRIX", target.username,
      `Skills ${before.length ? `[${before.join(", ")}]` : "[]"} → ${unique.length ? `[${unique.join(", ")}]` : "[]"} (DR-006 route qualification)`,
    );
    await db.notification.create({
      data: {
        userId: target.id,
        kind: "SKILL_MATRIX", severity: "INFO",
        title: "Skill matrix updated",
        message: `Your route qualifications (DR-006) are now: ${unique.length ? unique.join(", ") : "none"}. Updated by ${user.name}.`,
        refType: "SKILL", refId: target.username,
      },
    });

    return ok({
      username: updated.username,
      skills: parseJsonField<string[]>(updated.skillCodesJson, []),
    });
  });
}
