import OBR from "@owlbear-rodeo/sdk";
import { getActiveDeck, loadDeck } from "./storage";
import {
  closeRevealModal,
  openRevealModal,
  subscribeDeck,
  subscribeReveal
} from "./sync";

let lastKnownRevealedId: string | null = null;

async function syncFromMetadata(): Promise<void> {
  const state = await loadDeck();
  const activeDeck = getActiveDeck(state);
  const revealedCardId = activeDeck?.revealedCardId ?? null;
  lastKnownRevealedId = revealedCardId;

  if (revealedCardId) {
    await openRevealModal(revealedCardId);
  }
}

OBR.onReady(async () => {
  await syncFromMetadata();

  subscribeReveal(({ cardId }) => {
    lastKnownRevealedId = cardId;
    if (cardId) {
      void openRevealModal(cardId);
    } else {
      void closeRevealModal();
    }
  });

  subscribeDeck((state) => {
    const activeDeck = getActiveDeck(state);
    const nextCardId = activeDeck?.revealedCardId ?? null;
    if (nextCardId === lastKnownRevealedId) {
      return;
    }
    lastKnownRevealedId = nextCardId;
    if (nextCardId) {
      void openRevealModal(nextCardId);
    } else {
      void closeRevealModal();
    }
  });
});
