"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/posts/post-type-badge";
import { PostComparison } from "@/components/posts/post-comparison";
import { GeneratePostDialog } from "@/components/posts/generate-post-dialog";

type SourcePost = {
  id: string;
  userId: string;
  userEmail: string;
  companyName: string | null;
  title: string | null;
  caption: string | null;
  postType: string | null;
  renderedImage: string | null;
  generatedImageUrl: string | null;
  generatedImagePrompt: string | null;
  captionText: string | null;
  createdAt: string;
} & Record<string, unknown>;

type BackofficePostDetail = {
  id: string;
  backofficeUserId: string;
  backofficeUserEmail: string | null;
  targetUserId: string;
  targetUserEmail: string | null;
  sourceUserGeneratedImageId: string | null;
  sourceBackofficePostId: string | null;
  prompt: string;
  generatedImageUrl: string | null;
  generatedImagePrompt: string | null;
  captionText: string | null;
  referenceImageUrls: string[] | null;
  aspectRatio: string | null;
  status: string;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  sourcePost: SourcePost | null;
};

function formatDate(date: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(date));
}

export function BackofficePostDetailClient({
  post,
}: {
  post: BackofficePostDetail;
}) {
  const router = useRouter();
  const [generateOpen, setGenerateOpen] = useState(false);

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
            Post do Backoffice
          </h1>
          <div className="mt-2 flex items-center gap-2">
            <StatusBadge status={post.status} />
            <Badge variant="outline">Backoffice</Badge>
          </div>
        </div>
        <Button onClick={() => setGenerateOpen(true)}>
          Gerar Novo Post a partir deste
        </Button>
      </div>

      {/* Admin and target info */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Gerado por
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm font-medium">
              {post.backofficeUserEmail ?? "Desconhecido"}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Usuário Alvo
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm font-medium">
              {post.targetUserEmail ?? "Desconhecido"}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Criado em
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm font-medium">{formatDate(post.createdAt)}</p>
          </CardContent>
        </Card>
      </div>

      {/* Side-by-side comparison */}
      {post.sourcePost && (
        <div>
          <h2 className="mb-4 text-lg font-semibold">Comparação</h2>
          <PostComparison
            original={{
              imageUrl:
                post.sourcePost.generatedImageUrl ||
                post.sourcePost.renderedImage,
              caption: post.sourcePost.captionText || post.sourcePost.caption,
              prompt: post.sourcePost.generatedImagePrompt,
              label: "Post Original do Usuário",
            }}
            generated={{
              imageUrl: post.generatedImageUrl,
              caption: post.captionText,
              prompt: post.prompt,
              label: "Post Gerado pelo Backoffice",
            }}
          />
        </div>
      )}

      {/* If no source post, show the generated image standalone */}
      {!post.sourcePost && post.generatedImageUrl && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Imagem Gerada</CardTitle>
          </CardHeader>
          <CardContent>
            <img
              src={post.generatedImageUrl}
              alt="Post gerado"
              className="w-full max-w-2xl rounded-md border"
            />
          </CardContent>
        </Card>
      )}

      {/* Prompt */}
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

      {/* Caption */}
      {post.captionText && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Legenda Gerada</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="whitespace-pre-wrap text-sm">{post.captionText}</p>
          </CardContent>
        </Card>
      )}

      {/* Reference images */}
      {post.referenceImageUrls && post.referenceImageUrls.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Imagens de Referência</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-3">
              {post.referenceImageUrls.map((url, i) => (
                <img
                  key={`ref-${i}`}
                  src={url}
                  alt={`Referência ${i + 1}`}
                  className="h-20 w-20 rounded-md border object-cover"
                />
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Notes */}
      {post.notes && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Notas</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm">{post.notes}</p>
          </CardContent>
        </Card>
      )}

      {/* Source post link */}
      {post.sourceUserGeneratedImageId && (
        <div className="text-sm text-muted-foreground">
          Post baseado em:{" "}
          <Link
            href={`/posts/${post.sourceUserGeneratedImageId}`}
            className="text-primary hover:underline"
          >
            Ver post original
          </Link>
        </div>
      )}

      <GeneratePostDialog
        open={generateOpen}
        onOpenChange={setGenerateOpen}
        defaultPrompt={post.prompt}
        defaultReferenceImages={
          post.generatedImageUrl ? [post.generatedImageUrl] : []
        }
        targetUserId={post.targetUserId}
        targetUserEmail={post.targetUserEmail ?? ""}
        sourceBackofficePostId={post.id}
        onGenerated={() => router.refresh()}
      />
    </div>
  );
}
