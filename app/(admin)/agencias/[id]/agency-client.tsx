"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type Client = { userId: string; email: string; name: string | null; companyName: string | null; memberId: string | null; addedAt: string };
type Person = { id: string; email: string; name: string | null; role: string; active: boolean };
type Removal = { kind: "client"; id: string; label: string } | { kind: "person"; id: string; label: string };

const ROLE_LABEL: Record<string, string> = { agency_owner: "Dono", agency_member: "Membro" };

async function call(url: string, method: "POST" | "DELETE", body: unknown) {
  const response = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error ?? "Não foi possível concluir.");
  return data;
}

export function AgencyClient({
  agency,
  meId,
  initialClients,
  initialPeople,
}: {
  agency: { id: string; name: string };
  meId: string;
  initialClients: Client[];
  initialPeople: Person[];
}) {
  const router = useRouter();
  const [clientEmail, setClientEmail] = useState("");
  const [personEmail, setPersonEmail] = useState("");
  const [personName, setPersonName] = useState("");
  const [personRole, setPersonRole] = useState("agency_member");
  const [busy, setBusy] = useState<string | null>(null);
  const [removal, setRemoval] = useState<Removal | null>(null);
  const base = `/api/agencies/${agency.id}`;
  const personById = new Map(initialPeople.map((p) => [p.id, p]));

  async function run(key: string, action: () => Promise<unknown>, success: string) {
    setBusy(key);
    try {
      await action();
      toast.success(success);
      router.refresh();
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível concluir.");
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function addClient(event: FormEvent) {
    event.preventDefault();
    const ok = await run("client", () => call(`${base}/clients`, "POST", { email: clientEmail }), `${clientEmail} agora é cliente da agência.`);
    if (ok) setClientEmail("");
  }

  async function addPerson(event: FormEvent) {
    event.preventDefault();
    const role = ROLE_LABEL[personRole];
    const ok = await run("person", () => call(`${base}/people`, "POST", { email: personEmail, name: personName, role: personRole }), `${personEmail} entrou como ${role}.`);
    if (ok) {
      setPersonEmail("");
      setPersonName("");
    }
  }

  async function confirmRemoval() {
    if (!removal) return;
    const target = removal;
    setRemoval(null);
    if (target.kind === "client") await run(target.id, () => call(`${base}/clients`, "DELETE", { userId: target.id }), `${target.label} saiu da agência.`);
    else await run(target.id, () => call(`${base}/people`, "DELETE", { personId: target.id }), `${target.label} não tem mais acesso.`);
  }

  return (
    <div className="min-w-0 space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-foreground">{agency.name}</h1>
        <p className="text-sm text-muted-foreground">
          Clientes e pessoas da agência. Para dividir os clientes entre os Membros, troque o responsável na{" "}
          <Link className="underline underline-offset-4" href="/trafego/mesa">área de Tráfego</Link>.
        </p>
      </div>

      <section className="space-y-3" aria-labelledby="agency-clients">
        <h2 id="agency-clients" className="text-lg font-semibold">Clientes <span className="text-muted-foreground tabular-nums">{initialClients.length}</span></h2>
        <form className="rounded-lg border bg-card p-4" onSubmit={addClient}>
          <div className="grid min-w-0 gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
            <div className="space-y-1.5">
              <Label htmlFor="client-email">E-mail da conta Automatize do cliente</Label>
              <Input id="client-email" type="email" value={clientEmail} onChange={(e) => setClientEmail(e.target.value)} placeholder="cliente@negocio.com" required />
            </div>
            <Button type="submit" disabled={busy === "client"}>
              {busy === "client" ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
              Adicionar cliente
            </Button>
          </div>
        </form>
        <div className="rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Cliente</TableHead>
                <TableHead>Responsável</TableHead>
                <TableHead className="w-16 text-right"><span className="sr-only">Ações</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {initialClients.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={3} className="py-8 text-center text-sm text-muted-foreground">
                    Nenhum cliente ainda. Adicione pelo e-mail da conta que o cliente usa no Automatize.
                  </TableCell>
                </TableRow>
              ) : (
                initialClients.map((client) => {
                  const label = client.companyName?.trim() || client.name || client.email;
                  const member = client.memberId ? personById.get(client.memberId) : null;
                  return (
                    <TableRow key={client.userId}>
                      <TableCell className="min-w-0">
                        <Link className="block truncate text-sm font-medium underline-offset-4 hover:underline" href={`/trafego/clientes/${client.userId}`}>{label}</Link>
                        <p className="truncate text-xs text-muted-foreground">{client.email}</p>
                      </TableCell>
                      <TableCell className="text-sm">{member ? member.name ?? member.email : <span className="text-muted-foreground">Sem responsável</span>}</TableCell>
                      <TableCell className="text-right">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Tirar ${label} da agência`}
                          disabled={busy === client.userId}
                          onClick={() => setRemoval({ kind: "client", id: client.userId, label })}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </section>

      <section className="space-y-3" aria-labelledby="agency-people">
        <h2 id="agency-people" className="text-lg font-semibold">Pessoas <span className="text-muted-foreground tabular-nums">{initialPeople.length}</span></h2>
        <form className="rounded-lg border bg-card p-4" onSubmit={addPerson}>
          <div className="grid min-w-0 gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_160px_auto] md:items-end">
            <div className="space-y-1.5">
              <Label htmlFor="person-email">E-mail</Label>
              <Input id="person-email" type="email" value={personEmail} onChange={(e) => setPersonEmail(e.target.value)} placeholder="gestor@agencia.com" required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="person-name">Nome</Label>
              <Input id="person-name" value={personName} onChange={(e) => setPersonName(e.target.value)} placeholder="Opcional" />
            </div>
            <div className="space-y-1.5">
              <Label>Papel</Label>
              <Select value={personRole} onValueChange={setPersonRole}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="agency_member">Membro</SelectItem>
                  <SelectItem value="agency_owner">Dono</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button type="submit" disabled={busy === "person"}>
              {busy === "person" ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
              Dar acesso
            </Button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">Membro vê só os clientes atribuídos a ele; Dono vê todos e gere esta página.</p>
        </form>
        <div className="rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Pessoa</TableHead>
                <TableHead>Papel</TableHead>
                <TableHead className="w-16 text-right"><span className="sr-only">Ações</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {initialPeople.map((person) => (
                <TableRow key={person.id}>
                  <TableCell className="min-w-0">
                    <p className="truncate text-sm font-medium">{person.email}</p>
                    <p className="truncate text-xs text-muted-foreground">{person.name ?? "Sem nome"}</p>
                  </TableCell>
                  <TableCell><Badge variant="outline">{ROLE_LABEL[person.role] ?? person.role}</Badge></TableCell>
                  <TableCell className="text-right">
                    {person.id === meId ? null : (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Tirar o acesso de ${person.email}`}
                        disabled={busy === person.id}
                        onClick={() => setRemoval({ kind: "person", id: person.id, label: person.email })}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>

      <AlertDialog open={removal !== null} onOpenChange={(open) => !open && setRemoval(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{removal?.kind === "client" ? `Tirar ${removal.label} da agência?` : `Tirar o acesso de ${removal?.label}?`}</AlertDialogTitle>
            <AlertDialogDescription>
              {removal?.kind === "client"
                ? "A agência deixa de ver e operar este cliente. Nada da conta é apagado."
                : "A pessoa não entra mais no backoffice; os clientes atribuídos a ela ficam sem responsável."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmRemoval}>{removal?.kind === "client" ? "Tirar da agência" : "Tirar acesso"}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
