"use client";

import { useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  Loader2,
  Plus,
  Search,
  Sparkles,
  X,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  MAX_INCLUDE_GROUPS,
  UI_MAX_INTERESTS_PER_GROUP,
  createGroupId,
  type InterestTargetingValue,
  type MetaInterestSearchResult,
  type SelectedInterest,
} from "@/lib/meta-business/interest-targeting-types";
import { useInterestBrowse } from "../hooks/use-interest-browse";
import { useInterestSearch } from "../hooks/use-interest-search";
import { useInterestSuggestions } from "../hooks/use-interest-suggestions";
import { useInterestTargetingT } from "../utils/interest-targeting-messages";

type InterestTargetingSectionProps = {
  accountId: string | null;
  userId: string;
  value: InterestTargetingValue;
  onChange: (value: InterestTargetingValue) => void;
  disabled?: boolean;
  showAdvancedStructure?: boolean;
  locale?: string;
};

type InterestTargetingT = ReturnType<typeof useInterestTargetingT>;

function formatAudienceSize(
  interest: Pick<
    MetaInterestSearchResult,
    "audience_size" | "audience_size_lower_bound" | "audience_size_upper_bound"
  >,
  locale: string,
): string | null {
  const formatter = new Intl.NumberFormat(locale, { notation: "compact" });

  if (
    typeof interest.audience_size_lower_bound === "number" &&
    typeof interest.audience_size_upper_bound === "number"
  ) {
    return `${formatter.format(interest.audience_size_lower_bound)} – ${formatter.format(interest.audience_size_upper_bound)}`;
  }

  if (typeof interest.audience_size === "number") {
    return formatter.format(interest.audience_size);
  }

  return null;
}

function toSelectedInterest(result: MetaInterestSearchResult): SelectedInterest {
  return {
    id: result.id,
    name: result.name,
    audience_size: result.audience_size,
    audience_size_lower_bound: result.audience_size_lower_bound,
    audience_size_upper_bound: result.audience_size_upper_bound,
    path: result.path,
    description: result.description,
  };
}

function InterestChip({
  interest,
  locale,
  onRemove,
  disabled,
  removeLabel,
}: {
  interest: SelectedInterest;
  locale: string;
  onRemove: () => void;
  disabled?: boolean;
  removeLabel: string;
}) {
  const size = formatAudienceSize(interest, locale);
  const path = interest.path?.join(" > ");

  return (
    <div className="flex items-start gap-2 rounded-lg border border-border/60 bg-muted/20 px-3 py-2">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{interest.name}</p>
        {path ? (
          <p className="truncate text-xs text-muted-foreground">{path}</p>
        ) : null}
        {size ? (
          <p className="text-[11px] text-muted-foreground">{size}</p>
        ) : null}
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-7 shrink-0"
        onClick={onRemove}
        disabled={disabled}
        aria-label={removeLabel}
      >
        <X className="size-3.5" />
      </Button>
    </div>
  );
}

