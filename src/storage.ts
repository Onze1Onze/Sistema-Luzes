import OBR from "@owlbear-rodeo/sdk";
import { Card, CardDeck, CardVisibility, DeckState, EMPTY_DECK } from "./types";

export const METADATA_KEY = "com.onze1onze.sistema-cartas/deck";
const MAX_ROOM_METADATA_BYTES = 16 * 1024;

function cloneDeck(deck: DeckState): DeckState {
  return JSON.parse(JSON.stringify(deck)) as DeckState;
}

function byteSize(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function normalizeCard(value: unknown): Card {
  const card = (value && typeof value === "object" ? value : {}) as Partial<Card>;
  const visibility = ["HIDDEN", "AVAILABLE", "REVEALED", "DISCARDED"].includes(String(card.visibility))
    ? card.visibility as CardVisibility
    : "AVAILABLE";

  return {
    id: String(card.id ?? crypto.randomUUID()),
    name: String(card.name ?? "Carta"),
    frontUrl: String(card.frontUrl ?? ""),
    backUrl: String(card.backUrl ?? ""),
    description: String(card.description ?? ""),
    category: String(card.category ?? "Outros"),
    visibility,
    selected: Boolean(card.selected),
    createdAt: Number(card.createdAt ?? Date.now())
  };
}

/**
 * Reads both the original single-deck format and the current multi-deck format.
 * Existing room cards are migrated in memory without losing their content.
 */
export function normalizeDeckState(value: unknown): DeckState {
  if (!value || typeof value !== "object") return cloneDeck(EMPTY_DECK);

  const input = value as Partial<DeckState> & {
    cards?: unknown[];
    revealedCardId?: string | null;
  };

  let decks: CardDeck[] = Array.isArray(input.decks)
    ? input.decks.filter(Boolean).map((raw, index) => {
        const item = raw as Partial<CardDeck>;
        return {
          id: String(item.id ?? `deck-${index + 1}-${crypto.randomUUID()}`),
          name: String(item.name ?? `Baralho ${index + 1}`),
          cards: Array.isArray(item.cards) ? item.cards.map(normalizeCard) : [],
          revealedCardId: item.revealedCardId ? String(item.revealedCardId) : null,
          createdAt: Number(item.createdAt ?? Date.now()),
          updatedAt: Number(item.updatedAt ?? Date.now())
        };
      })
    : [];

  if (decks.length === 0) {
    const legacyCards = Array.isArray(input.cards) ? input.cards.map(normalizeCard) : [];
    decks = [{
      id: "legacy-deck",
      name: "Baralho principal",
      cards: legacyCards,
      revealedCardId: input.revealedCardId ? String(input.revealedCardId) : null,
      createdAt: Date.now(),
      updatedAt: Number(input.updatedAt ?? Date.now())
    }];
  }

  const requestedActiveId = String(input.activeDeckId ?? "");
  const activeDeckId = decks.some((item) => item.id === requestedActiveId)
    ? requestedActiveId
    : decks[0].id;

  return {
    version: 2,
    decks,
    activeDeckId,
    cardSize: input.cardSize === "small" || input.cardSize === "large" ? input.cardSize : "medium",
    updatedAt: Number(input.updatedAt ?? Date.now())
  };
}

export async function loadDeck(): Promise<DeckState> {
  const metadata = await OBR.room.getMetadata();
  return normalizeDeckState((metadata as any)[METADATA_KEY]);
}

export async function saveDeck(deck: DeckState): Promise<void> {
  const next = { ...cloneDeck(deck), version: 2 as const, updatedAt: Date.now() };
  const bytes = byteSize({ [METADATA_KEY]: next });
  if (bytes > MAX_ROOM_METADATA_BYTES) {
    throw new Error(
      `A coleção excede o limite de 16 KB do metadata da sala. Remova descrições longas ou reduza a quantidade de cartas (${bytes} bytes).`
    );
  }
  await OBR.room.setMetadata({ [METADATA_KEY]: next });
}

export function metadataKey(): string {
  return METADATA_KEY;
}
