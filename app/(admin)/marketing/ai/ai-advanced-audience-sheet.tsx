"use client";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { AudienceExclusionIds } from "@/lib/meta-business/marketing/ai-creation/audience-exclusions";
import type { AudienceInclusionIds } from "@/lib/meta-business/marketing/ai-creation/audience-inclusions";
import type { DemographicLimits } from "@/lib/meta-business/marketing/ai-creation/demographic-limits";
import { AudienceLibraryManager } from "../audiences/audience-library-manager";
import { AiAudienceExclusionsEditor } from "./ai-audience-exclusions-editor";
import { AiAudienceInclusionsEditor } from "./ai-audience-inclusions-editor";
import { AiDemographicLimitsEditor } from "./ai-demographic-limits-editor";

/**
 * The review's "Configurações avançadas de público": the same three editors the review used to
 * stack inline, plus the account library, each on its own tab. The editors keep their own
 * apply/cancel semantics — this sheet only hosts them.
 */
export function AiAdvancedAudienceSheet({
  open,
  onOpenChange,
  accountId,
  userId,
  demographics,
  onDemographicsChange,
  includedCustomAudienceIds,
  onInclusionsChange,
  excludedCustomAudienceIds,
  onExclusionsChange,
  disabled,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accountId: string;
  userId: string;
  demographics: DemographicLimits | undefined;
  onDemographicsChange: (value: DemographicLimits | undefined) => void;
  includedCustomAudienceIds: AudienceInclusionIds | undefined;
  onInclusionsChange: (value: AudienceInclusionIds | undefined) => void;
  excludedCustomAudienceIds: AudienceExclusionIds | undefined;
  onExclusionsChange: (value: AudienceExclusionIds | undefined) => void;
  disabled?: boolean;
}) {
  return (
    <Sheet modal={false} open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="z-[110] flex h-full w-full flex-col overflow-hidden sm:max-w-lg md:max-w-xl lg:max-w-2xl xl:max-w-3xl"
        onFocusOutside={(event) => event.preventDefault()}
      >
        <SheetHeader className="shrink-0 pr-8">
          <SheetTitle className="text-lg font-semibold">
            Configurações avançadas de público
          </SheetTitle>
          <SheetDescription className="text-left">
            Aplique as escolhas de segmentação antes de trocar de aba. A biblioteca não altera a
            campanha.
          </SheetDescription>
        </SheetHeader>

        {open ? (
          <Tabs defaultValue="demographics" className="mt-5 flex min-h-0 flex-1 flex-col">
            <TabsList className="grid h-auto w-full shrink-0 grid-cols-2 gap-1 p-1 sm:grid-cols-4">
              <TabsTrigger className="min-h-9 whitespace-normal px-2 text-xs" value="demographics">
                Idade e gênero
              </TabsTrigger>
              <TabsTrigger className="min-h-9 px-2 text-xs" value="inclusions">
                Inclusões
              </TabsTrigger>
              <TabsTrigger className="min-h-9 px-2 text-xs" value="exclusions">
                Exclusões
              </TabsTrigger>
              <TabsTrigger className="min-h-9 px-2 text-xs" value="library">
                Públicos da conta
              </TabsTrigger>
            </TabsList>

            <div className="min-h-0 flex-1 overflow-y-auto pb-4 pr-1">
              <TabsContent value="demographics" className="mt-4">
                <AiDemographicLimitsEditor
                  value={demographics}
                  onChange={onDemographicsChange}
                  disabled={disabled}
                />
              </TabsContent>
              <TabsContent value="inclusions" className="mt-4">
                <AiAudienceInclusionsEditor
                  accountId={accountId}
                  userId={userId}
                  value={includedCustomAudienceIds}
                  onChange={onInclusionsChange}
                  disabled={disabled}
                />
              </TabsContent>
              <TabsContent value="exclusions" className="mt-4">
                <AiAudienceExclusionsEditor
                  accountId={accountId}
                  userId={userId}
                  value={excludedCustomAudienceIds}
                  onChange={onExclusionsChange}
                  disabled={disabled}
                />
              </TabsContent>
              <TabsContent value="library" className="mt-4 space-y-4">
                <p className="text-sm leading-relaxed text-muted-foreground">
                  Consulte ou gerencie os públicos da conta. Isso não seleciona nenhum público para
                  esta campanha.
                </p>
                <AudienceLibraryManager
                  key={`${userId}:${accountId}`}
                  accountId={accountId}
                  userId={userId}
                />
              </TabsContent>
            </div>
          </Tabs>
        ) : null}

        <div className="shrink-0 border-t pt-4">
          <Button
            type="button"
            variant="outline"
            className="h-10 w-full"
            onClick={() => onOpenChange(false)}
          >
            Voltar à revisão
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
