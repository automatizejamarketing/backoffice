import type { CreatomatePort } from "./ports/creatomate-port";
import type {
  CreatomateRenderResponse,
  CreatomateTemplateResponse,
  CreatomateRenderOptions,
  CreatomatePreviewResult,
  CreatomateTemplateDetails,
} from "./types";

const CREATOMATE_API_URL = "https://api.creatomate.com/v1";

export class CreatomateGateway implements CreatomatePort {
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${CREATOMATE_API_URL}${endpoint}`;
    const response = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        ...options.headers,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Creatomate API Error: ${response.status} - ${errorText}`
      );
    }

    return response.json();
  }

  async getTemplate(templateId: string): Promise<CreatomateTemplateResponse> {
    return this.request<CreatomateTemplateResponse>(
      `/templates/${templateId}`
    );
  }

  async getTemplateDetails(templateId: string): Promise<CreatomateTemplateDetails> {
    return this.request<CreatomateTemplateDetails>(
      `/templates/${templateId}`
    );
  }

  async getTemplateThumbnail(templateId: string): Promise<string | undefined> {
    try {
      const template = await this.getTemplateDetails(templateId);
      return template.thumbnail_url ?? template.preview_url;
    } catch {
      return undefined;
    }
  }

  async createRender(
    options: CreatomateRenderOptions
  ): Promise<CreatomateRenderResponse> {
    const body: Record<string, unknown> = {
      template_id: options.templateId,
      render_scale: options.renderScale ?? 10,
    };

    if (options.webhookUrl) {
      body.webhook_url = options.webhookUrl;
    }

    const data = await this.request<CreatomateRenderResponse | CreatomateRenderResponse[]>(
      "/renders",
      {
        method: "POST",
        body: JSON.stringify(body),
      }
    );

    return Array.isArray(data) ? data[0] : data;
  }

  async getRenderStatus(renderId: string): Promise<CreatomateRenderResponse> {
    return this.request<CreatomateRenderResponse>(`/renders/${renderId}`);
  }

  async generatePreview(
    options: CreatomateRenderOptions
  ): Promise<CreatomatePreviewResult> {
    try {
      const render = await this.createRender({
        ...options,
        renderScale: 10,
      });

      let attempts = 0;
      const maxAttempts = 60;

      while (attempts < maxAttempts) {
        const status = await this.getRenderStatus(render.id);

        if (status.status === "succeeded" && status.url) {
          const thumbnailUrl = await this.extractThumbnailFromVideo(status.url);

          return {
            success: true,
            videoPreviewUrl: status.url,
            thumbnailUrl,
          };
        }

        if (status.status === "failed") {
          return {
            success: false,
            error: status.error_message ?? "Render failed",
          };
        }

        await new Promise((resolve) => setTimeout(resolve, 1000));
        attempts++;
      }

      return {
        success: false,
        error: "Timeout waiting for render",
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  private async extractThumbnailFromVideo(
    videoUrl: string
  ): Promise<string | undefined> {
    try {
      const body = {
        source: {
          output_format: "jpg",
          snapshot_time: 1,
          elements: [
            {
              type: "video",
              source: videoUrl,
            },
          ],
        },
      };

      const data = await this.request<CreatomateRenderResponse | CreatomateRenderResponse[]>(
        "/renders",
        {
          method: "POST",
          body: JSON.stringify(body),
        }
      );

      const renderResult = Array.isArray(data) ? data[0] : data;

      if (renderResult.status === "succeeded" && renderResult.url) {
        return renderResult.url;
      }

      if (renderResult.status === "failed") {
        console.warn(
          `Thumbnail extraction failed: ${renderResult.error_message}`
        );
        return undefined;
      }

      const thumbnailUrl = await this.waitForRender(renderResult.id);
      return thumbnailUrl;
    } catch (error) {
      console.warn("Failed to extract thumbnail:", error);
      return undefined;
    }
  }

  private async waitForRender(
    renderId: string,
    maxAttempts = 30
  ): Promise<string | undefined> {
    let attempts = 0;

    while (attempts < maxAttempts) {
      const status = await this.getRenderStatus(renderId);

      if (status.status === "succeeded" && status.url) {
        return status.url;
      }

      if (status.status === "failed") {
        return undefined;
      }

      await new Promise((resolve) => setTimeout(resolve, 1000));
      attempts++;
    }

    return undefined;
  }
}

let cachedGateway: CreatomateGateway | null = null;

export function getCreatomateGateway(): CreatomateGateway {
  if (cachedGateway) {
    return cachedGateway;
  }

  const key =
    process.env.CREATOMATE_API_KEY ?? process.env.creatomate_api_key;
  if (!key) {
    throw new Error("Missing CREATOMATE_API_KEY environment variable");
  }

  cachedGateway = new CreatomateGateway(key);
  return cachedGateway;
}