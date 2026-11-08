export const EXTENSION_ID = "com.onze1onze.sistema-luzes";
export const LIGHT_META_KEY = `${EXTENSION_ID}/light`;
export const LOCAL_META_KEY = `${EXTENSION_ID}/local`;
export const PLAYER_META_KEY = `${EXTENSION_ID}/player`;
export const TOOL_ID = `${EXTENSION_ID}/tool`;
export const TOOL_MODE_ID = `${TOOL_ID}/select`;
export const TOOL_ADD_ACTION_ID = `${TOOL_ID}/add`;

export type AnimationType =
  | "STATIC"
  | "BLINK"
  | "PULSE"
  | "FLICKER"
  | "EMERGENCY"
  | "OSCILLATE"
  | "CUSTOM";

export type VisibilityMode = "ALL" | "GM_ONLY";

export interface AnimationConfig {
  type: AnimationType;
  speed: number;
  min: number;
  max: number;
  frequency: number;
  irregularity: number;
  interval: number;
  phase: number;
  startedAt: number;
}

export interface LightConfig {
  name: string;
  color: string;
  intensity: number;
  opacity: number;
  falloff: number;
  softness: number;
  temperature: number;
  beamAngle: number;
  enabled: boolean;
  locked: boolean;
  visibility: VisibilityMode;
  linkedTokenId: string | null;
  offset: { x: number; y: number };
  animation: AnimationConfig;
}

export interface LightPreset {
  id: string;
  name: string;
  config: Omit<LightConfig, "linkedTokenId" | "offset" | "locked" | "visibility">;
}

export interface TokenOption {
  id: string;
  name: string;
  position: { x: number; y: number };
}

export interface LightRecord {
  id: string;
  item: any;
  config: LightConfig;
  radius: number;
  rotation: number;
  position: { x: number; y: number };
}

export const DEFAULT_CONFIG: LightConfig = {
  name: "Nova luz",
  color: "#ffd69a",
  intensity: 1,
  opacity: 0.48,
  falloff: 0.72,
  softness: 0,
  temperature: 4200,
  beamAngle: 360,
  enabled: true,
  locked: false,
  visibility: "ALL",
  linkedTokenId: null,
  offset: { x: 0, y: 0 },
  animation: {
    type: "STATIC",
    speed: 1,
    min: 0.25,
    max: 1,
    frequency: 4,
    irregularity: 0.55,
    interval: 0.5,
    phase: Math.random() * 1000,
    startedAt: Date.now() / 1000,
  },
};
