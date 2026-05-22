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
  /**
   * Instagram Business Account (the ad identity) whose media should be listed.
   * When it changes, the Instagram grid reloads and any previously selected
   * Instagram post is cleared.
   */
  instagramBusinessAccountId?: string;
};

export function MediaSourcePicker({
  accountId,
  userId,
  onChange,
  instagramBusinessAccountId,
}: MediaSourcePickerProps) {
  const [igSelected, setIgSelected] = useState<InstagramMediaItem[]>([]);
  const [automatizeSelected, setAutomatizeSelected] =
    useState<AutomatizeMediaSelection | null>(null);
  const [deviceSelected, setDeviceSelected] =
    useState<DeviceUploadSelection | null>(null);

  // When the Instagram identity changes, drop any Instagram post that was
  // selected from the previous account (it no longer belongs to the chosen
  // identity). Other sources (Automatize/Upload) are identity-agnostic.
  const igSelectedRef = useRef(igSelected);
  igSelectedRef.current = igSelected;
  useEffect(() => {
    if (igSelectedRef.current.length > 0) {
      setIgSelected([]);
      onChange(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instagramBusinessAccountId]);

  // Single overall selection: choosing in one tab clears the others.
  const handleInstagram = (posts: InstagramMediaItem[]) => {
    setIgSelected(posts);
    setAutomatizeSelected(null);
    setDeviceSelected(null);
    const post = posts[0];
    onChange(
      post
        ? {
            source: "instagram",
            instagramMediaId: post.id,
            previewUrl: post.thumbnail_url ?? post.media_url,
            isVideo:
              post.media_type === "VIDEO" || post.media_type === "REELS",
          }
        : null,
    );
  };

  const handleAutomatize = (sel: AutomatizeMediaSelection | null) => {
    setAutomatizeSelected(sel);
    setIgSelected([]);
    setDeviceSelected(null);
    onChange(
      sel
        ? {
            source: "automatize_media",
            generatedImageId: sel.generatedImageId,
            previewUrl: sel.imageUrl,
          }
        : null,
    );
  };

  const handleDevice = (sel: DeviceUploadSelection | null) => {
    setDeviceSelected(sel);
    setIgSelected([]);
    setAutomatizeSelected(null);
    onChange(
      sel
        ? {
            source: "device",
            blobUrl: sel.blobUrl,
            mediaType: sel.mediaType,
            previewUrl: sel.previewUrl,
          }
        : null,
    );
  };

  return (
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
          maxSelection={1}
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
        />
      </TabsContent>

      <TabsContent value="device" className="mt-4">
        <DeviceUploadTab
          userId={userId}
          selected={deviceSelected}
          onSelect={handleDevice}
        />
      </TabsContent>
    </Tabs>
  );
}
