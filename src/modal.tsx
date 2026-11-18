import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import OBR from "@owlbear-rodeo/sdk";
import { getActiveDeck, loadDeck, saveDeck } from "./storage";
import {
  broadcastReveal,
  closeRevealModal,
  subscribeDeck,
  subscribeReveal
} from "./sync";
import { DeckState } from "./types";

function RevealModalApp() {
  const initialCardId = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("cardId");
  }, []);

  const [deckState, setDeckState] = useState<DeckState | null>(null);
  const [cardId, setCardId] = useState<string | null>(initialCardId);
  const [role, setRole] = useState<"GM" | "PLAYER">("PLAYER");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let unsubDeck: (() => void) | undefined;
    let unsubReveal: (() => void) | undefined;
    let unsubRole: (() => void) | undefined;

    OBR.onReady(async () => {
      const [playerRole, loaded] = await Promise.all([
        OBR.player.getRole(),
        loadDeck()
      ]);

      setRole(playerRole);
      setDeckState(loaded);

      const activeDeck = getActiveDeck(loaded);
      const nextCardId = initialCardId ?? activeDeck?.revealedCardId ?? null;
      setCardId(nextCardId);
      setReady(true);

      unsubRole = OBR.player.onChange((player) => {
        setRole(player.role);
      });

      unsubDeck = subscribeDeck((nextState) => {
        setDeckState(nextState);
        const nextActive = getActiveDeck(nextState);
        if (!nextActive?.revealedCardId) {
          void closeRevealModal();
        } else {
          setCardId(nextActive.revealedCardId);
        }
      });

      unsubReveal = subscribeReveal(({ cardId: broadcastCardId }) => {
        if (!broadcastCardId) {
          void closeRevealModal();
        } else {
          setCardId(broadcastCardId);
        }
      });
    });

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        void closeRevealModal();
      }
    };
    window.addEventListener("keydown", onKeyDown);

    return () => {
      unsubDeck?.();
      unsubReveal?.();
      unsubRole?.();
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [initialCardId]);

  const activeDeck = deckState ? getActiveDeck(deckState) : null;
  const resolvedId = cardId ?? activeDeck?.revealedCardId ?? null;
  const card = useMemo(() => {
    if (!activeDeck || !resolvedId) return null;
    return activeDeck.cards.find((item) => item.id === resolvedId) ?? null;
  }, [activeDeck, resolvedId]);

  async function handleHideForAll(): Promise<void> {
    if (!deckState || !activeDeck) {
      await broadcastReveal(null);
      await closeRevealModal();
      return;
    }

    const updated: DeckState = {
      ...deckState,
      updatedAt: Date.now(),
      decks: deckState.decks.map((deck) =>
        deck.id === activeDeck.id
          ? {
              ...deck,
              revealedCardId: null,
              updatedAt: Date.now(),
              cards: deck.cards.map((item) =>
                item.visibility === "REVEALED"
                  ? { ...item, visibility: "AVAILABLE" }
                  : item
              )
            }
          : deck
      )
    };

    await saveDeck(updated);
    await broadcastReveal(null);
    await closeRevealModal();
  }

  return (
    <div
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          void closeRevealModal();
        }
      }}
      style={{
        position: "fixed",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px",
        background: "rgba(8, 11, 18, 0.72)",
        backdropFilter: "blur(4px)",
        fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        color: "#f8fafc",
        boxSizing: "border-box"
      }}
    >
      <div
        style={{
          position: "relative",
          maxWidth: "min(92vw, 560px)",
          maxHeight: "92vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "12px",
          padding: "18px",
          borderRadius: "16px",
          background: "rgba(18, 22, 34, 0.94)",
          border: "1px solid rgba(255, 255, 255, 0.14)",
          boxShadow: "0 24px 60px rgba(0, 0, 0, 0.65)",
          boxSizing: "border-box"
        }}
      >
        <div
          style={{
            width: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "12px"
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                fontSize: "18px",
                fontWeight: 700,
                lineHeight: 1.25,
                wordBreak: "break-word"
              }}
            >
              {card ? card.name : ready ? "Carta revelada" : "Carregando carta..."}
            </div>
            {card?.category ? (
              <div style={{ fontSize: "12px", color: "#94a3b8", marginTop: "2px" }}>
                {card.category}
              </div>
            ) : null}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "8px", flexShrink: 0 }}>
            {role === "GM" ? (
              <button
                type="button"
                onClick={() => void handleHideForAll()}
                style={{
                  border: "1px solid rgba(248, 113, 113, 0.45)",
                  background: "rgba(220, 38, 38, 0.22)",
                  color: "#fecaca",
                  borderRadius: "8px",
                  padding: "7px 12px",
                  fontSize: "13px",
                  fontWeight: 600,
                  cursor: "pointer"
                }}
              >
                Recolher para todos
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => void closeRevealModal()}
              aria-label="Fechar carta"
              style={{
                border: "1px solid rgba(255, 255, 255, 0.2)",
                background: "rgba(255, 255, 255, 0.1)",
                color: "#f8fafc",
                borderRadius: "8px",
                padding: "7px 12px",
                fontSize: "13px",
                fontWeight: 600,
                cursor: "pointer"
              }}
            >
              Fechar
            </button>
          </div>
        </div>

        {card?.frontUrl ? (
          <img
            src={card.frontUrl}
            alt={card.name}
            style={{
              maxWidth: "100%",
              maxHeight: "68vh",
              objectFit: "contain",
              borderRadius: "12px",
              boxShadow: "0 12px 32px rgba(0, 0, 0, 0.45)"
            }}
          />
        ) : (
          <div
            style={{
              padding: "36px 24px",
              color: "#cbd5e1",
              textAlign: "center",
              fontSize: "14px"
            }}
          >
            {ready ? "Nenhuma imagem disponível para esta carta." : "Carregando..."}
          </div>
        )}

        {card?.description ? (
          <div
            style={{
              width: "100%",
              maxHeight: "14vh",
              overflowY: "auto",
              fontSize: "13px",
              lineHeight: 1.45,
              color: "#cbd5e1",
              textAlign: "center",
              whiteSpace: "pre-wrap"
            }}
          >
            {card.description}
          </div>
        ) : null}
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <RevealModalApp />
  </React.StrictMode>
);
