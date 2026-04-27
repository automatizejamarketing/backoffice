import { notFound } from "next/navigation";
import { getBackofficePostDetails } from "@/lib/db/admin-queries";
import { BackofficePostDetailClient } from "./backoffice-post-detail-client";

export default async function BackofficePostDetailPage({
  params,
}: {
  params: Promise<{ postId: string }>;
}) {
  const { postId } = await params;
  const postDetail = await getBackofficePostDetails(postId);

  if (!postDetail) {
    notFound();
  }

  return (
    <BackofficePostDetailClient
      post={{
        ...postDetail,
        createdAt: postDetail.createdAt.toISOString(),
        updatedAt: postDetail.updatedAt.toISOString(),
        sourcePost: postDetail.sourcePost
          ? {
              ...postDetail.sourcePost,
              title: null,
              postType: null,
              renderedImage: null,
              generatedImageUrl: postDetail.sourcePost.currentImageUrl ?? postDetail.sourcePost.imageUrl,
              generatedImagePrompt: postDetail.sourcePost.prompt,
              captionText: postDetail.sourcePost.caption,
              createdAt: postDetail.sourcePost.createdAt.toISOString(),
            }
          : null,
      }}
    />
  );
}
