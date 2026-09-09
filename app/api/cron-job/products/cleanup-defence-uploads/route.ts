import { NextResponse, type NextRequest } from "next/server";
import { assertCronAuthorized } from "@/lib/auth/cron-auth";
import { cleanupExpiredProductDisputeDefenceUploads } from "@/lib/products/dispute-defense-service";

export async function GET(request: NextRequest) {
  const auth = assertCronAuthorized(request, "[product-defence-upload-cleanup]");
  if (!auth.ok) return auth.response;

  try {
    const result = await cleanupExpiredProductDisputeDefenceUploads();
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("[product-defence-upload-cleanup] failed", error);
    return NextResponse.json(
      { error: "Não foi possível limpar uploads de defesa expirados." },
      { status: 500 },
    );
  }
}

