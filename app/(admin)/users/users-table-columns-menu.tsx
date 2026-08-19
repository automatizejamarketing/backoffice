"use client";

import { useState, type DragEvent } from "react";
import { Columns3, Eye, EyeOff, GripVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import {
  USERS_TABLE_COLUMNS,
  isUsersTableColumnHideable,
  moveUsersTableColumnToIndex,
  setUsersTableColumnVisible,
  type UsersTableColumnId,
  type UsersTableColumnPrefs,
} from "@/lib/backoffice/users-table-columns";

const DRAG_TYPE = "application/x-users-table-column";

function isColumnId(value: string): value is UsersTableColumnId {
  return USERS_TABLE_COLUMNS.some((column) => column.id === value);
}

export function UsersTableColumnsMenu({
  prefs,
  visibleCount,
  onChange,
  onReset,
}: {
  prefs: UsersTableColumnPrefs;
  visibleCount: number;
  onChange: (prefs: UsersTableColumnPrefs) => void;
  onReset: () => void;
}) {
  const [draggingId, setDraggingId] = useState<UsersTableColumnId | null>(null);
  const [overId, setOverId] = useState<UsersTableColumnId | null>(null);

  function handleDragStart(
    event: DragEvent<HTMLElement>,
    columnId: UsersTableColumnId,
  ) {
    event.dataTransfer.setData(DRAG_TYPE, columnId);
    event.dataTransfer.setData("text/plain", columnId);
    event.dataTransfer.effectAllowed = "move";
    setDraggingId(columnId);
    setOverId(columnId);
  }

  function handleDragOver(
    event: DragEvent<HTMLElement>,
    columnId: UsersTableColumnId,
  ) {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    if (overId !== columnId) setOverId(columnId);
  }

  function handleDrop(
    event: DragEvent<HTMLElement>,
    columnId: UsersTableColumnId,
  ) {
    event.preventDefault();
    const source =
      event.dataTransfer.getData(DRAG_TYPE) ||
      event.dataTransfer.getData("text/plain");
    if (!isColumnId(source)) return;

    onChange(
      moveUsersTableColumnToIndex(prefs, source, prefs.order.indexOf(columnId)),
    );
    setDraggingId(null);
    setOverId(null);
  }

  function handleDragEnd() {
    setDraggingId(null);
    setOverId(null);
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 gap-1.5">
          <Columns3 data-icon="inline-start" />
          Colunas
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel>Mostrar e reordenar</DropdownMenuLabel>
        <p className="px-2 pb-1 text-[11px] text-muted-foreground">
          Arraste para mudar a ordem. Usuário e Ações não podem ser escondidas.
          {` ${visibleCount} visíveis.`}
        </p>
        <DropdownMenuSeparator />
        <div className="flex flex-col gap-0.5 p-1">
          {prefs.order.map((columnId) => {
            const column = USERS_TABLE_COLUMNS.find(
              (item) => item.id === columnId,
            );
            if (!column) return null;
            const hideable = isUsersTableColumnHideable(column.id);
            const visible = hideable ? !prefs.hidden.includes(columnId) : true;

            return (
              <div
                key={column.id}
                onDragOver={(event) => handleDragOver(event, column.id)}
                onDrop={(event) => handleDrop(event, column.id)}
                className={cn(
                  "flex items-center gap-1 rounded-sm px-1 py-0.5",
                  overId === column.id && draggingId && draggingId !== column.id
                    ? "bg-accent"
                    : null,
                  draggingId === column.id ? "opacity-50" : null,
                )}
              >
                <button
                  type="button"
                  draggable
                  aria-label={`Arrastar coluna ${column.label}`}
                  className="inline-flex size-8 shrink-0 cursor-grab items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground active:cursor-grabbing"
                  onPointerDown={(event) => event.stopPropagation()}
                  onDragStart={(event) => handleDragStart(event, column.id)}
                  onDragEnd={handleDragEnd}
                >
                  <GripVertical />
                </button>
                <span
                  className={cn(
                    "min-w-0 flex-1 truncate text-xs",
                    visible ? "text-foreground" : "text-muted-foreground",
                  )}
                >
                  {column.label}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  disabled={!hideable}
                  aria-pressed={visible}
                  title={
                    hideable
                      ? undefined
                      : `${column.label} não pode ser escondida`
                  }
                  aria-label={
                    hideable
                      ? visible
                        ? `Esconder coluna ${column.label}`
                        : `Mostrar coluna ${column.label}`
                      : `${column.label} não pode ser escondida`
                  }
                  onPointerDown={(event) => event.preventDefault()}
                  onClick={() => {
                    if (!hideable) return;
                    onChange(
                      setUsersTableColumnVisible(prefs, column.id, !visible),
                    );
                  }}
                >
                  {visible ? <Eye /> : <EyeOff />}
                </Button>
              </div>
            );
          })}
        </div>
        <DropdownMenuSeparator />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 w-full justify-start text-xs"
          onClick={onReset}
        >
          Restaurar padrão
        </Button>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
