export const modelConfig = {
  image: {
    provider: "google" as const,
    model: "google/gemini-3-pro-image",
  },
  text: {
    provider: "google" as const,
    model: "google/gemini-2.5-flash-lite",
  },
} as const;

export const AI_MODELS = {
  IMAGE_GENERATION: modelConfig.image.model,
  TEXT_GENERATION: modelConfig.text.model,
} as const;

export const ASPECT_RATIO_DIMENSIONS: Record<
  string,
  { width: number; height: number; label: string }
> = {
  "1:1": { width: 1024, height: 1024, label: "Quadrado" },
  "16:9": { width: 1536, height: 864, label: "Paisagem" },
  "9:16": { width: 864, height: 1536, label: "Retrato" },
  "4:3": { width: 1152, height: 864, label: "Padrão" },
  "3:4": { width: 864, height: 1152, label: "Retrato" },
  "21:9": { width: 1536, height: 658, label: "Cinematográfico" },
};
