import { Skeleton } from "@/components/ui/skeleton";

export function ClientSkeleton() {
  return (
    <div className="mx-auto w-full max-w-[1440px] space-y-5 px-4 py-5 lg:px-6">
      <Skeleton className="h-3 w-24" />
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <Skeleton className="h-8 w-72" />
          <Skeleton className="h-4 w-96 max-w-full" />
          <Skeleton className="h-3 w-80 max-w-full" />
        </div>
        <Skeleton className="h-16 w-56" />
      </div>
      <Skeleton className="h-24 w-full rounded-xl" />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-4">
          <Skeleton className="h-32 rounded-xl" />
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} className="h-20" />
            ))}
          </div>
          <Skeleton className="h-48 rounded-xl" />
          <Skeleton className="h-56 rounded-xl" />
        </div>
        <Skeleton className="h-96 rounded-xl" />
      </div>
      <p className="text-center text-xs text-muted-foreground">Montando a jornada e o dossiê do cliente…</p>
    </div>
  );
}
