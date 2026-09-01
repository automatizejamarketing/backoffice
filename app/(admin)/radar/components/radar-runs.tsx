"use client";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Filter } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const MOCK_RUNS = [
  { id: 1, date: "Agora", search: "Hamburguerias - Brasil", origin: "Manual", platforms: ["TikTok"], status: "Concluída", found: 20, new: 20, updated: 0, duplicated: 0, duration: "1m 12s", user: "Admin" },
];

function getRunStatusBadge(status: string) {
  switch(status) {
    case "Concluída": return <Badge variant="outline" className="text-emerald-500 border-emerald-500/20 bg-emerald-500/10">Concluída</Badge>;
    case "Falhou": return <Badge variant="destructive">Falhou</Badge>;
    case "Processando": return <Badge variant="outline" className="text-blue-500 border-blue-500/20 bg-blue-500/10 animate-pulse">Processando</Badge>;
    default: return <Badge>{status}</Badge>;
  }
}

export function RadarRuns() {
  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-4 sm:items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Coletas</h2>
          <p className="text-sm text-muted-foreground">Acompanhe todas as execuções de busca.</p>
        </div>
        <div className="flex gap-2">
          <Badge variant="secondary" className="px-3 py-1 text-sm font-normal">Concluídas hoje: 14</Badge>
          <Badge variant="outline" className="px-3 py-1 text-sm font-normal text-destructive border-destructive/20 bg-destructive/10">Erros hoje: 1</Badge>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b pb-4">
        <Button variant="outline" size="sm"><Filter className="mr-2 size-4" /> Filtros</Button>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Data / Hora</TableHead>
              <TableHead>Busca</TableHead>
              <TableHead>Origem</TableHead>
              <TableHead>Plataformas</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Encontrados</TableHead>
              <TableHead className="text-right">Novos</TableHead>
              <TableHead className="text-right">Atualizados</TableHead>
              <TableHead>Duração</TableHead>
              <TableHead>Resp.</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {MOCK_RUNS.map((run) => (
              <TableRow key={run.id}>
                <TableCell className="font-medium text-sm">{run.date}</TableCell>
                <TableCell>{run.search}</TableCell>
                <TableCell><Badge variant="secondary" className="text-xs font-normal">{run.origin}</Badge></TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    {run.platforms.map(p => (
                      <Badge key={p} variant="outline" className="text-[10px]">{p}</Badge>
                    ))}
                  </div>
                </TableCell>
                <TableCell>{getRunStatusBadge(run.status)}</TableCell>
                <TableCell className="text-right">{run.found}</TableCell>
                <TableCell className="text-right text-emerald-500 font-medium">+{run.new}</TableCell>
                <TableCell className="text-right text-blue-500">{run.updated}</TableCell>
                <TableCell className="text-muted-foreground text-sm">{run.duration}</TableCell>
                <TableCell className="text-muted-foreground text-sm">{run.user}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
