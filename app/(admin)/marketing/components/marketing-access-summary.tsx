"use client";

import { useEffect, useState } from "react";
import { TriangleAlert } from "lucide-react";
import { StatusBadge } from "@/components/status-badge";
import type { AccessSummary } from "@/lib/subscriptions/access-summary";

/**
 * Whether the client's access is active and until when, plus the billing side,
 * in one quiet line: the marketing page is about campaigns, not billing. The
 * full picture stays in the user hub's Assinatura tab.
 */
export function MarketingAccessSummary({ userId }: { userId: string }) {
  // Keyed by user so switching clients never shows the previous one's summary.
  const [loaded, setLoaded] = useState<{
    userId: string;
    summary: AccessSummary | null;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/users/${userId}/access-summary`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: AccessSummary | null) => {
        if (!cancelled) setLoaded({ userId, summary: data });
      })
      .catch(() => {
        if (!cancelled) setLoaded({ userId, summary: null });
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const summary = loaded?.userId === userId ? loaded.summary : null;
  if (!summary) return null;
  return <MarketingAccessSummaryView summary={summary} />;
}

export function MarketingAccessSummaryView({
  summary,
}: {
  summary: AccessSummary;
}) {
  const { access, billing, notice } = summary;
  // inline-size containment: the nowrap badges would otherwise widen the
  // column's min-content and squeeze the avatar next to it on phones.
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px] text-muted-foreground [contain:inline-size]">
      <span>Assinatura</span>
      <StatusBadge badge={access} />
      {access.hint ? <span>{access.hint}</span> : null}
      <span aria-hidden="true">·</span>
      <span>{billing.title}</span>
      {billing.badge ? (
        <>
          <StatusBadge badge={billing.badge} />
          {billing.badge.hint ? <span>{billing.badge.hint}</span> : null}
        </>
      ) : (
        <span>{billing.empty}</span>
      )}
      {notice ? (
        <span
          className="inline-flex items-center gap-1 text-warning"
          title={notice.detail}
        >
          <TriangleAlert className="size-3" aria-hidden="true" />
          {notice.title}
        </span>
      ) : null}
    </div>
  );
}
