"use client";

import { LoadError } from "@/components/consultant-workspace/common/load-error";
import { useBoardData, usePrefetchSibling } from "@/components/consultant-workspace/common/use-trafego-data";
import { isCoreSegment } from "@/lib/consultant-workspace/access";
import { CrmBoard } from "./crm-board";
import { PlaybooksView } from "./playbooks";
import { BoardSkeleton, ListSkeleton } from "./skeletons";

/** CRM a partir do cache do quadro; esqueleto só na primeira leitura. */
export function JourneyBoardScreen() {
  const query = useBoardData();
  usePrefetchSibling("board", query.isSuccess);
  if (!query.data) {
    return query.isError ? (
      <LoadError what="o CRM" error={query.error} onRetry={() => void query.refetch()} retrying={query.isFetching} />
    ) : (
      <BoardSkeleton />
    );
  }
  const data = query.data;
  return (
    <CrmBoard
      range={data.range}
      clients={data.clients}
      alerts={data.alerts}
      extras={data.extras}
      stopped={data.stopped}
      initialStore={data.store}
      now={data.now}
    />
  );
}

/** Playbooks usam a mesma leitura do quadro (e o mesmo cache). */
export function PlaybooksScreen() {
  const query = useBoardData();
  if (!query.data) {
    return query.isError ? (
      <LoadError what="os playbooks" error={query.error} onRetry={() => void query.refetch()} retrying={query.isFetching} />
    ) : (
      <ListSkeleton title="Playbooks" />
    );
  }
  const data = query.data;
  // Playbooks são do tráfego: só os pagantes (o CRM também carrega trial, vencidos…).
  return (
    <PlaybooksView
      clients={data.clients.filter((client) => isCoreSegment(client.access))}
      alerts={data.alerts}
      extras={data.extras}
      initialStore={data.store}
      now={data.now}
    />
  );
}
