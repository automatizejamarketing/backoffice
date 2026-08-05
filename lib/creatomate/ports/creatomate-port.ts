import type {
  CreatomateRenderResponse,
  CreatomateTemplateResponse,
  CreatomateRenderOptions,
  CreatomatePreviewResult,
  CreatomateTemplateDetails,
} from "../types";

export interface CreatomatePort {
  getTemplate(templateId: string): Promise<CreatomateTemplateResponse>;
  getTemplateDetails(templateId: string): Promise<CreatomateTemplateDetails>;
  getTemplateThumbnail(templateId: string): Promise<string | undefined>;
  createRender(options: CreatomateRenderOptions): Promise<CreatomateRenderResponse>;
  getRenderStatus(renderId: string): Promise<CreatomateRenderResponse>;
  generatePreview(options: CreatomateRenderOptions): Promise<CreatomatePreviewResult>;
}