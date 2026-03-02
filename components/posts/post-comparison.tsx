"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type ComparisonPost = {
  imageUrl: string | null;
  caption: string | null;
  prompt: string | null;
  label: string;
};

export function PostComparison({
  original,
  generated,
}: {
  original: ComparisonPost;
  generated: ComparisonPost;
}) {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <ComparisonCard post={original} />
      <ComparisonCard post={generated} />
    </div>
  );
}

function ComparisonCard({ post }: { post: ComparisonPost }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{post.label}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {post.imageUrl ? (
          <img
            src={post.imageUrl}
            alt={post.label}
            className="w-full rounded-md border"
          />
        ) : (
          <div className="flex h-64 items-center justify-center rounded-md bg-muted text-muted-foreground">
            Sem imagem
          </div>
        )}
        {post.caption && (
          <div>
            <p className="mb-1 text-xs font-medium text-muted-foreground">
              Legenda
            </p>
            <p className="whitespace-pre-wrap text-sm">{post.caption}</p>
          </div>
        )}
        {post.prompt && (
          <div>
            <p className="mb-1 text-xs font-medium text-muted-foreground">
              Prompt
            </p>
            <p className="whitespace-pre-wrap text-xs text-muted-foreground">
              {post.prompt}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
