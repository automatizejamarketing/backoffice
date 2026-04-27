"use client";

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  getDeliveryDotColor,
  getDeliveryStatus,
  type DeliveryStatus as DeliveryStatusKey,
} from "../utils/formatters";

type DeliveryStatusProps = {
  status: string | null | undefined;
  size?: "sm" | "xs";
  className?: string;
};

const labelByStatus: Record<DeliveryStatusKey, string> = {
  active: "Ativo",
  pending: "Pendente",
  inactive: "Inativo",
};

export function DeliveryStatus({
  status,
  size = "sm",
  className,
}: DeliveryStatusProps) {
  const deliveryStatus = getDeliveryStatus(status);

  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={cn(
              "inline-flex items-center gap-2 whitespace-nowrap text-muted-foreground",
              size === "xs" ? "text-[10px]" : "text-xs",
              className
            )}
          >
            <span
              className={cn(
                "rounded-full shrink-0",
                size === "xs" ? "size-1.5" : "size-2",
                getDeliveryDotColor(deliveryStatus)
              )}
            />
            <span className="font-medium text-foreground">
              {labelByStatus[deliveryStatus]}
            </span>
          </span>
        </TooltipTrigger>
        <TooltipContent className="max-w-[320px] space-y-3 p-3 text-left">
          <div className="space-y-1">
            <p className="font-semibold text-foreground">Veiculação</p>
            <p className="text-xs leading-relaxed text-muted-foreground">
              O status atual da veiculação da sua campanha, conjunto de anúncios
              ou anúncio. Agora você pode ver os status Ativo, Pendente ou
              Inativo.
            </p>
          </div>
          <div className="space-y-1">
            <p className="text-xs font-semibold text-foreground">
              Como essa métrica é usada
            </p>
            <p className="text-xs leading-relaxed text-muted-foreground">
              O status de veiculação pode ajudar você a entender se a sua
              campanha de anúncios está sendo veiculada normalmente ou se há
              algum problema que requer sua atenção. Campanhas, conjuntos de
              anúncios e anúncios podem ter diferentes status de veiculação.
              Você pode passar o ponteiro do mouse sobre os ícones de status de
              veiculação no Gerenciador de Anúncios para ver mais informações
              sobre seu anúncio em todos os níveis e saber se há alguma ação a
              realizar.
            </p>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
