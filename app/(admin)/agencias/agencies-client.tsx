"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type AgencyRow = { id: string; name: string; clients: number; people: number };

export function AgenciesClient({ initial }: { initial: AgencyRow[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [creating, setCreating] = useState(false);

  async function create(event: FormEvent) {
    event.preventDefault();
    setCreating(true);
    try {
      const response = await fetch("/api/agencies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, ownerEmail, ownerName }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        toast.error(data.error ?? "Não foi possível criar a agência.");
        return;
      }
      toast.success(`Agência ${data.agency.name} criada. ${data.agency.owner.email} já pode entrar no backoffice.`);
      router.push(`/agencias/${data.agency.id}`);
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="min-w-0 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Agências</h1>
        <p className="text-sm text-muted-foreground">
          Agências operam os próprios clientes pelo backoffice, só na área de Tráfego e no Marketing.
        </p>
      </div>

      <form className="rounded-lg border bg-card p-4" onSubmit={create}>
        <div className="grid min-w-0 gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end">
          <div className="space-y-1.5">
            <Label htmlFor="agency-name">Agência</Label>
            <Input id="agency-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome da agência" required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="agency-owner-email">E-mail do Dono</Label>
            <Input id="agency-owner-email" type="email" value={ownerEmail} onChange={(e) => setOwnerEmail(e.target.value)} placeholder="dono@agencia.com" required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="agency-owner-name">Nome do Dono</Label>
            <Input id="agency-owner-name" value={ownerName} onChange={(e) => setOwnerName(e.target.value)} placeholder="Opcional" />
          </div>
          <Button type="submit" disabled={creating}>
            {creating ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
            Criar agência
          </Button>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">O Dono entra com o Google usando este e-mail e adiciona clientes e Membros.</p>
      </form>

      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Agência</TableHead>
              <TableHead className="text-right">Clientes</TableHead>
              <TableHead className="text-right">Pessoas</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {initial.length === 0 ? (
              <TableRow>
                <TableCell colSpan={3} className="py-8 text-center text-sm text-muted-foreground">
                  Nenhuma agência ainda. Crie a primeira acima.
                </TableCell>
              </TableRow>
            ) : (
              initial.map((agency) => (
                <TableRow key={agency.id}>
                  <TableCell>
                    <Link className="font-medium underline-offset-4 hover:underline" href={`/agencias/${agency.id}`}>
                      {agency.name}
                    </Link>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{agency.clients}</TableCell>
                  <TableCell className="text-right tabular-nums">{agency.people}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
