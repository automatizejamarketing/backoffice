import { NextResponse } from "next/server";
import { getCurrentBackofficeActor } from "@/lib/auth/rbac";
import { hasBackofficePermission, type BackofficeActor } from "@/lib/auth/rbac-core";
import { AgencyError } from "@/lib/agency/agencies";

/** Admin (equipe) ou Dono de agência; a agência certa é checada em `lib/agency/agencies`. */
export async function agencyActor(): Promise<{ actor: BackofficeActor } | { response: NextResponse }> {
  const actor = await getCurrentBackofficeActor();
  if (!actor) return { response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if (!hasBackofficePermission(actor, "team:manage") && !hasBackofficePermission(actor, "agency:manage")) {
    return { response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { actor };
}

export function agencyErrorResponse(error: unknown) {
  if (error instanceof AgencyError) return NextResponse.json({ error: error.message }, { status: error.status });
  console.error("[agencies]", error);
  return NextResponse.json({ error: "Não foi possível concluir. Tente de novo." }, { status: 500 });
}

export async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = await request.json();
    return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export const str = (value: unknown) => (typeof value === "string" ? value : "");
