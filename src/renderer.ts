import OBR, { buildEffect, buildLight, buildShape } from "@owlbear-rodeo/sdk";
import type { LightConfig, LightRecord } from "./types";
import { LOCAL_META_KEY } from "./types";
import { animationLevel, finalLightColor, getLightRecords, isAnimated } from "./utils";

type Role = "GM" | "PLAYER";
type AnyItem = any;

const MAX_SOFT_SHADOW_LIGHTS = 24;
const MAX_COLOR_EFFECTS = 64;

const SHADER = `
uniform vec2 size;
uniform vec3 lightColor;
uniform float intensity;
uniform float opacity;
uniform float falloff;
uniform float pattern;
uniform float speed;
uniform float minLevel;
uniform float maxLevel;
uniform float frequency;
uniform float irregularity;
uniform float interval;
uniform float phase;
uniform float startedAt;
uniform float time;
uniform shader scene;
uniform mat3 modelView;

float noise1(float value) {
  return fract(sin(value * 127.1 + phase * 311.7) * 43758.5453);
}

float animationFactor() {
  float elapsed = max(0.0, time - startedAt) * speed;
  float lo = min(minLevel, maxLevel);
  float hi = max(minLevel, maxLevel);
  float wave = 0.5 + 0.5 * sin(elapsed * 6.2831853);
  float cycle = fract(elapsed * frequency);
  float result = 1.0;

  if (pattern > 0.5 && pattern < 1.5) {
    result = cycle < 0.5 ? hi : lo;
  } else if (pattern > 1.5 && pattern < 2.5) {
    result = mix(lo, hi, wave);
  } else if (pattern > 2.5 && pattern < 3.5) {
    float n = noise1(floor(elapsed * frequency));
    float w = 0.5 + 0.5 * sin(elapsed * frequency * 9.1 + phase);
    result = mix(lo, hi, mix(0.5, n * 0.72 + w * 0.28, irregularity));
  } else if (pattern > 3.5 && pattern < 4.5) {
    bool isOn = cycle < 0.13 || (cycle > 0.27 && cycle < 0.40);
    result = isOn ? hi : lo;
  } else if (pattern > 4.5 && pattern < 5.5) {
    result = mix(lo, hi, 0.5 + 0.5 * sin(elapsed * 1.8849556 + phase));
  } else if (pattern > 5.5) {
    float n = noise1(floor(elapsed / max(0.05, interval)));
    result = mix(lo, hi, n);
  }
  return clamp(result, 0.0, 1.0);
}

half4 main(float2 coord) {
  vec2 local = coord / size * 2.0 - 1.0;
  float distanceFromCenter = length(local);
  float fadeStart = clamp(0.02 + (1.0 - falloff) * 0.78, 0.02, 0.97);
  float mask = 1.0 - smoothstep(fadeStart, 1.0, distanceFromCenter);
  float radial = pow(clamp(mask, 0.0, 1.0), mix(1.0, 2.7, falloff));
  float modulation = animationFactor();
  float strength = clamp(intensity * opacity * modulation * radial, 0.0, 0.92);

  vec2 scenePosition = (vec3(coord, 1.0) * modelView).xy;
  half4 base = scene.eval(scenePosition);
  vec3 tint = clamp(lightColor * strength, 0.0, 0.92);
  vec3 lit = 1.0 - (1.0 - base.rgb) * (1.0 - tint);
  return half4(lit, base.a);
}
`;

function patternNumber(type: LightConfig["animation"]["type"]): number {
  return {
    STATIC: 0,
    BLINK: 1,
    PULSE: 2,
    FLICKER: 3,
    EMERGENCY: 4,
    OSCILLATE: 5,
    CUSTOM: 6,
  }[type];
}

function effectUniforms(config: LightConfig): any[] {
  const color = finalLightColor(config);
  return [
    { name: "lightColor", value: color },
    { name: "intensity", value: config.intensity },
    { name: "opacity", value: config.opacity },
    { name: "falloff", value: config.falloff },
    { name: "pattern", value: patternNumber(config.animation.type) },
    { name: "speed", value: config.animation.speed },
    { name: "minLevel", value: config.animation.min },
    { name: "maxLevel", value: config.animation.max },
    { name: "frequency", value: config.animation.frequency },
    { name: "irregularity", value: config.animation.irregularity },
    { name: "interval", value: config.animation.interval },
    { name: "phase", value: config.animation.phase },
    { name: "startedAt", value: config.animation.startedAt },
  ];
}

