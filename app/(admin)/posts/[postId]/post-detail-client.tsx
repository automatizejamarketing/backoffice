"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/posts/post-type-badge";
import { ReferenceImagesGallery } from "@/components/posts/reference-images-gallery";
import { GeneratePostDialog } from "@/components/posts/generate-post-dialog";

type PostDetail = {
  id: string;
  userId: string;
  userEmail: string;
  userImage: string | null;
  companyName: string | null;
  prompt: string;
  aspectRatio: string;
  width: number;
  height: number;
  imageUrl: string | null;
  currentImageUrl: string | null;
  status: string;
  caption: string | null;
  referenceImages: { id: string; imageUrl: string }[];
  createdAt: string;
};

function formatDate(date: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(date));
}

export function PostDetailClient({ post }: { post: PostDetail }) {
  const router = useRouter();
  const [generateOpen, setGenerateOpen] = useState(false);

  const mainImage = post.currentImageUrl || post.imageUrl;

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-4">
        <Link
          href="/posts"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← Voltar para Conteúdo
        </Link>
      </div>

      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">
            {post.prompt.slice(0, 80)}{post.prompt.length > 80 ? "..." : ""}
          </h1>
          <div className="mt-2 flex items-center gap-2">
            <Badge variant="outline">{post.aspectRatio}</Badge>
            <StatusBadge status={post.status} />
            {post.companyName && (
              <Badge variant="secondary">{post.companyName}</Badge>
            )}
          </div>
        </div>
        <Button onClick={() => setGenerateOpen(true)}>
          Gerar Novo Post a partir deste
        </Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Imagem Gerada</CardTitle>
            </CardHeader>
            <CardContent>
              {mainImage ? (
                <img
                  src={mainImage}
                  alt="Post"
                  className="w-full rounded-md border"
                />
              ) : (
                <div className="flex h-64 items-center justify-center rounded-md bg-muted text-muted-foreground">
                  Sem imagem disponível
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Usuário</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-3">
                {post.userImage ? (
                  <img
                    src={post.userImage}
                    alt={post.userEmail}
                    className="h-10 w-10 rounded-full"
                  />
                ) : (
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted text-sm font-medium">
                    {post.userEmail.charAt(0).toUpperCase()}
                  </div>
                )}
                <div>
                  <p className="text-sm font-medium">{post.userEmail}</p>
                  {post.companyName && (
                    <p className="text-xs text-muted-foreground">{post.companyName}</p>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Metadados</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Dimensões</span>
                <span>{post.width}x{post.height}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Proporção</span>
                <span>{post.aspectRatio}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Criado em</span>
                <span>{formatDate(post.createdAt)}</span>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Prompt Utilizado</CardTitle>
        </CardHeader>
        <CardContent>
          <pre className="whitespace-pre-wrap rounded-md bg-muted p-4 text-sm">
            {post.prompt}
          </pre>
        </CardContent>
      </Card>

      {post.caption && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Legenda</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="whitespace-pre-wrap text-sm">{post.caption}</p>
          </CardContent>
        </Card>
      )}

      {post.referenceImages.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Imagens de Referência</CardTitle>
          </CardHeader>
          <CardContent>
            <ReferenceImagesGallery images={post.referenceImages} />
          </CardContent>
        </Card>
      )}

      <GeneratePostDialog
        open={generateOpen}
        onOpenChange={setGenerateOpen}
        defaultPrompt={post.prompt}
        defaultAspectRatio={post.aspectRatio}
        defaultReferenceImages={post.referenceImages.map((r) => r.imageUrl)}
        targetUserId={post.userId}
        targetUserEmail={post.userEmail}
        sourceUserGeneratedImageId={post.id}
        onGenerated={() => router.refresh()}
      />
    </div>
  );
}
