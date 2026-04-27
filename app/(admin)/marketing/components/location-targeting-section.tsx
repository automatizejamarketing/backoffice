"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import { locationTargetingMessages, useLocationTargetingT } from "../utils/location-targeting-messages";
import {
  ChevronDown,
  ChevronUp,
  GripVertical,
  Loader2,
  MapPin,
  MapPinned,
  Minus,
  Plus,
  Search,
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Slider } from "@/components/ui/slider";
import { isFullBrazilCep } from "@/lib/geo/brazil-cep";
import { cn } from "@/lib/utils";
import {
  DEFAULT_CITY_RADIUS_KM,
  MAX_RADIUS_KM,
  MIN_RADIUS_KM,
  hasLocationCoordinates,
  normalizeSelectedGeoLocation,
  type GeoLocationSearchResult,
  type GeoLocationType,
  type SelectedGeoLocation,
} from "@/lib/meta-business/geo-targeting-types";
import {
  mergeZipGeocodeForMap,
  useZipGeocodeForMap,
} from "../hooks/use-zip-geocode-for-map";
import { useLocationSearch } from "../hooks/use-location-search";

const LocationTargetingMapPreview = dynamic(
  () =>
    import("./location-targeting-map-preview").then(
      (module) => module.LocationTargetingMapPreview,
    ),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-[320px] items-center justify-center rounded-2xl border border-border/60 bg-muted/20 text-sm text-muted-foreground">
        Carregando mapa...
      </div>
    ),
  },
);

type LocationTargetingSectionProps = {
  accountId: string | null;
  userId?: string | null;
  selectedLocations: SelectedGeoLocation[];
  onLocationsChange: (locations: SelectedGeoLocation[]) => void;
  disabled?: boolean;
  minRadiusKm?: number;
  maxRadiusKm?: number;
};

type LocationTargetingTranslator = ReturnType<typeof useLocationTargetingT>;
const LOCATION_RESULT_ORDER: GeoLocationType[] = [
  "place",
  "custom_location",
  "city",
  "subcity",
  "neighborhood",
  "region",
  "zip",
  "geo_market",
  "electoral_district",
  "country",
  "country_group",
];

function getLocationTypeIcon(type: GeoLocationType) {
  if (type === "country" || type === "region") {
    return MapPinned;
  }

  return MapPin;
}

function getLocationMeta(
  location: Pick<
    SelectedGeoLocation,
    | "type"
    | "country_name"
    | "region"
    | "geo_hierarchy_name"
    | "primary_city"
    | "address_string"
    | "name"
  >,
  t: LocationTargetingTranslator,
) {
  if (location.type === "country") {
    return t("country");
  }

  if (location.type === "region") {
    return location.country_name ?? t("region");
  }

  if (location.type === "country_group") {
    return t("countryGroupHint");
  }

  if (location.type === "custom_location") {
    return location.address_string ?? t("customLocationHint");
  }

  if (location.type === "place") {
    return (
      location.address_string ??
      [location.primary_city, location.region, location.country_name]
        .filter(Boolean)
        .join(", ") ??
      t("placeHint")
    );
  }

  if (location.type === "zip") {
    return [location.primary_city, location.region, location.country_name]
      .filter(Boolean)
      .join(", ");
  }

  if (location.type === "geo_market") {
    return [location.region, location.country_name].filter(Boolean).join(", ");
  }

  if (location.type === "electoral_district") {
    return [location.region, location.country_name].filter(Boolean).join(", ");
  }

  if (location.type === "subcity" || location.type === "neighborhood") {
    return [location.geo_hierarchy_name, location.region, location.country_name]
      .filter(Boolean)
      .join(", ");
  }

  return [location.region, location.country_name].filter(Boolean).join(", ");
}

function getLocationTypeLabel(
  type: GeoLocationType,
  t: LocationTargetingTranslator,
) {
  switch (type) {
    case "country":
      return t("country");
    case "region":
      return t("region");
    case "country_group":
      return t("countryGroup");
    case "city":
      return t("city");
    case "subcity":
      return t("subcity");
    case "neighborhood":
      return t("neighborhood");
    case "zip":
      return t("zip");
    case "geo_market":
      return t("geoMarket");
    case "electoral_district":
      return t("electoralDistrict");
    case "place":
      return t("place");
    case "custom_location":
      return t("address");
    default:
      return type;
  }
}

function summarizeLocations(
  locations: SelectedGeoLocation[],
  t: LocationTargetingTranslator,
) {
  if (locations.length === 0) {
    return t("searchPlaceholder");
  }

  if (locations.length === 1) {
    return locations[0]?.name ?? t("searchPlaceholder");
  }

  return t("selectedSummary", {
    first: locations[0]?.name ?? "",
    count: locations.length - 1,
  });
}

