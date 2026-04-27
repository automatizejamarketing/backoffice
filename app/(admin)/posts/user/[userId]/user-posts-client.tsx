"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Search } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PostsDataTable } from "@/components/posts/posts-data-table";
import { DataTablePagination } from "@/components/posts/data-table-pagination";
import { GeneratePostDialog } from "@/components/posts/generate-post-dialog";
import { ViewPostDialog } from "@/components/posts/view-post-dialog";

type UserInfo = {
  id: string;
  email: string;
  imageUrl: string | null;
  companyName: string | null;
  postCount: number;
};

type PostRow = {
  id: string;
  userId: string;
  userEmail: string;
  userImage: string | null;
  prompt: string;
  aspectRatio: string;
  width: number;
  height: number;
  imageUrl: string | null;
  currentImageUrl: string | null;
  status: string;
  caption: string | null;
  createdAt: string;
  updatedAt: string;
};

export function UserPostsClient({
  user,
  initialPosts,
  initialTotal,
}: {
  user: UserInfo;
  initialPosts: PostRow[];
  initialTotal: number;
}) {
  const router = useRouter();
  const [posts, setPosts] = useState(initialPosts);
  const [total, setTotal] = useState(initialTotal);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null);
  const limit = 20;
  const totalPages = Math.ceil(total / limit);

  const [generateDialogOpen, setGenerateDialogOpen] = useState(false);
  const [viewDialogOpen, setViewDialogOpen] = useState(false);
  const [selectedPost, setSelectedPost] = useState<PostRow | null>(null);
  const [isLoadingPostDetails, setIsLoadingPostDetails] = useState(false);
  const [generateSource, setGenerateSource] = useState<{
    prompt: string;
    aspectRatio: string;
    referenceImages: string[];
    sourceUserGeneratedImageId: string;
  } | null>(null);

  const fetchPosts = useCallback(
    async (p: number, searchTerm: string) => {
      setIsLoading(true);
      try {
        const params = new URLSearchParams({
          userId: user.id,
          page: String(p),
          limit: String(limit),
        });
        if (searchTerm.trim()) params.set("search", searchTerm.trim());
        const res = await fetch(`/api/posts?${params}`);
        if (res.ok) {
          const data = await res.json();
          setPosts(
            data.posts.map((post: PostRow) => ({
              ...post,
              createdAt:
                typeof post.createdAt === "string"
                  ? post.createdAt
                  : new Date(post.createdAt).toISOString(),
              updatedAt:
                typeof post.updatedAt === "string"
                  ? post.updatedAt
                  : new Date(post.updatedAt).toISOString(),
            }))
          );
          setTotal(data.total);
        }
      } finally {
        setIsLoading(false);
      }
    },
    [user.id]
  );

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setPage(1);
      fetchPosts(1, search);
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [search, fetchPosts]);

  const handlePageChange = (newPage: number) => {
    setPage(newPage);
    fetchPosts(newPage, search);
  };

  const openGenerateDialog = async (post: PostRow) => {
    setIsLoadingPostDetails(true);
    try {
      const res = await fetch(`/api/posts/${post.id}`);
      if (res.ok) {
        const details = await res.json();
        setGenerateSource({
          prompt: details.prompt ?? "",
          aspectRatio: details.aspectRatio ?? "1:1",
          referenceImages: details.referenceImages?.map((r: { imageUrl: string }) => r.imageUrl) ?? [],
          sourceUserGeneratedImageId: post.id,
        });
      } else {
        setGenerateSource({
          prompt: post.prompt,
          aspectRatio: post.aspectRatio ?? "1:1",
          referenceImages: [],
          sourceUserGeneratedImageId: post.id,
        });
      }
      setGenerateDialogOpen(true);
    } catch {
      setGenerateSource({
        prompt: post.prompt,
        aspectRatio: post.aspectRatio ?? "1:1",
        referenceImages: [],
        sourceUserGeneratedImageId: post.id,
      });
      setGenerateDialogOpen(true);
    } finally {
      setIsLoadingPostDetails(false);
    }
  };

  const openViewDialog = (post: PostRow) => {
    setSelectedPost(post);
    setViewDialogOpen(true);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/posts">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="size-4" />
          </Button>
        </Link>
        <div className="flex items-center gap-3">
          <Avatar className="size-10">
            <AvatarImage src={user.imageUrl ?? undefined} />
            <AvatarFallback>{user.email.charAt(0).toUpperCase()}</AvatarFallback>
          </Avatar>
          <div>
            <h1 className="text-xl font-bold text-foreground">{user.email}</h1>
            <p className="text-sm text-muted-foreground">
              {user.companyName ? `${user.companyName} · ` : ""}
              {user.postCount} {user.postCount === 1 ? "post" : "posts"}
            </p>
          </div>
        </div>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Buscar por prompt..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {isLoadingPostDetails && (
        <div className="text-sm text-muted-foreground">Carregando detalhes do post...</div>
      )}

      <PostsDataTable
        posts={posts}
        showUserColumn={false}
        onGenerateClick={openGenerateDialog}
        onRowClick={openViewDialog}
        onViewClick={openViewDialog}
      />

      <DataTablePagination
        page={page}
        totalPages={totalPages}
        total={total}
        onPageChange={handlePageChange}
        isLoading={isLoading}
      />

      {generateSource && (
        <GeneratePostDialog
          open={generateDialogOpen}
          onOpenChange={setGenerateDialogOpen}
          defaultPrompt={generateSource.prompt}
          defaultAspectRatio={generateSource.aspectRatio}
          defaultReferenceImages={generateSource.referenceImages}
          targetUserId={user.id}
          targetUserEmail={user.email}
          sourceUserGeneratedImageId={generateSource.sourceUserGeneratedImageId}
          onGenerated={() => {
            router.refresh();
          }}
        />
      )}

      <ViewPostDialog
        open={viewDialogOpen}
        onOpenChange={setViewDialogOpen}
        post={selectedPost}
        targetUserId={user.id}
        targetUserEmail={user.email}
        onGenerateClick={() => {
          if (selectedPost) {
            setViewDialogOpen(false);
            openGenerateDialog(selectedPost);
          }
        }}
      />
    </div>
  );
}
