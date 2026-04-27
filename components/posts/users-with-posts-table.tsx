"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search } from "lucide-react";
import { DataTablePagination } from "./data-table-pagination";

type UserWithPosts = {
  id: string;
  email: string;
  imageUrl: string | null;
  postCount: number;
  latestPostAt: string;
  companyName: string | null;
};

type UsersWithPostsTableProps = {
  initialUsers: UserWithPosts[];
  initialTotal: number;
};

export function UsersWithPostsTable({
  initialUsers,
  initialTotal,
}: UsersWithPostsTableProps) {
  const router = useRouter();
  const [users, setUsers] = useState(initialUsers);
  const [total, setTotal] = useState(initialTotal);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null);
  const limit = 20;
  const totalPages = Math.ceil(total / limit);

  const fetchUsers = useCallback(async (p: number, email: string) => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams({ page: String(p), limit: String(limit) });
      if (email.trim()) params.set("email", email.trim());
      const res = await fetch(`/api/posts/users?${params}`);
      if (res.ok) {
        const data = await res.json();
        setUsers(data.users);
        setTotal(data.total);
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setPage(1);
      fetchUsers(1, search);
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [search, fetchUsers]);

  const handlePageChange = (newPage: number) => {
    setPage(newPage);
    fetchUsers(newPage, search);
  };

  function formatDate(date: string) {
    return new Intl.DateTimeFormat("pt-BR", {
      dateStyle: "short",
      timeStyle: "short",
    }).format(new Date(date));
  }

  return (
    <div className="space-y-4">
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Buscar por e-mail..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Usuário</TableHead>
              <TableHead>Empresa</TableHead>
              <TableHead className="text-center">Posts</TableHead>
              <TableHead>Último Post</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                  {isLoading ? "Carregando..." : "Nenhum usuário encontrado"}
                </TableCell>
              </TableRow>
            ) : (
              users.map((u) => (
                <TableRow
                  key={u.id}
                  className="cursor-pointer"
                  onClick={() => router.push(`/posts/user/${u.id}`)}
                >
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <Avatar className="size-8">
                        <AvatarImage src={u.imageUrl ?? undefined} />
                        <AvatarFallback className="text-xs">
                          {u.email.charAt(0).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <span className="text-sm font-medium">{u.email}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {u.companyName ?? "—"}
                  </TableCell>
                  <TableCell className="text-center text-sm font-medium">
                    {u.postCount}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {formatDate(u.latestPostAt)}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        router.push(`/posts/user/${u.id}`);
                      }}
                    >
                      Ver
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <DataTablePagination
        page={page}
        totalPages={totalPages}
        total={total}
        onPageChange={handlePageChange}
        isLoading={isLoading}
      />
    </div>
  );
}
