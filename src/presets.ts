import type { LightPreset } from "./types";
import { DEFAULT_CONFIG } from "./types";

const base = (patch: Partial<LightPreset["config"]>): LightPreset["config"] => ({
  name: patch.name ?? DEFAULT_CONFIG.name,
  color: patch.color ?? DEFAULT_CONFIG.color,
  intensity: patch.intensity ?? DEFAULT_CONFIG.intensity,
  opacity: patch.opacity ?? DEFAULT_CONFIG.opacity,
  falloff: patch.falloff ?? DEFAULT_CONFIG.falloff,
  softness: patch.softness ?? DEFAULT_CONFIG.softness,
  temperature: patch.temperature ?? DEFAULT_CONFIG.temperature,
  beamAngle: patch.beamAngle ?? DEFAULT_CONFIG.beamAngle,
  enabled: patch.enabled ?? DEFAULT_CONFIG.enabled,
  animation: { ...DEFAULT_CONFIG.animation, ...(patch.animation ?? {}) },
});

export const BUILT_IN_PRESETS: LightPreset[] = [
  { id: "bulb", name: "Lâmpada", config: base({ color: "#fff1d6", intensity: 0.9, opacity: 0.42, falloff: 0.78, temperature: 5200 }) },
  { id: "torch", name: "Tocha", config: base({ color: "#ff8b3d", intensity: 1.15, opacity: 0.62, falloff: 0.62, temperature: 2100, animation: { ...DEFAULT_CONFIG.animation, type: "FLICKER", speed: 1.1, min: 0.7, max: 1, frequency: 7, irregularity: 0.72 } }) },
  { id: "emergency", name: "Emergência", config: base({ color: "#f12d36", intensity: 1.25, opacity: 0.68, falloff: 0.85, temperature: 2600, animation: { ...DEFAULT_CONFIG.animation, type: "EMERGENCY", speed: 1, min: 0.05, max: 1, frequency: 2.4, interval: 0.2 } }) },
  { id: "phone", name: "Celular", config: base({ color: "#b9d9ff", intensity: 0.64, opacity: 0.32, falloff: 0.9, temperature: 7200 }) },
  { id: "fire", name: "Fogueira", config: base({ color: "#ff9b32", intensity: 1.35, opacity: 0.72, falloff: 0.52, softness: 0, temperature: 1900, animation: { ...DEFAULT_CONFIG.animation, type: "FLICKER", speed: 0.75, min: 0.62, max: 1, frequency: 5, irregularity: 0.9 } }) },
  { id: "paranormal", name: "Energia paranormal", config: base({ color: "#a44bdb", intensity: 1.25, opacity: 0.64, falloff: 0.76, temperature: 7800, animation: { ...DEFAULT_CONFIG.animation, type: "PULSE", speed: 0.45, min: 0.35, max: 1, irregularity: 0.45 } }) },
  { id: "blue", name: "Luz fria", config: base({ color: "#5c9eff", intensity: 0.95, opacity: 0.5, falloff: 0.8, temperature: 8500 }) },
  { id: "green", name: "Luz verde", config: base({ color: "#56e0a0", intensity: 0.9, opacity: 0.48, falloff: 0.75, temperature: 6500 }) },
  { id: "cyan", name: "Luz ciano", config: base({ color: "#43dce5", intensity: 0.9, opacity: 0.5, falloff: 0.8, temperature: 7000 }) },
];
