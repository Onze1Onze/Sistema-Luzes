import { useCallback, useEffect, useMemo, useState } from "react";
import OBR from "@owlbear-rodeo/sdk";
import { loadDeck, normalizeDeckState, saveDeck } from "./storage";
import { broadcastReveal, subscribeDeck, subscribeReveal } from "./sync";
import {
  Card,
  CardDeck,
  CardSize,
  CardVisibility,
  DeckState,
  EMPTY_DECK,
} from "./types";

const MAX_META_BYTES = 16 * 1024;
const WARN_META_BYTES = 14 * 1024;

type FilterMode = "ALL" | CardVisibility;

interface CardForm {
  id: string | null;
  name: string;
  category: string;
  frontUrl: string;
  backUrl: string;
  description: string;
  visibility: CardVisibility;
}

const VISIBILITY_LABEL: Record<CardVisibility, string> = {
  REVEALED: "Revelada",
  AVAILABLE: "Disponível",
  HIDDEN: "Oculta",
  DISCARDED: "Descartada",
};

function makeId(prefix: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
  }
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

function emptyCardForm(card?: Card): CardForm {
  if (card) {
    return {
      id: card.id,
      name: card.name,
      category: card.category,
      frontUrl: card.frontUrl,
      backUrl: card.backUrl,
      description: card.description,
      visibility: card.visibility,
    };
  }
  return {
    id: null,
    name: "",
    category: "",
    frontUrl: "",
    backUrl: "",
    description: "",
    visibility: "HIDDEN",
  };
}export default function App() {
  const [state, setState] = useState<DeckState>(EMPTY_DECK);
  const [role, setRole] = useState<"GM" | "PLAYER">("GM");
  const [ready, setReady] = useState(false);
  const [filter, setFilter] = useState<FilterMode>("ALL");
  const [search, setSearch] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  const [cardModal, setCardModal] = useState<CardForm | null>(null);
  const [decksModalOpen, setDecksModalOpen] = useState(false);
  const [newDeckName, setNewDeckName] = useState("");
  const [renameDeckName, setRenameDeckName] = useState("");
  const [previewCard, setPreviewCard] = useState<Card | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 3500);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!OBR.isAvailable) {
      setRole("GM");
      setReady(true);
      return;
    }

    let active = true;
    let unsubDeck: (() => void) | undefined;
    let unsubReveal: (() => void) | undefined;
    let unsubRole: (() => void) | undefined;

    const timeout = window.setTimeout(() => {
      if (active) setReady(true);
    }, 8000);

    OBR.onReady(async () => {
      if (!active) return;
      window.clearTimeout(timeout);
      try {
        const [currentRole, loaded] = await Promise.all([
          OBR.player.getRole(),
          loadDeck(),
        ]);
        if (!active) return;
        setRole(currentRole);
        setState(loaded);

        unsubRole = OBR.player.onChange((player) => {
          setRole(player.role);
        });

        unsubDeck = subscribeDeck((next) => {
          if (next) {
            setState(normalizeDeckState(next));
          }
        });

        unsubReveal = subscribeReveal((cardId) => {
          setState((prev) => ({
            ...prev,
            decks: prev.decks.map((d) => {
              if (d.id !== prev.activeDeckId) return d;
              return {
                ...d,
                revealedCardId: cardId,
                cards: d.cards.map((c) => {
                  if (cardId && c.id === cardId) {
                    return { ...c, visibility: "REVEALED" as CardVisibility };
                  }
                  if (c.visibility === "REVEALED" && c.id !== cardId) {
                    return { ...c, visibility: "AVAILABLE" as CardVisibility };
                  }
                  return c;
                }),
              };
            }),
          }));
        });
      } catch (e) {
        showToast(e instanceof Error ? e.message : "Erro ao conectar ao Owlbear Rodeo.");
      } finally {
        if (active) setReady(true);
      }
    });

    return () => {
      active = false;
      window.clearTimeout(timeout);
      unsubDeck?.();
      unsubReveal?.();
      unsubRole?.();
    };
  }, [showToast]);

  const activeDeck = useMemo(
    () => state.decks.find((d) => d.id === state.activeDeckId) ?? state.decks[0],
    [state]
  );

  const metaBytes = useMemo(
    () => new TextEncoder().encode(JSON.stringify(state)).length,
    [state]
  );

  const persist = useCallback(
    async (next: DeckState) => {
      const normalized = normalizeDeckState({
        ...next,
        updatedAt: Date.now(),
      });
      const bytes = new TextEncoder().encode(JSON.stringify(normalized)).length;
      if (bytes > MAX_META_BYTES) {
        showToast(
          `Limite de 16 KB excedido (${(bytes / 1024).toFixed(1)} KB). Reduza textos ou cartas.`
        );
        return false;
      }
      setState(normalized);
      try {
        await saveDeck(normalized);
        return true;
      } catch (e) {
        showToast(e instanceof Error ? e.message : "Erro ao salvar metadados.");
        return false;
      }
    },
    [showToast]
  );
  const updateActiveDeck = useCallback(
    async (updater: (deck: CardDeck) => CardDeck) => {
      const now = Date.now();
      const next: DeckState = {
        ...state,
        decks: state.decks.map((d) =>
          d.id === activeDeck.id ? { ...updater(d), updatedAt: now } : d
        ),
      };
      return persist(next);
    },
    [state, activeDeck.id, persist]
  );

  const setCardVisibility = useCallback(
    async (cardId: string, visibility: CardVisibility) => {
      const wasRevealed = activeDeck.revealedCardId === cardId;
      const ok = await updateActiveDeck((deck) => ({
        ...deck,
        revealedCardId:
          visibility === "REVEALED"
            ? cardId
            : wasRevealed
              ? null
              : deck.revealedCardId,
        cards: deck.cards.map((c) => {
          if (c.id === cardId) return { ...c, visibility };
          if (visibility === "REVEALED" && c.visibility === "REVEALED") {
            return { ...c, visibility: "AVAILABLE" as CardVisibility };
          }
          return c;
        }),
      }));
      if (ok) {
        if (visibility === "REVEALED") {
          await broadcastReveal(cardId);
        } else if (wasRevealed) {
          await broadcastReveal(null);
        }
      }
    },
    [activeDeck.revealedCardId, updateActiveDeck]
  );

  const saveCardForm = useCallback(async () => {
    if (!cardModal) return;
    const name = cardModal.name.trim();
    if (!name) {
      showToast("Informe o nome da carta.");
      return;
    }

    const cardId = cardModal.id ?? makeId("card");
    const isNew = !cardModal.id;
    const targetVisibility = cardModal.visibility;

    const ok = await updateActiveDeck((deck) => {
      const existing = deck.cards.find((c) => c.id === cardId);
      const nextCard: Card = {
        id: cardId,
        name,
        category: cardModal.category.trim(),
        frontUrl: cardModal.frontUrl.trim(),
        backUrl: cardModal.backUrl.trim(),
        description: cardModal.description.trim(),
        visibility: targetVisibility,
        selected: existing?.selected ?? false,
        createdAt: existing?.createdAt ?? Date.now(),
      };

      const baseCards = isNew
        ? [...deck.cards, nextCard]
        : deck.cards.map((c) => (c.id === cardId ? nextCard : c));

      const finalCards =
        targetVisibility === "REVEALED"
          ? baseCards.map((c) =>
              c.id !== cardId && c.visibility === "REVEALED"
                ? { ...c, visibility: "AVAILABLE" as CardVisibility }
                : c
            )
          : baseCards;

      const nextRevealedId =
        targetVisibility === "REVEALED"
          ? cardId
          : deck.revealedCardId === cardId
            ? null
            : deck.revealedCardId;

      return {
        ...deck,
        revealedCardId: nextRevealedId,
        cards: finalCards,
      };
    });

    if (ok) {
      if (targetVisibility === "REVEALED") {
        await broadcastReveal(cardId);
      } else if (activeDeck.revealedCardId === cardId) {
        await broadcastReveal(null);
      }
      setCardModal(null);
      showToast(isNew ? "Carta adicionada." : "Carta atualizada.");
    }
  }, [cardModal, activeDeck.revealedCardId, updateActiveDeck, showToast]);

  const deleteCard = useCallback(
    async (cardId: string) => {
      const wasRevealed = activeDeck.revealedCardId === cardId;
      const ok = await updateActiveDeck((deck) => ({
        ...deck,
        revealedCardId: wasRevealed ? null : deck.revealedCardId,
        cards: deck.cards.filter((c) => c.id !== cardId),
      }));
      if (ok) {
        if (wasRevealed) await broadcastReveal(null);
        setCardModal(null);
        showToast("Carta removida.");
      }
    },
    [activeDeck.revealedCardId, updateActiveDeck, showToast]
  );

  const drawRandomCard = useCallback(async () => {
    const pool = activeDeck.cards.filter(
      (c) => c.visibility === "HIDDEN" || c.visibility === "AVAILABLE"
    );
    if (pool.length === 0) {
      showToast("Nenhuma carta dispon\u00edvel ou oculta para sortear.");
      return;
    }
    const picked = pool[Math.floor(Math.random() * pool.length)];
    await setCardVisibility(picked.id, "REVEALED");
    showToast(`Carta revelada: ${picked.name}`);
  }, [activeDeck.cards, setCardVisibility, showToast]);

  const shuffleDeck = useCallback(async () => {
    if (activeDeck.cards.length < 2) return;
    const copy = [...activeDeck.cards];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    const ok = await updateActiveDeck((deck) => ({ ...deck, cards: copy }));
    if (ok) showToast("Baralho embaralhado.");
  }, [activeDeck.cards, updateActiveDeck, showToast]);

  const chooseAsset = useCallback(
    async (field: "frontUrl" | "backUrl") => {
      if (!OBR.isAvailable) {
        showToast("Assets do Owlbear Rodeo dispon\u00edveis apenas dentro da mesa.");
        return;
      }
      try {
        const downloads = await OBR.assets.downloadImages(
          false,
          undefined,
          "ATTACHMENT"
        );
        const url = downloads[0]?.image.url;
        if (!url) return;
        setCardModal((prev) => (prev ? { ...prev, [field]: url } : prev));
      } catch (e) {
        showToast(e instanceof Error ? e.message : "Erro ao selecionar asset.");
      }
    },
    [showToast]
  );

  const exportJson = useCallback(() => {
    const blob = new Blob([JSON.stringify(state, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `sistema-cartas-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast("Backup JSON exportado.");
  }, [state, showToast]);

  const importJson = useCallback(
    async (file: File) => {
      try {
        const text = await file.text();
        const parsed = JSON.parse(text) as unknown;
        let nextState: DeckState;
        if (Array.isArray(parsed)) {
          nextState = normalizeDeckState({
            ...state,
            decks: state.decks.map((d) =>
              d.id === activeDeck.id ? { ...d, cards: parsed } : d
            ),
          });
        } else if (
          parsed &&
          typeof parsed === "object" &&
          "cards" in parsed &&
          !("decks" in parsed)
        ) {
          const single = parsed as Partial<CardDeck>;
          const id = makeId("deck");
          nextState = normalizeDeckState({
            ...state,
            activeDeckId: id,
            decks: [
              ...state.decks,
              {
                id,
                name: single.name || "Baralho Importado",
                cards: Array.isArray(single.cards) ? single.cards : [],
                revealedCardId: null,
                createdAt: Date.now(),
                updatedAt: Date.now(),
              },
            ],
          });
        } else {
          nextState = normalizeDeckState(parsed);
        }
        const ok = await persist(nextState);
        if (ok) showToast("JSON importado com sucesso.");
      } catch (e) {
        showToast(e instanceof Error ? e.message : "Arquivo JSON inv\u00e1lido.");
      }
    },
    [state, activeDeck.id, persist, showToast]
  );

  const switchDeck = useCallback(
    async (deckId: string) => {
      if (deckId === state.activeDeckId) return;
      const ok = await persist({ ...state, activeDeckId: deckId });
      if (ok) {
        const target = state.decks.find((d) => d.id === deckId);
        await broadcastReveal(target?.revealedCardId ?? null);
      }
    },
    [state, persist]
  );

  const createDeck = useCallback(async () => {
    const name = newDeckName.trim();
    if (!name) return;
    const id = makeId("deck");
    const now = Date.now();
    const ok = await persist({
      ...state,
      activeDeckId: id,
      decks: [
        ...state.decks,
        {
          id,
          name,
          cards: [],
          revealedCardId: null,
          createdAt: now,
          updatedAt: now,
        },
      ],
    });
    if (ok) {
      setNewDeckName("");
      await broadcastReveal(null);
      showToast(`Baralho "${name}" criado.`);
    }
  }, [newDeckName, state, persist, showToast]);

  const renameActiveDeck = useCallback(async () => {
    const name = renameDeckName.trim();
    if (!name) return;
    const ok = await updateActiveDeck((deck) => ({ ...deck, name }));
    if (ok) {
      setRenameDeckName("");
      showToast("Baralho renomeado.");
    }
  }, [renameDeckName, updateActiveDeck, showToast]);

  const deleteDeck = useCallback(
    async (deckId: string) => {
      if (state.decks.length <= 1) {
        showToast("Mantenha pelo menos um baralho.");
        return;
      }
      const remaining = state.decks.filter((d) => d.id !== deckId);
      const nextActive =
        state.activeDeckId === deckId ? remaining[0].id : state.activeDeckId;
      const ok = await persist({
        ...state,
        activeDeckId: nextActive,
        decks: remaining,
      });
      if (ok) {
        const target = remaining.find((d) => d.id === nextActive);
        await broadcastReveal(target?.revealedCardId ?? null);
        showToast("Baralho removido.");
      }
    },
    [state, persist, showToast]
  );

  const setCardSize = useCallback(
    async (cardSize: CardSize) => {
      await persist({ ...state, cardSize });
    },
    [state, persist]
  );
  const revealedCard = useMemo(
    () =>
      activeDeck.cards.find(
        (c) => c.id === activeDeck.revealedCardId && c.visibility === "REVEALED"
      ) ??
      activeDeck.cards.find((c) => c.visibility === "REVEALED") ??
      null,
    [activeDeck]
  );

  const availableCards = useMemo(
    () => activeDeck.cards.filter((c) => c.visibility === "AVAILABLE"),
    [activeDeck.cards]
  );

  const counts = useMemo(() => {
    const map: Record<FilterMode, number> = {
      ALL: activeDeck.cards.length,
      REVEALED: 0,
      AVAILABLE: 0,
      HIDDEN: 0,
      DISCARDED: 0,
    };
    for (const c of activeDeck.cards) {
      map[c.visibility] += 1;
    }
    return map;
  }, [activeDeck.cards]);

  const filteredCards = useMemo(() => {
    const q = search.trim().toLowerCase();
    return activeDeck.cards.filter((c) => {
      if (filter !== "ALL" && c.visibility !== filter) return false;
      if (!q) return true;
      return (
        c.name.toLowerCase().includes(q) ||
        c.category.toLowerCase().includes(q) ||
        c.description.toLowerCase().includes(q)
      );
    });
  }, [activeDeck.cards, filter, search]);

  const isGM = role === "GM";
  const gridClass =
    state.cardSize === "small"
      ? "grid small"
      : state.cardSize === "large"
        ? "grid large"
        : "grid";

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-left">
          <span className="brand">Sistema de Cartas</span>
          <span className={`role-pill ${isGM ? "gm" : ""}`}>
            {isGM ? "Mestre" : "Jogador"}
          </span>
          {isGM && (
            <select
              className="deck-select"
              value={activeDeck.id}
              onChange={(e) => void switchDeck(e.target.value)}
              aria-label="Selecionar baralho"
            >
              {state.decks.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name} ({d.cards.length})
                </option>
              ))}
            </select>
          )}
        </div>

        {isGM && (
          <div className="topbar-right">
            <span
              className={`meta-pill ${metaBytes >= WARN_META_BYTES ? "warn" : ""}`}
              title="Uso dos metadados da sala no Owlbear Rodeo"
            >
              {(metaBytes / 1024).toFixed(1)} / 16 KB
            </span>
            <button
              type="button"
              className="ghost"
              onClick={() => void shuffleDeck()}
              disabled={activeDeck.cards.length < 2}
            >
              Embaralhar
            </button>
            <button
              type="button"
              className="ghost"
              onClick={() => void drawRandomCard()}
            >
              Sortear
            </button>
            <button
              type="button"
              className="ghost"
              onClick={() => {
                setRenameDeckName(activeDeck.name);
                setDecksModalOpen(true);
              }}
            >
              Baralhos
            </button>
            <button
              type="button"
              className="primary"
              onClick={() => setCardModal(emptyCardForm())}
            >
              + Carta
            </button>
          </div>
        )}
      </header>

      <main className="main">
        {!ready ? (
          <div className="empty-box">Conectando ao Owlbear Rodeo...</div>
        ) : !isGM ? (
          <div className="player-stage">
            {revealedCard && (
              <section className="player-revealed">
                {revealedCard.frontUrl ? (
                  <img src={revealedCard.frontUrl} alt={revealedCard.name} />
                ) : (
                  <div className="card-placeholder" style={{ height: 220 }}>
                    Sem imagem
                  </div>
                )}
                <h2>{revealedCard.name}</h2>
                {revealedCard.category && (
                  <p className="card-cat">{revealedCard.category}</p>
                )}
                {revealedCard.description && <p>{revealedCard.description}</p>}
              </section>
            )}

            {availableCards.length > 0 && (
              <section>
                <div className={gridClass}>
                  {availableCards.map((card) => (
                    <article
                      key={card.id}
                      className="card-tile"
                      onClick={() => setPreviewCard(card)}
                      style={{ cursor: "pointer" }}
                    >
                      <div className="card-media">
                        {card.frontUrl || card.backUrl ? (
                          <img
                            src={card.frontUrl || card.backUrl}
                            alt={card.name}
                          />
                        ) : (
                          <div className="card-placeholder">Carta</div>
                        )}
                      </div>
                      <div className="card-body">
                        <div className="card-title">{card.name}</div>
                        {card.category && (
                          <div className="card-cat">{card.category}</div>
                        )}
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            )}

            {!revealedCard && availableCards.length === 0 && (
              <div className="empty-box">
                Nenhuma carta revelada ou dispon\u00edvel no momento.
              </div>
            )}
          </div>
        ) : (
          <>
            {revealedCard && (
              <section className="spotlight">
                {revealedCard.frontUrl ? (
                  <img
                    className="spotlight-thumb"
                    src={revealedCard.frontUrl}
                    alt={revealedCard.name}
                  />
                ) : (
                  <div className="spotlight-thumb card-placeholder">-</div>
                )}
                <div className="spotlight-info">
                  <div className="spotlight-title">
                    Revelada: {revealedCard.name}
                  </div>
                  <div className="spotlight-sub">
                    {revealedCard.category || "Sem categoria"}
                    {revealedCard.description
                      ? ` \u2022 ${revealedCard.description}`
                      : ""}
                  </div>
                </div>
                <div className="row">
                  <button
                    type="button"
                    className="ghost"
                    onClick={() =>
                      void setCardVisibility(revealedCard.id, "AVAILABLE")
                    }
                  >
                    Ocultar
                  </button>
                  <button
                    type="button"
                    className="danger"
                    onClick={() =>
                      void setCardVisibility(revealedCard.id, "DISCARDED")
                    }
                  >
                    Descartar
                  </button>
                </div>
              </section>
            )}

            <section className="toolbar">
              <div className="filters">
                {(
                  [
                    ["ALL", "Todas"],
                    ["REVEALED", "Revelada"],
                    ["AVAILABLE", "Dispon\u00edveis"],
                    ["HIDDEN", "Ocultas"],
                    ["DISCARDED", "Descartadas"],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    className={`chip ${filter === key ? "active" : ""}`}
                    onClick={() => setFilter(key)}
                  >
                    {label} ({counts[key]})
                  </button>
                ))}
              </div>

              <div className="toolbar-right">
                <input
                  type="search"
                  className="search-input"
                  placeholder="Buscar carta..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                <div className="size-group" role="group" aria-label="Tamanho">
                  {(
                    [
                      ["small", "P"],
                      ["medium", "M"],
                      ["large", "G"],
                    ] as const
                  ).map(([sz, label]) => (
                    <button
                      key={sz}
                      type="button"
                      className={state.cardSize === sz ? "active" : ""}
                      onClick={() => void setCardSize(sz)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </section>

            {filteredCards.length === 0 ? (
              <div className="empty-box">
                Nenhuma carta encontrada. Clique em "+ Carta" para adicionar.
              </div>
            ) : (
              <section className={gridClass}>
                {filteredCards.map((card) => {
                  const isRevealed = card.visibility === "REVEALED";
                  const imgSrc = card.frontUrl || card.backUrl;
                  return (
                    <article
                      key={card.id}
                      className={`card-tile ${isRevealed ? "revealed" : ""}`}
                    >
                      <div className="card-media">
                        {imgSrc ? (
                          <img src={imgSrc} alt={card.name} />
                        ) : (
                          <div className="card-placeholder">Sem imagem</div>
                        )}
                        <span className={`status-badge ${card.visibility}`}>
                          {VISIBILITY_LABEL[card.visibility]}
                        </span>
                      </div>

                      <div className="card-body">
                        <div className="card-title">{card.name}</div>
                        {card.category && (
                          <div className="card-cat">{card.category}</div>
                        )}
                        <div className="card-actions">
                          <button
                            type="button"
                            className="primary"
                            onClick={() =>
                              void setCardVisibility(
                                card.id,
                                isRevealed ? "AVAILABLE" : "REVEALED"
                              )
                            }
                          >
                            {isRevealed ? "Ocultar" : "Revelar"}
                          </button>
                          {card.visibility !== "AVAILABLE" && !isRevealed && (
                            <button
                              type="button"
                              className="ghost"
                              onClick={() =>
                                void setCardVisibility(card.id, "AVAILABLE")
                              }
                            >
                              Disponibilizar
                            </button>
                          )}
                          {card.visibility === "AVAILABLE" && (
                            <button
                              type="button"
                              className="ghost"
                              onClick={() =>
                                void setCardVisibility(card.id, "HIDDEN")
                              }
                            >
                              Esconder
                            </button>
                          )}
                          {card.visibility !== "DISCARDED" && (
                            <button
                              type="button"
                              className="ghost"
                              onClick={() =>
                                void setCardVisibility(card.id, "DISCARDED")
                              }
                            >
                              Descartar
                            </button>
                          )}
                          <button
                            type="button"
                            className="ghost"
                            onClick={() => setCardModal(emptyCardForm(card))}
                          >
                            Editar
                          </button>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </section>
            )}
          </>
        )}
      </main>

      {cardModal && (
        <div
          className="modal-backdrop"
          onClick={() => setCardModal(null)}
          role="presentation"
        >
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{cardModal.id ? "Editar Carta" : "Nova Carta"}</h3>
              <button
                type="button"
                className="ghost"
                onClick={() => setCardModal(null)}
              >
                Fechar
              </button>
            </div>

            <div className="field">
              <label htmlFor="card-name">Nome</label>
              <input
                id="card-name"
                value={cardModal.name}
                onChange={(e) =>
                  setCardModal({ ...cardModal, name: e.target.value })
                }
                placeholder="Ex.: O Sol"
              />
            </div>

            <div className="row">
              <div className="field" style={{ flex: 1 }}>
                <label htmlFor="card-category">Categoria</label>
                <input
                  id="card-category"
                  value={cardModal.category}
                  onChange={(e) =>
                    setCardModal({ ...cardModal, category: e.target.value })
                  }
                  placeholder="Ex.: Arcano Maior"
                />
              </div>

              <div className="field" style={{ flex: 1 }}>
                <label htmlFor="card-visibility">Visibilidade</label>
                <select
                  id="card-visibility"
                  value={cardModal.visibility}
                  onChange={(e) =>
                    setCardModal({
                      ...cardModal,
                      visibility: e.target.value as CardVisibility,
                    })
                  }
                >
                  <option value="HIDDEN">Oculta</option>
                  <option value="AVAILABLE">Dispon\u00edvel</option>
                  <option value="REVEALED">Revelada</option>
                  <option value="DISCARDED">Descartada</option>
                </select>
              </div>
            </div>

            <div className="field">
              <label htmlFor="card-front">URL da Frente</label>
              <div className="row">
                <input
                  id="card-front"
                  value={cardModal.frontUrl}
                  onChange={(e) =>
                    setCardModal({ ...cardModal, frontUrl: e.target.value })
                  }
                  placeholder="https://..."
                />
                <button
                  type="button"
                  className="ghost"
                  onClick={() => void chooseAsset("frontUrl")}
                >
                  Asset OBR
                </button>
              </div>
            </div>

            <div className="field">
              <label htmlFor="card-back">URL do Verso</label>
              <div className="row">
                <input
                  id="card-back"
                  value={cardModal.backUrl}
                  onChange={(e) =>
                    setCardModal({ ...cardModal, backUrl: e.target.value })
                  }
                  placeholder="https://..."
                />
                <button
                  type="button"
                  className="ghost"
                  onClick={() => void chooseAsset("backUrl")}
                >
                  Asset OBR
                </button>
              </div>
            </div>

            <div className="field">
              <label htmlFor="card-desc">Descri\u00e7\u00e3o</label>
              <textarea
                id="card-desc"
                rows={3}
                value={cardModal.description}
                onChange={(e) =>
                  setCardModal({ ...cardModal, description: e.target.value })
                }
                placeholder="Texto vis\u00edvel quando a carta for revelada..."
              />
            </div>

            <div className="modal-footer">
              {cardModal.id && (
                <button
                  type="button"
                  className="danger"
                  onClick={() => void deleteCard(cardModal.id!)}
                  style={{ marginRight: "auto" }}
                >
                  Excluir
                </button>
              )}
              <button
                type="button"
                className="ghost"
                onClick={() => setCardModal(null)}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="primary"
                onClick={() => void saveCardForm()}
              >
                Salvar
              </button>
            </div>
          </div>
        </div>
      )}

      {decksModalOpen && (
        <div
          className="modal-backdrop"
          onClick={() => setDecksModalOpen(false)}
          role="presentation"
        >
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Gerenciar Baralhos</h3>
              <button
                type="button"
                className="ghost"
                onClick={() => setDecksModalOpen(false)}
              >
                Fechar
              </button>
            </div>

            <div className="field">
              <label>Baralhos da Sala</label>
              {state.decks.map((d) => (
                <div key={d.id} className="row" style={{ marginBottom: 6 }}>
                  <button
                    type="button"
                    className={d.id === activeDeck.id ? "primary" : "ghost"}
                    style={{ flex: 1, textAlign: "left" }}
                    onClick={() => void switchDeck(d.id)}
                  >
                    {d.name} ({d.cards.length} cartas)
                  </button>
                  <button
                    type="button"
                    className="danger"
                    disabled={state.decks.length <= 1}
                    onClick={() => void deleteDeck(d.id)}
                  >
                    Excluir
                  </button>
                </div>
              ))}
            </div>

            <div className="field">
              <label htmlFor="rename-deck">Renomear baralho ativo</label>
              <div className="row">
                <input
                  id="rename-deck"
                  value={renameDeckName}
                  onChange={(e) => setRenameDeckName(e.target.value)}
                  placeholder="Novo nome..."
                />
                <button
                  type="button"
                  className="ghost"
                  onClick={() => void renameActiveDeck()}
                >
                  Renomear
                </button>
              </div>
            </div>

            <div className="field">
              <label htmlFor="new-deck">Criar novo baralho</label>
              <div className="row">
                <input
                  id="new-deck"
                  value={newDeckName}
                  onChange={(e) => setNewDeckName(e.target.value)}
                  placeholder="Nome do baralho..."
                />
                <button
                  type="button"
                  className="primary"
                  onClick={() => void createDeck()}
                >
                  Criar
                </button>
              </div>
            </div>

            <div className="field">
              <label>Backup JSON</label>
              <div className="row">
                <button
                  type="button"
                  className="ghost"
                  onClick={exportJson}
                >
                  Exportar JSON
                </button>
                <label
                  className="ghost"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    padding: "6px 11px",
                    cursor: "pointer",
                    fontSize: 13,
                  }}
                >
                  Importar JSON
                  <input
                    type="file"
                    accept=".json,application/json"
                    style={{ display: "none" }}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) void importJson(file);
                      e.target.value = "";
                    }}
                  />
                </label>
              </div>
            </div>

            <div className="modal-footer">
              <button
                type="button"
                className="ghost"
                onClick={() => setDecksModalOpen(false)}
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {previewCard && (
        <div
          className="modal-backdrop"
          onClick={() => setPreviewCard(null)}
          role="presentation"
        >
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{previewCard.name}</h3>
              <button
                type="button"
                className="ghost"
                onClick={() => setPreviewCard(null)}
              >
                Fechar
              </button>
            </div>
            {(previewCard.frontUrl || previewCard.backUrl) && (
              <img
                src={previewCard.frontUrl || previewCard.backUrl}
                alt={previewCard.name}
                style={{
                  width: "100%",
                  maxHeight: 340,
                  objectFit: "contain",
                  borderRadius: 8,
                  marginBottom: 10,
                }}
              />
            )}
            {previewCard.category && (
              <p className="card-cat" style={{ marginBottom: 6 }}>
                {previewCard.category}
              </p>
            )}
            {previewCard.description && <p>{previewCard.description}</p>}
          </div>
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

