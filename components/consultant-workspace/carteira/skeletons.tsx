import { Skeleton } from "@/components/ui/skeleton";

function TopSkeleton() {
  return (
    <>
      <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={index} className="h-[50px] rounded-lg" />
        ))}
      </div>
      <div className="flex gap-2">
        <Skeleton className="h-7 w-52" />
        <Skeleton className="h-7 w-72" />
        <Skeleton className="h-7 w-28" />
      </div>
      <div className="flex gap-1">
        {Array.from({ length: 7 }).map((_, index) => (
          <Skeleton key={index} className="h-6 w-24" />
        ))}
      </div>
    </>
  );
}

export function CarteiraSkeleton({ mode = "fila" }: { mode?: "fila" | "tabela" }) {
  return (
    <div className="flex min-h-[540px] flex-1 flex-col gap-2 px-3 pt-3 pb-3 lg:px-4">
      <TopSkeleton />
      {mode === "fila" ? (
        <div className="flex min-h-0 flex-1 overflow-hidden rounded-lg border">
          <div className="w-[320px] shrink-0 border-r xl:w-[380px] 2xl:w-[420px]">
            {Array.from({ length: 8 }).map((_, index) => (
              <div key={index} className="space-y-1.5 border-b px-3 py-2.5">
                <Skeleton className="h-3.5 w-2/3" />
                <Skeleton className="h-3 w-1/2" />
                <Skeleton className="h-3 w-3/4" />
              </div>
            ))}
          </div>
          <div className="flex-1 space-y-4 p-5">
            <Skeleton className="h-6 w-64" />
            <Skeleton className="h-4 w-96 max-w-full" />
            <Skeleton className="h-32 w-full rounded-lg" />
            <Skeleton className="h-24 w-full rounded-lg" />
            <p className="text-xs text-muted-foreground">Lendo clientes, gasto, alertas e jornada…</p>
          </div>
        </div>
      ) : (
        <div className="min-h-0 flex-1 space-y-1 overflow-hidden rounded-lg border p-2">
          {Array.from({ length: 14 }).map((_, index) => (
            <Skeleton key={index} className="h-8 w-full" />
          ))}
          <p className="pt-2 text-center text-xs text-muted-foreground">Lendo clientes, gasto, alertas e jornada…</p>
        </div>
      )}
    </div>
  );
}