function isVisibleForRole(config: LightConfig, role: Role): boolean {
  return config.enabled && (config.visibility === "ALL" || role === "GM");
}

function localMeta(item: AnyItem): { sourceId: string; kind: string } | null {
  const data = item?.metadata?.[LOCAL_META_KEY];
  return data && typeof data.sourceId === "string" && typeof data.kind === "string" ? data : null;
}

function buildFogItem(record: LightRecord, visible: boolean, softness: number): AnyItem {
  const builder = buildLight()
    .name(`SL/Fog/${record.config.name}`)
    .position(record.position)
    .attenuationRadius(record.radius)
    .sourceRadius(softness)
    .falloff(record.config.falloff)
    .visible(visible)
    .locked(true)
    .disableHit(true)
    .metadata({ [LOCAL_META_KEY]: { sourceId: record.id, kind: "fog" } });
  if (record.config.linkedTokenId) builder.attachedTo(record.config.linkedTokenId);
  return builder.build();
}

function buildGlowItem(record: LightRecord, visible: boolean): AnyItem {
  return buildEffect()
    .name(`SL/Glow/${record.config.name}`)
    .effectType("STANDALONE")
    .position(record.position)
    .width(record.radius * 2)
    .height(record.radius * 2)
    .sksl(SHADER)
    .uniforms(effectUniforms(record.config))
    .blendMode("SRC")
    .layer("POST_PROCESS")
    .visible(visible)
    .locked(true)
    .disableHit(true)
    .metadata({ [LOCAL_META_KEY]: { sourceId: record.id, kind: "glow" } })
    .build();
}

function buildSelectionRing(record: LightRecord): AnyItem {
  return buildShape()
    .name("SL/Selection")
    .shapeType("CIRCLE")
    .position(record.position)
    .width(record.radius * 2)
    .height(record.radius * 2)
    .fillColor(record.config.color)
    .fillOpacity(0)
    .strokeColor("#f0b36b")
    .strokeOpacity(0.9)
    .strokeWidth(2)
    .strokeDash([9, 6])
    .layer("CONTROL")
    .locked(true)
    .disableHit(true)
    .metadata({ [LOCAL_META_KEY]: { sourceId: record.id, kind: "selection" } })
    .build();
}

function buildSelectionHandle(record: LightRecord): AnyItem {
  return buildShape()
    .name("SL/Resize Handle")
    .shapeType("CIRCLE")
    .position({ x: record.position.x + record.radius, y: record.position.y })
    .width(14)
    .height(14)
    .fillColor("#f0b36b")
    .fillOpacity(1)
    .strokeColor("#201713")
    .strokeOpacity(1)
    .strokeWidth(2)
    .layer("CONTROL")
    .locked(true)
    .disableHit(true)
    .metadata({ [LOCAL_META_KEY]: { sourceId: record.id, kind: "handle" } })
    .build();
}

export class LightingRenderer {
  private latestItems: AnyItem[] = [];
  private role: Role = "PLAYER";
  private selectedId: string | null = null;
  private scheduleHandle: number | null = null;
  private animationHandle: number | null = null;
  private lastFogVisibility = new Map<string, boolean>();
  private localItems: AnyItem[] = [];

  setContext(items: AnyItem[], role: Role, selectedId: string | null): void {
    this.latestItems = items;
    this.role = role;
    this.selectedId = selectedId;
    if (this.scheduleHandle !== null) window.clearTimeout(this.scheduleHandle);
    this.scheduleHandle = window.setTimeout(() => {
      this.scheduleHandle = null;
      void this.reconcile();
    }, 45);
  }

