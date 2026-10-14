import { hiddenClientResponse, isHiddenClient } from "@/lib/auth/hidden-clients";
import { NextResponse } from "next/server";
import { requireBackofficePermissionResponse } from "@/lib/auth/rbac";
import { normalizeCrmNote } from "@/lib/backoffice/crm";
import { addCrmLeadNote, crmLeadAccountId } from "@/lib/db/crm-queries";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  const authz = await requireBackofficePermissionResponse("crm:manage");
  if (!authz.ok) return authz.response;
  const { userId } = await params;
  // A rota aceita o id do contato ou o da conta: checa a conta resolvida.
  if (isHiddenClient(authz.actor, userId) || isHiddenClient(authz.actor, await crmLeadAccountId(userId))) return hiddenClientResponse();
  const payload = (await request.json().catch(() => null)) as
    | { body?: unknown }
    | null;
  const body = normalizeCrmNote(payload?.body);
  if (!body) {
    return NextResponse.json(
      { error: "Escreva a anotação (até 4.000 caracteres)." },
      { status: 400 },
    );
  }
  const event = await addCrmLeadNote({
    userId,
    body,
    authorEmail: authz.actor.email,
  });
  return NextResponse.json({ event }, { status: 201 });
}
