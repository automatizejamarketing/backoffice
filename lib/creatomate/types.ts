export type CreatomateRenderStatus = "planned" | "rendering" | "succeeded" | "failed";

export interface CreatomateRenderResponse {
  id: string;
  status: CreatomateRenderStatus;
  url?: string;
  template_id: string;
  metadata?: string;
  error_message?: string;
}

export interface CreatomateTemplateResponse {
  id: string;
  name: string;
  source?: {
    elements?: CreatomateTemplateElement[];
  };
}

export interface CreatomateTemplateElement {
  id: string;
  name?: string;
  type?: string;
  elements?: CreatomateTemplateElement[];
}

export interface CreatomatePreviewResult {
  success: boolean;
  videoPreviewUrl?: string;
  thumbnailUrl?: string;
  error?: string;
}

export interface CreatomateRenderOptions {
  templateId: string;
  videoSourceKey?: string;
  renderScale?: number;
  webhookUrl?: string;
}

export interface CreatomateTemplateDetails {
  id: string;
  name: string;
  thumbnail_url?: string;
  preview_url?: string;
  source?: {
    elements?: CreatomateTemplateElement[];
  };
}