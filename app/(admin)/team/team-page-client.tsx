"use client";

import { useState, type FormEvent } from "react";
import { Loader2, Pencil, Plus, Power, PowerOff, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { BackofficeRole } from "@/lib/auth/rbac-core";

type TeamUser = {
  id: string;
  email: string;
  name: string | null;
  role: BackofficeRole;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

type TeamPageClientProps = {
  initialUsers: TeamUser[];
};

const ROLE_LABEL: Record<BackofficeRole, string> = {
  admin: "Admin",
  marketing_consultant: "Consultor de marketing",
};

export function TeamPageClient({ initialUsers }: TeamPageClientProps) {
  const [users, setUsers] = useState(initialUsers);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<BackofficeRole>("marketing_consultant");
  const [isCreating, setIsCreating] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [editingUser, setEditingUser] = useState<TeamUser | null>(null);
  const [deletingUser, setDeletingUser] = useState<TeamUser | null>(null);
  const [editEmail, setEditEmail] = useState("");
  const [editName, setEditName] = useState("");
  const [editRole, setEditRole] =
    useState<BackofficeRole>("marketing_consultant");

  async function createUser() {
    setIsCreating(true);
    try {
      const response = await fetch("/api/backoffice/team", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, name, role }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error ?? "Erro ao criar usuário");
      }
      setUsers((prev) =>
        [...prev, data.user].sort((a, b) => a.email.localeCompare(b.email)),
      );
      setEmail("");
      setName("");
      setRole("marketing_consultant");
      toast.success("Usuário de backoffice criado");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Erro ao criar usuário",
      );
    } finally {
      setIsCreating(false);
    }
  }

  async function updateUser(
    id: string,
    patch: Partial<Pick<TeamUser, "email" | "name" | "role" | "active">>,
  ): Promise<boolean> {
    setUpdatingId(id);
    try {
      const response = await fetch(`/api/backoffice/team/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error ?? "Erro ao atualizar usuário");
      }
      setUsers((prev) =>
        prev
          .map((user) => (user.id === id ? { ...user, ...data.user } : user))
          .sort((a, b) => a.email.localeCompare(b.email)),
      );
      toast.success("Equipe atualizada");
      return true;
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Erro ao atualizar usuário",
      );
      return false;
    } finally {
      setUpdatingId(null);
    }
  }

  function openEditDialog(user: TeamUser) {
    setEditingUser(user);
    setEditEmail(user.email);
    setEditName(user.name ?? "");
    setEditRole(user.role);
  }

  async function saveEditingUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingUser) return;

    const didUpdate = await updateUser(editingUser.id, {
      email: editEmail,
      name: editName,
      role: editRole,
    });
    if (didUpdate) setEditingUser(null);
  }

  async function deleteUser(user: TeamUser) {
    setUpdatingId(user.id);
    try {
      const response = await fetch(`/api/backoffice/team/${user.id}`, {
        method: "DELETE",
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error ?? "Erro ao excluir usuário");
      }
      setUsers((prev) => prev.filter((item) => item.id !== user.id));
      setDeletingUser(null);
      toast.success("Usuário interno excluído");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Erro ao excluir usuário",
      );
    } finally {
      setUpdatingId(null);
    }
  }

  return (
    <div className="min-w-0 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Equipe</h1>
        <p className="text-sm text-muted-foreground">
          Controle os acessos internos do backoffice.
        </p>
      </div>

      <div className="rounded-lg border bg-card p-4">
        <div className="grid min-w-0 gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_220px_auto] md:items-end">
          <div className="space-y-1.5">
            <Label htmlFor="team-email">E-mail</Label>
            <Input
              id="team-email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="consultor@empresa.com"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="team-name">Nome</Label>
            <Input
              id="team-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Nome opcional"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Cargo</Label>
            <Select
              value={role}
              onValueChange={(value) => setRole(value as BackofficeRole)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="marketing_consultant">
                  Consultor de marketing
                </SelectItem>
                <SelectItem value="admin">Admin</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button onClick={createUser} disabled={isCreating || !email.trim()}>
            {isCreating ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Plus className="size-4" />
            )}
            Adicionar
          </Button>
        </div>
      </div>

      <div className="min-w-0 overflow-hidden rounded-lg border bg-card">
        <Table className="w-full table-fixed">
          <TableHeader>
            <TableRow>
              <TableHead className="w-[44%]">Usuário interno</TableHead>
              <TableHead className="w-[24%]">Cargo</TableHead>
              <TableHead className="w-[16%]">Status</TableHead>
              <TableHead className="w-[16%] text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={4}
                  className="py-8 text-center text-sm text-muted-foreground"
                >
                  Nenhum usuário interno cadastrado.
                </TableCell>
              </TableRow>
            ) : (
              users.map((user) => (
                <TableRow key={user.id}>
                  <TableCell className="min-w-0">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {user.email}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {user.name ?? "Sem nome"}
                      </p>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{ROLE_LABEL[user.role]}</Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={user.active ? "default" : "secondary"}>
                      {user.active ? "Ativo" : "Inativo"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            type="button"
                            variant="outline"
                            size="icon-sm"
                            className="border-border"
                            onClick={() => openEditDialog(user)}
                            disabled={updatingId === user.id}
                            aria-label={`Editar ${user.email}`}
                          >
                            <Pencil className="size-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Editar</TooltipContent>
                      </Tooltip>

                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            type="button"
                            variant="outline"
                            size="icon-sm"
                            className={
                              user.active
                                ? "border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700 dark:border-red-900/60 dark:text-red-400 dark:hover:bg-red-950/30"
                                : "border-emerald-200 text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800 dark:border-emerald-900/60 dark:text-emerald-400 dark:hover:bg-emerald-950/30"
                            }
                            onClick={() =>
                              updateUser(user.id, { active: !user.active })
                            }
                            disabled={updatingId === user.id}
                            aria-label={
                              user.active
                                ? `Inativar ${user.email}`
                                : `Ativar ${user.email}`
                            }
                          >
                            {user.active ? (
                              <PowerOff className="size-4" />
                            ) : (
                              <Power className="size-4" />
                            )}
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                          {user.active ? "Inativar" : "Ativar"}
                        </TooltipContent>
                      </Tooltip>

                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            type="button"
                            variant="outline"
                            size="icon-sm"
                            className="border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700 dark:border-red-900/60 dark:text-red-400 dark:hover:bg-red-950/30"
                            onClick={() => setDeletingUser(user)}
                            disabled={updatingId === user.id}
                            aria-label={`Excluir ${user.email}`}
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Excluir</TooltipContent>
                      </Tooltip>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog
        open={Boolean(editingUser)}
        onOpenChange={(open) => {
          if (!open) setEditingUser(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar usuário interno</DialogTitle>
            <DialogDescription>
              Atualize e-mail, nome e cargo deste acesso de backoffice.
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={saveEditingUser}>
            <div className="space-y-1.5">
              <Label htmlFor="edit-team-email">E-mail</Label>
              <Input
                id="edit-team-email"
                type="email"
                value={editEmail}
                onChange={(event) => setEditEmail(event.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-team-name">Nome</Label>
              <Input
                id="edit-team-name"
                value={editName}
                onChange={(event) => setEditName(event.target.value)}
                placeholder="Nome opcional"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Cargo</Label>
              <Select
                value={editRole}
                onValueChange={(value) => setEditRole(value as BackofficeRole)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="marketing_consultant">
                    Consultor de marketing
                  </SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setEditingUser(null)}
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                disabled={!editEmail.trim() || updatingId === editingUser?.id}
              >
                {updatingId === editingUser?.id && (
                  <Loader2 className="size-4 animate-spin" />
                )}
                Salvar
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={Boolean(deletingUser)}
        onOpenChange={(open) => {
          if (!open) setDeletingUser(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir usuário interno?</AlertDialogTitle>
            <AlertDialogDescription>
              O acesso de {deletingUser?.email} será removido do backoffice.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={updatingId === deletingUser?.id}>
              Cancelar
            </AlertDialogCancel>
            <Button
              type="button"
              variant="destructive"
              onClick={() => deletingUser && deleteUser(deletingUser)}
              disabled={updatingId === deletingUser?.id}
            >
              {updatingId === deletingUser?.id && (
                <Loader2 className="size-4 animate-spin" />
              )}
              Excluir
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
