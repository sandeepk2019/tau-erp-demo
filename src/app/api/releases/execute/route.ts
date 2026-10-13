import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ApiError, body, getSessionUser, handle, logAudit, nextNumber, ok, requirePerm } from "@/lib/erp/server";

// ============================================================================
// Tau ERP — Product release evidence gate (spec §QMS step 4 + Phase-10 gate:
// "Product release verifies all mandatory evidence"). A run-check creates a
// PENDING release record (or BLOCKED with explicit blockers); a SECOND, different
// user approves → RELEASED (four-eyes, spec rule 12).
// ============================================================================

type Checks = {
  genealogyComplete: boolean;
  inspectionsPassed: boolean;
  calOk: boolean;
  eolOk: boolean;
  finalOk: boolean;
};

type InspLite = { inspNumber: string; kind: string; status: string; attempt: number };

/** Compute the release evidence checks for a finished serial. */
async function computeChecks(lotId: string, lotNumber: string): Promise<{ checks: Checks; blockers: string[] }> {
  const [linkCount, insps] = await Promise.all([
    db.genealogyLink.count({ where: { parentLotId: lotId } }),
    db.inspection.findMany({
      where: { lotNumber },
      select: { inspNumber: true, kind: true, status: true, attempt: true },
    }),
  ]);

  const calOk = insps.some((i) => i.kind === "CALIBRATION" && i.status === "PASSED");
  const eolOk = insps.some((i) => i.kind === "EOL" && i.status === "PASSED");
  const finalOk = insps.some((i) => i.kind === "FINAL" && i.status === "PASSED");

  // No FAILED attempt may remain without a LATER passing attempt (spec: original
  // failure is preserved; only an authorized retest supersedes it).
  const failedWithoutLaterPass = insps.filter((f) => {
    if (f.status !== "FAILED") return false;
    return !insps.some((p) => p.kind === f.kind && p.status === "PASSED" && p.attempt > f.attempt);
  });

  const checks: Checks = { genealogyComplete: linkCount >= 1, inspectionsPassed: calOk && eolOk && finalOk && failedWithoutLaterPass.length === 0, calOk, eolOk, finalOk };

  const blockers: string[] = [];
  if (!checks.genealogyComplete) blockers.push(`Genealogy incomplete — no component lot/serial links recorded for ${lotNumber}`);
  if (!calOk) blockers.push("Calibration evidence missing — no PASSED CALIBRATION record for this serial");
  if (!eolOk) blockers.push("EOL evidence missing — no PASSED EOL record for this serial");
  if (!finalOk) blockers.push("Final inspection evidence missing — no PASSED FINAL record for this serial");
  for (const f of failedWithoutLaterPass) {
    blockers.push(`${f.kind} attempt ${f.attempt} FAILED (${f.inspNumber}) — authorized retest required before release`);
  }
  return { checks, blockers };
}

/** POST /api/releases/execute { lotNumber } — run the release evidence check. */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const user = requirePerm(await getSessionUser(req), "quality.approve");
    const b = await body<{ lotNumber?: string }>(req);
    const lotNumber = (b.lotNumber ?? "").trim();
    if (!lotNumber) throw new ApiError("Provide the finished serial (lot number) to check", 400);

    const lot = await db.stockLot.findUnique({ where: { lotNumber }, include: { item: { select: { partNumber: true, itemType: true, familyCode: true } } } });
    if (!lot) throw new ApiError(`Lot ${lotNumber} not found`, 404);
    if (lot.trackingType !== "SERIAL" || lot.item.itemType !== "FINISHED") {
      throw new ApiError(`${lotNumber} is not a finished serialized unit — release gate applies to FG serials`, 422);
    }

    const released = await db.productRelease.findFirst({ where: { lotNumber, status: "RELEASED" } });
    if (released) {
      throw new ApiError(`${lotNumber} is already RELEASED under ${released.releaseNumber} — released evidence is immutable (spec rule 9)`, 422);
    }

    const { checks, blockers } = await computeChecks(lot.id, lotNumber);
    const status = blockers.length === 0 ? "PENDING" : "BLOCKED";

    // Re-running the check on an open record updates evidence but never the
    // original requester — that would defeat the four-eyes approval.
    let release = await db.productRelease.findFirst({ where: { lotNumber, status: { in: ["PENDING", "BLOCKED"] } } });
    if (release) {
      release = await db.productRelease.update({
        where: { id: release.id },
        data: {
          checksJson: JSON.stringify(checks),
          blockersJson: JSON.stringify(blockers),
          status,
          releasedBy: release.releasedBy || user.username,
        },
      });
    } else {
      release = await db.productRelease.create({
        data: {
          releaseNumber: await nextNumber("REL", "productRelease"),
          lotNumber,
          woNumber: lot.woNumber,
          checksJson: JSON.stringify(checks),
          blockersJson: JSON.stringify(blockers),
          status,
          releasedBy: user.username,
        },
      });
    }

    await logAudit(user, "RELEASE_CHECK", "PRODUCT_RELEASE", release.releaseNumber,
      `${lotNumber} → ${status}${blockers.length ? ` · blockers: ${blockers.length}` : " · all evidence checks passed"}`);
    if (status === "BLOCKED") {
      await db.notification.create({
        data: {
          role: "QUALITY_MGR", kind: "QUALITY", severity: "WARNING",
          title: "Product release blocked",
          message: `${release.releaseNumber} (${lotNumber}): ${blockers[0]}${blockers.length > 1 ? ` +${blockers.length - 1} more` : ""}`,
          refType: "RELEASE", refId: release.releaseNumber,
        },
      });
    }
    return ok({ release, blockers });
  });
}
