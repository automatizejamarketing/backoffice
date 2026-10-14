"use client";

import { LoadError } from "@/components/consultant-workspace/common/load-error";
import { useBoardData, usePrefetchSibling } from "@/components/consultant-workspace/common/use-trafego-data";
import { JourneyBoard } from "./board";
import { PlaybooksView } from "./playbooks";
import { BoardSkeleton, ListSkeleton } from "./skeletons";

/** Jornada a partir do cache do quadro; esqueleto só na primeira leitura. */
export function JourneyBoardScreen() {
  const query = useBoardData();
  usePrefetchSibling("board", query.isSuccess);
  if (!query.data) {
    return query.isError ? (
      <LoadError what="a Jornada" error={query.error} onRetry={() => void query.refetch()} retrying={query.isFetching} />
    ) : (
      <BoardSkeleton />
    );
  }
  const data = query.data;
  return (
    <JourneyBoard
      range={data.range}
      clients={data.clients}
      alerts={data.alerts}
      extras={data.extras}
      stopped={data.stopped}
      touchedAlertUser={data.touchedAlertUser}
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
  return (
    <PlaybooksView
      clients={data.clients}
      alerts={data.alerts}
      extras={data.extras}
      initialStore={data.store}
      now={data.now}
    />
  );
}
