"use client";

import { useQueryClient } from "@tanstack/react-query";
import { KanbanSquare, List } from "lucide-react";
import { useDeferredValue, useState } from "react";
import { FilterBar, FilterSelect } from "@/components/ui/filter";
import { SearchField } from "@/components/ui/search-field";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  CRM_ACCOUNT_STAGE_META,
  CRM_ACCOUNT_STAGE_VALUES,
  CRM_COMMERCIAL_STATUS_VALUES,
  CRM_STATUS_META,
  type CrmAccountStage,
  type CrmCommercialStatus,
} from "@/lib/backoffice/crm";
import { CrmKanban } from "./crm-kanban";
import { CrmLeadSheet } from "./crm-lead-sheet";
import { CrmList } from "./crm-list";

type View = "kanban" | "list";

const ACCOUNT_STAGE_OPTIONS = CRM_ACCOUNT_STAGE_VALUES.map((value) => ({
  value,
  label: CRM_ACCOUNT_STAGE_META[value].label,
}));

const COMMERCIAL_STATUS_OPTIONS = CRM_COMMERCIAL_STATUS_VALUES.map((value) => ({
  value,
  label: CRM_STATUS_META[value].label,
}));

export function CrmWorkspace() {
  const queryClient = useQueryClient();
  const [view, setView] = useState<View>("kanban");
  const [searchInput, setSearchInput] = useState("");
  const search = useDeferredValue(searchInput.trim());
  const [accountStage, setAccountStage] = useState<CrmAccountStage | undefined>();
  const [commercialStatus, setCommercialStatus] = useState<
    CrmCommercialStatus | undefined
  >();
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);

  const activeFilters =
    Number(Boolean(accountStage)) +
    Number(Boolean(commercialStatus) && view === "list");

  function refreshLists() {
    void queryClient.invalidateQueries({ queryKey: ["crm"] });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <FilterBar
          activeCount={activeFilters}
          onClear={() => {
            setAccountStage(undefined);
            setCommercialStatus(undefined);
          }}
        >
          <SearchField
            label="Buscar leads"
            placeholder="Nome, e-mail, empresa ou telefone…"
            value={searchInput}
            onValueChange={setSearchInput}
            className="w-full sm:w-80"
          />
          <FilterSelect
            label="Conta"
            value={accountStage}
            onValueChange={(value) => setAccountStage(value as CrmAccountStage | undefined)}
            options={ACCOUNT_STAGE_OPTIONS}
            allLabel="Todas"
          />
          {view === "list" ? (
            <FilterSelect
              label="Status comercial"
              value={commercialStatus}
              onValueChange={(value) =>
                setCommercialStatus(value as CrmCommercialStatus | undefined)
              }
              options={COMMERCIAL_STATUS_OPTIONS}
              allLabel="Todos"
            />
          ) : null}
        </FilterBar>
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          aria-label="Visualização"
          value={view}
          onValueChange={(value) => {
            if (value) setView(value as View);
          }}
        >
          <ToggleGroupItem value="kanban" aria-label="Kanban">
            <KanbanSquare />
            Kanban
          </ToggleGroupItem>
          <ToggleGroupItem value="list" aria-label="Lista">
            <List />
            Lista
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      {view === "kanban" ? (
        <CrmKanban
          search={search}
          accountStage={accountStage}
          onOpenLead={setSelectedUserId}
        />
      ) : (
        <CrmList
          search={search}
          accountStage={accountStage}
          commercialStatus={commercialStatus}
          onOpenLead={setSelectedUserId}
        />
      )}

      <CrmLeadSheet
        userId={selectedUserId}
        onClose={() => setSelectedUserId(null)}
        onChanged={refreshLists}
      />
    </div>
  );
}
