"use client";

import { useState } from "react";

export function ExpertAvatar({
  name,
  src,
  size = "sm",
}: {
  name: string;
  src: string | null;
  size?: "xs" | "sm" | "lg";
}) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const sizeClass =
    size === "lg"
      ? "size-20 text-xl"
      : size === "xs"
        ? "size-8 text-xs"
        : "size-10 text-sm";
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
  const imageSrc = src && failedSrc !== src ? src : null;

  return (
    <div
      className={`${sizeClass} shrink-0 overflow-hidden rounded-full border bg-muted`}
      aria-label={imageSrc ? undefined : `Sem foto para ${name}`}
    >
      {imageSrc ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={imageSrc}
          alt={`Foto de ${name}`}
          className="size-full object-cover"
          onError={() => setFailedSrc(imageSrc)}
        />
      ) : (
        <span className="flex size-full items-center justify-center font-semibold text-muted-foreground">
          {initials || "EX"}
        </span>
      )}
    </div>
  );
}
