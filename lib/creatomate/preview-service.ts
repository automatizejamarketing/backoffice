import type { CreatomatePreviewResult } from "./types";
import { getCreatomateGateway } from "./creatomate-gateway";

export interface GeneratePreviewOptions {
  templateId: string;
  videoSourceKey?: string;
}

export class VideoTemplatePreviewService {
  async generatePreview(
    options: GeneratePreviewOptions
  ): Promise<CreatomatePreviewResult> {
    try {
      const gateway = getCreatomateGateway();

      const thumbnailDirect = await gateway.getTemplateThumbnail(options.templateId);
      if (thumbnailDirect) {
        return {
          success: true,
          thumbnailUrl: thumbnailDirect,
        };
      }

      const result = await gateway.generatePreview({
        templateId: options.templateId,
        videoSourceKey: options.videoSourceKey ?? "Video-1",
        renderScale: 10,
      });

      return result;
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  async validateTemplate(templateId: string): Promise<boolean> {
    try {
      const gateway = getCreatomateGateway();
      const template = await gateway.getTemplate(templateId);
      return !!template.id;
    } catch {
      return false;
    }
  }

  async getTemplateThumbnail(templateId: string): Promise<string | undefined> {
    try {
      const gateway = getCreatomateGateway();
      return await gateway.getTemplateThumbnail(templateId);
    } catch {
      return undefined;
    }
  }
}

export const videoTemplatePreviewService = new VideoTemplatePreviewService();