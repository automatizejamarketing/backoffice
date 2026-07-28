import { put } from "@vercel/blob";
import { NextResponse } from "next/server";
import { requireBackofficePermissionResponse } from "@/lib/auth/rbac";

const MAX_FILE_SIZE = 50 * 1024 * 1024;

export async function POST(request: Request) {
  const authz = await requireBackofficePermissionResponse("products:manage");
  if (!authz.ok) return authz.response;
  const form = await request.formData();
  const file = form.get("file");
  const productId = form.get("productId");
  if (!(file instanceof File) || typeof productId !== "string") {
    return NextResponse.json({ error: "Arquivo inválido" }, { status: 422 });
  }
  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json(
      { error: "O arquivo deve ter no máximo 50 MB" },
      { status: 413 },
    );
  }
  const pathname = `products/${productId}/${crypto.randomUUID()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "-")}`;
  const blob = await put(pathname, file, {
    access: "private",
    addRandomSuffix: false,
    contentType: file.type || "application/octet-stream",
  });
  return NextResponse.json({
    pathname: blob.pathname,
    filename: file.name,
    mimeType: file.type || "application/octet-stream",
  });
}

