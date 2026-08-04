import { UserHubPage } from "@/app/(admin)/users/[id]/user-hub-page";

export default async function EmbedUserDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string; conversation?: string }>;
}) {
  return (
    <UserHubPage
      params={params}
      searchParams={searchParams}
      basePath="/embed/users"
      embedded
    />
  );
}
