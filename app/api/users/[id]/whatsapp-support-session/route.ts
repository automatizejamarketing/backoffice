import { NextResponse } from "next/server";
import { requireBackofficePermissionResponse } from "@/lib/auth/rbac";
import {
  isWhatsappSupportDuration,
  normalizeSupportPhoneE164,
  normalizeWhatsappSupportReason,
  resolveWhatsappSupportEnvironment,
} from "@/lib/backoffice/whatsapp-support-session-core";
import {
  createWhatsappSupportSession,
  endWhatsappSupportSessionFromBackoffice,
  getCurrentWhatsappSupportSession,
} from "@/lib/backoffice/whatsapp-support-session-store";

function disabledEnvironmentResponse() {
  return NextResponse.json(
    {
      error:
        "Support sessions are available only on recognized Vercel deployments.",
    },
    { status: 409 },
  );
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const authz = await requireBackofficePermissionResponse(
    "whatsapp:support-session",
  );
  if (!authz.ok) return authz.response;

  const environment = resolveWhatsappSupportEnvironment();
  if (!environment) return disabledEnvironmentResponse();

  const { id: targetUserId } = await params;
  const session = await getCurrentWhatsappSupportSession({
    targetUserId,
    environment,
  });
  return NextResponse.json(
    {
      environment,
      webhookAvailable: environment === "prod",
      session,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const authz = await requireBackofficePermissionResponse(
    "whatsapp:support-session",
  );
  if (!authz.ok) return authz.response;

  const environment = resolveWhatsappSupportEnvironment();
  if (!environment) return disabledEnvironmentResponse();

  const body = (await request.json().catch(() => null)) as {
    phone?: unknown;
    durationMinutes?: unknown;
    reason?: unknown;
  } | null;
  const phoneE164 =
    typeof body?.phone === "string"
      ? normalizeSupportPhoneE164(body.phone)
      : null;
  const durationMinutes = body?.durationMinutes;
  const reason =
    typeof body?.reason === "string"
      ? normalizeWhatsappSupportReason(body.reason)
      : null;
  if (
    !phoneE164 ||
    typeof durationMinutes !== "number" ||
    !isWhatsappSupportDuration(durationMinutes) ||
    !reason
  ) {
    return NextResponse.json(
      { error: "Telefone, duração ou motivo inválido." },
      { status: 400 },
    );
  }

  const { id: targetUserId } = await params;
  const result = await createWhatsappSupportSession({
    operatorEmail: authz.actor.email,
    targetUserId,
    phoneE164,
    environment,
    reason,
    durationMinutes,
  });
  if (!result.ok) {
    return NextResponse.json(
      { error: "Usuário não encontrado." },
      { status: 404 },
    );
  }

  return NextResponse.json(
    {
      environment,
      webhookAvailable: environment === "prod",
      session: result.session,
      activationCode: result.activationCode,
      activationCommand: `SUPORTE ${result.activationCode}`,
    },
    {
      status: 201,
      headers: { "Cache-Control": "no-store" },
    },
  );
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const authz = await requireBackofficePermissionResponse(
    "whatsapp:support-session",
  );
  if (!authz.ok) return authz.response;

  const environment = resolveWhatsappSupportEnvironment();
  if (!environment) return disabledEnvironmentResponse();

  const body = (await request.json().catch(() => null)) as {
    sessionId?: unknown;
  } | null;
  if (typeof body?.sessionId !== "string") {
    return NextResponse.json(
      { error: "sessionId inválido." },
      { status: 400 },
    );
  }

  const { id: targetUserId } = await params;
  const ended = await endWhatsappSupportSessionFromBackoffice({
    sessionId: body.sessionId,
    targetUserId,
    environment,
    operatorEmail: authz.actor.email,
  });
  if (!ended) {
    return NextResponse.json(
      { error: "Sessão não encontrada ou já encerrada." },
      { status: 404 },
    );
  }
  return NextResponse.json(
    { success: true },
    { headers: { "Cache-Control": "no-store" } },
  );
}
