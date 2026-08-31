"use client";

import {
  AlertTriangle,
  BarChart3,
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronsDownUp,
  ChevronsUpDown,
  CircleSlash2,
  Clock3,
  ExternalLink,
  Film,
  FlaskConical,
  ImageIcon,
  LayoutGrid,
  List,
  Loader2,
  Play,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  XCircle,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { useAdMedia } from "@/app/(admin)/marketing/hooks/use-ad-media";
import type { AdMediaItem } from "@/lib/meta-business/ad-media-types";
import type {
  CreativeAnalysisBucket,
  CreativeAnalysisLimit,
  CreativeAnalysisMedia,
  CreativeAnalysisMetricComparison,
  CreativeAnalysisSummary,
  CreativeAnalysisView,
} from "@/lib/creative-analysis/playground";
import { cn } from "@/lib/utils";

const API_PATH = "/api/backoffice/creative-analysis-playground";

type ListResponse = {
  records: CreativeAnalysisView[];
  summary: CreativeAnalysisSummary;
};

type RunFeedback = {
  action: "preview" | "run";
  jobs: Array<{ userId?: string; accountId?: string; adId?: string }>;
  runIds: string[];
  skipped: string | null;
  deliveryEnabled: boolean | null;
  decision?: {
    kind?: string;
    reason?: string | null;
    gaps?: string[];
    forceWouldBypass?: boolean;
  };
};

const EMPTY_SUMMARY: CreativeAnalysisSummary = {
  total: 0,
  analyzed: 0,
  positive: 0,
  negative: 0,
  pending: 0,
  skipped: 0,
  control: 0,
  failed: 0,
};

const BUCKET_META: Record<
  CreativeAnalysisBucket,
  { label: string; icon: typeof CheckCircle2; className: string }
> = {
  positive: {
    label: "Contribuidor provável",
    icon: AlertTriangle,
    className:
      "border-amber-500/35 bg-amber-500/5 text-amber-800 dark:text-amber-300",
  },
  negative: {
    label: "Criativo parece ok",
    icon: CheckCircle2,
    className:
      "border-emerald-500/35 bg-emerald-500/5 text-emerald-800 dark:text-emerald-300",
  },
  pending: {
    label: "Em análise",
    icon: Clock3,
    className:
      "border-blue-500/35 bg-blue-500/5 text-blue-800 dark:text-blue-300",
  },
  skipped: {
    label: "Ignorado",
    icon: CircleSlash2,
    className:
      "border-slate-500/30 bg-slate-500/5 text-slate-700 dark:text-slate-300",
  },
  control: {
    label: "Controle forçado",
    icon: FlaskConical,
    className:
      "border-violet-500/35 bg-violet-500/5 text-violet-800 dark:text-violet-300",
  },
  failed: {
    label: "Falhou",
    icon: XCircle,
    className:
      "border-destructive/35 bg-destructive/5 text-destructive",
  },
};

const METRIC_LABELS: Record<string, string> = {
  ctr: "CTR",
  threeSecondViewRate: "View 3s",
  p25ViewRate: "View 25%",
  landingPageRate: "LP / clique",
  cpa: "CPA",
  roas: "ROAS",
  avgWatchSeconds: "Tempo médio",
};

const GAP_LABELS: Record<string, string> = {
  ctr_7d: "CTR 7d",
  three_second_view_rate_7d: "View 3s 7d",
  p25_view_rate_7d: "View 25% 7d",
  landing_page_rate_7d: "LP / clique 7d",
  cpa_7d: "CPA 7d",
  roas_7d: "ROAS 7d",
  roas_14d: "ROAS 14d",
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function parseFeedback(value: unknown): RunFeedback | null {
  const envelope = asRecord(value);
  const result = asRecord(envelope?.result);
  if (!result) return null;
  const action = result.action;
  if (action !== "preview" && action !== "run") return null;
  const decision = asRecord(result.decision);
  return {
    action,
    jobs: Array.isArray(result.jobs)
      ? result.jobs.flatMap((job) => {
          const item = asRecord(job);
          return item
            ? [
                {
                  userId: stringValue(item.userId) ?? undefined,
                  accountId: stringValue(item.accountId) ?? undefined,
                  adId: stringValue(item.adId) ?? undefined,
                },
              ]
            : [];
        })
      : [],
    runIds: Array.isArray(result.runIds)
      ? result.runIds.filter((id): id is string => typeof id === "string")
      : [],
    skipped: stringValue(result.skipped),
    deliveryEnabled:
      typeof result.deliveryEnabled === "boolean"
        ? result.deliveryEnabled
        : null,
    decision: decision
      ? {
          kind: stringValue(decision.kind) ?? undefined,
          reason: stringValue(decision.reason),
          gaps: Array.isArray(decision.gaps)
            ? decision.gaps.filter(
                (gap): gap is string => typeof gap === "string",
              )
            : [],
          forceWouldBypass: decision.forceWouldBypass === true,
        }
      : undefined,
  };
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Sao_Paulo",
  }).format(date);
}

