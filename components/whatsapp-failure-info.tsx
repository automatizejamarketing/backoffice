"use client";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export function WhatsappFailureInfo({
  failureCode,
  failureDetail,
}: {
  failureCode: string | null;
  failureDetail: string | null;
}) {
  const message = [failureCode, failureDetail].filter(Boolean).join(" · ");

  if (!message) {
    return <span className="text-muted-foreground">—</span>;
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <p
          tabIndex={0}
          className="line-clamp-2 cursor-help rounded-sm text-xs text-destructive outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          {message}
        </p>
      </TooltipTrigger>
      <TooltipContent
        side="top"
        align="end"
        className="max-w-md break-words text-left text-xs leading-relaxed"
      >
        {message}
      </TooltipContent>
    </Tooltip>
  );
}
