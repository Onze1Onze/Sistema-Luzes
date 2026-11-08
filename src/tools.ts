import OBR from "@owlbear-rodeo/sdk";
import { DEFAULT_CONFIG, LIGHT_META_KEY, LOCAL_META_KEY, PLAYER_META_KEY, TOOL_ID, TOOL_MODE_ID } from "./types";
import { createLightAt, getSceneItems } from "./repository";
import { findRecordAt, type LightControlMode } from "./renderer";
import { getLightRecords } from "./utils";

const EXTENSION_ICON_URL = new URL("icon.svg", document.baseURI).href;

type Interaction = [((recipe: (draft: any) => void) => any), () => void];
type Point = { x: number; y: number };
type DragState = {
  interaction: Interaction | null;
  mode: LightControlMode;
  record: any;
  center: Point;
  startPointer: Point;
  startRadius: number;
  startRotation: number;
  startPointerAngle: number;
  pointerOffset: Point;
  latestPointer: Point;
};

let latestItems: any[] = [];
let selectedId: string | null = null;
let drag: DragState | null = null;
let startingDrag = false;
let pendingPointer: Point | null = null;
let pendingRelease: Point | null = null;
let armedMode: { recordId: string; mode: LightControlMode } | null = null;

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

function angleFrom(center: Point, pointer: Point): number {
  return Math.atan2(pointer.y - center.y, pointer.x - center.x) * 180 / Math.PI;
}

function modeFromTarget(target: any): { recordId: string; mode: LightControlMode } | null {
  const metadata = target?.metadata?.[LOCAL_META_KEY];
  if (!metadata || typeof metadata.sourceId !== "string" || typeof metadata.kind !== "string") return null;
  if (metadata.kind === "control-v2-move") return { recordId: metadata.sourceId, mode: "MOVE" };
  if (metadata.kind === "control-v2-rotate") return { recordId: metadata.sourceId, mode: "ROTATE" };
  if (metadata.kind === "control-v2-resize") return { recordId: metadata.sourceId, mode: "RESIZE" };
  return null;
}

function applyDrag(state: DragState, pointer: Point): void {
  state.latestPointer = { ...pointer };
  if (!state.interaction) return;
  const [update] = state.interaction;

  if (state.mode === "MOVE") {
    update((draft: any) => {
      draft.position = {
        x: pointer.x - state.pointerOffset.x,
        y: pointer.y - state.pointerOffset.y,
      };
    });
    return;
  }

  if (state.mode === "RESIZE") {
    const startDistance = Math.hypot(
      state.startPointer.x - state.center.x,
      state.startPointer.y - state.center.y,
    );
    const nextDistance = Math.hypot(pointer.x - state.center.x, pointer.y - state.center.y);
    const radius = Math.max(24, Math.min(5000, state.startRadius + nextDistance - startDistance));
    update((draft: any) => {
      draft.width = radius * 2;
      draft.height = radius * 2;
    });
    return;
  }

  const nextAngle = angleFrom(state.center, pointer);
  let delta = nextAngle - state.startPointerAngle;
  if (delta > 180) delta -= 360;
  if (delta < -180) delta += 360;
  const rotation = ((state.startRotation + delta) % 360 + 360) % 360;
  update((draft: any) => { draft.rotation = rotation; });
}

async function beginDrag(event: any): Promise<void> {
  if (drag || startingDrag) return;
  startingDrag = true;
  pendingPointer = { ...event.pointerPosition };
  pendingRelease = null;

  try {
    const role = await OBR.player.getRole();
    if (role !== "GM") return;

    latestItems = await getSceneItems();
    await readSelected();

    const targetButton = modeFromTarget(event.target);
    const scale = await OBR.viewport.getScale();
    let record: any;
    let mode: LightControlMode;

    if (targetButton) {
      record = getLightRecords(latestItems).find((entry) => entry.id === targetButton.recordId);
      mode = targetButton.mode;
    } else {
      const found = findRecordAt(latestItems, event.pointerPosition, selectedId, scale);
      if (!found) return;
      record = found.record;
      mode = armedMode && armedMode.recordId === record.id ? armedMode.mode : found.mode;
    }

    if (!record || record.config.locked) return;
    if (record.config.linkedTokenId && mode === "MOVE") return;

    if (selectedId !== record.id) await setSelected(record.id);
    armedMode = null;

    const center = { ...record.position };
    const startPointer = { ...event.pointerPosition };
    const state: DragState = {
      interaction: null,
      mode,
      record,
      center,
      startPointer,
      startRadius: record.radius,
      startRotation: record.rotation,
      startPointerAngle: angleFrom(center, startPointer),
      pointerOffset: { x: startPointer.x - center.x, y: startPointer.y - center.y },
      latestPointer: pendingPointer ?? startPointer,
    };
    drag = state;

    const interaction = await OBR.interaction.startItemInteraction(record.item);
    if (drag !== state) {
      interaction[1]();
      return;
    }
    state.interaction = interaction;
    applyDrag(state, state.latestPointer);

    if (pendingRelease) {
      applyDrag(state, pendingRelease);
      drag = null;
      state.interaction[1]();
    }
  } catch (error) {
    console.error("[Sistema de Luzes] Falha ao iniciar controle da luz:", error);
    if (drag && !drag.interaction) drag = null;
  } finally {
    startingDrag = false;
    pendingPointer = null;
    pendingRelease = null;
  }
}

function stopDrag(pointer?: Point): void {
  if (startingDrag) {
    pendingRelease = pointer ? { ...pointer } : (pendingPointer ? { ...pendingPointer } : null);
    return;
  }
  const state = drag;
  if (!state) return;
  if (pointer) applyDrag(state, pointer);
  drag = null;
  state.interaction?.[1]();
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
      label: "Toque e arraste MOVER, GIRAR ou RAIO ao lado da luz",
      filter: { activeTools: [TOOL_ID] },
    }],
    cursors: [{ cursor: "crosshair" }],
    async onToolDown(_, event) {
      await beginDrag(event);
    },
    onToolMove(_, event) {
      if (startingDrag) pendingPointer = { ...event.pointerPosition };
      else if (drag) applyDrag(drag, event.pointerPosition);
    },
    onToolUp(_, event) {
      stopDrag(event.pointerPosition);
    },
    async onToolClick(_, event) {
      const role = await OBR.player.getRole();
      if (role !== "GM") return false;
      const targetButton = modeFromTarget(event.target);
      if (targetButton) {
        armedMode = targetButton;
        await setSelected(targetButton.recordId);
        return false;
      }

      latestItems = await getSceneItems();
      await readSelected();
      const scale = await OBR.viewport.getScale();
      const found = findRecordAt(latestItems, event.pointerPosition, selectedId, scale);
      if (found) {
        await setSelected(found.record.id);
        return false;
      }

      const id = await createLightAt(event.pointerPosition, DEFAULT_CONFIG);
      await setSelected(id);
      return false;
    },
    async onToolDragStart(_, event) {
      if (!drag && !startingDrag) await beginDrag(event);
    },
    onToolDragMove(_, event) {
      if (drag) applyDrag(drag, event.pointerPosition);
      else if (startingDrag) pendingPointer = { ...event.pointerPosition };
    },
    onToolDragEnd(_, event) {
      stopDrag(event.pointerPosition);
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
      armedMode = null;
    },
  });

  latestItems = await getSceneItems();
  await readSelected();
  OBR.scene.items.onChange((items) => { latestItems = items; });
  OBR.player.onChange((player) => {
    const data = player.metadata?.[PLAYER_META_KEY] as { selectedId?: string | null } | undefined;
    selectedId = data?.selectedId ?? null;
  });
}
