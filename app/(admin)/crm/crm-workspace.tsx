"use client";

import { useQueryClient } from "@tanstack/react-query";
import { KanbanSquare, List } from "lucide-react";
import { useDeferredValue, useEffect, useState } from "react";
import { FilterBar, FilterDate, FilterSelect } from "@/components/ui/filter";
import { SearchField } from "@/components/ui/search-field";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  CRM_ACCOUNT_STAGE_META,
  CRM_ACCOUNT_STAGE_VALUES,
  CRM_COMMERCIAL_STATUS_VALUES,
  CRM_STATUS_META,
  crmDateConditionToBounds,
  type CrmAccountStage,
  type CrmCommercialStatus,
  type CrmDateCondition,
} from "@/lib/backoffice/crm";
import {
  CRM_FILTERS_STORAGE_KEY,
  parseCrmStoredFilters,
  serializeCrmStoredFilters,
  type CrmView,
} from "@/lib/backoffice/crm-filters-storage";
import { CrmKanban } from "./crm-kanban";
import { CrmLeadSheet } from "./crm-lead-sheet";
import { CrmList } from "./crm-list";

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
  const [view, setView] = useState<CrmView>("kanban");
  const [searchInput, setSearchInput] = useState("");
  const search = useDeferredValue(searchInput.trim());
  const [accountStage, setAccountStage] = useState<CrmAccountStage | undefined>();
  const [commercialStatus, setCommercialStatus] = useState<
    CrmCommercialStatus | undefined
  >();
  const [signup, setSignup] = useState<CrmDateCondition | undefined>();
  const [expires, setExpires] = useState<CrmDateCondition | undefined>();
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  // Os filtros ficam no localStorage; até ler, nada é buscado nem gravado.
  const [filtersLoaded, setFiltersLoaded] = useState(false);

  const signupBounds = signup && crmDateConditionToBounds(signup);
  const expiresBounds = expires && crmDateConditionToBounds(expires);

  useEffect(() => {
    try {
      const stored = parseCrmStoredFilters(
        localStorage.getItem(CRM_FILTERS_STORAGE_KEY),
      );
      setView(stored.view);
      setAccountStage(stored.accountStage);
      setCommercialStatus(stored.commercialStatus);
      setSignup(stored.signup);
      setExpires(stored.expires);
    } catch {
      // Sem storage (modo privado, bloqueio): segue com os padrões.
    } finally {
      setFiltersLoaded(true);
    }
  }, []);

  const storedFilters = serializeCrmStoredFilters({
    view,
    accountStage,
    commercialStatus,
    signup,
    expires,
  });
  useEffect(() => {
    if (!filtersLoaded) return;
    try {
      localStorage.setItem(CRM_FILTERS_STORAGE_KEY, storedFilters);
    } catch {
      // Gravar é conveniência; a tela segue funcionando sem storage.
    }
  }, [filtersLoaded, storedFilters]);

  const activeFilters =
    Number(Boolean(accountStage)) +
    Number(Boolean(commercialStatus) && view === "list") +
    Number(Boolean(signup)) +
    Number(Boolean(expires));

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
            setSignup(undefined);
            setExpires(undefined);
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
          <FilterDate
            label="Cadastro"
            value={signup}
            onChange={setSignup}
            maxDate={new Date()}
            className="w-full sm:w-auto"
          />
          <FilterDate
            label="Acesso até"
            value={expires}
            onChange={setExpires}
            className="w-full sm:w-auto"
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
            if (value) setView(value as CrmView);
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

      {!filtersLoaded ? null : view === "kanban" ? (
        <CrmKanban
          search={search}
          accountStage={accountStage}
          signup={signupBounds}
          expires={expiresBounds}
          onOpenLead={setSelectedUserId}
        />
      ) : (
        <CrmList
          search={search}
          accountStage={accountStage}
          commercialStatus={commercialStatus}
          signup={signupBounds}
          expires={expiresBounds}
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
