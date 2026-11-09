import OBR from "@owlbear-rodeo/sdk";
import { DeckState, EMPTY_DECK } from "./types";

export const METADATA_KEY = "com.onze1onze.sistema-cartas/deck";
const MAX_ROOM_METADATA_BYTES = 16 * 1024;

function cloneDeck(deck: DeckState): DeckState {
  return JSON.parse(JSON.stringify(deck)) as DeckState;
}

function byteSize(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function normalizeDeck(value: unknown): DeckState {
  if (!value || typeof value !== "object") return cloneDeck(EMPTY_DECK);
  const input = value as Partial<DeckState>;
  const cards = Array.isArray(input.cards) ? input.cards : [];
  return {
    version: 1,
    cards: cards.filter(Boolean).map((card) => ({
      id: String((card as any).id ?? crypto.randomUUID()),
      name: String((card as any).name ?? "Carta"),
      frontUrl: String((card as any).frontUrl ?? ""),
      backUrl: String((card as any).backUrl ?? ""),
      description: String((card as any).description ?? ""),
      category: String((card as any).category ?? "Outros"),
      visibility: ["HIDDEN", "AVAILABLE", "REVEALED", "DISCARDED"].includes((card as any).visibility)
        ? (card as any).visibility
        : "AVAILABLE",
      selected: Boolean((card as any).selected),
      createdAt: Number((card as any).createdAt ?? Date.now())
    })),
    revealedCardId: input.revealedCardId ? String(input.revealedCardId) : null,
    cardSize: input.cardSize === "small" || input.cardSize === "large" ? input.cardSize : "medium",
    updatedAt: Number(input.updatedAt ?? Date.now())
  };
}

export async function loadDeck(): Promise<DeckState> {
  const metadata = await OBR.room.getMetadata();
  return normalizeDeck((metadata as any)[METADATA_KEY]);
}

export async function saveDeck(deck: DeckState): Promise<void> {
  const next = { ...cloneDeck(deck), updatedAt: Date.now() };
  const bytes = byteSize({ [METADATA_KEY]: next });
  if (bytes > MAX_ROOM_METADATA_BYTES) {
    throw new Error(
      `O deck excede o limite de 16 KB do metadata da sala. Reduza descrições ou referências duplicadas (${bytes} bytes).`
    );
  }
  await OBR.room.setMetadata({ [METADATA_KEY]: next });
}

export function metadataKey(): string {
  return METADATA_KEY;
}