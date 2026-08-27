"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Search, MoreHorizontal, Play, Pause, Edit, Eye, Copy, Archive } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const MOCK_SEARCHES = [
  { id: 1, name: "Hamburguerias - Brasil", niche: "Food > Hamburgueria", platforms: ["Instagram", "TikTok", "YouTube"], terms: 12, freq: "A cada 3 horas", last: "Agora", next: "Hoje, 17:35", status: "Ativa" },
];

function getStatusBadge(status: string) {
  switch(status) {
    case "Ativa": return <Badge variant="outline" className="text-emerald-500 border-emerald-500/20 bg-emerald-500/10">Ativa</Badge>;
    case "Pausada": return <Badge variant="secondary">Pausada</Badge>;
    case "Em execução": return <Badge variant="outline" className="text-blue-500 border-blue-500/20 bg-blue-500/10 animate-pulse">Em execução</Badge>;
    case "Com erro": return <Badge variant="destructive">Com erro</Badge>;
    default: return <Badge>{status}</Badge>;
  }
}

export function RadarSearches() {
  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-4 sm:items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Buscas configuradas</h2>
          <p className="text-sm text-muted-foreground">Defina quais conteúdos o Radar deve encontrar e com que frequência.</p>
        </div>
        <Button size="sm">
          <Plus className="mr-2 size-4" />
          Nova busca
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Buscar pelo nome..." className="pl-8" />
        </div>
        <Button variant="outline" size="sm">Nicho</Button>
        <Button variant="outline" size="sm">Plataforma</Button>
        <Button variant="outline" size="sm">Status</Button>
        <Button variant="outline" size="sm">Frequência</Button>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead>Nicho</TableHead>
              <TableHead>Plataformas</TableHead>
              <TableHead>Termos</TableHead>
              <TableHead>Frequência</TableHead>
              <TableHead>Última execução</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {MOCK_SEARCHES.map((search) => (
              <TableRow key={search.id}>
                <TableCell className="font-medium">{search.name}</TableCell>
                <TableCell className="text-muted-foreground text-sm">{search.niche}</TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    {search.platforms.map(p => (
                      <Badge key={p} variant="secondary" className="text-[10px]">{p}</Badge>
                    ))}
                  </div>
                </TableCell>
                <TableCell className="text-muted-foreground">{search.terms}</TableCell>
                <TableCell className="text-muted-foreground text-sm">{search.freq}</TableCell>
                <TableCell className="text-muted-foreground text-sm">{search.last}</TableCell>
                <TableCell>{getStatusBadge(search.status)}</TableCell>
                <TableCell className="text-right">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" className="h-8 w-8 p-0">
                        <span className="sr-only">Abrir menu</span>
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem><Eye className="mr-2 h-4 w-4" /> Ver resultados</DropdownMenuItem>
                      <DropdownMenuItem><Edit className="mr-2 h-4 w-4" /> Editar</DropdownMenuItem>
                      <DropdownMenuItem><Play className="mr-2 h-4 w-4" /> Executar agora</DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem><Pause className="mr-2 h-4 w-4" /> Pausar</DropdownMenuItem>
                      <DropdownMenuItem><Copy className="mr-2 h-4 w-4" /> Duplicar</DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem className="text-destructive"><Archive className="mr-2 h-4 w-4" /> Arquivar</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