function formatMetric(metric: string, value: number | null): string {
  if (value === null) return "n/d";
  if (
    metric === "ctr" ||
    metric === "threeSecondViewRate" ||
    metric === "p25ViewRate" ||
    metric === "landingPageRate"
  ) {
    return new Intl.NumberFormat("pt-BR", {
      style: "percent",
      maximumFractionDigits: 2,
    }).format(value);
  }
  if (metric === "cpa") {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
      maximumFractionDigits: 2,
    }).format(value);
  }
  if (metric === "avgWatchSeconds") return `${value.toFixed(1)}s`;
  return value.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
}

function MetricComparison({
  comparison,
}: {
  comparison: CreativeAnalysisMetricComparison;
}) {
  const unfavorable =
    comparison.deltaPercent !== null &&
    (comparison.metric === "cpa"
      ? comparison.deltaPercent > 0
      : comparison.deltaPercent < 0);

  return (
    <div className="grid grid-cols-[1fr_auto_auto] items-center gap-3 rounded-md border bg-background/60 px-3 py-2">
      <div>
        <p className="font-medium">
          {METRIC_LABELS[comparison.metric] ?? comparison.metric}
          <span className="ml-1 text-[10px] text-muted-foreground">
            {comparison.window}
          </span>
        </p>
        <p className="text-[10px] text-muted-foreground">
          candidato vs. mediana dos irmãos
        </p>
      </div>
      <p className="text-right font-semibold tabular-nums">
        {formatMetric(comparison.metric, comparison.candidate)}
        <span className="block text-[10px] font-normal text-muted-foreground">
          {formatMetric(comparison.metric, comparison.siblings)}
        </span>
      </p>
      <Badge
        variant="outline"
        className={cn(
          "min-w-14 tabular-nums",
          unfavorable
            ? "text-rose-700 dark:text-rose-300"
            : "text-emerald-700 dark:text-emerald-300",
        )}
      >
        {comparison.deltaPercent === null
          ? "—"
          : `${comparison.deltaPercent > 0 ? "+" : ""}${comparison.deltaPercent.toFixed(0)}%`}
      </Badge>
    </div>
  );
}

function DiagnosisThumbnail({
  media,
  className,
}: {
  media: CreativeAnalysisMedia[];
  className?: string;
}) {
  const first = media[0];
  if (!first) {
    return (
      <div
        className={cn(
          "flex shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground",
          className,
        )}
      >
        <ImageIcon className="size-4" />
      </div>
    );
  }

  return (
    <div
      className={cn(
        "relative shrink-0 overflow-hidden rounded-md bg-black/80 pointer-events-none",
        className,
      )}
    >
      {first.type === "video" ? (
        <video
          src={first.url}
          muted
          playsInline
          preload="metadata"
          className="size-full object-cover"
        />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={first.url}
          alt=""
          className="size-full object-cover"
        />
      )}
      {first.type === "video" ? (
        <span className="absolute bottom-1 right-1 rounded bg-black/70 p-0.5 text-white">
          <Film className="size-3" />
        </span>
      ) : null}
    </div>
  );
}

type PlayableCreative = {
  type: "image" | "video";
  url: string;
  posterUrl?: string;
  permalinkUrl?: string;
};

function playableFromAdMedia(items: AdMediaItem[]): PlayableCreative[] {
  const playable: PlayableCreative[] = [];
  for (const item of items) {
    if (
      item.kind === "video" &&
      item.previewUrl &&
      item.videoStatus !== "error"
    ) {
      playable.push({
        type: "video",
        url: item.previewUrl,
        posterUrl: item.posterUrl,
        permalinkUrl: item.permalinkUrl,
      });
      continue;
    }
    if (item.kind === "image" && item.previewUrl) {
      playable.push({ type: "image", url: item.previewUrl });
      continue;
    }
    if (item.posterUrl) {
      playable.push({
        type: "image",
        url: item.posterUrl,
        permalinkUrl: item.permalinkUrl,
      });
    }
  }
  return playable;
}

