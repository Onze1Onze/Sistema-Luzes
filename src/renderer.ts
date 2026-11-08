import OBR, { buildEffect, buildLabel, buildLight, buildShape } from "@owlbear-rodeo/sdk";
import type { LightConfig, LightRecord } from "./types";
import { LOCAL_META_KEY } from "./types";
import { animationLevel, finalLightColor, getLightRecords, isAnimated } from "./utils";

type Role = "GM" | "PLAYER";
type AnyItem = any;
export type LightControlMode = "MOVE" | "ROTATE" | "RESIZE";

const MAX_COLOR_EFFECTS = 64;
const BUTTON_SIZE = 32;
const BUTTON_HIT_RADIUS = 22;
const BUTTON_GAP = 8;

const SHADER = `
uniform vec2 size;
uniform vec3 lightColor;
uniform float intensity;
uniform float opacity;
uniform float falloff;
uniform float modulation;
uniform float rotation;
uniform float beamAngle;
uniform shader scene;
uniform mat3 modelView;

half4 main(float2 coord) {
  vec2 local = coord / size * 2.0 - 1.0;
  float distanceFromCenter = length(local);
  float edge = 1.0 - smoothstep(0.78, 1.0, distanceFromCenter);
  float diffuse = exp(-distanceFromCenter * distanceFromCenter * (1.6 + falloff * 2.8));
  float core = exp(-distanceFromCenter * distanceFromCenter * 12.0);
  float radial = edge * (0.22 + 0.78 * diffuse);

  float cone = 1.0;
  if (beamAngle < 359.5) {
    const float PI = 3.14159265;
    float fragmentAngle = atan(local.y, local.x);
    float direction = radians(rotation);
    float difference = abs(mod(fragmentAngle - direction + PI, 2.0 * PI) - PI);
    float halfAngle = radians(beamAngle) * 0.5;
    float feather = max(radians(2.5), radians(beamAngle * 0.16));
    cone = 1.0 - smoothstep(max(0.0, halfAngle - feather), halfAngle + 0.0001, difference);
  }

  vec2 scenePosition = (vec3(coord, 1.0) * modelView).xy;
  half4 base = scene.eval(scenePosition);
  float strength = clamp(intensity * opacity * modulation * radial * cone, 0.0, 0.82);
  vec3 warmCore = lightColor * (0.82 + 0.22 * core);
  vec3 lit = base.rgb + warmCore * strength * (1.0 - base.rgb);
  return half4(clamp(lit, 0.0, 1.0), base.a);
}
`;

function normalizedAngle(angle: number): number {
  return ((angle % 360) + 360) % 360;
}

function isVisibleForRole(config: LightConfig, role: Role): boolean {
  return config.enabled && (config.visibility === "ALL" || role === "GM");
}

function localMeta(item: AnyItem): { sourceId: string; kind: string } | null {
  const data = item?.metadata?.[LOCAL_META_KEY];
  return data && typeof data.sourceId === "string" && typeof data.kind === "string" ? data : null;
}

function effectTopLeft(record: LightRecord) {
  return {
    x: record.position.x - record.radius,
    y: record.position.y - record.radius,
  };
}

export function controlButtonPosition(record: LightRecord, mode: LightControlMode, viewScale: number) {
  const scale = Math.max(0.05, Math.min(20, Number.isFinite(viewScale) ? viewScale : 1));
  const x = record.position.x + record.radius + (BUTTON_GAP + BUTTON_SIZE / 2) / scale;
  const yOffset = mode === "MOVE" ? -(BUTTON_SIZE + BUTTON_GAP) / scale
    : mode === "ROTATE" ? 0
    : (BUTTON_SIZE + BUTTON_GAP) / scale;
  return { x, y: record.position.y + yOffset };
}

export function controlButtonHitRadius(viewScale: number): number {
  return BUTTON_HIT_RADIUS / Math.max(0.05, Math.min(20, viewScale || 1));
}

