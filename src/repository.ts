import OBR, { buildShape } from "@owlbear-rodeo/sdk";
import type { LightConfig, LightPreset } from "./types";
import { DEFAULT_CONFIG, LIGHT_META_KEY } from "./types";
import { validateConfig } from "./utils";

export type SceneItem = any;

export function getLightConfig(item: SceneItem): LightConfig | null {
  const value = item?.metadata?.[LIGHT_META_KEY];
  return value ? validateConfig(value) : null;
}

export async function getSceneItems(): Promise<SceneItem[]> {
  return OBR.scene.items.getItems();
}

export async function createLightAt(
  position: { x: number; y: number },
  config: LightConfig = DEFAULT_CONFIG,
): Promise<string> {
  const safe = validateConfig(config);
  const item = buildShape()
    .name(`SL • ${safe.name}`)
    .shapeType("CIRCLE")
    .position(position)
    .width(480)
    .height(480)
    .rotation(0)
    .fillOpacity(0)
    .strokeOpacity(0)
    .visible(false)
    .locked(false)
    .disableHit(true)
    .metadata({ [LIGHT_META_KEY]: safe })
    .build();
  await OBR.scene.items.addItems([item]);
  return item.id;
}

export async function updateLight(id: string, next: LightConfig): Promise<void> {
  const safe = validateConfig(next);
  await OBR.scene.items.updateItems([id], (items: SceneItem[]) => {
    const item = items[0];
    if (!item) return;
    item.name = `SL • ${safe.name}`;
    item.metadata = { ...item.metadata, [LIGHT_META_KEY]: safe };
    item.width = item.width || 480;
    item.height = item.height || 480;
  });
}

export async function updateLightRadius(id: string, radius: number): Promise<void> {
  const safeRadius = Math.max(24, Math.min(5000, Number.isFinite(radius) ? radius : 240));
  await OBR.scene.items.updateItems([id], (items: SceneItem[]) => {
    if (!items[0]) return;
    // This extension stores the authoritative light radius on the hidden
    // scene shape. getLightRecords() reads width/2 from this same item.
    items[0].width = safeRadius * 2;
    items[0].height = safeRadius * 2;
  });
}

export async function updateLightRotation(id: string, rotation: number): Promise<void> {
  const normalized = ((Number.isFinite(rotation) ? rotation : 0) % 360 + 360) % 360;
  await OBR.scene.items.updateItems([id], (items: SceneItem[]) => {
    if (items[0]) items[0].rotation = normalized;
  });
}

export async function deleteLight(id: string): Promise<void> {
  await OBR.scene.items.deleteItems([id]);
}

export async function duplicateLight(item: SceneItem): Promise<string | null> {
  const config = getLightConfig(item);
  if (!config) return null;
  const duplicate: LightConfig = {
    ...config,
    name: `${config.name} (cópia)`.slice(0, 48),
    linkedTokenId: null,
    offset: { x: 0, y: 0 },
    locked: false,
    animation: { ...config.animation, phase: Math.random() * 1000, startedAt: Date.now() / 1000 },
  };
  const position = { x: item.position.x + 28, y: item.position.y + 28 };
  const id = await createLightAt(position, duplicate);
  await updateLightRadius(id, Math.max(24, item.width / 2));
  await updateLightRotation(id, Number(item.rotation) || 0);
  return id;
}

export async function applyPreset(id: string, preset: LightPreset): Promise<void> {
  const safe = validateConfig({
    ...preset.config,
    name: preset.name,
    linkedTokenId: null,
    offset: { x: 0, y: 0 },
    locked: false,
    visibility: "ALL",
    animation: { ...preset.config.animation, phase: Math.random() * 1000, startedAt: Date.now() / 1000 },
  });
  await OBR.scene.items.updateItems([id], (items: SceneItem[]) => {
    if (!items[0]) return;
    items[0].name = `SL • ${safe.name}`;
    items[0].metadata = { ...items[0].metadata, [LIGHT_META_KEY]: safe };
    items[0].width = 480;
    items[0].height = 480;
  });
}

export async function placeNewLightAtViewportCenter(config: LightConfig = DEFAULT_CONFIG): Promise<string> {
  const position = await OBR.viewport.getPosition();
  return createLightAt(position, config);
}
