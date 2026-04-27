import { searchUsersByEmail } from "@/lib/db/admin-queries";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get("q");

  if (!query || query.length < 3) {
    return Response.json([]);
  }

  const users = await searchUsersByEmail(query);
  return Response.json(users);
}
