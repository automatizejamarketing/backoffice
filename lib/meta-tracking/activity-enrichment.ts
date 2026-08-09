/**
 * O audit trail da Meta (`GET /act_{id}/activities`) virando enriquecimento das
 * ações do stream (§4.4 e §5.5 do plano
 * `docs/plans/campaign-tracking-foundation.md`).
 *
 * Tudo aqui é decisão pura. Quem fala com a Graph API é
 * `graph-collector-gateway.ts`, quem fala com o Postgres é
 * `lib/db/meta-tracking-activity-queries.ts`, e quem coordena os dois é
 * `collect-activity-events.ts` — nenhum dos três decide nada.
 *
 * ## Enriquecimento, nunca fonte
 *
 * A Meta **não documenta** o formato de `extra_data` nem a retenção deste
 * endpoint (a consulta padrão devolve 7 dias). Por isso a fonte de verdade das
 * ações é o diff do coletor, e o audit trail só acrescenta o que o diff não tem:
 * **quem** mexeu e a **hora exata**. Se o endpoint mudar, degradar ou sumir, o
 * stream continua completo — só fica anônimo, com o horário da detecção.
 *
 * Consequência de projeto: nada aqui pode inventar. Quando o audit trail não
 * permite dizer quem foi, a ação fica sem autor em vez de receber um palpite —
 * um autor errado no histórico é pior do que nenhum, porque ninguém tem como
 * saber que ele está errado depois.
 *
 * ## As três decisões deste arquivo
 *
 * 1. **O que identifica um evento cru** (`activityDedupHash`) — o evento não tem
 *    id próprio documentado, e o poll se sobrepõe de propósito em 48 h.
 * 2. **O que é uma linha** (`toActivityEventRows`) — inclusive os eventos que
 *    não têm nada a ver com ações (cobrança, públicos, papéis da conta), que
 *    ficam guardados crus como matéria-prima futura.
 * 3. **Qual evento explica qual ação** (`matchActivitiesToChanges`) — mesma
 *    entidade, mesma natureza, dentro da janela, e sem ambiguidade de autor.
 */

import { createHash } from "node:crypto";

import type {
  MetaTrackingChangeKind,
  MetaTrackingEntityLevel,
} from "@/lib/db/schema";

/**
 * A sobreposição deliberada do poll diário: cada execução pede as últimas 48 h,
 * não as últimas 24 h.
 *
 * O dobro da periodicidade é o que faz um dia de falha se resolver sozinho — a
 * execução seguinte alcança o que a anterior perdeu — e o que torna a
 * deduplicação obrigatória em vez de opcional: no regime normal, metade dos
 * eventos de cada resposta já está gravada.
 *
 * A mesma constante é a janela do matcher, e isso não é coincidência: o matcher
 * não pode alcançar um evento que o poll não trouxe.
 */
export const ACTIVITY_POLL_OVERLAP_MS = 48 * 60 * 60 * 1000;

/** Uma linha do `/activities` como a Meta a entrega: tudo opaco. */
export type RawActivity = Record<string, unknown>;

/** Uma linha de `meta_tracking_activity_events` pronta para upsert. */
export type ActivityEventRow = {
  userId: string;
  accountId: string;
  eventType: string;
  translatedEventType: string | null;
  eventTime: Date;
  actorId: string | null;
  actorName: string | null;
  applicationId: string | null;
  objectId: string | null;
  objectType: string | null;
  objectName: string | null;
  /** Opaco de propósito: não documentado, pode sumir ou mudar sem aviso. */
  extraData: unknown;
  dedupHash: string;
};

/** Separador que não aparece em nenhum campo da Meta. */
const HASH_FIELD_SEPARATOR = "\u0000";

/**
 * A identidade de um evento cru: sha256 de `(account_id, event_type,
 * event_time, object_id, actor_id)`, nessa ordem — o contrato do schema.
 *
 * É hash, e não unique composto no banco, porque `object_id` e `actor_id` vêm
 * nulos em parte dos eventos e no Postgres NULL nunca colide com NULL: o
 * composto deixaria passar duplicata justo na sobreposição de 48 h, que é o
 * único lugar onde a duplicata acontece.
 *
 * O separador existe pelo mesmo motivo que o hash existe: concatenar sem ele
 * faria `(objeto "12", ator "3")` e `(objeto "1", ator "23")` colidirem, e dois
 * eventos distintos viram um só sem ninguém perceber.
 */
