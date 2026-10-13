import { Skeleton } from "@/components/ui/skeleton";

export function BoardSkeleton() {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="space-y-3 px-4 pt-3 pb-3 lg:px-6">
        <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-[50px] rounded-lg" />
          ))}
        </div>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="space-y-1.5">
            <Skeleton className="h-6 w-56" />
            <Skeleton className="h-3 w-96 max-w-full" />
          </div>
          <Skeleton className="h-8 w-72" />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-6 w-36 rounded-full" />
          ))}
        </div>
      </div>
      <div className="grid gap-3 px-4 pb-4 lg:grid-cols-3 lg:px-6">
        {Array.from({ length: 3 }).map((_, column) => (
          <div key={column} className="space-y-2 rounded-xl border bg-muted/30 p-2">
            <Skeleton className="h-10 w-full" />
            {Array.from({ length: 4 }).map((__, index) => (
              <Skeleton key={index} className="h-24 w-full rounded-lg" />
            ))}
          </div>
        ))}
      </div>
      <p className="pb-4 text-center text-xs text-muted-foreground">Lendo clientes, gasto e etapas…</p>
    </div>
  );
}

export function ListSkeleton({ title }: { title: string }) {
  return (
    <div className="mx-auto w-full max-w-[1200px] space-y-4 px-4 py-5 lg:px-6">
      <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
      <Skeleton className="h-4 w-96 max-w-full" />
      <div className="grid gap-3 md:grid-cols-2">
        {Array.from({ length: 6 }).map((_, index) => (
          <Skeleton key={index} className="h-48 rounded-xl" />
        ))}
      </div>
    </div>
  );
}
