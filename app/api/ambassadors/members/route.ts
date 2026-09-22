import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { requireBackofficePermissionResponse } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { ambassadorMember, backofficeUser } from "@/lib/db/schema";
import { mutationError } from "@/lib/ambassadors/http";
export async function PUT(request: Request) {
  const auth = await requireBackofficePermissionResponse("team:manage");
  if (!auth.ok) return auth.response;
  try {
    const data = z
      .object({
        userId: z.string().uuid(),
        enabled: z.boolean(),
        canGrantStarter: z.boolean(),
      })
      .strict()
      .parse(await request.json());
    const [member] = await db
      .select()
      .from(backofficeUser)
      .where(eq(backofficeUser.id, data.userId));
    if (!member?.active)
      throw new Error("Integrante não encontrado ou inativo.");
    if (data.enabled)
      await db
        .insert(ambassadorMember)
        .values({ userId: data.userId, canGrantStarter: data.canGrantStarter })
        .onConflictDoUpdate({
          target: ambassadorMember.userId,
          set: { canGrantStarter: data.canGrantStarter },
        });
    else
      await db
        .delete(ambassadorMember)
        .where(eq(ambassadorMember.userId, data.userId));
    return NextResponse.json({ ok: true });
  } catch (error) {
    return mutationError(error);
  }
}