function effectUniforms(config: LightConfig, rotation: number, modulation: number): any[] {
  return [
    { name: "lightColor", value: finalLightColor(config) },
    { name: "intensity", value: config.intensity },
    { name: "opacity", value: config.opacity },
    { name: "falloff", value: config.falloff },
    { name: "modulation", value: modulation },
    { name: "rotation", value: normalizedAngle(rotation) },
    { name: "beamAngle", value: config.beamAngle },
  ];
}

function buildFogItem(record: LightRecord, visible: boolean): AnyItem {
  const angle = record.config.beamAngle;
  return buildLight()
    .name(`SL/Fog/${record.config.name}`)
    .position(record.position)
    .rotation(record.rotation)
    .attenuationRadius(record.radius)
    .sourceRadius(record.config.softness)
    .falloff(record.config.falloff)
    .innerAngle(angle >= 360 ? 360 : angle * 0.82)
    .outerAngle(angle)
    .visible(visible)
    .locked(true)
    .disableHit(true)
    .metadata({ [LOCAL_META_KEY]: { sourceId: record.id, kind: "fog" } })
    .build();
}

function buildGlowItem(record: LightRecord, visible: boolean): AnyItem {
  return buildEffect()
    .name(`SL/Glow/${record.config.name}`)
    .effectType("STANDALONE")
    // EFFECT draws a rectangle; its origin stays offset from the shared light centre.
    .position(effectTopLeft(record))
    .width(record.radius * 2)
    .height(record.radius * 2)
    .sksl(SHADER)
    .uniforms(effectUniforms(record.config, record.rotation, 1))
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
    // SHAPE.position is the centre of its bounds, not the top-left corner.
    .position(record.position)
    .width(record.radius * 2)
    .height(record.radius * 2)
    .fillColor(record.config.color)
    .fillOpacity(0)
    .strokeColor("#f0b36b")
    .strokeOpacity(0.94)
    .strokeWidth(2)
    .strokeDash([9, 6])
    .layer("CONTROL")
    .locked(true)
    .disableHit(true)
    .metadata({ [LOCAL_META_KEY]: { sourceId: record.id, kind: "selection" } })
    .build();
}

function buildControlButton(record: LightRecord, mode: LightControlMode, viewScale: number): AnyItem {
  const glyph = mode === "MOVE" ? "✥" : mode === "ROTATE" ? "↻" : "⤢";
  const background = mode === "MOVE" ? "#292522" : mode === "ROTATE" ? "#65402b" : "#3b4447";
  return buildLabel()
    .name(`SL/Button/${mode}/${record.config.name}`)
    .plainText(glyph)
    .width(BUTTON_SIZE)
    .height(BUTTON_SIZE)
    .fontFamily("Arial")
    .fontSize(19)
    .fontWeight(700)
    .textAlign("CENTER")
    .textAlignVertical("MIDDLE")
    .fillColor("#fff3df")
    .backgroundColor(background)
    .backgroundOpacity(0.97)
    .cornerRadius(8)
    .position(controlButtonPosition(record, mode, viewScale))
    .layer("CONTROL")
    .locked(true)
    .disableHit(true)
    .metadata({ [LOCAL_META_KEY]: { sourceId: record.id, kind: `button-${mode.toLowerCase()}` } })
    .build();
}

export class LightingRenderer {
  private latestItems: AnyItem[] = [];
  private role: Role = "PLAYER";
  private selectedId: string | null = null;
  private viewScale = 1;
  private scheduleHandle: number | null = null;
  private animationHandle: number | null = null;
  private localItems: AnyItem[] = [];

  setContext(items: AnyItem[], role: Role, selectedId: string | null): void {
    this.latestItems = items;
    this.role = role;
    this.selectedId = selectedId;
    if (this.scheduleHandle !== null) window.clearTimeout(this.scheduleHandle);
    this.scheduleHandle = window.setTimeout(() => {
      this.scheduleHandle = null;
      void this.reconcile();
    }, 16);
  }

