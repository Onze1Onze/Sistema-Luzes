import OBR from "@owlbear-rodeo/sdk";
import { DeckState } from "./types";
import { METADATA_KEY } from "./storage";

export const CHANNEL = "com.onze1onze.sistema-cartas/reveal";

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