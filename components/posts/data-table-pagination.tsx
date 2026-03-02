"use client";

import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";

type DataTablePaginationProps = {
  page: number;
  totalPages: number;
  total: number;
  onPageChange: (page: number) => void;
  isLoading?: boolean;
};

export function DataTablePagination({
  page,
  totalPages,
  total,
  onPageChange,
  isLoading,
}: DataTablePaginationProps) {
  if (totalPages <= 1) return null;

  return (
    <div className="flex items-center justify-between px-2 py-4">
      <p className="text-sm text-muted-foreground">
        {total} {total === 1 ? "resultado" : "resultados"}
      </p>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1 || isLoading}
        >
          <ChevronLeft className="size-4" />
          <span className="hidden sm:inline">Anterior</span>
        </Button>
        <span className="text-sm text-muted-foreground">
          {page} / {totalPages}
        </span>
        <Button
          variant="outline"
          size="sm"
          onClick={() => onPageChange(page + 1)}
          disabled={page >= totalPages || isLoading}
        >
          <span className="hidden sm:inline">Próxima</span>
          <ChevronRight className="size-4" />
        </Button>
      </div>
    </div>
  );
}
