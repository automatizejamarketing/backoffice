"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";
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
import { DataTablePagination } from "@/components/posts/data-table-pagination";

type MarketingUser = {
  id: string;
  email: string;
  image_url: string | null;
  metaAccountName: string | null;
  metaUpdatedAt: string;
};

type ApiResponse = {
  users: MarketingUser[];
  total: number;
  page: number;
  limit: number;
};

type SelectedUser = {
  id: string;
  email: string;
  image_url: string | null;
};

type MarketingUsersPickerProps = {
  onSelectUser: (user: SelectedUser) => void;
};

const PAGE_SIZE = 20;
const MIN_SEARCH_LENGTH = 3;

export function MarketingUsersPicker({
  onSelectUser,
}: MarketingUsersPickerProps) {
  const [users, setUsers] = useState<MarketingUser[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [email, setEmail] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMountedRef = useRef(false);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const fetchUsers = useCallback(async (p: number, emailFilter: string) => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(p),
        limit: String(PAGE_SIZE),
      });
      if (emailFilter.trim()) {
        params.set("email", emailFilter.trim());
      }
      const res = await fetch(`/api/marketing/users?${params.toString()}`);
      if (res.ok) {
        const data = (await res.json()) as ApiResponse;
        setUsers(data.users);
        setTotal(data.total);
      } else {
        setUsers([]);
        setTotal(0);
      }
    } catch {
      setUsers([]);
      setTotal(0);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isMountedRef.current) {
      isMountedRef.current = true;
      fetchUsers(1, "");
      return;
    }

    const trimmed = email.trim();
    // Skip the query while the user has typed fewer than MIN_SEARCH_LENGTH
    // characters; an empty input still triggers a fetch so the unfiltered
    // list is restored.
    if (trimmed.length > 0 && trimmed.length < MIN_SEARCH_LENGTH) {
      return;
    }

    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    debounceRef.current = setTimeout(() => {
      setPage(1);
      fetchUsers(1, trimmed);
    }, 300);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [email, fetchUsers]);

  const handlePageChange = (newPage: number) => {
    setPage(newPage);
    fetchUsers(newPage, email.trim());
  };

  const trimmedEmail = email.trim();
  const isBelowMinSearch =
    trimmedEmail.length > 0 && trimmedEmail.length < MIN_SEARCH_LENGTH;

  function formatDate(dateStr: string) {
    const date = new Date(dateStr);
    if (Number.isNaN(date.getTime())) return "—";
    return new Intl.DateTimeFormat("pt-BR", {
      dateStyle: "short",
      timeStyle: "short",
    }).format(date);
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Filtrar por e-mail (mínimo 3 caracteres)..."
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="pl-9"
          />
        </div>
        {isBelowMinSearch && (
          <p className="text-xs text-muted-foreground">
            Digite pelo menos {MIN_SEARCH_LENGTH} caracteres para filtrar
          </p>
        )}
      </div>

      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Usuário</TableHead>
              <TableHead>Conta Meta</TableHead>
              <TableHead>Conectado em</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={4}
                  className="py-8 text-center text-sm text-muted-foreground"
                >
                  {isLoading
                    ? "Carregando..."
                    : "Nenhum usuário com conta de marketing do Facebook conectada"}
                </TableCell>
              </TableRow>
            ) : (
              users.map((u) => (
                <TableRow
                  key={u.id}
                  className="cursor-pointer"
                  onClick={() =>
                    onSelectUser({
                      id: u.id,
                      email: u.email,
                      image_url: u.image_url,
                    })
                  }
                >
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <Avatar className="size-8">
                        <AvatarImage src={u.image_url ?? undefined} />
                        <AvatarFallback className="text-xs">
                          {u.email.charAt(0).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <span className="text-sm font-medium">{u.email}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {u.metaAccountName ?? "—"}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {formatDate(u.metaUpdatedAt)}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectUser({
                          id: u.id,
                          email: u.email,
                          image_url: u.image_url,
                        });
                      }}
                    >
                      Selecionar
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
