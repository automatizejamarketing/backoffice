"use client";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type AdAccount = {
  id: string;
  name: string;
  accountId: string;
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

  return (
    <Select
      value={selectedAccountId ?? undefined}
      onValueChange={(value) => {
        if (value !== null) {
          onSelectAccount(value);
        }
      }}
    >
      <SelectTrigger className="w-full min-w-[200px] max-w-[400px] sm:min-w-[280px]">
        {selectedAccount ? (
          // <div className="flex items-center gap-2 flex-1 min-w-0">
          //   {/* Rounded badge with initial (not circular) */}
          //   <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-muted text-xs font-medium text-foreground">
          //     {getInitial(selectedAccount.name)}
          //   </div>
          //   <span className="truncate text-sm min-w-0">
          //     {selectedAccount.name}
          //   </span>
          // </div>
          <></>
        ) : (
          <span className="text-muted-foreground">Selecione uma conta</span>
        )}
        <SelectValue className="sr-only" />
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
            </div>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
