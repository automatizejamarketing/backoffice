"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PostStatsCards } from "@/components/posts/post-stats-cards";
import { BackofficePostsDataTable } from "@/components/posts/posts-data-table";
import { UsersWithPostsTable } from "@/components/posts/users-with-posts-table";
import { GeneratePostDialog } from "@/components/posts/generate-post-dialog";

type PostStats = {
  totalPosts: number;
  postsByType: { type: string; count: number }[];
  totalAiCost: number;
  totalAiTokens: number;
  avgGenerationDuration: number;
  totalAiRequests: number;
  backofficePostCount: number;
};

type UserRow = {
  id: string;
  email: string;
  imageUrl: string | null;
  postCount: number;
  latestPostAt: string;
  companyName: string | null;
};

type BackofficePostRow = {
  id: string;
  backofficeUserId: string;
  backofficeUserEmail: string;
  targetUserId: string;
  targetUserEmail: string;
  sourceUserGeneratedImageId: string | null;
  sourceBackofficePostId: string | null;
  prompt: string;
  referenceImageUrls: string[] | null;
  aspectRatio: string | null;
  status: string;
  notes: string | null;
  generatedImageUrl: string | null;
  captionText: string | null;
  createdAt: string;
};

export function PostsPageClient({
  stats,
  initialUsers,
  initialUsersTotal,
  initialBackofficePosts,
  initialBackofficePostsTotal,
}: {
  stats: PostStats;
  initialUsers: UserRow[];
  initialUsersTotal: number;
  initialBackofficePosts: BackofficePostRow[];
  initialBackofficePostsTotal: number;
}) {
  const router = useRouter();
  const [generateDialogOpen, setGenerateDialogOpen] = useState(false);
  const [generateSource, setGenerateSource] = useState<{
    prompt: string;
    aspectRatio: string;
    referenceImages: string[];
    targetUserId: string;
    targetUserEmail: string;
    sourceBackofficePostId?: string;
  } | null>(null);

  const handleGenerateFromBackofficePost = (post: BackofficePostRow) => {
    setGenerateSource({
      prompt: post.prompt,
      aspectRatio: post.aspectRatio ?? "1:1",
      referenceImages: post.generatedImageUrl ? [post.generatedImageUrl] : [],
      targetUserId: post.targetUserId,
      targetUserEmail: post.targetUserEmail,
      sourceBackofficePostId: post.id,
    });
    setGenerateDialogOpen(true);
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Conteúdo</h1>
        <p className="text-sm text-muted-foreground">
          Visualize e gerencie posts dos usuários e posts gerados pelo backoffice
        </p>
      </div>

      <PostStatsCards stats={stats} />

      <Tabs defaultValue="users">
        <TabsList>
          <TabsTrigger value="users">
            Usuários ({initialUsersTotal})
          </TabsTrigger>
          <TabsTrigger value="backoffice-posts">
            Posts do Backoffice ({initialBackofficePostsTotal})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="users" className="mt-4">
          <UsersWithPostsTable
            initialUsers={initialUsers}
            initialTotal={initialUsersTotal}
          />
        </TabsContent>

        <TabsContent value="backoffice-posts" className="mt-4">
          <BackofficePostsDataTable
            posts={initialBackofficePosts}
            onGenerateClick={handleGenerateFromBackofficePost}
          />
        </TabsContent>
      </Tabs>

      {generateSource && (
        <GeneratePostDialog
          open={generateDialogOpen}
          onOpenChange={setGenerateDialogOpen}
          defaultPrompt={generateSource.prompt}
          defaultAspectRatio={generateSource.aspectRatio}
          defaultReferenceImages={generateSource.referenceImages}
          targetUserId={generateSource.targetUserId}
          targetUserEmail={generateSource.targetUserEmail}
          sourceBackofficePostId={generateSource.sourceBackofficePostId}
          onGenerated={() => {
            router.refresh();
          }}
        />
      )}
    </div>
  );
}
