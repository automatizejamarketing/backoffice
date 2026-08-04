import { UserHubPage } from "./user-hub-page";

export default async function UserDetailPage({
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
      basePath="/users"
      embedded={false}
    />
  );
}
