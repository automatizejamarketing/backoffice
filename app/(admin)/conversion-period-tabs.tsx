"use client";

import { useState, type ReactNode } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { ConversionView } from "@/lib/backoffice/dashboard-search-params";

export function ConversionPeriodTabs({
  initialView,
  dateFilter,
  historical,
  period,
}: {
  initialView: ConversionView;
  dateFilter: ReactNode;
  historical: ReactNode;
  period: ReactNode;
}) {
  const [view, setView] = useState<ConversionView>(initialView);

  return (
    <Tabs
      value={view}
      onValueChange={(value) => setView(value as ConversionView)}
      className="min-w-0"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <TabsList aria-label="Período da conversão">
          <TabsTrigger value="historical" className="min-w-[116px]">
            Desde sempre
          </TabsTrigger>
          <TabsTrigger value="period" className="min-w-[116px]">
            Por período
          </TabsTrigger>
        </TabsList>
        {view === "period" ? dateFilter : null}
      </div>

      <TabsContent value="historical" className="mt-5 min-w-0">
        {historical}
      </TabsContent>
      <TabsContent value="period" className="mt-5 min-w-0">
        {period}
      </TabsContent>
    </Tabs>
  );
}
