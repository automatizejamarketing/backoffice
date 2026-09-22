import { NextResponse } from "next/server";
import { requireBackofficePermissionResponse } from "@/lib/auth/rbac";
import {
  ambassadorOptions,
  createAmbassador,
  createSchema,
  listAmbassadors,
} from "@/lib/ambassadors/queries";
import { mutationError } from "@/lib/ambassadors/http";
export async function GET() {
  const auth = await requireBackofficePermissionResponse("ambassadors:manage");
  if (!auth.ok) return auth.response;
  const [rows, options] = await Promise.all([
    listAmbassadors(),
    ambassadorOptions(auth.actor.role === "admin"),
  ]);
  return NextResponse.json({ rows, ...options });
}
export async function POST(request: Request) {
  const auth = await requireBackofficePermissionResponse("ambassadors:manage");
  if (!auth.ok) return auth.response;
  try {
    const data = createSchema.parse(await request.json());
    return NextResponse.json(await createAmbassador(data, auth.actor.email), {
      status: 201,
    });
  } catch (error) {
    return mutationError(error);
  }
}
