import OBR, { buildEffect, buildLight, buildShape } from "@owlbear-rodeo/sdk";
import type { LightConfig, LightRecord } from "./types";
import { LOCAL_META_KEY } from "./types";
import { animationLevel, finalLightColor, getLightRecords, isAnimated } from "./utils";

type Role = "GM" | "PLAYER";
type AnyItem = any;
type OverlayMode = "MOVE" | "RESIZE" | "ROTATE";

const MAX_COLOR_EFFECTS = 64;
const HANDLE_RADIUS = 11;
const HANDLE_DISTANCE = 28;

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
  float edge = 1.0 - smoothstep(0.72, 1.0, distanceFromCenter);
  float diffuse = exp(-distanceFromCenter * distanceFromCenter * (2.0 + falloff * 3.5));
  float core = exp(-distanceFromCenter * distanceFromCenter * 10.0);
  float radial = edge * (0.30 + 0.70 * diffuse);

  float cone = 1.0;
  if (beamAngle < 359.5) {
    const float PI = 3.14159265;
    float fragmentAngle = atan(local.y, local.x);
    float direction = radians(rotation);
    float difference = abs(mod(fragmentAngle - direction + PI, 2.0 * PI) - PI);
    float halfAngle = radians(beamAngle) * 0.5;
    float feather = max(radians(2.0), radians(beamAngle * 0.12));
    cone = 1.0 - smoothstep(max(0.0, halfAngle - feather), halfAngle + 0.0001, difference);
  }

  vec2 scenePosition = (vec3(coord, 1.0) * modelView).xy;
  half4 base = scene.eval(scenePosition);
  float strength = clamp(intensity * opacity * modulation * radial * cone, 0.0, 0.88);
  vec3 sourceColor = lightColor * (0.78 + 0.30 * core);
  vec3 lit = base.rgb + sourceColor * strength * (1.0 - base.rgb);
  return half4(clamp(lit, 0.0, 1.0), base.a);
}
`;

function normalizedAngle(angle: number): number {
  return ((angle % 360) + 360) % 360;
}

function pointAt(center: { x: number; y: number }, angle: number, distance: number) {
  const radians = angle * Math.PI / 180;
  return {
    x: center.x + Math.cos(radians) * distance,
    y: center.y + Math.sin(radians) * distance,
  };
}

export function rotationHandlePosition(record: LightRecord) {
  return pointAt(record.position, record.rotation, record.radius + HANDLE_DISTANCE);
}

export function resizeHandlePosition(record: LightRecord) {
  return pointAt(record.position, record.rotation + 90, record.radius + HANDLE_DISTANCE);
}

// A standalone effect and a Shape overlay use the top-left of their bounds.
// The shared anchor position intentionally represents the light centre.
function effectTopLeft(record: LightRecord) {
  return {
    x: record.position.x - record.radius,
    y: record.position.y - record.radius,
  };
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

function isVisibleForRole(config: LightConfig, role: Role): boolean {
  return config.enabled && (config.visibility === "ALL" || role === "GM");
}

function localMeta(item: AnyItem): { sourceId: string; kind: string } | null {
  const data = item?.metadata?.[LOCAL_META_KEY];
  return data && typeof data.sourceId === "string" && typeof data.kind === "string" ? data : null;
}

function buildFogItem(record: LightRecord, visible: boolean): AnyItem {
  const beamAngle = record.config.beamAngle;
  const innerAngle = beamAngle >= 360 ? 360 : Math.max(0, beamAngle * 0.82);
  const builder = buildLight()
    .name(`SL/Fog/${record.config.name}`)
    .position(record.position)
    .rotation(record.rotation)
    .attenuationRadius(record.radius)
    .sourceRadius(record.config.softness)
    .falloff(record.config.falloff)
    .innerAngle(innerAngle)
    .outerAngle(beamAngle)
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
    .position(effectTopLeft(record))
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

function buildHandle(record: LightRecord, kind: "resize" | "rotate"): AnyItem {
  const point = kind === "resize" ? resizeHandlePosition(record) : rotationHandlePosition(record);
  const color = kind === "resize" ? "#eee2d2" : "#e5a45e";
  return buildShape()
    .name(kind === "resize" ? "SL/Resize Handle" : "SL/Rotation Handle")
    .shapeType("CIRCLE")
    .position({ x: point.x - HANDLE_RADIUS, y: point.y - HANDLE_RADIUS })
    .width(HANDLE_RADIUS * 2)
    .height(HANDLE_RADIUS * 2)
    .fillColor(color)
    .fillOpacity(1)
    .strokeColor("#201713")
    .strokeOpacity(1)
    .strokeWidth(2)
    .layer("CONTROL")
    .locked(true)
    .disableHit(true)
    .metadata({ [LOCAL_META_KEY]: { sourceId: record.id, kind } })
    .build();
}

export class LightingRenderer {
  private latestItems: AnyItem[] = [];
  private role: Role = "PLAYER";
  private selectedId: string | null = null;
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
        desired.add(`${selected.id}:resize`);
        desired.add(`${selected.id}:rotate`);
        const ring = bySourceKind.get(`${selected.id}:selection`);
        const resize = bySourceKind.get(`${selected.id}:resize`);
        const rotate = bySourceKind.get(`${selected.id}:rotate`);
        if (ring) updates.push({ item: ring, record: selected, visible: true });
        else additions.push(buildSelectionRing(selected));
        if (resize) updates.push({ item: resize, record: selected, visible: true });
        else additions.push(buildHandle(selected, "resize"));
        if (rotate) updates.push({ item: rotate, record: selected, visible: true });
        else additions.push(buildHandle(selected, "rotate"));
      }

      const stale = managed.filter((item) => {
        const meta = localMeta(item);
        return !meta || !desired.has(`${meta.sourceId}:${meta.kind}`);
      });
      if (stale.length) await OBR.scene.local.deleteItems(stale.map((item) => item.id));

      const fogUpdates = updates.filter((entry) => localMeta(entry.item)?.kind === "fog");
      const glowUpdates = updates.filter((entry) => localMeta(entry.item)?.kind === "glow");
      const ringUpdates = updates.filter((entry) => localMeta(entry.item)?.kind === "selection");
      const resizeUpdates = updates.filter((entry) => localMeta(entry.item)?.kind === "resize");
      const rotateUpdates = updates.filter((entry) => localMeta(entry.item)?.kind === "rotate");

      if (fogUpdates.length) await OBR.scene.local.updateItems(fogUpdates.map((entry) => entry.item), (draft: any[]) => {
        for (const item of draft) {
          const meta = localMeta(item);
          const entry = fogUpdates.find((candidate) => localMeta(candidate.item)?.sourceId === meta?.sourceId);
          if (!entry) continue;
          item.position = entry.record.position;
          item.rotation = entry.record.rotation;
          item.attenuationRadius = entry.record.radius;
          item.sourceRadius = entry.record.config.softness;
          item.falloff = entry.record.config.falloff;
          item.innerAngle = entry.record.config.beamAngle >= 360 ? 360 : Math.max(0, entry.record.config.beamAngle * 0.82);
          item.outerAngle = entry.record.config.beamAngle;
          item.visible = entry.visible;
        }
      });

      if (glowUpdates.length) await OBR.scene.local.updateItems(glowUpdates.map((entry) => entry.item), (draft: any[]) => {
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

      if (ringUpdates.length) await OBR.scene.local.updateItems(ringUpdates.map((entry) => entry.item), (draft: any[]) => {
        for (const item of draft) {
          const meta = localMeta(item);
          const entry = ringUpdates.find((candidate) => localMeta(candidate.item)?.sourceId === meta?.sourceId);
          if (!entry) continue;
          item.position = effectTopLeft(entry.record);
          item.width = entry.record.radius * 2;
          item.height = entry.record.radius * 2;
        }
      });

      if (resizeUpdates.length) await OBR.scene.local.updateItems(resizeUpdates.map((entry) => entry.item), (draft: any[]) => {
        for (const item of draft) {
          const meta = localMeta(item);
          const entry = resizeUpdates.find((candidate) => localMeta(candidate.item)?.sourceId === meta?.sourceId);
          if (entry) {
            const point = resizeHandlePosition(entry.record);
            item.position = { x: point.x - HANDLE_RADIUS, y: point.y - HANDLE_RADIUS };
          }
        }
      });

      if (rotateUpdates.length) await OBR.scene.local.updateItems(rotateUpdates.map((entry) => entry.item), (draft: any[]) => {
        for (const item of draft) {
          const meta = localMeta(item);
          const entry = rotateUpdates.find((candidate) => localMeta(candidate.item)?.sourceId === meta?.sourceId);
          if (entry) {
            const point = rotationHandlePosition(entry.record);
            item.position = { x: point.x - HANDLE_RADIUS, y: point.y - HANDLE_RADIUS };
          }
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
        .map((record) => [record.id, {
          record,
          level: animationLevel(record.config.animation, now),
        }]),
    );
    if (!active.size) return;

    const animatedItems = this.localItems.filter((item) => {
      const meta = localMeta(item);
      return !!meta && active.has(meta.sourceId) && (meta.kind === "glow" || meta.kind === "fog");
    });
    if (!animatedItems.length) return;

    void OBR.scene.local.updateItems(animatedItems, (draft: any[]) => {
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
): { record: LightRecord; mode: OverlayMode } | null {
  const records = getLightRecords(items);
  const selected = records.find((record) => record.id === selectedId);
  if (selected) {
    const rotationPoint = rotationHandlePosition(selected);
    const resizePoint = resizeHandlePosition(selected);
    const rotationDistance = Math.hypot(point.x - rotationPoint.x, point.y - rotationPoint.y);
    const resizeDistance = Math.hypot(point.x - resizePoint.x, point.y - resizePoint.y);
    if (rotationDistance <= HANDLE_RADIUS * 2) return { record: selected, mode: "ROTATE" };
    if (resizeDistance <= HANDLE_RADIUS * 2) return { record: selected, mode: "RESIZE" };
  }

  let best: { record: LightRecord; distance: number } | null = null;
  for (const record of records) {
    const distance = Math.hypot(point.x - record.position.x, point.y - record.position.y);
    if (distance > record.radius + HANDLE_DISTANCE + HANDLE_RADIUS) continue;
    if (!best || distance < best.distance) best = { record, distance };
  }
  return best ? { record: best.record, mode: "MOVE" } : null;
}
