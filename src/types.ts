export type CardVisibility = "HIDDEN" | "AVAILABLE" | "REVEALED" | "DISCARDED";
export type CardSize = "small" | "medium" | "large";

export interface Card {
  id: string;
  name: string;
  frontUrl: string;
  backUrl: string;
  description: string;
  category: string;
  visibility: CardVisibility;
  selected: boolean;
  createdAt: number;
}

export interface CardDeck {
  id: string;
  name: string;
  cards: Card[];
  revealedCardId: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface DeckState {
  version: 2;
  decks: CardDeck[];
  activeDeckId: string;
  cardSize: CardSize;
  updatedAt: number;
}

export const EMPTY_DECK: DeckState = {
  version: 2,
  decks: [{
    id: "default-deck",
    name: "Baralho principal",
    cards: [],
    revealedCardId: null,
    createdAt: Date.now(),
    updatedAt: Date.now()
  }],
  activeDeckId: "default-deck",
  cardSize: "medium",
  updatedAt: Date.now()
};
