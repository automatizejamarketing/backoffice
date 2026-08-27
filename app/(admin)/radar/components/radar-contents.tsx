"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { Search, LayoutGrid, List, Filter, Play, CheckCircle2, XCircle, TrendingUp, TrendingDown, EyeOff, MoreVertical } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";

function getTrendBadge(status: string) {
  switch(status) {
    case "Explodindo": return <Badge variant="outline" className="text-orange-500 border-orange-500/20 bg-orange-500/10"><TrendingUp className="mr-1 size-3" /> Explodindo</Badge>;
    case "Em crescimento": return <Badge variant="outline" className="text-emerald-500 border-emerald-500/20 bg-emerald-500/10"><TrendingUp className="mr-1 size-3" /> Em crescimento</Badge>;
    case "Evergreen": return <Badge variant="outline" className="text-blue-500 border-blue-500/20 bg-blue-500/10"><TrendingUp className="mr-1 size-3" /> Sempre em alta</Badge>;
    case "Estável": return <Badge variant="secondary">Estável</Badge>;
    case "Perdendo força": return <Badge variant="outline" className="text-rose-500 border-rose-500/20 bg-rose-500/10"><TrendingDown className="mr-1 size-3" /> Perdendo força</Badge>;
    default: return <Badge>{status}</Badge>;
  }
}

function getStatusBadge(status: string) {
  switch(status) {
    case "Pendente": return <Badge variant="outline" className="text-amber-500 border-amber-500/20 bg-amber-500/10">Pendente</Badge>;
    case "Publicado": return <Badge variant="outline" className="text-emerald-500 border-emerald-500/20 bg-emerald-500/10">Publicado</Badge>;
    case "Oculto": return <Badge variant="secondary"><EyeOff className="mr-1 size-3" /> Oculto</Badge>;
    case "Irrelevante": return <Badge variant="destructive">Irrelevante</Badge>;
    default: return <Badge>{status}</Badge>;
  }
}

export function RadarContents({ initialData = [] }: { initialData?: any[] }) {
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [contents, setContents] = useState<any[]>(initialData);

  const handleApprove = (id: string) => {
    setContents(prev => 
      prev.map(content => 
        content.id === id ? { ...content, status: "Publicado" } : content
      )
    );
    toast.success("Conteúdo aprovado", {
      description: "O conteúdo agora está disponível para os clientes.",
    });
  };

  const handleHide = (id: string) => {
    setContents(prev => 
      prev.map(content => 
        content.id === id ? { ...content, status: "Oculto" } : content
      )
    );
    toast("Conteúdo ocultado", {
      description: "O conteúdo não será mais exibido no radar.",
    });
  };

  const handleIrrelevant = (id: string) => {
    setContents(prev => 
      prev.map(content => 
        content.id === id ? { ...content, status: "Irrelevante" } : content
      )
    );
    toast.error("Marcado como irrelevante", {
      description: "O algoritmo aprenderá a não buscar mais conteúdos semelhantes.",
    });
  };

  const pendingCount = contents.filter(c => c.status === "Pendente").length;
  const publishedCount = contents.filter(c => c.status === "Publicado").length;

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-4 sm:items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Conteúdos encontrados</h2>
          <p className="text-sm text-muted-foreground">Revise, classifique e controle os conteúdos disponíveis no Radar.</p>
        </div>
        <div className="flex gap-2">
          <Badge variant="secondary" className="px-3 py-1 text-sm font-normal">Todos ({contents.length})</Badge>
          <Badge variant="outline" className="px-3 py-1 text-sm font-normal text-amber-500 border-amber-500/20 bg-amber-500/10">Pendentes ({pendingCount})</Badge>
          <Badge variant="outline" className="px-3 py-1 text-sm font-normal text-emerald-500 border-emerald-500/20 bg-emerald-500/10">Publicados ({publishedCount})</Badge>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b pb-4">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Buscar na legenda ou @perfil..." className="pl-8" />
        </div>
        <Button variant="outline" size="sm"><Filter className="mr-2 size-4" /> Mais Filtros</Button>
        <div className="flex-1" />
        <div className="flex items-center border rounded-md">
          <Button 
            variant="ghost" 
            size="sm" 
            className={`px-3 rounded-none ${viewMode === 'grid' ? 'bg-muted' : ''}`}
            onClick={() => setViewMode('grid')}
          >
            <LayoutGrid className="size-4" />
          </Button>
          <Button 
            variant="ghost" 
            size="sm" 
            className={`px-3 rounded-none ${viewMode === 'list' ? 'bg-muted' : ''}`}
            onClick={() => setViewMode('list')}
          >
            <List className="size-4" />
          </Button>
        </div>
      </div>

      {viewMode === "grid" ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {contents.map((content) => (
            <Card key={content.id} className="overflow-hidden flex flex-col">
              <div className="relative aspect-[9/16] bg-muted group">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={content.thumbnail} alt={content.caption} className="object-cover w-full h-full opacity-80 transition-opacity group-hover:opacity-100" />
                <div className="absolute top-2 left-2 flex flex-col gap-1">
                  <Badge variant="secondary" className="bg-black/50 text-white hover:bg-black/70 border-none backdrop-blur-md">{content.platform}</Badge>
                  <Badge variant="secondary" className="bg-black/50 text-white hover:bg-black/70 border-none backdrop-blur-md">{content.format}</Badge>
                </div>
                <div className="absolute top-2 right-2">
                  <Badge className="bg-primary text-primary-foreground">{content.score}</Badge>
                </div>
                <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/20">
                  <Button variant="secondary" size="icon" className="rounded-full size-12 shadow-lg">
                    <Play className="size-5 ml-1" />
                  </Button>
                </div>
                <div className="absolute bottom-2 left-2 right-2">
                   {getTrendBadge(content.trendStatus)}
                </div>
              </div>
              <CardHeader className="p-3 pb-0">
                <div className="flex justify-between items-start">
                  <span className="font-semibold text-sm truncate">{content.profile}</span>
                  {getStatusBadge(content.status)}
                </div>
              </CardHeader>
              <CardContent className="p-3 text-sm flex-1">
                <p className="line-clamp-2 text-muted-foreground text-xs mb-2">{content.caption}</p>
                <div className="flex justify-between text-[11px] text-muted-foreground mt-auto pt-2 border-t">
                  <span title="Views">👁 {content.views}</span>
                  <span title="Likes">❤️ {content.likes}</span>
                  <span title="Comments">💬 {content.comments}</span>
                </div>
              </CardContent>
              <CardFooter className="p-2 pt-0 grid grid-cols-2 gap-2">
                <Button 
                  variant="outline" 
                  size="sm" 
                  className="w-full text-xs h-8"
                  onClick={() => handleApprove(content.id)}
                >
                  <CheckCircle2 className="mr-1 size-3 text-emerald-500" /> Aprovar
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="sm" className="w-full text-xs h-8"><MoreVertical className="size-3" /> Mais</Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => handleHide(content.id)}><XCircle className="mr-2 size-4" /> Ocultar</DropdownMenuItem>
                    <DropdownMenuItem className="text-destructive" onClick={() => handleIrrelevant(content.id)}><EyeOff className="mr-2 size-4" /> Irrelevante</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </CardFooter>
            </Card>
          ))}
        </div>
      ) : (
        <div className="text-center py-12 text-muted-foreground">
          Visualização em lista em desenvolvimento.
        </div>
      )}
    </div>
  );
}
