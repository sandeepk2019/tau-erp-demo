import { NextRequest } from "next/server";
import { handle, ok, logAudit, getSessionUser } from "@/lib/erp/server";
import { seedAll, isSeeded } from "@/lib/erp/seed";

/** POST /api/seed — idempotent SYNTHETIC seed. Guarded: dev/UAT only (spec rule 7). */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const user = await getSessionUser(req);
    const payload = await req.json().catch(() => ({}));
    const force = Boolean((payload as { force?: boolean }).force);
    if (force) {
      // deliberate guarded override — audit loudly
      await logAudit(user, "SEED", "SITE", "tau-erp", "FORCE reseed requested (SYNTHETIC)");
    }
    const result = await seedAll(force);
    return ok(result);
  });
}

export async function GET() {
  return handle(async () => {
    const seeded = await isSeeded();
    return ok({ seeded, note: "POST to seed SYNTHETIC dataset (force=true to wipe & reseed)" });
  });
}
