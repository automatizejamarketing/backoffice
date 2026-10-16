"use client";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MetaAssetSelectionBadges } from "./meta-asset-selection-badges";

type AdAccount = {
  id: string;
  name: string;
  accountId: string;
  enabled?: boolean;
  primary?: boolean;
};

type AccountSelectorProps = {
  accounts: AdAccount[];
  selectedAccountId: string | null;
  onSelectAccount: (accountId: string) => void;
};

function getInitial(name: string): string {
  if (!name || name.trim().length === 0) {
    return "?";
  }
  return name.trim().charAt(0).toUpperCase();
}

export function AdAccountSelector({
  accounts,
  selectedAccountId,
  onSelectAccount,
}: AccountSelectorProps) {
  const selectedAccount = accounts.find(
    (acc) => acc.accountId === selectedAccountId,
  );
  const choosePrompt = (
    <span className="text-muted-foreground">Selecione uma conta</span>
  );

  return (
    <Select
      value={selectedAccountId ?? undefined}
      onValueChange={(value) => {
        if (value !== null) {
          onSelectAccount(value);
        }
      }}
    >
      <SelectTrigger className="w-full min-w-[200px] max-w-[400px] py-2 data-[size=default]:h-14 sm:min-w-[280px] [&>span]:line-clamp-none [&>span]:min-w-0">
        {/* O conteúdo vai como children do Value: sem children, o Radix espelha aqui o item
            inteiro do menu (avatar, nome, ID, selos), e o Value ignora `className`, então não
            dá para escondê-lo com `sr-only` — era o nome duplicado no gatilho. */}
        <SelectValue placeholder={choosePrompt}>
          {selectedAccount ? (
            <span className="flex min-w-0 items-center gap-2 truncate text-sm">
              <span className="truncate">
                {selectedAccount.name || selectedAccount.accountId}
              </span>
              <MetaAssetSelectionBadges
                enabled={selectedAccount.enabled}
                primary={selectedAccount.primary}
              />
            </span>
          ) : (
            choosePrompt
          )}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {accounts.map((account) => (
          <SelectItem key={account.id} value={account.accountId}>
            <div className="flex items-center gap-2 w-full">
              {/* Circular avatar for dropdown items */}
              <Avatar className="size-5 shrink-0">
                <AvatarFallback className="text-xs">
                  {getInitial(account.name)}
                </AvatarFallback>
              </Avatar>
              <div className="flex flex-col min-w-0 flex-1">
                <span className="text-sm truncate">{account.name}</span>
                <span className="text-xs text-muted-foreground">
                  ID: {account.accountId}
                </span>
              </div>
              <MetaAssetSelectionBadges
                enabled={account.enabled}
                primary={account.primary}
              />
            </div>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
