import OBR from "@owlbear-rodeo/sdk";
import { DEFAULT_CONFIG, LIGHT_META_KEY, PLAYER_META_KEY, TOOL_ID, TOOL_MODE_ID } from "./types";
import { createLightAt, getSceneItems } from "./repository";
import { findRecordAt } from "./renderer";

// Resolve the icon from the deployed extension page. This works both on
// GitHub Pages project paths (/Sistema-Luzes/) and on localhost.
const EXTENSION_ICON_URL = new URL("icon.svg", document.baseURI).href;

let latestItems: any[] = [];
let selectedId: string | null = null;
let drag: {
  interaction: [((recipe: (draft: any) => void) => any), () => void];
  item: any;
  mode: "MOVE" | "RESIZE";
  center: { x: number; y: number };
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

function managedItemAt(point: { x: number; y: number }): { item: any; record: any; resize: boolean } | null {
  const hit = findRecordAt(latestItems, point, selectedId);
  if (!hit) return null;
  return { item: hit.record.item, record: hit.record, resize: hit.resize };
}

async function cancelDrag(): Promise<void> {
  if (drag) {
    drag.interaction[1]();
    drag = null;
  }
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
    icons: [{ icon: EXTENSION_ICON_URL, label: "Selecionar / mover / criar luz", filter: { activeTools: [TOOL_ID] } }],
    cursors: [{ cursor: "crosshair" }],
    async onToolClick(_, event) {
      const role = await OBR.player.getRole();
      if (role !== "GM") return false;
      latestItems = await getSceneItems();
      await readSelected();
      const found = managedItemAt(event.pointerPosition);
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
      const found = managedItemAt(event.pointerPosition);
      if (!found || found.record.config.locked || found.record.config.linkedTokenId) return;
      await setSelected(found.record.id);
      const interaction = await OBR.interaction.startItemInteraction(found.item);
      drag = {
        interaction,
        item: found.item,
        mode: found.resize ? "RESIZE" : "MOVE",
        center: { ...found.record.position },
      };
    },
    onToolDragMove(_, event) {
      if (!drag) return;
      const [update] = drag.interaction;
      if (drag.mode === "MOVE") {
        update((draft: any) => {
          draft.position = event.pointerPosition;
        });
      } else {
        const radius = Math.max(24, Math.min(5000, Math.hypot(event.pointerPosition.x - drag!.center.x, event.pointerPosition.y - drag!.center.y)));
        update((draft: any) => {
          draft.width = radius * 2;
          draft.height = radius * 2;
        });
      }
    },
    onToolDragEnd(_, event) {
      if (!drag) return;
      const current = drag;
      const [update, stop] = current.interaction;
      if (current.mode === "MOVE") {
        update((draft: any) => { draft.position = event.pointerPosition; });
      } else {
        const radius = Math.max(24, Math.min(5000, Math.hypot(event.pointerPosition.x - current.center.x, event.pointerPosition.y - current.center.y)));
        update((draft: any) => { draft.width = radius * 2; draft.height = radius * 2; });
      }
      stop();
      drag = null;
    },
    onToolDragCancel() {
      void cancelDrag();
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
