import { NextResponse } from "next/server";
import { requireBackofficePermissionResponse } from "@/lib/auth/rbac";
import { createExpert, listExperts } from "@/lib/db/product-queries";

export async function GET() {
  const authz = await requireBackofficePermissionResponse("products:manage");
  if (!authz.ok) return authz.response;
  return NextResponse.json(await listExperts());
}

export async function POST(request: Request) {
  const authz = await requireBackofficePermissionResponse("products:manage");
  if (!authz.ok) return authz.response;
  const body = (await request.json()) as {
    email?: string;
    displayName?: string;
    profileImageUrl?: string | null;
    phone?: string;
    pixKey?: string;
    platformFeePercent?: number;
    platformFeeFixedCentavos?: number;
  };
  if (!body.email || !body.displayName?.trim() || !body.pixKey?.trim()) {
    return NextResponse.json({ error: "Dados incompletos" }, { status: 422 });
  }
  try {
    return NextResponse.json(
      await createExpert({
        email: body.email,
        displayName: body.displayName,
        profileImageUrl: body.profileImageUrl,
        phone: body.phone,
        pixKey: body.pixKey,
        platformFeePercent: body.platformFeePercent,
        platformFeeFixedCentavos: body.platformFeeFixedCentavos,
      }),
      { status: 201 },
    );
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 422 },
    );
  }
}
