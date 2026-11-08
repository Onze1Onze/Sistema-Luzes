import type { AnimationConfig, AnimationType, LightConfig, LightRecord } from "./types";
import { DEFAULT_CONFIG, LIGHT_META_KEY } from "./types";

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const finite = (value: unknown, fallback: number) => (typeof value === "number" && Number.isFinite(value) ? value : fallback);

export function validateConfig(value: unknown): LightConfig {
  const input = (value && typeof value === "object" ? value : {}) as Partial<LightConfig>;
  const animation = (input.animation && typeof input.animation === "object" ? input.animation : {}) as Partial<AnimationConfig>;
  const validTypes: AnimationType[] = ["STATIC", "BLINK", "PULSE", "FLICKER", "EMERGENCY", "OSCILLATE", "CUSTOM"];
  const type = validTypes.includes(animation.type as AnimationType) ? (animation.type as AnimationType) : "STATIC";
  const color = typeof input.color === "string" && /^#[0-9a-fA-F]{6}$/.test(input.color) ? input.color : DEFAULT_CONFIG.color;
  const offset = input.offset && typeof input.offset === "object" ? input.offset : { x: 0, y: 0 };
  return {
    name: typeof input.name === "string" ? input.name.slice(0, 48) : DEFAULT_CONFIG.name,
    color,
    intensity: clamp(finite(input.intensity, DEFAULT_CONFIG.intensity), 0, 2.5),
    opacity: clamp(finite(input.opacity, DEFAULT_CONFIG.opacity), 0, 1),
    falloff: clamp(finite(input.falloff, DEFAULT_CONFIG.falloff), 0, 1),
    softness: clamp(finite(input.softness, DEFAULT_CONFIG.softness), 0, 240),
    temperature: clamp(finite(input.temperature, DEFAULT_CONFIG.temperature), 1600, 10000),
    beamAngle: clamp(finite(input.beamAngle, DEFAULT_CONFIG.beamAngle), 12, 360),
    enabled: typeof input.enabled === "boolean" ? input.enabled : true,
    locked: typeof input.locked === "boolean" ? input.locked : false,
    visibility: input.visibility === "GM_ONLY" ? "GM_ONLY" : "ALL",
    linkedTokenId: typeof input.linkedTokenId === "string" && input.linkedTokenId.length ? input.linkedTokenId : null,
    offset: { x: clamp(finite(offset.x, 0), -10000, 10000), y: clamp(finite(offset.y, 0), -10000, 10000) },
    animation: {
      type,
      speed: clamp(finite(animation.speed, 1), 0.05, 8),
      min: clamp(finite(animation.min, 0.25), 0, 1),
      max: clamp(finite(animation.max, 1), 0, 1),
      frequency: clamp(finite(animation.frequency, 4), 0.1, 30),
      irregularity: clamp(finite(animation.irregularity, 0.5), 0, 1),
      interval: clamp(finite(animation.interval, 0.5), 0.05, 5),
      phase: finite(animation.phase, 0),
      startedAt: finite(animation.startedAt, Date.now() / 1000),
    },
  };
}

export function configFromItem(item: any): LightConfig | null {
  const raw = item?.metadata?.[LIGHT_META_KEY];
  if (!raw || typeof raw !== "object") return null;
  return validateConfig(raw);
}

export function getLightRecords(items: any[]): LightRecord[] {
  const tokenMap = new Map<string, any>();
  for (const item of items) {
    if (item.layer === "CHARACTER") tokenMap.set(item.id, item);
  }
  const records: LightRecord[] = [];
  for (const item of items) {
    const config = configFromItem(item);
    if (!config) continue;
    const radius = clamp(finite(item.width, 240) / 2, 24, 5000);
    const token = config.linkedTokenId ? tokenMap.get(config.linkedTokenId) : null;
    const effectiveConfig = config.linkedTokenId && !token ? { ...config, linkedTokenId: null, offset: { x: 0, y: 0 } } : config;
    const position = token
      ? { x: token.position.x + config.offset.x, y: token.position.y + config.offset.y }
      : { x: item.position.x, y: item.position.y };
    records.push({ id: item.id, item, config: effectiveConfig, radius, rotation: finite(item.rotation, 0), position });
  }
  return records;
}

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const clean = hex.replace("#", "");
  return {
    r: parseInt(clean.slice(0, 2), 16) / 255,
    g: parseInt(clean.slice(2, 4), 16) / 255,
    b: parseInt(clean.slice(4, 6), 16) / 255,
  };
}

