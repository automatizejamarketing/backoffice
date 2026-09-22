import { NextResponse } from "next/server";
import { z } from "zod";
import { requireBackofficePermissionResponse } from "@/lib/auth/rbac";
import { grantStarter } from "@/lib/ambassadors/benefits";
import { calendarDate } from "@/lib/ambassadors/workflow";
import { mutationError } from "@/lib/ambassadors/http";
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireBackofficePermissionResponse("ambassadors:grant");
  if (!auth.ok) return auth.response;
  try {
    const id = z
      .string()
      .uuid()
      .parse((await context.params).id);
    const { expiresOn } = z
      .object({ expiresOn: calendarDate })
      .strict()
      .parse(await request.json());
    return NextResponse.json(
      await grantStarter(id, expiresOn, auth.actor.email),
    );
  } catch (error) {
    return mutationError(error);
  }
}
