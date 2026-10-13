import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ApiError, body, fourEyes, getSessionUser, handle, logAudit, ok, requirePerm } from "@/lib/erp/server";

// ============================================================================
// Tau ERP — Product release records: list + four-eyes approval.
// Run-check lives at /api/releases/execute (creates PENDING/BLOCKED records).
// ============================================================================

/** GET /api/releases — release records + eligible finished serials for the check. */
export async function GET() {
  return handle(async () => {
    const [releases, serials] = await Promise.all([
      db.productRelease.findMany({ orderBy: { createdAt: "desc" } }),
      db.stockLot.findMany({
        where: { trackingType: "SERIAL", item: { itemType: "FINISHED" } },
        include: { item: { select: { partNumber: true, familyCode: true } } },
        orderBy: { lotNumber: "asc" },
      }),
    ]);
    const releasedLots = new Set(releases.filter((r) => r.status === "RELEASED").map((r) => r.lotNumber));
    const openLots = new Set(releases.filter((r) => r.status === "PENDING" || r.status === "BLOCKED").map((r) => r.lotNumber));
    return ok({
      releases,
      eligibleLots: serials
        .filter((s) => !releasedLots.has(s.lotNumber))
        .map((s) => ({
          lotNumber: s.lotNumber,
          woNumber: s.woNumber,
          partNumber: s.item.partNumber,
          family: s.item.familyCode,
          hasOpenCheck: openLots.has(s.lotNumber),
          lotStatus: s.status,
        })),
    });
  });
}

/** POST /api/releases — action=approve { id }: four-eyes approval PENDING → RELEASED. */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const user = requirePerm(await getSessionUser(req), "quality.approve");
    const b = await body<{ action?: string; id?: string }>(req);
    if ((b.action ?? "approve") !== "approve") throw new ApiError(`Unknown action '${b.action}'`, 400);
    if (!b.id) throw new ApiError("Missing release id", 400);
    const release = await db.productRelease.findUnique({ where: { id: b.id } });
    if (!release) throw new ApiError("Release record not found", 404);
    if (release.status === "RELEASED") {
      throw new ApiError(`${release.releaseNumber} is already approved — released evidence is immutable (spec rule 9)`, 422);
    }
    if (release.status === "BLOCKED") {
      const blockers = JSON.parse(release.blockersJson || "[]") as string[];
      throw new ApiError(`Release blocked — resolve evidence first: ${blockers[0] ?? "blockers recorded"}`, 422);
    }
    // Spec rule 12 — approver must differ from the user who ran the release check.
    fourEyes(release.releasedBy, user.username, "Product release");

    const updated = await db.productRelease.update({
      where: { id: release.id },
      data: { status: "RELEASED", approvedBy: user.username, releasedAt: new Date() },
    });
    await logAudit(user, "APPROVE", "PRODUCT_RELEASE", release.releaseNumber,
      `${release.lotNumber} RELEASED — four-eyes (checker ${release.releasedBy}, approver ${user.username})`);
    await db.notification.create({
      data: {
        role: "SALES_MGR", kind: "INFO", severity: "INFO",
        title: "Serial released for dispatch",
        message: `${release.lotNumber} (${release.woNumber || "—"}) released under ${release.releaseNumber} — available for pick/pack.`,
        refType: "RELEASE", refId: release.releaseNumber,
      },
    });
    return ok({ release: updated });
  });
}
