import { NextResponse } from "next/server";
import { requireBackofficePermissionResponse } from "@/lib/auth/rbac";
import {
  activeNameExists,
  createTrackableLink,
} from "@/lib/trackable-links/queries";

export async function POST(request: Request) {
  try {
    const authz = await requireBackofficePermissionResponse(
      "trackable-links:manage",
    );
    if (!authz.ok) return authz.response;

    const body = await request.json();
    const { name: rawName } = body as { name?: string };
    const name = typeof rawName === "string" ? rawName.trim() : "";

    if (!name) {
      return NextResponse.json({ error: "Missing name" }, { status: 400 });
    }

    if (await activeNameExists(name)) {
      return NextResponse.json(
        { error: "Já existe um link rastreável com esse nome" },
        { status: 409 },
      );
    }

    // Slug is derived from the name (kebab-case), made unique with a random
    // suffix on collision, and is immutable thereafter.
    const link = await createTrackableLink({
      name,
      createdBy: authz.actor.email,
    });

    return NextResponse.json({ trackableLink: link });
  } catch (error) {
    console.error("Error creating trackable link:", error);
    return NextResponse.json(
      { error: "Failed to create trackable link" },
      { status: 500 },
    );
  }
}
