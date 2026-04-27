import { notFound } from "next/navigation";
import { getAllUserGeneratedImages, getUserWithDetailedUsage } from "@/lib/db/admin-queries";
import { UserPostsClient } from "./user-posts-client";

export default async function UserPostsPage({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  const { userId } = await params;

  const [userData, postsResult] = await Promise.all([
    getUserWithDetailedUsage(userId),
    getAllUserGeneratedImages({ userId, page: 1, limit: 20 }),
  ]);

  if (!userData) {
    notFound();
  }

  return (
    <UserPostsClient
      user={{
        id: userData.id,
        email: userData.email,
        imageUrl: userData.image_url,
        companyName: userData.companyName,
        postCount: userData.postCount,
      }}
      initialPosts={postsResult.posts.map((p) => ({
        ...p,
        createdAt: p.createdAt.toISOString(),
        updatedAt: p.updatedAt.toISOString(),
      }))}
      initialTotal={postsResult.total}
    />
  );
}