export function activityDedupHash(parts: {
  accountId: string;
  eventType: string;
  eventTime: Date;
  objectId: string | null;
  actorId: string | null;
}): string {
  const material = [
    parts.accountId,
    parts.eventType,
    parts.eventTime.toISOString(),
    parts.objectId ?? "",
    parts.actorId ?? "",
  ].join(HASH_FIELD_SEPARATOR);

  return createHash("sha256").update(material).digest("hex");
}

function text(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const raw = typeof value === "string" ? value.trim() : String(value);
  return raw.length > 0 ? raw : null;
}

/** `YYYY-MM-DD HH:MM:SS` — a forma sem fuso que o endpoint às vezes devolve. */
const NAIVE_DATE_TIME = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

/**
 * O instante do evento. Determinístico por obrigação: o `dedup_hash` depende
 * desta leitura, então duas execuções que vissem o mesmo evento de formas
 * diferentes gravariam duas linhas — exatamente o que o poll sobreposto tenta
 * evitar.
 *
 * A forma sem fuso é lida como UTC de propósito. `new Date("2026-08-08
 * 14:33:21")` seria interpretado no fuso da MÁQUINA, e o hash de um evento
 * passaria a depender de onde o coletor está rodando.
 */
function eventTimeOf(value: unknown): Date | null {
  const raw = text(value);
  if (raw === null) return null;

  const normalized = NAIVE_DATE_TIME.test(raw)
    ? `${raw.replace(" ", "T")}Z`
    : raw;
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * `extra_data` como ele vem — e ele vem de formas diferentes.
 *
 * Na prática a Meta o devolve como uma STRING contendo JSON, não como objeto.
 * Guardar a string crua num `jsonb` funcionaria (jsonb aceita escalar), mas
 * enterraria o conteúdo atrás de um `::json` na hora de consultar. Então: tenta
 * abrir; se não for JSON válido, guarda o texto como veio. Nada aqui interpreta
 * o conteúdo — o campo não é documentado e nenhuma lógica depende dele.
 */
function opaqueJson(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return value;

  const raw = value.trim();
  if (raw.length === 0) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

export type ToActivityEventRowsInput = {
  userId: string;
  accountId: string;
  rows: readonly RawActivity[];
};

/**
 * A resposta do `/activities` vira linhas da tabela crua — TODAS elas,
 * inclusive as que não têm relação com ação nenhuma (cobrança, públicos,
 * papéis da conta). Elas são o §4.4 do plano: matéria-prima de propósitos que
 * ainda não existem, e que não teriam como voltar atrás para buscá-la.
 *
 * Descarta só o que não dá para gravar sem inventar (sem tipo de evento, sem
 * instante utilizável) e colapsa repetições da mesma chave de dedup: um
 * `INSERT … ON CONFLICT DO UPDATE` com a mesma chave duas vezes no mesmo
 * comando é erro do Postgres, não upsert.
 */
export function toActivityEventRows(
  input: ToActivityEventRowsInput,
): ActivityEventRow[] {
  const byDedupHash = new Map<string, ActivityEventRow>();

  for (const raw of input.rows) {
    const eventType = text(raw["event_type"]);
    const eventTime = eventTimeOf(raw["event_time"]);
    if (eventType === null || eventTime === null) continue;

    const objectId = text(raw["object_id"]);
    const actorId = text(raw["actor_id"]);
    const dedupHash = activityDedupHash({
      accountId: input.accountId,
      eventType,
      eventTime,
      objectId,
      actorId,
    });

    byDedupHash.set(dedupHash, {
      userId: input.userId,
      accountId: input.accountId,
      eventType,
      translatedEventType: text(raw["translated_event_type"]),
      eventTime,
      actorId,
      actorName: text(raw["actor_name"]),
      applicationId: text(raw["application_id"]),
      objectId,
      objectType: text(raw["object_type"]),
      objectName: text(raw["object_name"]),
      extraData: opaqueJson(raw["extra_data"]),
      dedupHash,
    });
  }

  return [...byDedupHash.values()];
}

/**
 * A natureza da mudança, do lado do audit trail e do lado do stream. Existe
 * para que a pausa de uma campanha não seja atribuída a quem mexeu no orçamento
 * dela no mesmo dia: os dois fatos aparecem como eventos distintos nos dois
 * lados, e cruzá-los produziria autor errado com aparência de certo.
 */
type ChangeNature = "creation" | "status" | "config";

/**
 * O nome do evento diz a natureza dele. Os três níveis usam o mesmo sufixo para
 * ciclo de vida (`update_campaign_run_status`, `update_ad_set_run_status`,
 * `update_ad_run_status`) e o mesmo prefixo para criação (`create_…`).
 *
 * `event_type` é campo documentado do endpoint — ao contrário de `extra_data`,
 * pode ser lido. Ainda assim, o desconhecido cai em `config`: é a natureza mais
 * comum e a única que não afirma nada sobre ciclo de vida.
 */
function activityNature(eventType: string): ChangeNature {
  const name = eventType.toLowerCase();
  if (name.includes("run_status")) return "status";
  if (name.startsWith("create_")) return "creation";
  return "config";
}

function changeNature(changeKind: MetaTrackingChangeKind): ChangeNature {
  if (changeKind === "created") return "creation";
  if (changeKind === "config_change") return "config";
  // `status_transition`, `archived` e `deleted_detected` são o mesmo fato para
  // a Meta: o estado de execução da entidade mudou.
  return "status";
}

/**
 * Uma ação do stream esperando autor e horário exato — tipicamente um
 * `external_detected` que o diff acabou de escrever.
 */
export type EnrichableChange = {
  changeEventId: string;
  entityLevel: MetaTrackingEntityLevel;
  entityId: string;
  changeKind: MetaTrackingChangeKind;
  /** Quando o coletor VIU a mudança; a ação em si aconteceu antes disso. */
  detectedAt: Date;
};

/**
 * "Este evento cru explica esta ação." O executor troca o `dedupHash` pelo uuid
 * da linha gravada e escreve os dois lados da ponte.
 */
export type ActivityMatch = {
  changeEventId: string;
  dedupHash: string;
  /** Nome que a Meta atribuiu a quem agiu; nulo quando ela não informa. */
  actorName: string | null;
  /** O horário EXATO da ação, que substitui o horário da detecção. */
  occurredAt: Date;
};

export type MatchActivitiesInput = {
  activities: readonly ActivityEventRow[];
  /** Ações pendentes, da mais recente para a mais antiga. */
  changes: readonly EnrichableChange[];
};

/** Quem agiu, para efeito de ambiguidade. */
function actorIdentity(activity: ActivityEventRow): string {
  return `${activity.actorId ?? ""}|${activity.actorName ?? ""}`;
}

/**
 * Liga eventos crus às ações que o diff detectou.
 *
 * Um candidato precisa ser, ao mesmo tempo: **da mesma entidade** (`object_id`),
 * **da mesma natureza** (ciclo de vida × configuração × criação) e **anterior à
 * detecção**, dentro da janela. Entre os candidatos vale o mais recente — é ele
 * que produziu o estado que a coleta observou.
 *
 * Duas regras de honestidade:
 *
 * - **Atores diferentes ⇒ nenhum match.** Se duas pessoas mexeram na mesma
 *   entidade da mesma forma dentro da janela, o audit trail não diz qual delas
 *   produziu o que se observou. A ação fica sem autor, e os dois eventos crus
 *   ficam guardados para quem quiser olhar.
 * - **Cada evento cru explica uma ação só.** Consumido por uma, não é oferecido
 *   à seguinte — senão uma edição isolada viraria a explicação de tudo o que se
 *   parecesse com ela.
 *
 * Ações sem candidato simplesmente não aparecem no resultado: elas permanecem no
 * stream com o horário da detecção e sem autor, que é o comportamento normal
 * quando o audit trail não alcança o fato (retenção não documentada).
 */
export function matchActivitiesToChanges(
  input: MatchActivitiesInput,
): ActivityMatch[] {
  const consumed = new Set<string>();
  const matches: ActivityMatch[] = [];

  for (const change of input.changes) {
    const detectedAt = change.detectedAt.getTime();
    const nature = changeNature(change.changeKind);

    const candidates = input.activities
      .filter(
        (activity) =>
          !consumed.has(activity.dedupHash) &&
          activity.objectId === change.entityId &&
          activityNature(activity.eventType) === nature &&
          activity.eventTime.getTime() <= detectedAt &&
          activity.eventTime.getTime() >= detectedAt - ACTIVITY_POLL_OVERLAP_MS,
      )
      .sort((a, b) => b.eventTime.getTime() - a.eventTime.getTime());

    if (candidates.length === 0) continue;

    const actors = new Set(candidates.map(actorIdentity));
    if (actors.size > 1) continue;

    const [winner] = candidates;
    consumed.add(winner.dedupHash);
    matches.push({
      changeEventId: change.changeEventId,
      dedupHash: winner.dedupHash,
      actorName: winner.actorName,
      occurredAt: winner.eventTime,
    });
  }

  return matches;
}
