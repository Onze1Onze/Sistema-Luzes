import OBR from "@owlbear-rodeo/sdk";
import { DeckState } from "./types";
import { METADATA_KEY } from "./storage";

export const CHANNEL = "com.onze1onze.sistema-cartas/reveal";
export const REVEAL_MODAL_ID = "com.onze1onze.sistema-cartas/reveal-modal";

export function subscribeDeck(onDeck: (deck: DeckState) => void): () => void {
  return OBR.room.onMetadataChange((metadata) => {
    const next = (metadata as any)[METADATA_KEY] as DeckState | undefined;
    if (next) onDeck(next);
  });
}

export function subscribeReveal(onReveal: (payload: { cardId: string | null; source: string }) => void): () => void {
  return OBR.broadcast.onMessage(CHANNEL, (event) => {
    const data = event.data as { cardId?: unknown };
    onReveal({
      cardId: typeof data.cardId === "string" ? data.cardId : null,
      source: event.connectionId
    });
  });
}

export async function broadcastReveal(cardId: string | null): Promise<void> {
  await OBR.broadcast.sendMessage(CHANNEL, { cardId }, { destination: "ALL" });
}

export function getRevealModalUrl(cardId?: string | null): string {
  const url = new URL("./modal.html", window.location.href);
  url.searchParams.set("v", "2.1.1");
  if (cardId) {
    url.searchParams.set("cardId", cardId);
  }
  return url.toString();
}

export async function openRevealModal(cardId?: string | null): Promise<void> {
  await OBR.modal.open({
    id: REVEAL_MODAL_ID,
    url: getRevealModalUrl(cardId),
    fullScreen: true,
    hidePaper: true
  });
}

export async function closeRevealModal(): Promise<void> {
  await OBR.modal.close(REVEAL_MODAL_ID);
}
