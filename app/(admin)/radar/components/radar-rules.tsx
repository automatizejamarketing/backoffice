"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";

export function RadarRules() {
  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-4 sm:items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Regras de Publicação</h2>
          <p className="text-sm text-muted-foreground">Controle o que pode chegar ao Radar dos clientes.</p>
        </div>
        <Button size="sm">Salvar Alterações</Button>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Regras Globais</CardTitle>
            <CardDescription>Aplicadas a todos os nichos por padrão.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label>Publicar automaticamente</Label>
                <p className="text-[13px] text-muted-foreground">Conteúdos que atingem a nota mínima são publicados sem aprovação manual.</p>
              </div>
              <Switch defaultChecked={false} />
            </div>
            
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label>Ocultar conteúdo sem thumbnail</Label>
                <p className="text-[13px] text-muted-foreground">Não exibe conteúdos que falharam ao carregar a imagem de capa.</p>
              </div>
              <Switch defaultChecked={true} />
            </div>

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label>Ocultar duplicados</Label>
                <p className="text-[13px] text-muted-foreground">Oculta vídeos postados por mais de um perfil no mesmo nicho.</p>
              </div>
              <Switch defaultChecked={true} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Simulação</CardTitle>
            <CardDescription>Impacto das regras atuais na base de dados.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="rounded-lg bg-muted p-4">
              <p className="text-sm">Com estas regras, <span className="font-bold text-primary">892</span> dos <span className="font-bold">1.248</span> conteúdos atuais seriam exibidos aos clientes.</p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