  async reconcile(): Promise<void> {
    try {
      const records = getLightRecords(this.latestItems);
      const localItems = await OBR.scene.local.getItems();
      this.localItems = localItems;
      const managed = localItems.filter((item) => localMeta(item));
      const bySourceKind = new Map<string, AnyItem>();
      for (const item of managed) {
        const meta = localMeta(item);
        if (meta) bySourceKind.set(`${meta.sourceId}:${meta.kind}`, item);
      }

      const desired = new Set<string>();
      const additions: AnyItem[] = [];
      const updates: { item: AnyItem; record: LightRecord; visible: boolean; softness: number }[] = [];
      let softCount = 0;
      const effectRecords = [...records].sort((a, b) => b.config.intensity * b.radius - a.config.intensity * a.radius);
      const effectEligible = new Set(effectRecords.slice(0, MAX_COLOR_EFFECTS).map((record) => record.id));

      for (const record of records) {
        const visible = isVisibleForRole(record.config, this.role);
        const softness = record.config.softness > 0 && softCount < MAX_SOFT_SHADOW_LIGHTS ? record.config.softness : 0;
        if (softness > 0) softCount++;
        desired.add(`${record.id}:fog`);
        desired.add(`${record.id}:glow`);
        const fog = bySourceKind.get(`${record.id}:fog`);
        const glow = bySourceKind.get(`${record.id}:glow`);
        if (fog) updates.push({ item: fog, record, visible, softness });
        else additions.push(buildFogItem(record, visible, softness));
        if (glow) updates.push({ item: glow, record, visible: visible && effectEligible.has(record.id), softness });
        else additions.push(buildGlowItem(record, visible && effectEligible.has(record.id)));
      }

      const selected = this.role === "GM" ? records.find((record) => record.id === this.selectedId) : undefined;
      if (selected) {
        desired.add(`${selected.id}:selection`);
        desired.add(`${selected.id}:handle`);
        const ring = bySourceKind.get(`${selected.id}:selection`);
        const handle = bySourceKind.get(`${selected.id}:handle`);
        if (ring) {
          const meta = localMeta(ring);
          if (meta) updates.push({ item: ring, record: selected, visible: true, softness: 0 });
        } else additions.push(buildSelectionRing(selected));
        if (handle) {
          const meta = localMeta(handle);
          if (meta) updates.push({ item: handle, record: selected, visible: true, softness: 0 });
        } else additions.push(buildSelectionHandle(selected));
      }

      const stale = managed.filter((item) => {
        const meta = localMeta(item);
        return !meta || !desired.has(`${meta.sourceId}:${meta.kind}`);
      });
      if (stale.length) await OBR.scene.local.deleteItems(stale.map((item) => item.id));

      const fogUpdates = updates.filter((entry) => localMeta(entry.item)?.kind === "fog");
      const glowUpdates = updates.filter((entry) => localMeta(entry.item)?.kind === "glow");
      const ringUpdates = updates.filter((entry) => localMeta(entry.item)?.kind === "selection");
      const handleUpdates = updates.filter((entry) => localMeta(entry.item)?.kind === "handle");
      if (fogUpdates.length) await OBR.scene.local.updateItems(fogUpdates.map((entry) => entry.item), (draft: any[]) => {
        for (const item of draft) {
          const meta = localMeta(item);
          const entry = fogUpdates.find((candidate) => localMeta(candidate.item)?.sourceId === meta?.sourceId);
          if (!entry) continue;
          item.position = entry.record.position;
          item.attenuationRadius = entry.record.radius;
          item.sourceRadius = entry.softness;
          item.falloff = entry.record.config.falloff;
          item.visible = entry.visible;
        }
      });
      if (glowUpdates.length) await OBR.scene.local.updateItems(glowUpdates.map((entry) => entry.item), (draft: any[]) => {
        for (const item of draft) {
          const meta = localMeta(item);
          const entry = glowUpdates.find((candidate) => localMeta(candidate.item)?.sourceId === meta?.sourceId);
          if (!entry) continue;
          item.position = entry.record.position;
          item.width = entry.record.radius * 2;
          item.height = entry.record.radius * 2;
          item.uniforms = effectUniforms(entry.record.config);
          item.visible = entry.visible && effectEligible.has(entry.record.id);
        }
      });
      if (ringUpdates.length) await OBR.scene.local.updateItems(ringUpdates.map((entry) => entry.item), (draft: any[]) => {
        for (const item of draft) {
          const meta = localMeta(item);
          const entry = ringUpdates.find((candidate) => localMeta(candidate.item)?.sourceId === meta?.sourceId);
          if (!entry) continue;
          item.position = entry.record.position;
          item.width = entry.record.radius * 2;
          item.height = entry.record.radius * 2;
        }
      });
      if (handleUpdates.length) await OBR.scene.local.updateItems(handleUpdates.map((entry) => entry.item), (draft: any[]) => {
        for (const item of draft) {
          const meta = localMeta(item);
          const entry = handleUpdates.find((candidate) => localMeta(candidate.item)?.sourceId === meta?.sourceId);
          if (entry) item.position = { x: entry.record.position.x + entry.record.radius, y: entry.record.position.y };
        }
      });
      if (additions.length) await OBR.scene.local.addItems(additions);
      this.localItems = await OBR.scene.local.getItems();
      this.refreshAnimationScheduler(records);
    } catch (error) {
      console.error("[Sistema de Luzes] Falha ao reconciliar iluminação local:", error);
    }
  }

