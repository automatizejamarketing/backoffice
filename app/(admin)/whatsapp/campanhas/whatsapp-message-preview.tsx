import type { CampaignButton, CampaignHeaderMedia } from "@/lib/backoffice/whatsapp-campaign-core";
import { ArrowLeft, MoreVertical, ExternalLink } from "lucide-react";

/** Visual approximation of the message received by a customer, not a live chat. */
export function WhatsappMessagePreview({ body, button = null, headerMedia = null }: { body: string; button?: CampaignButton | null; headerMedia?: CampaignHeaderMedia | null }) {
  const message = body.replaceAll("{{1}}", "João");

  return (
    <figure className="mx-auto w-full max-w-sm space-y-3">
      <div className="overflow-hidden rounded-xl border border-black/10 bg-[#efeae2] text-[#111b21]">
        <div className="flex items-center gap-3 bg-[#075e54] px-3 py-3 text-white">
          <ArrowLeft aria-hidden="true" className="size-4 shrink-0" />
          <span aria-hidden="true" className="flex size-9 shrink-0 items-center justify-center rounded-full bg-white/15 text-sm font-semibold">A</span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">AutomatizeJá — Contato</p>
            <p className="text-xs text-white/80">Conta comercial</p>
          </div>
          <MoreVertical aria-hidden="true" className="size-4" />
        </div>
        <div className="p-4">
          <div className="mb-4 text-center"><span className="rounded-md bg-white/80 px-3 py-1 text-[11px] text-[#54656f]">Hoje</span></div>
          <div className="relative mr-3 rounded-lg rounded-tl-none bg-white px-3 pb-2 pt-3 shadow-sm">
            <span aria-hidden="true" className="absolute -left-2 top-0 size-0 border-r-8 border-t-8 border-r-white border-t-transparent" />
            {headerMedia?.type === "video" && <video className="-mx-2 -mt-2 mb-2 max-h-96 w-[calc(100%+1rem)] max-w-none rounded-md bg-black object-contain" src={headerMedia.url} controls preload="metadata" playsInline />}
            {/* eslint-disable-next-line @next/next/no-img-element -- remote campaign media, shown as received */}
            {headerMedia?.type === "image" && <img className="-mx-2 -mt-2 mb-2 max-h-96 w-[calc(100%+1rem)] max-w-none rounded-md object-cover" src={headerMedia.url} alt="" />}
            <div className="whitespace-pre-wrap text-[14px] leading-[1.45] [overflow-wrap:anywhere]">
              {message ? message.split(/(https?:\/\/[^\s]+)/g).map((part, index) =>
                /^https?:\/\//.test(part)
                  ? <span key={index} className="text-[#027eb5]">{part}</span>
                  : <span key={index}>{part}</span>,
              ) : <span className="text-[#667781]">Sua mensagem aparecerá aqui.</span>}
            </div>
            <p aria-hidden="true" className="mt-1 text-right text-[10px] text-[#667781]">10:00</p>
            {button && <div className="-mx-3 mt-2 flex items-center justify-center gap-2 border-t border-black/10 px-3 py-3 text-sm text-[#027eb5]"><ExternalLink aria-hidden="true" className="size-4"/>{button.text}</div>}
          </div>
        </div>
      </div>
      <figcaption className="text-xs leading-relaxed text-muted-foreground">
        Prévia aproximada no WhatsApp. A aparência pode variar conforme o celular.
        {body.includes("{{1}}") && " João é um nome de exemplo; cada contato recebe seu primeiro nome."}
      </figcaption>
    </figure>
  );
}
