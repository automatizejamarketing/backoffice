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
      <SelectTrigger className="w-[180px] sm:w-[240px]">
        <SelectValue>
          {selectedAccount ? (
            <div className="flex items-center gap-2">
              <Avatar className="size-5">
                <AvatarFallback className="text-xs">
                  {getInitial(selectedAccount.name)}
                </AvatarFallback>
              </Avatar>
              <span className="truncate text-sm">{selectedAccount.name}</span>
            </div>
          ) : (
            <span className="text-muted-foreground">Selecione uma conta</span>
          )}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {accounts.map((account) => (
          <SelectItem key={account.id} value={account.accountId}>
            <div className="flex items-center gap-2">
              <Avatar className="size-5">
                <AvatarFallback className="text-xs">
                  {getInitial(account.name)}
                </AvatarFallback>
              </Avatar>
              <div className="flex flex-col">
                <span className="text-sm">{account.name}</span>
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
