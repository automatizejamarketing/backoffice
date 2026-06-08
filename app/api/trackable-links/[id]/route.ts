import { NextResponse } from "next/server";
import { requireBackofficePermissionResponse } from "@/lib/auth/rbac";
import {
  activeNameExists,
  getActiveTrackableLinkById,
  renameTrackableLink,
  softDeleteTrackableLink,
} from "@/lib/trackable-links/queries";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const authz = await requireBackofficePermissionResponse(
      "trackable-links:manage",
    );
    if (!authz.ok) return authz.response;

    const { id } = await params;
    const body = await request.json();
    const { name: rawName } = body as { name?: string };
    const name = typeof rawName === "string" ? rawName.trim() : "";

    if (!name) {
      return NextResponse.json({ error: "Missing name" }, { status: 400 });
    }

    const existing = await getActiveTrackableLinkById(id);
    if (!existing) {
      return NextResponse.json(
        { error: "Trackable link not found" },
        { status: 404 },
      );
    }

    // Only reject when the name actually changes to one another active link uses.
    if (
      name.toLowerCase() !== existing.name.toLowerCase() &&
      (await activeNameExists(name))
    ) {
      return NextResponse.json(
        { error: "Já existe um link rastreável com esse nome" },
        { status: 409 },
      );
    }

    // The slug is immutable — only the name is updated.
    await renameTrackableLink(id, name);

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Error updating trackable link:", error);
    return NextResponse.json(
      { error: "Failed to update trackable link" },
      { status: 500 },
    );
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const authz = await requireBackofficePermissionResponse(
      "trackable-links:manage",
    );
    if (!authz.ok) return authz.response;

    const { id } = await params;
    const existing = await getActiveTrackableLinkById(id);
    if (!existing) {
      return NextResponse.json(
        { error: "Trackable link not found" },
        { status: 404 },
      );
    }

    await softDeleteTrackableLink(id);

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Error deleting trackable link:", error);
    return NextResponse.json(
      { error: "Failed to delete trackable link" },
      { status: 500 },
    );
  }
}
