import { getUserMetaBusinessAccount } from "@/lib/db/admin-queries";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const account = await getUserMetaBusinessAccount(id);
  return Response.json(account);
}
