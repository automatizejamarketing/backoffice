// =============================================
// Canvas Editor Layer Types
// =============================================

/**
 * Base layer properties shared by all layer types
 */
export type BaseLayer = {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  // Position & size
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  opacity: number;
};

/**
 * Image layer data for background images or imported images
 */
export type ImageLayerData = {
  type: "image";
  src: string; // base64 or URL
  fit: "cover" | "contain" | "fill" | "none";
};

/**
 * Text layer data for text elements
 */
export type TextLayerData = {
  type: "text";
  text: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900;
  fontStyle: "normal" | "italic";
  color: string;
  textAlign: "left" | "center" | "right";
  lineHeight: number;
  letterSpacing: number;
  textDecoration: "none" | "underline" | "line-through";
};

/**
 * Shape layer data for geometric shapes
 */
export type ShapeLayerData = {
  type: "shape";
  shape: "rectangle" | "circle" | "ellipse" | "line";
  fill: string;
  stroke: string;
  strokeWidth: number;
  borderRadius: number;
};

/**
 * Union type for layer data
 */
export type LayerData = ImageLayerData | TextLayerData | ShapeLayerData;

/**
 * Complete Layer type combining base properties with specific data
 */
export type Layer = BaseLayer & { data: LayerData };

/**
 * Post status for tracking the lifecycle of a post
 */
export type PostStatus = "draft" | "ready" | "scheduled" | "posted" | "failed";