  async reconcile(): Promise<void> {
    try {
      const records = getLightRecords(this.latestItems);
      const [localItems, viewScale] = await Promise.all([
        OBR.scene.local.getItems(),
        OBR.viewport.getScale(),
      ]);
      this.localItems = localItems;
      this.viewScale = viewScale || 1;
      const managed = localItems.filter((item) => localMeta(item));
      const bySourceKind = new Map<string, AnyItem>();
      for (const item of managed) {
        const meta = localMeta(item);
        if (meta) bySourceKind.set(`${meta.sourceId}:${meta.kind}`, item);
      }

      const desired = new Set<string>();
      const additions: AnyItem[] = [];
      const updates: { item: AnyItem; record: LightRecord; visible: boolean }[] = [];
      const effectRecords = [...records].sort((a, b) => b.config.intensity * b.radius - a.config.intensity * a.radius);
      const effectEligible = new Set(effectRecords.slice(0, MAX_COLOR_EFFECTS).map((record) => record.id));

      for (const record of records) {
        const visible = isVisibleForRole(record.config, this.role);
        desired.add(`${record.id}:fog`);
        desired.add(`${record.id}:glow`);
        const fog = bySourceKind.get(`${record.id}:fog`);
        const glow = bySourceKind.get(`${record.id}:glow`);
        if (fog) updates.push({ item: fog, record, visible });
        else additions.push(buildFogItem(record, visible));
        if (glow) updates.push({ item: glow, record, visible: visible && effectEligible.has(record.id) });
        else additions.push(buildGlowItem(record, visible && effectEligible.has(record.id)));
      }

      const selected = this.role === "GM" ? records.find((record) => record.id === this.selectedId) : undefined;
      if (selected) {
        desired.add(`${selected.id}:selection`);
        const ring = bySourceKind.get(`${selected.id}:selection`);
        if (ring) updates.push({ item: ring, record: selected, visible: true });
        else additions.push(buildSelectionRing(selected));

        for (const mode of ["MOVE", "ROTATE", "RESIZE"] as LightControlMode[]) {
          const kind = `button-${mode.toLowerCase()}`;
          desired.add(`${selected.id}:${kind}`);
          const button = bySourceKind.get(`${selected.id}:${kind}`);
          if (button) updates.push({ item: button, record: selected, visible: true });
          else additions.push(buildControlButton(selected, mode, this.viewScale));
        }
      }

      const stale = managed.filter((item) => {
        const meta = localMeta(item);
        return !meta || !desired.has(`${meta.sourceId}:${meta.kind}`);
      });
      if (stale.length) await OBR.scene.local.deleteItems(stale.map((item) => item.id));

      const fogUpdates = updates.filter((entry) => localMeta(entry.item)?.kind === "fog");
      const glowUpdates = updates.filter((entry) => localMeta(entry.item)?.kind === "glow");
      const ringUpdates = updates.filter((entry) => localMeta(entry.item)?.kind === "selection");
      const buttonUpdates = updates.filter((entry) => localMeta(entry.item)?.kind.startsWith("button-"));

      if (fogUpdates.length) await OBR.scene.local.updateItems(fogUpdates.map((entry) => entry.item), (draft: AnyItem[]) => {
        for (const item of draft) {
          const meta = localMeta(item);
          const entry = fogUpdates.find((candidate) => localMeta(candidate.item)?.sourceId === meta?.sourceId);
          if (!entry) continue;
          item.position = entry.record.position;
          item.rotation = entry.record.rotation;
          item.attenuationRadius = entry.record.radius;
          item.sourceRadius = entry.record.config.softness;
          item.falloff = entry.record.config.falloff;
          item.innerAngle = entry.record.config.beamAngle >= 360 ? 360 : entry.record.config.beamAngle * 0.82;
          item.outerAngle = entry.record.config.beamAngle;
          item.visible = entry.visible;
        }
      });

      if (glowUpdates.length) await OBR.scene.local.updateItems(glowUpdates.map((entry) => entry.item), (draft: AnyItem[]) => {
        for (const item of draft) {
          const meta = localMeta(item);
          const entry = glowUpdates.find((candidate) => localMeta(candidate.item)?.sourceId === meta?.sourceId);
          if (!entry) continue;
          item.position = effectTopLeft(entry.record);
          item.width = entry.record.radius * 2;
          item.height = entry.record.radius * 2;
          item.uniforms = effectUniforms(entry.record.config, entry.record.rotation, 1);
          item.visible = entry.visible && effectEligible.has(entry.record.id);
        }
      });

      if (ringUpdates.length) await OBR.scene.local.updateItems(ringUpdates.map((entry) => entry.item), (draft: AnyItem[]) => {
        for (const item of draft) {
          const meta = localMeta(item);
          const entry = ringUpdates.find((candidate) => localMeta(candidate.item)?.sourceId === meta?.sourceId);
          if (!entry) continue;
          item.position = entry.record.position;
          item.width = entry.record.radius * 2;
          item.height = entry.record.radius * 2;
        }
      });

      if (buttonUpdates.length) await OBR.scene.local.updateItems(buttonUpdates.map((entry) => entry.item), (draft: AnyItem[]) => {
        for (const item of draft) {
          const meta = localMeta(item);
          const entry = buttonUpdates.find((candidate) => localMeta(candidate.item)?.sourceId === meta?.sourceId);
          if (!entry || !meta) continue;
          const mode = meta.kind === "button-move" ? "MOVE" : meta.kind === "button-rotate" ? "ROTATE" : "RESIZE";
          item.position = controlButtonPosition(entry.record, mode, this.viewScale);
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
    const needsScheduler = records.some((record) => isAnimated(record.config));
    if (!needsScheduler && this.animationHandle !== null) {
      window.clearInterval(this.animationHandle);
      this.animationHandle = null;
      return;
    }
    if (!needsScheduler || this.animationHandle !== null) return;
    this.animationHandle = window.setInterval(() => this.tickAnimations(), 1000 / 30);
  }

  private tickAnimations(): void {
    const now = Date.now() / 1000;
    const active = new Map(
      getLightRecords(this.latestItems)
        .filter((record) => isAnimated(record.config) && isVisibleForRole(record.config, this.role))
        .map((record) => [record.id, { record, level: animationLevel(record.config.animation, now) }]),
    );
    if (!active.size) return;

    const animatedItems = this.localItems.filter((item) => {
      const meta = localMeta(item);
      return !!meta && active.has(meta.sourceId) && (meta.kind === "glow" || meta.kind === "fog");
    });
    if (!animatedItems.length) return;

    void OBR.scene.local.updateItems(animatedItems, (draft: AnyItem[]) => {
      for (const item of draft) {
        const meta = localMeta(item);
        const entry = meta ? active.get(meta.sourceId) : undefined;
        if (!meta || !entry) continue;
        if (meta.kind === "glow") {
          item.uniforms = effectUniforms(entry.record.config, entry.record.rotation, entry.level);
        } else if (meta.kind === "fog") {
          item.attenuationRadius = entry.record.radius * (0.92 + entry.level * 0.08);
        }
      }
    }).catch((error: unknown) => {
      console.warn("[Sistema de Luzes] Falha ao atualizar animação:", error);
    });
  }

  dispose(): void {
    if (this.scheduleHandle !== null) window.clearTimeout(this.scheduleHandle);
    if (this.animationHandle !== null) window.clearInterval(this.animationHandle);
    this.scheduleHandle = null;
    this.animationHandle = null;
  }
}

export function findRecordAt(
  items: AnyItem[],
  point: { x: number; y: number },
  selectedId: string | null,
  viewScale = 1,
): { record: LightRecord; mode: LightControlMode } | null {
  const records = getLightRecords(items);
  const selected = records.find((record) => record.id === selectedId);
  if (selected) {
    for (const mode of ["MOVE", "ROTATE", "RESIZE"] as LightControlMode[]) {
      const button = controlButtonPosition(selected, mode, viewScale);
      const distance = Math.hypot(point.x - button.x, point.y - button.y);
      if (distance <= controlButtonHitRadius(viewScale)) return { record: selected, mode };
    }
  }

  let best: { record: LightRecord; distance: number } | null = null;
  for (const record of records) {
    const distance = Math.hypot(point.x - record.position.x, point.y - record.position.y);
    if (distance > record.radius + 4 / Math.max(0.05, viewScale)) continue;
    if (!best || distance < best.distance) best = { record, distance };
  }
  return best ? { record: best.record, mode: "MOVE" } : null;
}
