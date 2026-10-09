"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { loginUrlWithReturn } from "@/lib/auth/login-return";
import { getCurrentBackofficeActor } from "@/lib/auth/rbac";
import { capabilitiesFor } from "@/lib/mcp/connections";
import { buildRedirect } from "@/lib/mcp-oauth/core";
import { resolveAuthorizeRequest } from "@/lib/mcp-oauth/http";
import { mcpOauthService } from "@/lib/mcp-oauth/store";

/**
 * The consent decision. Re-validates everything from the query (the form is
 * just a carrier) so a tampered form cannot mint a code for another client.
 */
export async function decideAuthorization(formData: FormData): Promise<void> {
  const query = String(formData.get("query") ?? "");
  const params = new URLSearchParams(query);
  const { parsed } = await resolveAuthorizeRequest(params, await headers());

  if (!parsed.ok) {
    if (parsed.kind === "redirect") {
      redirect(buildRedirect(parsed.redirectUri, { error: parsed.error, error_description: parsed.description, state: parsed.state }));
    }
    redirect(`/oauth/authorize?${query}`);
  }

  const actor = await getCurrentBackofficeActor();
  if (!actor) redirect(loginUrlWithReturn(`/oauth/authorize?${query}`));

  const { request } = parsed;
  if (formData.get("decision") !== "approve") {
    redirect(buildRedirect(request.redirectUri, { error: "access_denied", error_description: "O colaborador não autorizou o acesso.", state: request.state }));
  }
  // Same rule as the consent screen: a role without any MCP tool cannot connect.
  if (capabilitiesFor(actor).length === 0) {
    redirect(buildRedirect(request.redirectUri, { error: "access_denied", error_description: "O cargo deste colaborador não usa o conector.", state: request.state }));
  }

  const code = await mcpOauthService.issueAuthorizationCode({ request, actorEmail: actor.email });
  redirect(buildRedirect(request.redirectUri, { code, state: request.state }));
}
