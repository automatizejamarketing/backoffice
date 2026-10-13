import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { requirePagePermission } from "@/lib/auth/rbac";
import {
  DEFAULT_VIEW,
  TRAFEGO_VIEWS,
  VIEW_COOKIE,
  isTrafegoView,
} from "@/components/consultant-workspace/common/routes";

export const dynamic = "force-dynamic";

/** /trafego abre a visão que o consultor escolheu como padrão (Jornada se ainda não escolheu). */
export default async function TrafegoPage() {
  const [, cookieStore] = await Promise.all([requirePagePermission("marketing:read"), cookies()]);
  const saved = cookieStore.get(VIEW_COOKIE)?.value;
  const view = isTrafegoView(saved) ? saved : DEFAULT_VIEW;
  redirect(TRAFEGO_VIEWS.find((entry) => entry.key === view)?.href ?? "/trafego/jornada");
}
