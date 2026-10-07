"use client";

import { Copy, Link2, Loader2, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDateInSaoPaulo } from "@/lib/backoffice/datetime-format";

type AgencyRow = {
  id: string;
  name: string;
  createdAt: string;
  owners: string[];
  memberCount: number;
  pendingOwnerInvitation: { email: string; expiresAt: string } | null;
};

type InviteLink = { email: string; url: string; expiresAt: string };

const ERRORS: Record<string, string> = {
  invalid_email: "Confira o e-mail do Dono.",
  invalid_name: "Informe o nome da agência.",
  agency_not_found: "Agência não encontrada.",
};

export function AgenciesClient({ initialAgencies }: { initialAgencies: AgencyRow[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [reinviteTarget, setReinviteTarget] = useState<AgencyRow | null>(null);
  const [link, setLink] = useState<InviteLink | null>(null);

  async function submit(url: string, body: Record<string, string>) {
    setBusy(true);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        toast.error(ERRORS[data.error] ?? "Não foi possível gerar o convite.");
        return false;
      }
      setLink({ email: data.email, url: data.inviteUrl, expiresAt: data.expiresAt });
      router.refresh();
      return true;
    } catch {
      toast.error("Não foi possível gerar o convite.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function handleCreate() {
    if (await submit("/api/agencies", { name, ownerEmail })) {
      setCreateOpen(false);
      setName("");
      setOwnerEmail("");
    }
  }

  async function handleReinvite() {
    if (!reinviteTarget) return;
    if (await submit(`/api/agencies/${reinviteTarget.id}/owner-invitation`, { ownerEmail })) {
      setReinviteTarget(null);
      setOwnerEmail("");
    }
  }

  async function copyLink() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.url);
      toast.success("Link copiado!");
    } catch {
      toast.error("Não foi possível copiar o link");
    }
  }

  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Agências</h1>
          <p className="text-sm text-muted-foreground">
            Crie a agência e envie ao Dono o link de convite. Ele entra com a própria
            conta e convida a equipe.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="size-4" />
          Nova agência
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Agências ({initialAgencies.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>Dono</TableHead>
                <TableHead className="text-right">Membros</TableHead>
                <TableHead>Criada em</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {initialAgencies.length === 0 ? (
                <TableRow>
                  <TableCell className="text-center text-muted-foreground" colSpan={5}>
                    Nenhuma agência ainda.
                  </TableCell>
                </TableRow>
              ) : (
                initialAgencies.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="font-medium">{item.name}</TableCell>
                    <TableCell>
                      {item.owners.length > 0 ? (
                        item.owners.join(", ")
                      ) : item.pendingOwnerInvitation ? (
                        <span className="flex flex-wrap items-center gap-2">
                          {item.pendingOwnerInvitation.email}
                          <Badge variant="outline">
                            convite até {formatDateInSaoPaulo(item.pendingOwnerInvitation.expiresAt)}
                          </Badge>
                        </span>
                      ) : (
                        <Badge variant="destructive">sem Dono</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{item.memberCount}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDateInSaoPaulo(item.createdAt)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        onClick={() => {
                          setReinviteTarget(item);
                          setOwnerEmail(item.pendingOwnerInvitation?.email ?? "");
                        }}
                        size="sm"
                        title="Gerar link de convite de Dono"
                        variant="ghost"
                      >
                        <Link2 className="size-4" />
                        Convite de Dono
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog onOpenChange={setCreateOpen} open={createOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nova agência</DialogTitle>
            <DialogDescription>
              O Dono recebe um link de convite que vale por 7 dias, uma vez, só para o
              e-mail informado.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="agency-name">Nome da agência</Label>
              <Input id="agency-name" onChange={(e) => setName(e.target.value)} value={name} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="owner-email">E-mail do Dono</Label>
              <Input
                id="owner-email"
                onChange={(e) => setOwnerEmail(e.target.value)}
                type="email"
                value={ownerEmail}
              />
            </div>
          </div>
          <DialogFooter>
            <Button disabled={busy || !name.trim() || !ownerEmail.trim()} onClick={handleCreate}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : null}
              Criar e gerar link
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        onOpenChange={(open) => {
          if (!open) setReinviteTarget(null);
        }}
        open={reinviteTarget !== null}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Convite de Dono · {reinviteTarget?.name}</DialogTitle>
            <DialogDescription>
              Gera um link novo. Um convite pendente para o mesmo e-mail é cancelado.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="reinvite-email">E-mail do Dono</Label>
            <Input
              id="reinvite-email"
              onChange={(e) => setOwnerEmail(e.target.value)}
              type="email"
              value={ownerEmail}
            />
          </div>
          <DialogFooter>
            <Button disabled={busy || !ownerEmail.trim()} onClick={handleReinvite}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : null}
              Gerar link
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        onOpenChange={(open) => {
          if (!open) setLink(null);
        }}
        open={link !== null}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Link de convite do Dono</DialogTitle>
            <DialogDescription>
              Envie para {link?.email}. Ele só aparece agora; se perder, gere outro.
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-2">
            <Input
              className="font-mono text-xs"
              onFocus={(e) => e.currentTarget.select()}
              readOnly
              value={link?.url ?? ""}
            />
            <Button onClick={copyLink} variant="outline">
              <Copy className="size-4" />
              Copiar
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