export function temperatureTint(kelvin: number): { r: number; g: number; b: number } {
  const t = clamp(kelvin, 1600, 10000) / 100;
  const r = t <= 66 ? 1 : clamp(1.292936186 * Math.pow(t - 60, -0.1332047592), 0, 1);
  const g = t <= 66 ? clamp(0.390081579 * Math.log(t) - 0.631841444, 0, 1) : clamp(1.129890861 * Math.pow(t - 60, -0.0755148492), 0, 1);
  const b = t >= 66 ? 1 : t <= 19 ? 0 : clamp(0.543206789 * Math.log(t - 10) - 1.196254089, 0, 1);
  return { r, g, b };
}

export function finalLightColor(config: LightConfig): { x: number; y: number; z: number } {
  const rgb = hexToRgb(config.color);
  const temp = temperatureTint(config.temperature);
  const blend = 0.28;
  return {
    x: clamp(rgb.r * (1 - blend) + temp.r * blend, 0, 1),
    y: clamp(rgb.g * (1 - blend) + temp.g * blend, 0, 1),
    z: clamp(rgb.b * (1 - blend) + temp.b * blend, 0, 1),
  };
}

export function animationLevel(animation: AnimationConfig, unixSeconds: number): number {
  const elapsed = Math.max(0, unixSeconds - animation.startedAt) * animation.speed;
  const lo = Math.min(animation.min, animation.max);
  const hi = Math.max(animation.min, animation.max);
  const fract = (value: number) => value - Math.floor(value);
  const smooth = (value: number) => {
    const t = clamp(value, 0, 1);
    return t * t * (3 - 2 * t);
  };
  const hash = (step: number) => fract(
    Math.sin((step + animation.phase) * 127.1 + 311.7) * 43758.5453123,
  );
  const smoothNoise = (value: number) => {
    const step = Math.floor(value);
    const blend = smooth(fract(value));
    return hash(step) * (1 - blend) + hash(step + 1) * blend;
  };
  const pulse = (cycle: number, center: number, width: number) => {
    const raw = Math.abs(cycle - center);
    const distance = Math.min(raw, 1 - raw);
    const envelope = 1 - smooth(distance / width);
    return envelope * envelope;
  };

  let level = 1;
  switch (animation.type) {
    case "BLINK": {
      const wave = 0.5 + 0.5 * Math.sin(elapsed * animation.frequency * Math.PI * 2);
      level = smooth((wave - 0.25) / 0.5);
      break;
    }
    case "PULSE":
      level = 0.5 - 0.5 * Math.cos(elapsed * Math.PI * 2);
      break;
    case "FLICKER": {
      const slow = smoothNoise(elapsed * animation.frequency * 0.72);
      const fast = smoothNoise(elapsed * animation.frequency * 2.15 + animation.phase * 0.37);
      const flutter = 0.5 + 0.5 * Math.sin(elapsed * animation.frequency * 6.1 + animation.phase);
      level = 0.22 + 0.78 * (slow * 0.52 + fast * 0.34 + flutter * 0.14);
      break;
    }
    case "EMERGENCY": {
      const cycle = fract(elapsed * animation.frequency);
      const flash = Math.max(pulse(cycle, 0.14, 0.12), pulse(cycle, 0.37, 0.12));
      level = 0.035 + 0.965 * flash;
      break;
    }
    case "OSCILLATE":
      level = 0.5 + 0.5 * Math.sin(elapsed * Math.PI * 1.2 + animation.phase);
      break;
    case "CUSTOM":
      level = smoothNoise(elapsed / Math.max(0.05, animation.interval) + animation.phase * 0.11);
      break;
    default:
      level = 1;
  }
  return clamp(lo + (hi - lo) * level, 0, 1);
}

export function isAnimated(config: LightConfig): boolean {
  return config.animation.type !== "STATIC" && config.enabled;
}
