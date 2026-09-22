import { NextResponse } from "next/server";
import { z } from "zod";
import { requireBackofficePermissionResponse } from "@/lib/auth/rbac";
import {
  ambassadorHistory,
  updateAmbassador,
  updateSchema,
} from "@/lib/ambassadors/queries";
import { mutationError } from "@/lib/ambassadors/http";
type Context = { params: Promise<{ id: string }> };
export async function GET(_: Request, context: Context) {
  const auth = await requireBackofficePermissionResponse("ambassadors:manage");
  if (!auth.ok) return auth.response;
  try {
    const id = z
      .string()
      .uuid()
      .parse((await context.params).id);
    return NextResponse.json(await ambassadorHistory(id));
  } catch (error) {
    return mutationError(error);
  }
}
export async function PATCH(request: Request, context: Context) {
  const auth = await requireBackofficePermissionResponse("ambassadors:manage");
  if (!auth.ok) return auth.response;
  try {
    const id = z
      .string()
      .uuid()
      .parse((await context.params).id);
    await updateAmbassador(
      id,
      updateSchema.parse(await request.json()),
      auth.actor.email,
    );
    return NextResponse.json({ ok: true });
  } catch (error) {
    return mutationError(error);
  }
}
