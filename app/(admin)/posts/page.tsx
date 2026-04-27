import {
  getBackofficeGeneratedPosts,
  getPostPerformanceStats,
  getUsersWithPosts,
} from "@/lib/db/admin-queries";
import { PostsPageClient } from "./posts-page-client";

export default async function PostsPage() {
  const [stats, usersResult, backofficePostsResult] = await Promise.all([
    getPostPerformanceStats(),
    getUsersWithPosts({ page: 1, limit: 20 }),
    getBackofficeGeneratedPosts({ page: 1, limit: 20 }),
  ]);

  return (
    <PostsPageClient
      stats={stats}
      initialUsers={usersResult.users.map((u) => ({
        ...u,
        latestPostAt:
          u.latestPostAt instanceof Date
            ? u.latestPostAt.toISOString()
            : String(u.latestPostAt),
      }))}
      initialUsersTotal={usersResult.total}
      initialBackofficePosts={backofficePostsResult.posts.map((p) => ({
        ...p,
        createdAt: p.createdAt.toISOString(),
      }))}
      initialBackofficePostsTotal={backofficePostsResult.total}
    />
  );
}
