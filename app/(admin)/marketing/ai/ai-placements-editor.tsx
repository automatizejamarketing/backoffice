"use client";

import { Check, Facebook, Instagram, Sparkles } from "lucide-react";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  ALL_PLACEMENTS,
  FACEBOOK_PLACEMENTS,
  INSTAGRAM_PLACEMENTS,
  type PlacementKey,
} from "@/lib/meta-business/placements";

export type PlacementsMode = "automatic" | "manual";

const PLACEMENT_LABEL_PT: Record<PlacementKey, string> = {
  facebook_feed: "Feed do Facebook",
  facebook_stories: "Stories do Facebook",
  facebook_reels: "Reels do Facebook",
  instagram_feed: "Feed do Instagram",
  instagram_stories: "Stories do Instagram",
  instagram_reels: "Reels do Instagram",
};

type AiPlacementsEditorProps = {
  objective: "sales" | "followers" | "leads";
  mode: PlacementsMode;
  onModeChange: (mode: PlacementsMode) => void;
  selectedPlacements: readonly PlacementKey[];
  onChange: (placements: PlacementKey[]) => void;
  disabled?: boolean;
};

export function AiPlacementsEditor({
  objective,
  mode,
  onModeChange,
  selectedPlacements,
  onChange,
  disabled = false,
}: AiPlacementsEditorProps) {
  const available =
    objective === "followers" ? INSTAGRAM_PLACEMENTS : ALL_PLACEMENTS;
  const canUseAutomatic = objective !== "followers";
  const isAutomatic = canUseAutomatic && mode === "automatic";
  const selectedSet = new Set(selectedPlacements);
  const showFacebook = available.some((key) =>
    (FACEBOOK_PLACEMENTS as readonly string[]).includes(key),
  );

  const seedAvailable = () => onChange([...available]);

  const switchToManual = (next?: readonly PlacementKey[]) => {
    onModeChange("manual");
    if (next) {
      onChange(ALL_PLACEMENTS.filter((key) => next.includes(key)));
      return;
    }
    if (selectedPlacements.length === 0) seedAvailable();
  };

  const toggle = (key: PlacementKey) => {
    if (disabled) return;
    if (isAutomatic) {
      switchToManual(available);
      return;
    }
    const next = new Set(selectedSet);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    onChange(ALL_PLACEMENTS.filter((item) => next.has(item)));
  };

  const groups = [
    ...(showFacebook
      ? [
          {
            label: "Facebook",
            Icon: Facebook,
            placements: FACEBOOK_PLACEMENTS,
          },
        ]
      : []),
    {
      label: "Instagram",
      Icon: Instagram,
      placements: INSTAGRAM_PLACEMENTS,
    },
  ];

  return (
    <div className="space-y-3">
      <Label>Posicionamentos</Label>
      {canUseAutomatic ? (
        <div className="grid gap-2 sm:grid-cols-2">
          <button
            type="button"
            disabled={disabled}
            aria-pressed={isAutomatic}
            onClick={() => onModeChange("automatic")}
            className={cn(
              "flex items-start gap-2 rounded-md border p-2.5 text-left transition-colors hover:bg-muted disabled:opacity-50",
              isAutomatic
                ? "border-primary/60 bg-primary/5"
                : "border-border/60",
            )}
          >
            <Sparkles className="mt-0.5 size-4 text-primary" />
            <span>
              <span className="block text-sm font-medium">
                Advantage+ (automático)
              </span>
              <span className="block text-xs text-muted-foreground">
                A Meta escolhe onde o anúncio aparece.
              </span>
            </span>
          </button>
          <button
            type="button"
            disabled={disabled}
            aria-pressed={!isAutomatic}
            onClick={() => switchToManual()}
            className={cn(
              "rounded-md border p-2.5 text-left transition-colors hover:bg-muted disabled:opacity-50",
              !isAutomatic
                ? "border-primary/60 bg-primary/5"
                : "border-border/60",
            )}
          >
            <span className="block text-sm font-medium">Manual</span>
            <span className="block text-xs text-muted-foreground">
              Escolher superfícies desativa o Advantage+.
            </span>
          </button>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          Campanhas de seguidores ficam só no Instagram.
        </p>
      )}

      {groups.map((group) => (
        <div key={group.label} className="space-y-2">
          <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <group.Icon className="size-3.5" />
            {group.label}
          </p>
          <div
            className={cn(
              "grid gap-2 sm:grid-cols-3",
              isAutomatic && "opacity-60",
            )}
          >
            {group.placements.map((key) => {
              const checked = !isAutomatic && selectedSet.has(key);
              return (
                <button
                  key={key}
                  type="button"
                  disabled={disabled}
                  onClick={() => toggle(key)}
                  className={cn(
                    "flex items-center gap-2 rounded-md border p-2 text-left text-sm transition-colors hover:bg-muted disabled:opacity-50",
                    checked && "border-primary/60 bg-primary/5",
                  )}
                >
                  <span
                    className={cn(
                      "grid size-4 place-content-center rounded-sm border border-primary",
                      checked
                        ? "bg-primary text-primary-foreground"
                        : "bg-background",
                    )}
                  >
                    {checked ? <Check className="size-3" /> : null}
                  </span>
                  {PLACEMENT_LABEL_PT[key]}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

export function placementsSummary(
  mode: PlacementsMode,
  selected: readonly PlacementKey[],
  objective: "sales" | "followers" | "leads",
): string {
  if (objective !== "followers" && mode === "automatic") {
    return "Advantage+ (a Meta escolhe)";
  }
  if (selected.length === 0) return "Nenhuma superfície selecionada";
  return selected.map((key) => PLACEMENT_LABEL_PT[key]).join(" · ");
}
