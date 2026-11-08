import OBR from "@owlbear-rodeo/sdk";
import { DEFAULT_CONFIG, LIGHT_META_KEY, PLAYER_META_KEY, TOOL_ID, TOOL_MODE_ID } from "./types";
import { createLightAt, getSceneItems } from "./repository";
import { findRecordAt, type LightControlMode } from "./renderer";

const EXTENSION_ICON_URL = new URL("icon.svg", document.baseURI).href;

let latestItems: any[] = [];
let selectedId: string | null = null;
let drag: {
  interaction: [((recipe: (draft: any) => void) => any), () => void];
  mode: LightControlMode;
  startPointer: { x: number; y: number };
  startCenter: { x: number; y: number };
  startRadius: number;
  startRotation: number;
  startPointerAngle: number;
  pointerOffset: { x: number; y: number };
} | null = null;

async function readSelected(): Promise<string | null> {
  try {
    const metadata = await OBR.player.getMetadata();
    const data = metadata[PLAYER_META_KEY] as { selectedId?: string | null } | undefined;
    selectedId = data?.selectedId ?? null;
    return selectedId;
  } catch {
    return selectedId;
  }
}

async function setSelected(id: string | null): Promise<void> {
  selectedId = id;
  const metadata = await OBR.player.getMetadata();
  const current = metadata[PLAYER_META_KEY] && typeof metadata[PLAYER_META_KEY] === "object"
    ? metadata[PLAYER_META_KEY] as Record<string, unknown>
    : {};
  await OBR.player.setMetadata({ [PLAYER_META_KEY]: { ...current, selectedId: id } });
}

function angleFrom(center: { x: number; y: number }, pointer: { x: number; y: number }): number {
  return Math.atan2(pointer.y - center.y, pointer.x - center.x) * 180 / Math.PI;
}

function applyDrag(current: NonNullable<typeof drag>, pointer: { x: number; y: number }): void {
  const [update] = current.interaction;
  if (current.mode === "MOVE") {
    update((draft: any) => {
      draft.position = {
        x: pointer.x - current.pointerOffset.x,
        y: pointer.y - current.pointerOffset.y,
      };
    });
    return;
  }

  if (current.mode === "RESIZE") {
    const startDistance = Math.hypot(
      current.startPointer.x - current.startCenter.x,
      current.startPointer.y - current.startCenter.y,
    );
    const nextDistance = Math.hypot(
      pointer.x - current.startCenter.x,
      pointer.y - current.startCenter.y,
    );
    const radius = Math.max(24, Math.min(5000, current.startRadius + nextDistance - startDistance));
    update((draft: any) => {
      draft.width = radius * 2;
      draft.height = radius * 2;
    });
    return;
  }

  const nextAngle = angleFrom(current.startCenter, pointer);
  let delta = nextAngle - current.startPointerAngle;
  if (delta > 180) delta -= 360;
  if (delta < -180) delta += 360;
  const rotation = ((current.startRotation + delta) % 360 + 360) % 360;
  update((draft: any) => { draft.rotation = rotation; });
}

function stopDrag(): void {
  if (!drag) return;
  drag.interaction[1]();
  drag = null;
}

export async function registerLightTool(): Promise<void> {
  await OBR.tool.create({
    id: TOOL_ID,
    icons: [{ icon: EXTENSION_ICON_URL, label: "Sistema de Luzes" }],
    defaultMode: TOOL_MODE_ID,
    disabled: { roles: ["PLAYER"] },
  });

  await OBR.tool.createMode({
    id: TOOL_MODE_ID,
    icons: [{
      icon: EXTENSION_ICON_URL,
      label: "Segure os botões ao lado da luz para mover, girar ou redimensionar",
      filter: { activeTools: [TOOL_ID] },
    }],
    cursors: [{ cursor: "crosshair" }],
    async onToolClick(_, event) {
      const role = await OBR.player.getRole();
      if (role !== "GM") return false;
      latestItems = await getSceneItems();
      await readSelected();
      const scale = await OBR.viewport.getScale();
      const found = findRecordAt(latestItems, event.pointerPosition, selectedId, scale);
      if (found) {
        await setSelected(found.record.id);
      } else {
        const id = await createLightAt(event.pointerPosition, DEFAULT_CONFIG);
        await setSelected(id);
      }
      return false;
    },
    async onToolDragStart(_, event) {
      const role = await OBR.player.getRole();
      if (role !== "GM") return;
      latestItems = await getSceneItems();
      await readSelected();
      const scale = await OBR.viewport.getScale();
      const found = findRecordAt(latestItems, event.pointerPosition, selectedId, scale);
      if (!found || found.record.config.locked) return;
      if (found.record.config.linkedTokenId && found.mode === "MOVE") return;

      await setSelected(found.record.id);
      const interaction = await OBR.interaction.startItemInteraction(found.record.item);
      const startCenter = { ...found.record.position };
      const startPointer = { ...event.pointerPosition };
      drag = {
        interaction,
        mode: found.mode,
        startPointer,
        startCenter,
        startRadius: found.record.radius,
        startRotation: found.record.rotation,
        startPointerAngle: angleFrom(startCenter, startPointer),
        pointerOffset: {
          x: startPointer.x - startCenter.x,
          y: startPointer.y - startCenter.y,
        },
      };
    },
    onToolDragMove(_, event) {
      if (drag) applyDrag(drag, event.pointerPosition);
    },
    onToolDragEnd(_, event) {
      if (!drag) return;
      applyDrag(drag, event.pointerPosition);
      stopDrag();
    },
    onToolDragCancel() {
      stopDrag();
    },
    async onKeyDown(_, event) {
      if (event.key !== "Delete" && event.key !== "Backspace") return;
      await readSelected();
      if (!selectedId) return;
      const items = await getSceneItems();
      const selected = items.find((item) => item.id === selectedId && item.metadata?.[LIGHT_META_KEY]);
      if (!selected) return;
      await OBR.scene.items.deleteItems([selected.id]);
      await setSelected(null);
    },
  });

  latestItems = await getSceneItems();
  await readSelected();
  OBR.scene.items.onChange((items) => { latestItems = items; });
}
