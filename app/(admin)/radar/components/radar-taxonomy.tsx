"use client";

import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export function RadarTaxonomy() {
  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-4 sm:items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Nichos e Termos</h2>
          <p className="text-sm text-muted-foreground">Organize a taxonomia utilizada pelas buscas.</p>
        </div>
        <Button size="sm">
          <Plus className="mr-2 size-4" />
          Novo Nicho
        </Button>
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {/* Mock Data */}
        <div className="rounded-md border p-4 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">Food</h3>
            <Badge>Ativo</Badge>
          </div>
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">Subnichos:</p>
            <div className="flex flex-wrap gap-1">
              <Badge variant="secondary">Hamburgueria</Badge>
              <Badge variant="secondary">Pizzaria</Badge>
              <Badge variant="secondary">Pastelaria</Badge>
              <Badge variant="secondary">Delivery</Badge>
              <Badge variant="secondary">Cafeteria</Badge>
            </div>
          </div>
          <Button variant="outline" size="sm" className="w-full">Gerenciar Subnichos</Button>
        </div>
        
        <div className="rounded-md border p-4 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">Odontologia</h3>
            <Badge>Ativo</Badge>
          </div>
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">Subnichos:</p>
            <div className="flex flex-wrap gap-1">
              <Badge variant="secondary">Estética</Badge>
              <Badge variant="secondary">Ortodontia</Badge>
              <Badge variant="secondary">Implantodontia</Badge>
            </div>
          </div>
          <Button variant="outline" size="sm" className="w-full">Gerenciar Subnichos</Button>
        </div>
      </div>
    </div>
  );
}
