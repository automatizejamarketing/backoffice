"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export function RadarSources() {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Fontes e Consumo</h2>
        <p className="text-sm text-muted-foreground">Disponibilidade das integrações e consumo da KeyAPI.</p>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        <Card>
          <CardHeader>
            <div className="flex justify-between items-center">
              <CardTitle className="text-base">Instagram</CardTitle>
              <Badge variant="outline" className="text-emerald-500 border-emerald-500/20 bg-emerald-500/10">Operacional</Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Última coleta</span>
              <span className="font-medium">Hoje, 14:35</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Buscas ativas</span>
              <span className="font-medium">18</span>
            </div>
            <Button variant="outline" size="sm" className="w-full mt-2">Ver Detalhes</Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex justify-between items-center">
              <CardTitle className="text-base">TikTok</CardTitle>
              <Badge variant="outline" className="text-emerald-500 border-emerald-500/20 bg-emerald-500/10">Operacional</Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Última coleta</span>
              <span className="font-medium">Hoje, 14:35</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Buscas ativas</span>
              <span className="font-medium">12</span>
            </div>
            <Button variant="outline" size="sm" className="w-full mt-2">Ver Detalhes</Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex justify-between items-center">
              <CardTitle className="text-base">YouTube</CardTitle>
              <Badge variant="secondary">Não Configurado</Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4 text-sm text-muted-foreground">
            <p>Integração com YouTube Shorts ainda não foi configurada.</p>
            <Button variant="outline" size="sm" className="w-full mt-2">Configurar</Button>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Consumo Estimado (Demonstrativo)</CardTitle>
          <CardDescription>Uso das cotas da KeyAPI no mês atual.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span>Requisições realizadas</span>
              <span className="font-medium">45.230 / 100.000</span>
            </div>
            <div className="h-2 w-full bg-muted rounded-full overflow-hidden">
              <div className="h-full bg-primary w-[45%]" />
            </div>
            <p className="text-xs text-muted-foreground text-right">45% utilizado</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