  private refreshAnimationScheduler(records: LightRecord[]): void {
    const needsScheduler = records.some((record) => {
      const type = record.config.animation.type;
      return isAnimated(record.config) && (type === "BLINK" || type === "EMERGENCY" || type === "FLICKER" || type === "CUSTOM");
    });
    if (!needsScheduler && this.animationHandle !== null) {
      window.clearInterval(this.animationHandle);
      this.animationHandle = null;
      return;
    }
    if (!needsScheduler || this.animationHandle !== null) return;

    this.animationHandle = window.setInterval(() => {
      const now = Date.now() / 1000;
      const currentRecords = getLightRecords(this.latestItems);
      const updates = currentRecords.filter((record) => {
        if (!isVisibleForRole(record.config, this.role)) return false;
        const type = record.config.animation.type;
        if (!(type === "BLINK" || type === "EMERGENCY" || type === "FLICKER" || type === "CUSTOM")) return false;
        const shouldShow = animationLevel(record.config.animation, now) > 0.08;
        const previous = this.lastFogVisibility.get(record.id);
        this.lastFogVisibility.set(record.id, shouldShow);
        return previous === undefined || previous !== shouldShow;
      });
      if (!updates.length) return;
      const updateById = new Map(updates.map((record) => [record.id, animationLevel(record.config.animation, now) > 0.08]));
      const fogItems = this.localItems.filter((item) => {
        const meta = localMeta(item);
        return meta?.kind === "fog" && updateById.has(meta.sourceId);
      });
      if (fogItems.length) {
        void OBR.scene.local.updateItems(fogItems, (draft: any[]) => {
          for (const item of draft) {
            const meta = localMeta(item);
            if (meta) item.visible = updateById.get(meta.sourceId) ?? true;
          }
        });
      }
    }, 110);
  }

  dispose(): void {
    if (this.scheduleHandle !== null) window.clearTimeout(this.scheduleHandle);
    if (this.animationHandle !== null) window.clearInterval(this.animationHandle);
    this.scheduleHandle = null;
    this.animationHandle = null;
  }
}

export function findRecordAt(items: AnyItem[], point: { x: number; y: number }, selectedId: string | null): { record: LightRecord; resize: boolean } | null {
  const records = getLightRecords(items);
  let best: { record: LightRecord; distance: number } | null = null;
  for (const record of records) {
    const distance = Math.hypot(point.x - record.position.x, point.y - record.position.y);
    const innerHit = distance <= Math.max(38, Math.min(record.radius, 180));
    const edgeHit = record.id === selectedId && Math.abs(distance - record.radius) <= Math.max(34, record.radius * 0.12);
    if (!innerHit && !edgeHit) continue;
    if (!best || distance < best.distance) best = { record, distance };
  }
  if (!best) return null;
  const resize = best.record.id === selectedId && Math.abs(best.distance - best.record.radius) < Math.max(34, best.record.radius * 0.12);
  return { record: best.record, resize };
}
