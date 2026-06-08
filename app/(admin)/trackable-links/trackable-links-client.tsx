"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
import { Badge } from "@/components/ui/badge";
import { Copy, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { slugifyName } from "@/lib/trackable-links/slug";

type TrackableLinkRow = {
  id: string;
  name: string;
  slug: string;
  clicks: number;
  signups: number;
  createdAt: string;
};

export function TrackableLinksClient({
  initialLinks,
  appUrl,
}: {
  initialLinks: TrackableLinkRow[];
  appUrl: string;
}) {
  const [links, setLinks] = useState<TrackableLinkRow[]>(initialLinks);
  const [busy, setBusy] = useState(false);

  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");

  const [renameOpen, setRenameOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<TrackableLinkRow | null>(null);
  const [renameName, setRenameName] = useState("");

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<TrackableLinkRow | null>(null);

  const linkUrl = (slug: string) => `${appUrl}/?lr=${slug}`;

  const handleCopy = async (slug: string) => {
    try {
      await navigator.clipboard.writeText(linkUrl(slug));
      toast.success("Link copiado!");
    } catch {
      toast.error("Não foi possível copiar o link");
    }
  };

  const handleCreate = async () => {
    const name = createName.trim();
    if (!name) return;
    setBusy(true);
    try {
      const res = await fetch("/api/trackable-links/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Erro ao criar link rastreável");
        return;
      }
      const created = data.trackableLink as {
        id: string;
        name: string;
        slug: string;
        createdAt: string;
      };
      setLinks((prev) => [
        {
          id: created.id,
          name: created.name,
          slug: created.slug,
          clicks: 0,
          signups: 0,
          createdAt: created.createdAt,
        },
        ...prev,
      ]);
      toast.success("Link rastreável criado!");
      setCreateOpen(false);
      setCreateName("");
    } catch {
      toast.error("Erro ao criar link rastreável");
    } finally {
      setBusy(false);
    }
  };

  const handleRename = async () => {
    if (!renameTarget) return;
    const name = renameName.trim();
    if (!name) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/trackable-links/${renameTarget.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || "Erro ao renomear");
        return;
      }
      setLinks((prev) =>
        prev.map((l) => (l.id === renameTarget.id ? { ...l, name } : l)),
      );
      toast.success("Nome atualizado!");
      setRenameOpen(false);
      setRenameTarget(null);
    } catch {
      toast.error("Erro ao renomear");
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/trackable-links/${deleteTarget.id}`, {
        method: "DELETE",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || "Erro ao excluir");
        return;
      }
      setLinks((prev) => prev.filter((l) => l.id !== deleteTarget.id));
      toast.success("Link rastreável excluído!");
      setDeleteOpen(false);
      setDeleteTarget(null);
    } catch {
      toast.error("Erro ao excluir");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Links Rastreáveis</h1>
          <p className="text-sm text-muted-foreground">
            Crie links para medir cliques e cadastros.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="size-4" />
          Novo link
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Links ({links.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>Slug</TableHead>
                <TableHead className="text-right">Cliques</TableHead>
                <TableHead className="text-right">Cadastros</TableHead>
                <TableHead>Criado em</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {links.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="text-center text-muted-foreground"
                  >
                    Nenhum link rastreável ainda.
                  </TableCell>
                </TableRow>
              ) : (
                links.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className="font-medium">{l.name}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="font-mono">
                        {l.slug}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {l.clicks}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {l.signups}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {new Date(l.createdAt).toLocaleDateString("pt-BR")}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleCopy(l.slug)}
                          title="Copiar link"
                        >
                          <Copy className="size-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setRenameTarget(l);
                            setRenameName(l.name);
                            setRenameOpen(true);
                          }}
                          title="Renomear"
                        >
                          <Pencil className="size-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setDeleteTarget(l);
                            setDeleteOpen(true);
                          }}
                          title="Excluir"
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Create */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Novo link rastreável</DialogTitle>
            <DialogDescription>
              O slug do link é gerado a partir do nome e não pode ser alterado
              depois.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Label htmlFor="create-name">Nome</Label>
            <Input
              id="create-name"
              value={createName}
              onChange={(e) => setCreateName(e.target.value)}
              placeholder="Ex: Dudu Donos de Hambúrgueria"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !busy) handleCreate();
              }}
            />
            {createName.trim() && (
              <p className="text-xs text-muted-foreground">
                Prévia do slug:{" "}
                <span className="font-mono">{slugifyName(createName)}</span>
                {" "}
                (um sufixo pode ser adicionado se já existir)
              </p>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setCreateOpen(false)}
              disabled={busy}
            >
              Cancelar
            </Button>
            <Button onClick={handleCreate} disabled={busy || !createName.trim()}>
              {busy && <Loader2 className="size-4 animate-spin" />}
              Criar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rename */}
      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Renomear link</DialogTitle>
            <DialogDescription>
              O slug{renameTarget ? ` (${renameTarget.slug})` : ""} permanece o
              mesmo — apenas o nome muda.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Label htmlFor="rename-name">Nome</Label>
            <Input
              id="rename-name"
              value={renameName}
              onChange={(e) => setRenameName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !busy) handleRename();
              }}
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setRenameOpen(false)}
              disabled={busy}
            >
              Cancelar
            </Button>
            <Button onClick={handleRename} disabled={busy || !renameName.trim()}>
              {busy && <Loader2 className="size-4 animate-spin" />}
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Excluir link rastreável</DialogTitle>
            <DialogDescription>
              {deleteTarget ? `"${deleteTarget.name}" ` : ""}deixará de contar
              novos cliques. Cadastros em andamento (cookies já definidos) ainda
              serão creditados. Esta ação não pode ser desfeita.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteOpen(false)}
              disabled={busy}
            >
              Cancelar
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={busy}>
              {busy && <Loader2 className="size-4 animate-spin" />}
              Excluir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
