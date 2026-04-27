import { notFound } from "next/navigation";
import { getGeneratedImageDetails } from "@/lib/db/admin-queries";
import { PostDetailClient } from "./post-detail-client";

export default async function PostDetailPage({
  params,
}: {
  params: Promise<{ postId: string }>;
}) {
  const { postId } = await params;
  const details = await getGeneratedImageDetails(postId);

  if (!details) {
    notFound();
  }

  return (
    <PostDetailClient
      post={{
        ...details,
        createdAt: details.createdAt.toISOString(),
      }}
    />
  );
}