function DiagnosisMediaPanel({ record }: { record: CreativeAnalysisView }) {
  const [visible, setVisible] = useState(true);
  const live = useAdMedia(
    record.accountId,
    record.userId,
    record.adId,
    visible,
  );
  const liveItems = playableFromAdMedia(live.data?.items ?? []);
  const playable =
    liveItems.length > 0
      ? liveItems
      : record.media.map((item) => ({
          type: item.type,
          url: item.url,
        }));
  const permalink = live.data?.items?.find((item) => item.permalinkUrl)
    ?.permalinkUrl;
  const label = live.isLoading
    ? "carregando"
    : playable.some((item) => item.type === "video")
      ? playable.length === 1
        ? "Vídeo"
        : `${playable.length} peças`
      : playable.length === 1
        ? "Imagem"
        : playable.length > 1
          ? `${playable.length} peças`
          : "mídia";

  return (
    <section className="overflow-hidden rounded-lg border bg-background/60">
      <button
        type="button"
        onClick={() => setVisible((current) => !current)}
        aria-expanded={visible}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-background/70"
      >
        <span className="flex items-center gap-2 font-medium text-foreground">
          {playable.some((item) => item.type === "video") ? (
            <Film className="size-3.5" />
          ) : (
            <ImageIcon className="size-3.5" />
          )}
          Criativo
          <Badge variant="outline">{label}</Badge>
        </span>
        <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
          {visible ? "ocultar" : "mostrar"}
          <ChevronDown
            className={cn(
              "size-3.5 transition-transform",
              visible && "rotate-180",
            )}
          />
        </span>
      </button>
      {visible ? (
        <div className="border-t border-current/10 p-3">
          {live.isLoading && playable.length === 0 ? (
            <div className="flex h-64 items-center justify-center rounded-md bg-black/40 text-muted-foreground">
              <Loader2 className="size-5 animate-spin" />
              <span className="ml-2 text-sm">Carregando o criativo…</span>
            </div>
          ) : playable.length > 0 ? (
            <div
              className={cn(
                playable.length > 1 && "grid gap-2 sm:grid-cols-2",
              )}
            >
              {playable.map((item, index) =>
                item.type === "video" ? (
                  <video
                    key={`${item.url}-${index}`}
                    src={item.url}
                    poster={item.posterUrl}
                    controls
                    playsInline
                    preload="metadata"
                    className="max-h-[28rem] w-full rounded-md bg-black object-contain"
                  />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    key={`${item.url}-${index}`}
                    src={item.url}
                    alt={`Criativo ${index + 1}`}
                    className="max-h-[28rem] w-full rounded-md bg-muted object-contain"
                  />
                ),
              )}
            </div>
          ) : (
            <p className="rounded-md bg-muted/40 px-3 py-8 text-center text-sm text-muted-foreground">
              {live.isError
                ? "Não foi possível buscar a mídia deste anúncio na Meta."
                : "Este diagnóstico não tem mídia reproduzível agora."}
            </p>
          )}
          {permalink ? (
            <a
              href={permalink}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
            >
              <ExternalLink className="size-3" />
              Abrir publicação original
            </a>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function DiagnosisBadges({ record }: { record: CreativeAnalysisView }) {
  const meta = BUCKET_META[record.bucket];
  const StatusIcon = meta.icon;

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
      <Badge variant="outline" className="border-current/25 bg-background/70">
        <StatusIcon
          className={cn(
            "size-3",
            record.bucket === "pending" && "animate-pulse",
          )}
        />
        {meta.label}
      </Badge>
      {record.confidence ? (
        <Badge variant="secondary">confiança {record.confidence}</Badge>
      ) : null}
      {record.siblingCount !== null ? (
        <span className="text-[11px] text-muted-foreground">
          {record.siblingCount} irmão(s)
        </span>
      ) : null}
    </div>
  );
}

function DiagnosisDetail({ record }: { record: CreativeAnalysisView }) {
  return (
    <div className="space-y-4 text-sm">
      <DiagnosisMediaPanel record={record} />
      {record.summary ? (
        <div className="rounded-lg bg-background/75 p-4 leading-relaxed text-foreground">
          {record.summary}
        </div>
      ) : record.bucket === "pending" ? (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          O workflow recebeu o diagnóstico e ainda está processando.
        </div>
      ) : null}

      {record.evidenceGaps.length > 0 || record.citations.length > 0 ? (
        <div className="grid gap-3 md:grid-cols-2">
          <section className="rounded-lg border bg-background/60 p-3">
            <h3 className="mb-2 flex items-center gap-2 font-medium text-foreground">
              <BarChart3 className="size-3.5" />
              Gaps de evidência
            </h3>
            <div className="flex flex-wrap gap-1.5">
              {record.evidenceGaps.map((gap) => (
                <Badge key={gap} variant="outline">
                  {GAP_LABELS[gap] ?? gap}
                </Badge>
              ))}
            </div>
          </section>
          <section className="rounded-lg border bg-background/60 p-3">
            <h3 className="mb-2 font-medium text-foreground">Citações</h3>
            <ul className="space-y-1.5 text-muted-foreground">
              {record.citations.map((citation) => (
                <li key={citation} className="flex gap-2">
                  <span aria-hidden>↳</span>
                  <span>{citation}</span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      ) : null}

      {record.metricComparisons.length > 0 ? (
        <section>
          <h3 className="mb-2 font-medium text-foreground">
            Comparações métricas
          </h3>
          <div className="grid gap-2 lg:grid-cols-2">
            {record.metricComparisons.map((comparison) => (
              <MetricComparison
                key={`${comparison.window}-${comparison.metric}`}
                comparison={comparison}
              />
            ))}
          </div>
        </section>
      ) : null}

      {record.craftGaps.length > 0 ? (
        <section>
          <h3 className="mb-2 flex items-center gap-2 font-medium text-foreground">
            <Sparkles className="size-3.5" />
            Gaps de craft e sugestões
          </h3>
          <div className="grid gap-2 md:grid-cols-2">
            {record.craftGaps.map((gap, index) => (
              <div
                key={`${gap.dimension}-${index}`}
                className="rounded-lg border bg-background/60 p-3"
              >
                <Badge variant="secondary">{gap.dimension}</Badge>
                <p className="mt-2 text-foreground">{gap.finding}</p>
                <p className="mt-1 text-muted-foreground">
                  <span className="font-medium text-foreground">Sugestão:</span>{" "}
                  {gap.suggestion}
                </p>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {record.alternativeExplanations.length > 0 ? (
        <section className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3">
          <h3 className="mb-2 font-medium text-foreground">
            Explicações alternativas
          </h3>
          <ul className="list-disc space-y-1 pl-4 text-muted-foreground">
            {record.alternativeExplanations.map((explanation) => (
              <li key={explanation}>{explanation}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {record.errorMessage && record.errorMessage !== "forced_control" ? (
        <p className="rounded-md bg-background/70 p-3 font-mono text-[11px] text-muted-foreground">
          Motivo: {record.errorMessage}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-current/10 pt-3 text-[10px] text-muted-foreground">
        <span>campanha {record.campaignId ?? "—"}</span>
        <span>conjunto {record.adsetId ?? "—"}</span>
        <span>criativo {record.creativeId}</span>
        <span>
          janela {record.metricWindowStart} → {record.metricWindowEnd}
        </span>
        <span>rubric {record.rubricVersion}</span>
        <span>modelo {record.modelId}</span>
        <span>criado {formatDateTime(record.createdAt)}</span>
      </div>
    </div>
  );
}

function DiagnosisAccordion({
  record,
  open,
  onToggle,
}: {
  record: CreativeAnalysisView;
  open: boolean;
  onToggle: () => void;
}) {
  const meta = BUCKET_META[record.bucket];

  return (
    <Card className={cn("overflow-hidden border-l-4 ring-0 border", meta.className)}>
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="flex w-full items-start gap-3 px-4 py-3 text-left transition hover:bg-background/40"
      >
        {record.media.length > 0 ? (
          <DiagnosisThumbnail media={record.media} className="size-14" />
        ) : null}
        <div className="min-w-0 flex-1 space-y-1.5">
          <DiagnosisBadges record={record} />
          <p className="truncate font-medium text-foreground">
            Anúncio {record.adId}
            <span className="ml-2 font-mono text-[11px] font-normal text-muted-foreground">
              {record.accountId}
            </span>
          </p>
          <p className="truncate text-[11px] text-muted-foreground">
            {record.userName || "Usuário sem nome"} ·{" "}
            {record.userEmail || record.userId} · atualizado{" "}
            {formatDateTime(record.updatedAt)}
          </p>
          {!open && record.summary ? (
            <p className="line-clamp-2 text-sm leading-relaxed text-foreground/90">
              {record.summary}
            </p>
          ) : null}
        </div>
        <ChevronDown
          className={cn(
            "mt-1 size-4 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-180",
          )}
        />
      </button>
      {open ? (
        <CardContent className="border-t border-current/10 pt-4">
          <DiagnosisDetail record={record} />
        </CardContent>
      ) : null}
    </Card>
  );
}

function DiagnosisGridCard({
  record,
  onOpen,
}: {
  record: CreativeAnalysisView;
  onOpen: () => void;
}) {
  const meta = BUCKET_META[record.bucket];

  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "flex h-full flex-col overflow-hidden rounded-xl border border-l-4 p-4 text-left transition hover:bg-background/50 hover:shadow-sm",
        meta.className,
      )}
    >
      {record.media.length > 0 ? (
        <DiagnosisThumbnail
          media={record.media}
          className="-mx-4 -mt-4 mb-3 h-40 w-[calc(100%+2rem)] rounded-none"
        />
      ) : null}
      <DiagnosisBadges record={record} />
      <p className="mt-3 truncate font-medium">Anúncio {record.adId}</p>
      <p className="truncate font-mono text-[11px] text-muted-foreground">
        {record.accountId}
      </p>
      <p className="mt-1 truncate text-[11px] text-muted-foreground">
        {record.userName || "Usuário sem nome"}
      </p>
      <p className="mt-3 line-clamp-3 min-h-[4.5rem] flex-1 text-sm leading-relaxed">
        {record.summary ||
          (record.bucket === "pending"
            ? "Processando…"
            : "Sem resumo disponível.")}
      </p>
      <p className="mt-3 text-[10px] text-muted-foreground">
        {formatDateTime(record.updatedAt)} · abrir detalhe
      </p>
    </button>
  );
}

function SummaryCard({
  label,
  value,
  detail,
  icon: Icon,
  active,
  onClick,
}: {
  label: string;
  value: number;
  detail: string;
  icon: typeof CheckCircle2;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-xl border bg-card p-4 text-left transition hover:border-foreground/20 hover:shadow-sm",
        active && "border-primary ring-2 ring-primary/10",
      )}
    >
      <div className="flex items-start justify-between">
        <div>
          <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
            {label}
          </p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
        </div>
        <div className="rounded-lg bg-muted p-2">
          <Icon className="size-4" />
        </div>
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">{detail}</p>
    </button>
  );
}

export function CreativeAnalysisPlayground() {
  const [data, setData] = useState<ListResponse>({
    records: [],
    summary: EMPTY_SUMMARY,
  });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [requesting, setRequesting] = useState<"preview" | "run" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<RunFeedback | null>(null);
  const [scope, setScope] = useState<"eligible" | "ad">("eligible");
  const [limit, setLimit] = useState<CreativeAnalysisLimit>(3);
  const [adId, setAdId] = useState("");
  const [force, setForce] = useState(false);
  const [bucket, setBucket] = useState<CreativeAnalysisBucket | "all">("all");
  const [confidence, setConfidence] = useState("all");
  const [query, setQuery] = useState("");
  const [viewMode, setViewMode] = useState<"list" | "grid">("list");
  const [openIds, setOpenIds] = useState<string[]>([]);
  const [sheetId, setSheetId] = useState<string | null>(null);
  const [pollingDeadline, setPollingDeadline] = useState<number | null>(null);
  const zeroPendingPolls = useRef(0);

  const loadRecords = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    try {
      const response = await fetch(`${API_PATH}?limit=100`, {
        cache: "no-store",
      });
      const payload: unknown = await response.json();
      const record = asRecord(payload);
      if (!response.ok) {
        throw new Error(stringValue(record?.error) ?? "Falha ao carregar.");
      }
      setData(payload as ListResponse);
      setError(null);
      return payload as ListResponse;
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Não foi possível carregar os diagnósticos.",
      );
      return null;
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadRecords();
  }, [loadRecords]);

  useEffect(() => {
    if (pollingDeadline === null) return;
    const poll = async () => {
      const next = await loadRecords(true);
      if (!next) return;
      if (next.summary.pending > 0) zeroPendingPolls.current = 0;
      else zeroPendingPolls.current += 1;
      if (
        Date.now() >= pollingDeadline ||
        zeroPendingPolls.current >= 3
      ) {
        setPollingDeadline(null);
      }
    };
    const interval = window.setInterval(() => void poll(), 3_000);
    return () => window.clearInterval(interval);
  }, [loadRecords, pollingDeadline]);

  const submit = async (action: "preview" | "run") => {
    if (scope === "ad" && !adId.trim()) {
      setError("Informe o ID do anúncio.");
      return;
    }
    if (
      action === "run" &&
      ((scope === "eligible" && limit === "all") || force) &&
      !window.confirm(
        force
          ? "Executar como controle forçado? O gate pode ser contornado e o resultado continuará sem entrega."
          : "Executar todos os elegíveis disponíveis? O limite diário de segurança continuará valendo.",
      )
    ) {
      return;
    }

    setRequesting(action);
    setError(null);
    try {
      const response = await fetch(API_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          scope,
          limit: scope === "ad" ? 1 : limit,
          ...(scope === "ad" ? { adId: adId.trim(), force } : {}),
        }),
      });
      const payload: unknown = await response.json();
      const envelope = asRecord(payload);
      if (!response.ok) {
        throw new Error(
          stringValue(envelope?.error) ?? "A solicitação foi recusada.",
        );
      }
      setFeedback(parseFeedback(payload));
      if (action === "run") {
        zeroPendingPolls.current = 0;
        setPollingDeadline(Date.now() + 120_000);
        await loadRecords(true);
      }
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Não foi possível enviar a solicitação.",
      );
    } finally {
      setRequesting(null);
    }
  };

  const visibleRecords = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return data.records.filter((record) => {
      if (bucket !== "all" && record.bucket !== bucket) return false;
      if (confidence !== "all" && record.confidence !== confidence) {
        return false;
      }
      if (!normalizedQuery) return true;
      return [
        record.adId,
        record.accountId,
        record.userName,
        record.userEmail,
        record.userId,
        record.campaignId,
      ].some((value) => value?.toLowerCase().includes(normalizedQuery));
    });
  }, [bucket, confidence, data.records, query]);

  const sheetRecord = useMemo(
    () => data.records.find((record) => record.id === sheetId) ?? null,
    [data.records, sheetId],
  );

  const toggleOpen = (id: string) => {
    setOpenIds((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id],
    );
  };

  return (
    <main className="mx-auto flex w-full max-w-[1500px] flex-col gap-6">
      <div className="relative overflow-hidden rounded-2xl border bg-gradient-to-br from-violet-500/10 via-background to-blue-500/10 p-6 md:p-8">
        <div className="absolute -right-12 -top-16 size-56 rounded-full bg-violet-500/10 blur-3xl" />
        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-3xl">
            <Badge variant="outline" className="mb-3 bg-background/70">
              <Bot className="size-3" />
              laboratório interno
            </Badge>
            <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">
              Playground de análise criativa
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              Inspecione o gate, execute diagnósticos controlados e compare o
              parecer visual com os sinais de performance da própria conta.
            </p>
          </div>
          <Button
            variant="outline"
            onClick={() => void loadRecords(true)}
            disabled={refreshing}
          >
            <RefreshCw className={cn(refreshing && "animate-spin")} />
            Atualizar
          </Button>
        </div>
      </div>

      <Alert className="border-amber-500/35 bg-amber-500/5">
        <ShieldCheck className="size-4 text-amber-700 dark:text-amber-300" />
        <AlertTitle>Entrega permanece desligada</AlertTitle>
        <AlertDescription>
          Este backoffice não grava diagnósticos diretamente. Toda execução
          passa pelo endpoint interno do frontend; em produção, ela permanece
          bloqueada por esse endpoint e por sua feature flag. Nenhum insight é
          entregue ao cliente por esta tela.
        </AlertDescription>
      </Alert>

      <Card className="ring-0 border">
        <CardHeader className="border-b">
          <CardTitle>Nova investigação</CardTitle>
          <CardDescription>
            Preview não cria workflow. Executar delega o processamento ao
            frontend, que mantém gates, orçamento diário e persistência.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5 lg:grid-cols-[1.2fr_0.8fr_auto]">
          <div className="space-y-3">
            <Label>Escopo</Label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                className={cn(
                  "rounded-lg border p-3 text-left transition",
                  scope === "eligible"
                    ? "border-primary bg-primary/5"
                    : "hover:bg-muted/50",
                )}
                onClick={() => {
                  setScope("eligible");
                  setForce(false);
                }}
              >
                <span className="font-medium">Lote elegível</span>
                <span className="mt-1 block text-[11px] text-muted-foreground">
                  Usa o gate e a allowlist atuais
                </span>
              </button>
              <button
                type="button"
                className={cn(
                  "rounded-lg border p-3 text-left transition",
                  scope === "ad"
                    ? "border-primary bg-primary/5"
                    : "hover:bg-muted/50",
                )}
                onClick={() => setScope("ad")}
              >
                <span className="font-medium">Anúncio específico</span>
                <span className="mt-1 block text-[11px] text-muted-foreground">
                  Investiga um ad ID rastreado
                </span>
              </button>
            </div>
            {scope === "ad" ? (
              <div className="space-y-1.5">
                <Label htmlFor="creative-analysis-ad-id">ID do anúncio</Label>
                <Input
                  id="creative-analysis-ad-id"
                  value={adId}
                  onChange={(event) => setAdId(event.target.value)}
                  placeholder="Ex.: 120210987654321"
                  className="h-9 font-mono"
                />
              </div>
            ) : null}
          </div>

          <div className="space-y-4">
            {scope === "eligible" ? (
              <div className="space-y-1.5">
                <Label>Limite do lote</Label>
                <Select
                  value={String(limit)}
                  onValueChange={(value) =>
                    setLimit(
                      value === "all"
                        ? "all"
                        : (Number(value) as CreativeAnalysisLimit),
                    )
                  }
                >
                  <SelectTrigger className="h-9 w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">1 diagnóstico</SelectItem>
                    <SelectItem value="3">3 diagnósticos</SelectItem>
                    <SelectItem value="5">5 diagnósticos</SelectItem>
                    <SelectItem value="all">
                      Todos — respeita o limite diário
                    </SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground">
                  “Todos” nunca ultrapassa o cap diário do frontend.
                </p>
              </div>
            ) : (
              <div className="flex items-center justify-between rounded-lg border p-3">
                <div>
                  <Label htmlFor="creative-analysis-force">
                    Controle forçado
                  </Label>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Só contorna gates de vencedor ou boa performance.
                  </p>
                </div>
                <Switch
                  id="creative-analysis-force"
                  checked={force}
                  onCheckedChange={setForce}
                />
              </div>
            )}
          </div>

          <div className="flex min-w-44 flex-col justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => void submit("preview")}
              disabled={requesting !== null}
            >
              {requesting === "preview" ? (
                <Loader2 className="animate-spin" />
              ) : (
                <Search />
              )}
              Dry-run preview
            </Button>
            <Button
              onClick={() => void submit("run")}
              disabled={requesting !== null}
            >
              {requesting === "run" ? (
                <Loader2 className="animate-spin" />
              ) : (
                <Play />
              )}
              Executar análise
            </Button>
          </div>
        </CardContent>
      </Card>

      {error ? (
        <Alert variant="destructive">
          <XCircle className="size-4" />
          <AlertTitle>Não foi possível concluir</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {feedback ? (
        <Alert className="border-blue-500/30 bg-blue-500/5">
          <FlaskConical className="size-4 text-blue-700 dark:text-blue-300" />
          <AlertTitle>
            {feedback.action === "preview"
              ? "Preview concluído"
              : "Execução enviada"}
          </AlertTitle>
          <AlertDescription>
            <span className="block">
              {feedback.jobs.length} anúncio(s) selecionado(s)
              {feedback.runIds.length > 0
                ? ` · ${feedback.runIds.length} workflow(s) iniciado(s)`
                : ""}
              {feedback.skipped ? ` · ${feedback.skipped}` : ""}
            </span>
            {feedback.decision ? (
              <span className="mt-1 block">
                Gate: {feedback.decision.kind ?? "—"}
                {feedback.decision.reason
                  ? ` (${feedback.decision.reason})`
                  : ""}
                {feedback.decision.forceWouldBypass
                  ? " · force contornaria este gate"
                  : ""}
              </span>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
        <SummaryCard
          label="Recentes"
          value={data.summary.total}
          detail="até 100 registros"
          icon={BarChart3}
          active={bucket === "all"}
          onClick={() => setBucket("all")}
        />
        <SummaryCard
          label="Positivos"
          value={data.summary.positive}
          detail="peça é hipótese"
          icon={AlertTriangle}
          active={bucket === "positive"}
          onClick={() => setBucket("positive")}
        />
        <SummaryCard
          label="Negativos"
          value={data.summary.negative}
          detail="buscar outra causa"
          icon={CheckCircle2}
          active={bucket === "negative"}
          onClick={() => setBucket("negative")}
        />
        <SummaryCard
          label="Pendentes"
          value={data.summary.pending}
          detail="autoatualização ativa"
          icon={Clock3}
          active={bucket === "pending"}
          onClick={() => setBucket("pending")}
        />
        <SummaryCard
          label="Ignorados"
          value={data.summary.skipped}
          detail="gate ou amostra"
          icon={CircleSlash2}
          active={bucket === "skipped"}
          onClick={() => setBucket("skipped")}
        />
        <SummaryCard
          label="Controles"
          value={data.summary.control}
          detail="execução forçada"
          icon={FlaskConical}
          active={bucket === "control"}
          onClick={() => setBucket("control")}
        />
        <SummaryCard
          label="Falhas"
          value={data.summary.failed}
          detail="requer inspeção"
          icon={XCircle}
          active={bucket === "failed"}
          onClick={() => setBucket("failed")}
        />
      </section>

      <div className="flex flex-col gap-3 rounded-xl border bg-card p-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Buscar por anúncio, conta, campanha, usuário ou email"
              className="h-8 pl-8"
            />
          </div>
          <Select value={confidence} onValueChange={setConfidence}>
            <SelectTrigger className="h-8 w-full sm:w-44">
              <SelectValue placeholder="Confiança" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Toda confiança</SelectItem>
              <SelectItem value="high">Alta</SelectItem>
              <SelectItem value="medium">Média</SelectItem>
              <SelectItem value="low">Baixa</SelectItem>
            </SelectContent>
          </Select>
          <div className="flex items-center gap-2 px-2 text-[11px] text-muted-foreground">
            {pollingDeadline !== null ? (
              <>
                <Loader2 className="size-3.5 animate-spin" />
                acompanhando workflows
              </>
            ) : (
              `${visibleRecords.length} resultado(s)`
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg border p-0.5">
            <Button
              type="button"
              size="sm"
              variant={viewMode === "list" ? "secondary" : "ghost"}
              className="h-7"
              onClick={() => setViewMode("list")}
            >
              <List />
              Lista
            </Button>
            <Button
              type="button"
              size="sm"
              variant={viewMode === "grid" ? "secondary" : "ghost"}
              className="h-7"
              onClick={() => setViewMode("grid")}
            >
              <LayoutGrid />
              Grade
            </Button>
          </div>
          {viewMode === "list" ? (
            <>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7"
                disabled={visibleRecords.length === 0}
                onClick={() =>
                  setOpenIds(visibleRecords.map((record) => record.id))
                }
              >
                <ChevronsUpDown />
                Abrir todos
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7"
                disabled={openIds.length === 0}
                onClick={() => setOpenIds([])}
              >
                <ChevronsDownUp />
                Fechar todos
              </Button>
            </>
          ) : (
            <p className="text-[11px] text-muted-foreground">
              Clique no card para abrir o diagnóstico completo.
            </p>
          )}
        </div>
      </div>

      <section
        className={cn(
          viewMode === "grid"
            ? "grid gap-3 sm:grid-cols-2 xl:grid-cols-3"
            : "space-y-2",
        )}
      >
        {loading ? (
          <Card className="col-span-full items-center py-14">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Carregando diagnósticos…
            </p>
          </Card>
        ) : visibleRecords.length === 0 ? (
          <Card className="col-span-full items-center py-14 text-center">
            <CircleSlash2 className="size-7 text-muted-foreground" />
            <div>
              <p className="font-medium">Nenhum diagnóstico neste recorte</p>
              <p className="mt-1 text-muted-foreground">
                Ajuste os filtros ou rode um preview para investigar elegíveis.
              </p>
            </div>
          </Card>
        ) : viewMode === "grid" ? (
          visibleRecords.map((record) => (
            <DiagnosisGridCard
              key={record.id}
              record={record}
              onOpen={() => setSheetId(record.id)}
            />
          ))
        ) : (
          visibleRecords.map((record) => (
            <DiagnosisAccordion
              key={record.id}
              record={record}
              open={openIds.includes(record.id)}
              onToggle={() => toggleOpen(record.id)}
            />
          ))
        )}
      </section>

      <Sheet
        open={sheetRecord !== null}
        onOpenChange={(open) => {
          if (!open) setSheetId(null);
        }}
      >
        <SheetContent
          side="right"
          className="w-full overflow-y-auto sm:max-w-2xl"
        >
          {sheetRecord ? (
            <>
              <SheetHeader className="pr-8 text-left">
                <SheetTitle>Anúncio {sheetRecord.adId}</SheetTitle>
                <SheetDescription>
                  {sheetRecord.userName || "Usuário sem nome"} · conta{" "}
                  {sheetRecord.accountId}
                </SheetDescription>
              </SheetHeader>
              <div className="mt-4">
                <DiagnosisBadges record={sheetRecord} />
                <div className="mt-4">
                  <DiagnosisDetail record={sheetRecord} />
                </div>
              </div>
            </>
          ) : null}
        </SheetContent>
      </Sheet>
    </main>
  );
}
