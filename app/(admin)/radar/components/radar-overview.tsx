"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Plus, Play, Search, Image as ImageIcon, CheckCircle2, AlertTriangle, Clock, History, Activity } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export function RadarOverview({ initialData = [] }: { initialData?: any[] }) {
  const contents = initialData.length > 0 ? initialData : [];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row gap-4 sm:items-center justify-between">
        <h2 className="text-lg font-semibold tracking-tight">Visão Geral Operacional</h2>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link href="/radar?tab=coletas">
              <Play className="mr-2 size-4" />
              Buscar agora
            </Link>
          </Button>
          <Button size="sm" asChild>
            <Link href="/radar?tab=buscas&action=new">
              <Plus className="mr-2 size-4" />
              Nova busca
            </Link>
          </Button>
        </div>
      </div>

      {/* Indicadores Compactos */}
      <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Buscas ativas</CardTitle>
            <Search className="size-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">1</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Encontrados hoje</CardTitle>
            <ImageIcon className="size-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{contents.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Pendentes</CardTitle>
            <Clock className="size-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-amber-500">{contents.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Publicados</CardTitle>
            <CheckCircle2 className="size-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-emerald-500">0</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Erros (hoje)</CardTitle>
            <AlertTriangle className="size-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-destructive">0</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Última atualização</CardTitle>
            <History className="size-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">Agora</div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Status do Radar */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Status do Radar</CardTitle>
            <CardDescription>Condições das coletas e integrações.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-4 border-b pb-4">
              <div className="flex size-10 items-center justify-center rounded-full bg-emerald-500/10">
                <Activity className="size-5 text-emerald-500" />
              </div>
              <div>
                <p className="text-sm font-medium">Radar funcionando normalmente</p>
                <p className="text-sm text-muted-foreground">Última coleta concluída com sucesso.</p>
              </div>
            </div>
            
            <div className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Última coleta</span>
                <span className="font-medium">Hoje, às 14:35</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Próxima coleta</span>
                <span className="font-medium">Hoje, às 17:00</span>
              </div>
              
              <div className="pt-2 space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">Instagram</span>
                  <Badge variant="outline" className="text-emerald-500 border-emerald-500/20 bg-emerald-500/10">Operacional</Badge>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">TikTok</span>
                  <Badge variant="outline" className="text-emerald-500 border-emerald-500/20 bg-emerald-500/10">Operacional</Badge>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">YouTube</span>
                  <Badge variant="secondary">Não configurado</Badge>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Atividade Recente */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Atividade recente</CardTitle>
            <CardDescription>Últimas ações realizadas no módulo.</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Ação</TableHead>
                  <TableHead>Usuário</TableHead>
                  <TableHead className="text-right">Horário</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {[
                  { id: 1, type: "Conteúdo aprovado", desc: "12 conteúdos de Hamburgueria", user: "Ana S.", time: "14:52" },
                  { id: 2, type: "Busca executada", desc: "Hamburguerias - Brasil", user: "Sistema", time: "14:35" },
                  { id: 3, type: "Conteúdo ocultado", desc: "3 conteúdos irrelevantes", user: "Carlos M.", time: "14:10" },
                  { id: 4, type: "Configuração pausada", desc: "Pizzarias - SP", user: "Admin", time: "11:20" },
                  { id: 5, type: "Termo adicionado", desc: "#smashburger", user: "Ana S.", time: "09:15" },
                ].map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>
                      <p className="font-medium text-sm">{item.type}</p>
                      <p className="text-xs text-muted-foreground">{item.desc}</p>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{item.user}</TableCell>
                    <TableCell className="text-sm text-right text-muted-foreground">{item.time}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
