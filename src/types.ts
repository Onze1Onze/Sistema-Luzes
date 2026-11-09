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

export interface DeckState {
  version: 1;
  cards: Card[];
  revealedCardId: string | null;
  cardSize: CardSize;
  updatedAt: number;
}

export const EMPTY_DECK: DeckState = {
  version: 1,
  cards: [],
  revealedCardId: null,
  cardSize: "medium",
  updatedAt: Date.now()
};