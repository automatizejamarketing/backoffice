"use client";

import { useState, type MouseEvent, type ReactNode } from "react";
import { UserDetailSheet } from "./user-detail-sheet";

type UsersTableShellProps = {
  children: ReactNode;
};

export function UsersTableShell({ children }: UsersTableShellProps) {
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [selectedUserEmail, setSelectedUserEmail] = useState<string | null>(
    null,
  );

  function handleClick(event: MouseEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement | null;
    if (!target) return;
    if (target.closest("[data-user-row-ignore]")) return;

    const row = target.closest<HTMLElement>("[data-user-id]");
    if (!row) return;

    const userId = row.dataset.userId;
    const userEmail = row.dataset.userEmail;
    if (!userId) return;

    setSelectedUserId(userId);
    setSelectedUserEmail(userEmail ?? null);
  }

  function closeUser() {
    setSelectedUserId(null);
    setSelectedUserEmail(null);
  }

  return (
    <div onClick={handleClick}>
      {children}
      <UserDetailSheet
        userId={selectedUserId}
        userEmail={selectedUserEmail}
        open={Boolean(selectedUserId)}
        onClose={closeUser}
      />
    </div>
  );
}