export function LocationTargetingSection({
  accountId,
  userId,
  selectedLocations,
  onLocationsChange,
  disabled = false,
  minRadiusKm = MIN_RADIUS_KM,
  maxRadiusKm = MAX_RADIUS_KM,
}: LocationTargetingSectionProps) {
  const locale = "pt-BR";
  const t = useLocationTargetingT();
  const [open, setOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);

  const clampRadius = (value: number) =>
    Math.min(maxRadiusKm, Math.max(minRadiusKm, value));

  const { results, isFetching, error } = useLocationSearch({
    accountId,
    userId,
    locale,
    searchTerm,
    selectedLocations,
    enabled: open,
  });

  const { geocodeByKey, isGeocoding, geocodeError } =
    useZipGeocodeForMap(selectedLocations);

  const groupedResults = useMemo(() => {
    const groups = new Map<string, GeoLocationSearchResult[]>();

    for (const result of results) {
      const key = result.type;
      const existing = groups.get(key) ?? [];
      existing.push(result);
      groups.set(key, existing);
    }

    return Array.from(groups.entries()).sort(
      ([left], [right]) =>
        LOCATION_RESULT_ORDER.indexOf(left as GeoLocationType) -
        LOCATION_RESULT_ORDER.indexOf(right as GeoLocationType),
    );
  }, [results]);

  const coordinateLocationsByKey = useMemo(() => {
    const map = new Map<
      string,
      SelectedGeoLocation & { latitude: number; longitude: number }
    >();

    for (const location of selectedLocations) {
      const withCoords = mergeZipGeocodeForMap(location, geocodeByKey);
      if (withCoords) {
        map.set(location.key, withCoords);
      }
    }

    return map;
  }, [selectedLocations, geocodeByKey]);

  useEffect(() => {
    if (expandedIndex === null) return;
    if (expandedIndex >= selectedLocations.length) {
      setExpandedIndex(null);
    }
  }, [selectedLocations.length, expandedIndex]);

  const handleSelectLocation = (location: GeoLocationSearchResult) => {
    const normalizedLocation = normalizeSelectedGeoLocation(location);
    onLocationsChange([...selectedLocations, normalizedLocation]);
    setExpandedIndex(selectedLocations.length);
    setSearchTerm("");
    setOpen(false);
  };

  const handleRemoveLocation = (locationKey: string) => {
    const removedIndex = selectedLocations.findIndex(
      (location) => location.key === locationKey,
    );
    onLocationsChange(
      selectedLocations.filter((location) => location.key !== locationKey),
    );

    setExpandedIndex((current) => {
      if (current === null) return null;
      if (removedIndex === current) return null;
      if (removedIndex < current) return current - 1;
      return current;
    });
  };

  const handleRadiusChange = (locationKey: string, value: string) => {
    const parsed = Number.parseInt(value, 10);

    onLocationsChange(
      selectedLocations.map((location) => {
        if (location.key !== locationKey) {
          return location;
        }

        if (!Number.isFinite(parsed) || parsed <= 0) {
          return location;
        }

        return {
          ...location,
          radius: clampRadius(parsed),
          distance_unit: "kilometer",
        };
      }),
    );
  };

  const handleRadiusStep = (locationKey: string, delta: number) => {
    onLocationsChange(
      selectedLocations.map((location) => {
        if (location.key !== locationKey) {
          return location;
        }

        return {
          ...location,
          radius: clampRadius((location.radius ?? DEFAULT_CITY_RADIUS_KM) + delta),
          distance_unit: "kilometer",
        };
      }),
    );
  };

  const handleLocationDrag = (
    locationIndex: number,
    latitude: number,
    longitude: number,
  ) => {
    const draggedKey = `custom_${latitude.toFixed(6)}_${longitude.toFixed(6)}`;

    onLocationsChange(
      selectedLocations.map((location, idx) => {
        if (idx !== locationIndex) {
          return location;
        }

        return {
          ...location,
          key: draggedKey,
          type: "custom_location" as const,
          latitude,
          longitude,
          address_string: location.address_string ?? location.name,
          radius: location.radius ?? clampRadius(DEFAULT_CITY_RADIUS_KM),
          distance_unit: "kilometer" as const,
        };
      }),
    );
  };

  const toggleExpanded = (index: number) => {
    setExpandedIndex((current) => (current === index ? null : index));
  };

  return (
    <section className="space-y-3.5 rounded-2xl border border-border/60 bg-linear-to-br from-background via-background to-muted/20 p-4 sm:p-5">
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-3">
          <Label className="text-sm font-medium">
            {t("title")}
            <span className="ml-1 text-destructive">*</span>
          </Label>
          <Badge
            variant="outline"
            className="border-primary/20 bg-primary/5 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-primary"
          >
            {selectedLocations.length} {t("selectedLabel")}
          </Badge>
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">
          {t("description")}
        </p>
      </div>

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            disabled={disabled || !accountId}
            className={cn(
              "h-auto w-full justify-between rounded-xl border-border/70 bg-background px-3 py-3 text-left hover:bg-accent/40",
              !accountId && "text-muted-foreground",
            )}
          >
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Search className="size-4" />
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">
                  {accountId
                    ? summarizeLocations(selectedLocations, t)
                    : t("selectAccountFirst")}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {accountId ? t("searchHint") : t("searchDisabledHint")}
                </p>
              </div>
            </div>
            <MapPin className="size-4 shrink-0 text-muted-foreground" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-[min(92vw,30rem)] p-0 shadow-xl"
        >
          <Command shouldFilter={false}>
            <CommandInput
              value={searchTerm}
              onValueChange={setSearchTerm}
              placeholder={t("searchPlaceholder")}
            />
            <CommandList>
              {error ? (
                <div className="px-3 py-8 text-center text-sm text-destructive">
                  {error instanceof Error ? error.message : t("searchError")}
                </div>
              ) : null}
              {!error && isFetching ? (
                <div className="flex items-center justify-center gap-2 px-3 py-8 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" />
                  {t("searching")}
                </div>
              ) : null}
              {!error && !isFetching && searchTerm.trim().length === 0 ? (
                <div className="px-3 py-8 text-center text-sm text-muted-foreground">
                  {t("searchEmptyState")}
                </div>
              ) : null}
              {!error && !isFetching && searchTerm.trim().length > 0 ? (
                <>
                  <CommandEmpty>
                    <span className="block">{t("noResults")}</span>
                    {isFullBrazilCep(searchTerm.trim()) ? (
                      <span className="mt-2 block text-xs text-muted-foreground">
                        {t("zipCepSearchHint")}
                      </span>
                    ) : null}
                  </CommandEmpty>
                  {groupedResults.map(([type, locations]) => (
                    <CommandGroup
                      key={type}
                      heading={getLocationTypeLabel(type as GeoLocationType, t)}
                    >
                      {locations.map((location) => {
                        const Icon = getLocationTypeIcon(location.type);

                        return (
                          <CommandItem
                            key={`${location.type}-${location.key}`}
                            value={`${location.name}-${location.key}`}
                            onSelect={() => handleSelectLocation(location)}
                          >
                            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                              <Icon className="size-4" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-medium">
                                {location.name}
                              </p>
                              <p className="truncate text-xs text-muted-foreground">
                                {getLocationMeta(location, t)}
                              </p>
                            </div>
                            <Badge
                              variant="outline"
                              className="shrink-0 border-border/70 bg-background text-[10px] uppercase tracking-[0.12em] text-muted-foreground"
                            >
                              {getLocationTypeLabel(location.type, t)}
                            </Badge>
                          </CommandItem>
                        );
                      })}
                    </CommandGroup>
                  ))}
                </>
              ) : null}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      <div className="space-y-2">
        {selectedLocations.length === 0 ? (
          <div className="rounded-xl border border-dashed border-destructive/40 bg-destructive/5 px-3 py-3 text-sm text-destructive">
            {t("atLeastOneLocation")}
          </div>
        ) : (
          selectedLocations.map((location, locationIndex) => {
            const locationTypeLabel = getLocationTypeLabel(location.type, t);
            const coordLocation = coordinateLocationsByKey.get(location.key);
            const canShowMap = !!coordLocation;
            const isExpanded = expandedIndex === locationIndex;
            const isGeocodingThis =
              isGeocoding &&
              !hasLocationCoordinates(location) &&
              !geocodeByKey[location.key];

            const pinSource =
              location.type === "zip" && !hasLocationCoordinates(location)
                ? "openstreetmap"
                : "meta";

            return (
              <div
                key={locationIndex}
                className={cn(
                  "overflow-hidden rounded-xl border border-border/60 bg-background/80 shadow-sm shadow-black/5 transition-colors",
                  isExpanded && "border-primary/40 bg-primary/5",
                )}
              >
                <div className="flex items-center gap-2 p-3">
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-sm font-medium">{location.name}</p>
                      <Badge
                        variant="outline"
                        className="border-primary/15 bg-primary/5 text-[10px] uppercase tracking-[0.12em] text-primary"
                      >
                        {locationTypeLabel}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {getLocationMeta(location, t)}
                    </p>
                    {canShowMap && (
                      <p className="flex items-center gap-1 text-[11px] text-primary/70">
                        <GripVertical className="size-3" />
                        {t("dragPinHint")}
                      </p>
                    )}
                  </div>

                  <div className="flex shrink-0 items-center gap-1">
                    {canShowMap && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => toggleExpanded(locationIndex)}
                        className="size-8 rounded-full text-muted-foreground hover:text-foreground"
                        aria-label={isExpanded ? t("collapseMap") : t("expandMap")}
                      >
                        {isExpanded ? (
                          <ChevronUp className="size-4" />
                        ) : (
                          <ChevronDown className="size-4" />
                        )}
                      </Button>
                    )}
                    {isGeocodingThis && (
                      <Loader2 className="size-4 animate-spin text-muted-foreground" />
                    )}
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      disabled={disabled}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRemoveLocation(location.key);
                      }}
                      className="size-8 rounded-full text-muted-foreground hover:text-destructive"
                      aria-label={t("removeLocation")}
                    >
                      <X className="size-4" />
                    </Button>
                  </div>
                </div>

                {isExpanded && coordLocation && (
                  <div className="space-y-3 border-t border-border/40 p-3">
                    <LocationTargetingMapPreview
                      location={coordLocation}
                      radiusKm={coordLocation.radius ?? DEFAULT_CITY_RADIUS_KM}
                      pinSource={pinSource}
                      onLocationDrag={(lat, lng) =>
                        handleLocationDrag(locationIndex, lat, lng)
                      }
                    />

                    <div className="rounded-xl border border-border/60 bg-muted/20 p-3">
                      <div className="mb-2 flex items-center justify-between gap-3">
                        <div>
                          <p className="text-xs font-medium text-foreground">
                            {t("radiusLabel")}
                          </p>
                          <p className="text-[11px] text-muted-foreground">
                            {location.type === "custom_location"
                              ? t("customLocationRadiusHint")
                              : location.type === "place"
                                ? t("placeRadiusHint")
                                : t("cityRadiusHint")}
                          </p>
                        </div>
                        <div className="flex items-center rounded-lg border border-border/60 bg-background">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            disabled={disabled}
                            className="size-9 rounded-r-none"
                            onClick={() => handleRadiusStep(location.key, -1)}
                            aria-label={t("decreaseRadius")}
                          >
                            <Minus className="size-4" />
                          </Button>
                          <Input
                            type="number"
                            min={minRadiusKm.toString()}
                            max={maxRadiusKm.toString()}
                            step="1"
                            value={location.radius ?? ""}
                            disabled={disabled}
                            onChange={(event) =>
                              handleRadiusChange(location.key, event.target.value)
                            }
                            className="h-9 w-14 rounded-none border-x-0 border-y-0 px-1 text-center text-sm shadow-none focus-visible:ring-0"
                          />
                          <span className="border-l border-border/60 px-2 text-xs text-muted-foreground">
                            {t("km")}
                          </span>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            disabled={disabled}
                            className="size-9 rounded-l-none border-l border-border/60"
                            onClick={() => handleRadiusStep(location.key, 1)}
                            aria-label={t("increaseRadius")}
                          >
                            <Plus className="size-4" />
                          </Button>
                        </div>
                      </div>
                      <Slider
                        min={minRadiusKm}
                        max={maxRadiusKm}
                        step={1}
                        value={[location.radius ?? clampRadius(DEFAULT_CITY_RADIUS_KM)]}
                        onValueChange={(value) =>
                          handleRadiusChange(
                            location.key,
                            String(value[0] ?? DEFAULT_CITY_RADIUS_KM),
                          )
                        }
                        disabled={disabled}
                      />
                    </div>
                  </div>
                )}

                {isExpanded && !coordLocation && isGeocodingThis && (
                  <div className="border-t border-border/40 p-3">
                    <div className="flex h-[320px] items-center justify-center gap-2 rounded-2xl border border-border/60 bg-muted/20 text-sm text-muted-foreground">
                      <Loader2 className="size-4 animate-spin" />
                      {t("mapGeocodingZip")}
                    </div>
                  </div>
                )}

                {isExpanded && !coordLocation && !isGeocodingThis && geocodeError && (
                  <div className="border-t border-border/40 p-3">
                    <div className="rounded-2xl border border-dashed border-border/70 bg-muted/20 px-4 py-5">
                      <p className="text-sm font-medium text-foreground">
                        {t("mapPreviewTitle")}
                      </p>
                      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                        {t("mapGeocodeError", { message: geocodeError })}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}
