"use client";

import Link from "next/link";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "./post-type-badge";

const linkBtnClass =
  "inline-flex h-7 items-center justify-center rounded-md px-2 text-xs font-medium hover:bg-muted transition-all";

type PostRow = {
  id: string;
  userId: string;
  userEmail: string;
  prompt: string;
  aspectRatio: string;
  imageUrl: string | null;
  currentImageUrl: string | null;
  status: string;
  caption: string | null;
  createdAt: string;
};

function formatDate(date: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(date));
}

export function PostsDataTable<T extends PostRow>({
  posts,
  showUserColumn = true,
  onGenerateClick,
  onRowClick,
  onViewClick,
}: {
  posts: T[];
  showUserColumn?: boolean;
  onGenerateClick?: (post: T) => void;
  onRowClick?: (post: T) => void;
  onViewClick?: (post: T) => void;
}) {
  const colSpan = showUserColumn ? 7 : 6;

  return (
    <div className="overflow-x-auto rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-16">Imagem</TableHead>
            {showUserColumn && <TableHead>Usuário</TableHead>}
            <TableHead>Prompt</TableHead>
            <TableHead>Proporção</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Data</TableHead>
            <TableHead className="text-right">Ações</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {posts.length === 0 ? (
            <TableRow>
              <TableCell colSpan={colSpan} className="text-center text-muted-foreground py-8">
                Nenhum post encontrado
              </TableCell>
            </TableRow>
          ) : (
            posts.map((p) => (
              <TableRow
                key={p.id}
                className={onRowClick ? "cursor-pointer" : undefined}
                onClick={() => onRowClick?.(p)}
              >
                <TableCell>
                  {(p.currentImageUrl || p.imageUrl) ? (
                    <img
                      src={p.currentImageUrl || p.imageUrl || ""}
                      alt=""
                      className="h-10 w-10 rounded object-cover"
                    />
                  ) : (
                    <div className="flex h-10 w-10 items-center justify-center rounded bg-muted text-xs text-muted-foreground">
                      N/A
                    </div>
                  )}
                </TableCell>
                {showUserColumn && (
                  <TableCell className="text-sm">{p.userEmail}</TableCell>
                )}
                <TableCell className="max-w-[200px] truncate text-sm">
                  {p.prompt.slice(0, 60) || p.caption?.slice(0, 60) || "—"}
                </TableCell>
                <TableCell>
                  <Badge variant="outline">{p.aspectRatio}</Badge>
                </TableCell>
                <TableCell>
                  <StatusBadge status={p.status} />
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {formatDate(p.createdAt)}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-2">
                    {onViewClick && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          onViewClick(p);
                        }}
                      >
                        Ver
                      </Button>
                    )}
                    {!onRowClick && !onViewClick && (
                      <Link
                        href={`/posts/${p.id}`}
                        className={linkBtnClass}
                        onClick={(e) => e.stopPropagation()}
                      >
                        Ver
                      </Link>
                    )}
                    {onGenerateClick && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          onGenerateClick(p);
                        }}
                      >
                        Gerar
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}

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

export function BackofficePostsDataTable<T extends BackofficePostRow>({
  posts,
  onGenerateClick,
}: {
  posts: T[];
  onGenerateClick?: (post: T) => void;
}) {
  return (
    <div className="overflow-x-auto rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-16">Imagem</TableHead>
            <TableHead>Admin</TableHead>
            <TableHead>Usuário Alvo</TableHead>
            <TableHead>Prompt</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Data</TableHead>
            <TableHead className="text-right">Ações</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {posts.length === 0 ? (
            <TableRow>
              <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                Nenhum post do backoffice encontrado
              </TableCell>
            </TableRow>
          ) : (
            posts.map((p) => (
              <TableRow key={p.id}>
                <TableCell>
                  {p.generatedImageUrl ? (
                    <img
                      src={p.generatedImageUrl}
                      alt=""
                      className="h-10 w-10 rounded object-cover"
                    />
                  ) : (
                    <div className="flex h-10 w-10 items-center justify-center rounded bg-muted text-xs text-muted-foreground">
                      N/A
                    </div>
                  )}
                </TableCell>
                <TableCell className="text-sm">{p.backofficeUserEmail}</TableCell>
                <TableCell className="text-sm">{p.targetUserEmail}</TableCell>
                <TableCell className="max-w-[200px] truncate text-sm">
                  {p.prompt.slice(0, 50)}...
                </TableCell>
                <TableCell>
                  <StatusBadge status={p.status} />
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {formatDate(p.createdAt)}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-2">
                    <Link href={`/posts/backoffice/${p.id}`} className={linkBtnClass}>
                      Ver
                    </Link>
                    {onGenerateClick && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => onGenerateClick(p)}
                      >
                        Gerar
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
