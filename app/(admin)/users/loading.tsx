import { Skeleton } from "@/components/ui/skeleton";

export default function UsersLoading() {
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-2">
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-4 w-72 max-w-full" />
        </div>
        <Skeleton className="h-9 w-40" />
      </div>
      <Skeleton className="h-32 rounded-lg" />
      <div className="space-y-2 rounded-lg border p-4">
        <Skeleton className="h-10 w-full" />
        {Array.from({ length: 8 }).map((_, index) => (
          <Skeleton key={index} className="h-14 w-full" />
        ))}
      </div>
    </div>
  );
}
