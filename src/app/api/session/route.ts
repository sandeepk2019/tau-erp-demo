import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { handle, ok, getSessionUser } from "@/lib/erp/server";

export async function GET(req: NextRequest) {
  return handle(async () => {
    const userCount = await db.user.count();
    const session = await getSessionUser(req);
    return ok({
      seeded: userCount > 0,
      users: await db.user.findMany({
        where: { active: true },
        select: { id: true, username: true, name: true, role: true, plant: true },
        orderBy: { name: "asc" },
      }),
      session,
    });
  });
}