function InterestSearchPopover({
  accountId,
  userId,
  locale,
  disabled,
  selectedInterests,
  onSelect,
  triggerLabel,
  triggerHint,
  t,
}: {
  accountId: string | null;
  userId: string;
  locale: string;
  disabled?: boolean;
  selectedInterests: SelectedInterest[];
  onSelect: (interest: SelectedInterest) => void;
  triggerLabel: string;
  triggerHint: string;
  t: InterestTargetingT;
}) {
  const [open, setOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");

  const { results, isFetching, error } = useInterestSearch({
    accountId,
    userId,
    locale,
    searchTerm,
    selectedInterests,
    enabled: open,
  });

  const handleSelect = (result: MetaInterestSearchResult) => {
    onSelect(toSelectedInterest(result));
    setSearchTerm("");
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          disabled={disabled || !accountId}
          className="h-auto w-full justify-start gap-3 rounded-xl border-dashed border-border/60 bg-muted/10 px-3 py-2.5 text-left hover:border-primary/30 hover:bg-primary/5"
        >
          <Search className="size-4 shrink-0 text-primary" />
          <div className="min-w-0">
            <p className="text-sm font-medium">{triggerLabel}</p>
            <p className="truncate text-xs text-muted-foreground">{triggerHint}</p>
          </div>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(92vw,28rem)] p-0">
        <Command shouldFilter={false}>
          <CommandInput
            value={searchTerm}
            onValueChange={setSearchTerm}
            placeholder={t("searchPlaceholder")}
          />
          <CommandList>
            {error ? (
              <div className="px-3 py-6 text-center text-sm text-destructive">
                {error instanceof Error ? error.message : t("searchError")}
              </div>
            ) : null}
            {!error && isFetching ? (
              <div className="flex items-center justify-center gap-2 px-3 py-6 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                {t("searching")}
              </div>
            ) : null}
            {!error && !isFetching && searchTerm.trim().length === 0 ? (
              <div className="px-3 py-6 text-center text-sm text-muted-foreground">
                {t("searchEmptyState")}
              </div>
            ) : null}
            {!error && !isFetching && searchTerm.trim().length > 0 ? (
              <>
                <CommandEmpty>{t("noResults")}</CommandEmpty>
                <CommandGroup>
                  {results.map((result) => {
                    const size = formatAudienceSize(result, locale);
                    return (
                      <CommandItem
                        key={result.id}
                        value={result.id}
                        onSelect={() => handleSelect(result)}
                        className="flex flex-col items-start gap-0.5 py-2"
                      >
                        <span className="font-medium">{result.name}</span>
                        {result.path?.length ? (
                          <span className="text-xs text-muted-foreground">
                            {result.path.join(" > ")}
                          </span>
                        ) : null}
                        {size ? (
                          <span className="text-[11px] text-muted-foreground">
                            {t("audienceSize", { size })}
                          </span>
                        ) : null}
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              </>
            ) : null}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export function InterestTargetingSection({
  accountId,
  userId,
  value,
  onChange,
  disabled = false,
  showAdvancedStructure = true,
  locale = "pt-BR",
}: InterestTargetingSectionProps) {
  const t = useInterestTargetingT();
  const [showBrowse, setShowBrowse] = useState(false);

  const allIncluded = useMemo(
    () => value.includeGroups.flatMap((g) => g.interests),
    [value.includeGroups],
  );

  const suggestionNames = useMemo(
    () => allIncluded.map((i) => i.name).slice(0, 5),
    [allIncluded],
  );

  const suggestionsQuery = useInterestSuggestions({
    accountId,
    userId,
    locale,
    names: suggestionNames,
    enabled: suggestionNames.length > 0,
  });

  const browseQuery = useInterestBrowse({
    accountId,
    userId,
    locale,
    enabled: showBrowse,
  });

  const includedCount = allIncluded.length;
  const excludedCount = value.exclusions.length;

  const updateGroup = (
    groupId: string,
    updater: (interests: SelectedInterest[]) => SelectedInterest[],
  ) => {
    onChange({
      ...value,
      includeGroups: value.includeGroups.map((group) =>
        group.id === groupId
          ? { ...group, interests: updater(group.interests) }
          : group,
      ),
    });
  };

  const addInterestToGroup = (groupId: string, interest: SelectedInterest) => {
    if (value.exclusions.some((e) => e.id === interest.id)) return;

    updateGroup(groupId, (interests) => {
      if (interests.some((i) => i.id === interest.id)) return interests;
      if (interests.length >= UI_MAX_INTERESTS_PER_GROUP) return interests;
      return [...interests, interest];
    });
  };

  const addExclusion = (interest: SelectedInterest) => {
    if (allIncluded.some((i) => i.id === interest.id)) return;
    if (value.exclusions.some((e) => e.id === interest.id)) return;
    onChange({
      ...value,
      exclusions: [...value.exclusions, interest],
    });
  };

  const removeFromGroup = (groupId: string, interestId: string) => {
    updateGroup(groupId, (interests) =>
      interests.filter((i) => i.id !== interestId),
    );
  };

  const addIncludeGroup = () => {
    if (value.includeGroups.length >= MAX_INCLUDE_GROUPS) return;
    onChange({
      ...value,
      includeGroups: [
        ...value.includeGroups,
        { id: createGroupId(), interests: [] },
      ],
    });
  };

  const removeIncludeGroup = (groupId: string) => {
    const next = value.includeGroups.filter((g) => g.id !== groupId);
    onChange({
      ...value,
      includeGroups:
        next.length > 0 ? next : [{ id: createGroupId(), interests: [] }],
    });
  };

  const handleSuggestionAdd = (result: MetaInterestSearchResult) => {
    const interest = toSelectedInterest(result);
    const targetGroup =
      value.includeGroups.find((g) => g.interests.length < UI_MAX_INTERESTS_PER_GROUP) ??
      value.includeGroups[0];
    if (targetGroup) {
      addInterestToGroup(targetGroup.id, interest);
    }
  };

  const suggestionResults = (suggestionsQuery.data?.data ?? []).filter(
    (s) =>
      !allIncluded.some((i) => i.id === s.id) &&
      !value.exclusions.some((e) => e.id === s.id),
  );

  const browseResults = (browseQuery.data?.data ?? []).filter(
    (s) =>
      !allIncluded.some((i) => i.id === s.id) &&
      !value.exclusions.some((e) => e.id === s.id),
  );

  return (
    <section className="space-y-5 rounded-2xl border border-border/50 bg-card p-5 shadow-sm shadow-black/5 sm:p-6">
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-3">
          <Label className="text-sm font-medium">{t("title")}</Label>
          {(includedCount > 0 || excludedCount > 0) && (
            <Badge
              variant="outline"
              className="border-primary/20 bg-primary/5 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-primary"
            >
              {t("summary", { included: includedCount, excluded: excludedCount })}
            </Badge>
          )}
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">
          {t("description")}
        </p>
      </div>

      <div className="space-y-4">
        <div className="space-y-2">
          <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t("includeLabel")}
          </Label>

          {value.includeGroups.map((group, groupIndex) => (
            <div
              key={group.id}
              className={cn(
                "space-y-3 rounded-xl border border-border/50 bg-muted/10 p-4",
                groupIndex > 0 && "border-primary/20",
              )}
            >
              {showAdvancedStructure && value.includeGroups.length > 1 ? (
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-medium text-muted-foreground">
                    {groupIndex === 0
                      ? t("groupPrimary")
                      : t("groupNarrowing", { index: groupIndex + 1 })}
                  </p>
                  {groupIndex > 0 ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => removeIncludeGroup(group.id)}
                      disabled={disabled}
                    >
                      {t("removeGroup")}
                    </Button>
                  ) : null}
                </div>
              ) : null}

              <p className="text-xs text-muted-foreground">{t("groupHint")}</p>

              <div className="space-y-2">
                {group.interests.map((interest) => (
                  <InterestChip
                    key={interest.id}
                    interest={interest}
                    locale={locale}
                    onRemove={() => removeFromGroup(group.id, interest.id)}
                    disabled={disabled}
                    removeLabel={t("removeInterest")}
                  />
                ))}
              </div>

              <InterestSearchPopover
                accountId={accountId}
                userId={userId}
                locale={locale}
                disabled={disabled}
                selectedInterests={[...group.interests, ...value.exclusions]}
                onSelect={(interest) => addInterestToGroup(group.id, interest)}
                triggerLabel={t("addInterest")}
                triggerHint={t("searchHint")}
                t={t}
              />
            </div>
          ))}

          {showAdvancedStructure &&
          value.includeGroups.length < MAX_INCLUDE_GROUPS ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={addIncludeGroup}
              disabled={disabled}
            >
              <Plus className="size-3.5" />
              {t("narrowAudience")}
            </Button>
          ) : null}
        </div>

        <div className="space-y-3 rounded-xl border border-border/50 bg-muted/10 p-4">
          <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t("excludeLabel")}
          </Label>
          <p className="text-xs text-muted-foreground">{t("excludeHint")}</p>

          <div className="space-y-2">
            {value.exclusions.map((interest) => (
              <InterestChip
                key={interest.id}
                interest={interest}
                locale={locale}
                onRemove={() =>
                  onChange({
                    ...value,
                    exclusions: value.exclusions.filter((e) => e.id !== interest.id),
                  })
                }
                disabled={disabled}
                removeLabel={t("removeInterest")}
              />
            ))}
          </div>

          <InterestSearchPopover
            accountId={accountId}
            userId={userId}
            locale={locale}
            disabled={disabled}
            selectedInterests={[...allIncluded, ...value.exclusions]}
            onSelect={addExclusion}
            triggerLabel={t("addExclusion")}
            triggerHint={t("searchHint")}
            t={t}
          />
        </div>

        {suggestionNames.length > 0 ? (
          <div className="space-y-3 rounded-xl border border-primary/15 bg-primary/5 p-4">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Sparkles className="size-4 text-primary" />
              {t("suggestions")}
            </div>
            {suggestionsQuery.isFetching ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                {t("loadingSuggestions")}
              </div>
            ) : suggestionResults.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {suggestionResults.slice(0, 8).map((result) => (
                  <Button
                    key={result.id}
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="h-auto max-w-full whitespace-normal py-1.5 text-left"
                    disabled={disabled}
                    onClick={() => handleSuggestionAdd(result)}
                  >
                    + {result.name}
                  </Button>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                {t("noSuggestions")}
              </p>
            )}
          </div>
        ) : null}

        <div className="space-y-3">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="gap-2 px-0 text-muted-foreground hover:text-foreground"
            onClick={() => setShowBrowse((v) => !v)}
            disabled={disabled || !accountId}
          >
            {showBrowse ? (
              <ChevronUp className="size-4" />
            ) : (
              <ChevronDown className="size-4" />
            )}
            {t("browseCategories")}
          </Button>

          {showBrowse ? (
            <div className="max-h-56 space-y-2 overflow-y-auto rounded-xl border border-border/50 p-3">
              {browseQuery.isFetching ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" />
                  {t("loadingBrowse")}
                </div>
              ) : browseResults.length > 0 ? (
                browseResults.slice(0, 30).map((result) => (
                  <button
                    key={result.id}
                    type="button"
                    className="flex w-full flex-col items-start rounded-lg px-2 py-2 text-left hover:bg-muted/50 disabled:opacity-50"
                    disabled={disabled}
                    onClick={() => handleSuggestionAdd(result)}
                  >
                    <span className="text-sm font-medium">{result.name}</span>
                    {result.path?.length ? (
                      <span className="text-xs text-muted-foreground">
                        {result.path.join(" > ")}
                      </span>
                    ) : null}
                  </button>
                ))
              ) : (
                <p className="text-xs text-muted-foreground">{t("noBrowseResults")}</p>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
