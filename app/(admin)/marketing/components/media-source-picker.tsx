"use client";

import { useEffect, useRef, useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  InstagramPostPicker,
  type InstagramMediaItem,
} from "./instagram-post-picker";
import {
  AutomatizeMediaGrid,
  type AutomatizeMediaSelection,
} from "./automatize-media-grid";
import {
  DeviceUploadTab,
  type DeviceUploadSelection,
} from "./device-upload-tab";

export type SelectedMedia =
  | {
      source: "instagram";
      instagramMediaId: string;
      previewUrl?: string;
      isVideo: boolean;
    }
  | {
      source: "automatize_media";
      generatedImageId: string;
      previewUrl: string;
    }
  | {
      source: "device";
      blobUrl: string;
      mediaType: "image" | "video";
      previewUrl: string;
    };

type MediaSourcePickerProps = {
  accountId: string;
  userId: string;
  onChange: (media: SelectedMedia | null) => void;
  onChangeMany?: (media: SelectedMedia[]) => void;
  maxSelection?: number;
  /**
   * Instagram Business Account (the ad identity) whose media should be listed.
   * When it changes, the Instagram grid reloads and any previously selected
   * Instagram post is cleared.
   */
  instagramBusinessAccountId?: string;
};

function toSelectedMedia(
  igSelected: InstagramMediaItem[],
  automatizeSelected: AutomatizeMediaSelection[],
  deviceSelected: DeviceUploadSelection[],
): SelectedMedia[] {
  return [
    ...igSelected.map((post) => ({
      source: "instagram" as const,
      instagramMediaId: post.id,
      previewUrl: post.thumbnail_url ?? post.media_url,
      isVideo: post.media_type === "VIDEO" || post.media_type === "REELS",
    })),
    ...automatizeSelected.map((sel) => ({
      source: "automatize_media" as const,
      generatedImageId: sel.generatedImageId,
      previewUrl: sel.imageUrl,
    })),
    ...deviceSelected.map((sel) => ({
      source: "device" as const,
      blobUrl: sel.blobUrl,
      mediaType: sel.mediaType,
      previewUrl: sel.previewUrl,
    })),
  ];
}

export function MediaSourcePicker({
  accountId,
  userId,
  onChange,
  onChangeMany,
  maxSelection = 1,
  instagramBusinessAccountId,
}: MediaSourcePickerProps) {
  const [igSelected, setIgSelected] = useState<InstagramMediaItem[]>([]);
  const [automatizeSelected, setAutomatizeSelected] = useState<
    AutomatizeMediaSelection[]
  >([]);
  const [deviceSelected, setDeviceSelected] = useState<DeviceUploadSelection[]>(
    [],
  );

  const emit = (
    nextIg: InstagramMediaItem[],
    nextAutomatize: AutomatizeMediaSelection[],
    nextDevice: DeviceUploadSelection[],
  ) => {
    const items = toSelectedMedia(nextIg, nextAutomatize, nextDevice);
    onChangeMany?.(items);
    onChange(items[0] ?? null);
  };

  const igSelectedRef = useRef(igSelected);
  igSelectedRef.current = igSelected;
  useEffect(() => {
    if (igSelectedRef.current.length > 0) {
      setIgSelected([]);
      emit([], automatizeSelected, deviceSelected);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instagramBusinessAccountId]);

  const exclusive = maxSelection === 1;
  const usedSlots =
    igSelected.length + automatizeSelected.length + deviceSelected.length;

  const handleInstagram = (posts: InstagramMediaItem[]) => {
    const nextIg = exclusive ? posts.slice(0, 1) : posts;
    const nextAutomatize = exclusive ? [] : automatizeSelected;
    const nextDevice = exclusive ? [] : deviceSelected;
    setIgSelected(nextIg);
    if (exclusive) {
      setAutomatizeSelected([]);
      setDeviceSelected([]);
    }
    emit(nextIg, nextAutomatize, nextDevice);
  };

  const handleAutomatize = (sel: AutomatizeMediaSelection[]) => {
    const nextAutomatize = exclusive ? sel.slice(0, 1) : sel;
    const nextIg = exclusive ? [] : igSelected;
    const nextDevice = exclusive ? [] : deviceSelected;
    setAutomatizeSelected(nextAutomatize);
    if (exclusive) {
      setIgSelected([]);
      setDeviceSelected([]);
    }
    emit(nextIg, nextAutomatize, nextDevice);
  };

  const handleDevice = (sel: DeviceUploadSelection[]) => {
    const nextDevice = exclusive ? sel.slice(0, 1) : sel;
    const nextIg = exclusive ? [] : igSelected;
    const nextAutomatize = exclusive ? [] : automatizeSelected;
    setDeviceSelected(nextDevice);
    if (exclusive) {
      setIgSelected([]);
      setAutomatizeSelected([]);
    }
    emit(nextIg, nextAutomatize, nextDevice);
  };

  const remaining = Math.max(0, maxSelection - usedSlots);

  return (
    <div className="space-y-3">
      {maxSelection > 1 ? (
        <p className="text-xs text-muted-foreground">
          {usedSlots}/{maxSelection} mídias selecionadas. Pode misturar
          Instagram, Automatize e arquivos do dispositivo.
        </p>
      ) : null}
      <Tabs defaultValue="instagram" className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="instagram">Instagram</TabsTrigger>
          <TabsTrigger value="automatize">Automatize</TabsTrigger>
          <TabsTrigger value="device">Upload</TabsTrigger>
        </TabsList>

        <TabsContent value="instagram" className="mt-4">
          <InstagramPostPicker
            accountId={accountId}
            userId={userId}
            maxSelection={igSelected.length + remaining}
            selectedPosts={igSelected}
            onSelectionChange={handleInstagram}
            instagramBusinessAccountId={instagramBusinessAccountId}
          />
        </TabsContent>

        <TabsContent value="automatize" className="mt-4">
          <AutomatizeMediaGrid
            accountId={accountId}
            userId={userId}
            selected={automatizeSelected}
            onSelect={handleAutomatize}
            maxSelection={automatizeSelected.length + remaining}
          />
        </TabsContent>

        <TabsContent value="device" className="mt-4">
          <DeviceUploadTab
            userId={userId}
            selected={deviceSelected}
            onSelect={handleDevice}
            maxSelection={deviceSelected.length + remaining}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
