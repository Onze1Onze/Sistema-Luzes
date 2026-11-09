import { useEffect, useMemo, useState } from "react";
import OBR, { buildImageUpload } from "@owlbear-rodeo/sdk";
import { broadcastReveal, subscribeDeck, subscribeReveal } from "./sync";
import { loadDeck, saveDeck } from "./storage";
import { Card, CardSize, DeckState, EMPTY_DECK } from "./types";

const CATEGORIES = ["Equipamento", "Evento", "Inimigo", "Pista", "Local", "NPC", "Habilidade", "Condição", "Item", "Narrativa", "Outros"];

function blankCard(): Card {
  return {
    id: crypto.randomUUID(),
    name: "Nova carta",
    frontUrl: "",
    backUrl: "",
    description: "",
    category: "Outros",
    visibility: "AVAILABLE",
    selected: false,
    createdAt: Date.now()
  };
}

export default function App() {
  const [deck, setDeck] = useState<DeckState>(EMPTY_DECK);
  const [role, setRole] = useState<"GM" | "PLAYER">("PLAYER");
  const [ready, setReady] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Card | null>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("Todas");
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  const isGM = role === "GM";

  useEffect(() => {
    let unsubDeck = () => {};
    let unsubReveal = () => {};
    let mounted = true;

    void (async () => {
      try {
        await OBR.onReady(() => {});
        const currentRole = await OBR.player.getRole();
        if (!mounted) return;
        setRole(currentRole);
        setDeck(await loadDeck());
        setReady(true);
        unsubDeck = subscribeDeck((next) => setDeck(next));
        unsubReveal = subscribeReveal(({ cardId }) => {
          setDeck((prev) => ({ ...prev, revealedCardId: cardId, updatedAt: Date.now() }));
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : "Não foi possível carregar o deck.");
      }
    })();

    return () => {
      mounted = false;
      unsubDeck();
      unsubReveal();
    };
  }, []);

  const filteredCards = useMemo(() => {
    const q = query.trim().toLocaleLowerCase();
    return deck.cards.filter((card) => {
      const textMatch = !q || `${card.name} ${card.description}`.toLocaleLowerCase().includes(q);
      const categoryMatch = category === "Todas" || card.category === category;
      return textMatch && categoryMatch;
    });
  }, [deck.cards, query, category]);

  const selectedCard = deck.cards.find((c) => c.id === selectedId) ?? null;
  const revealedCard = deck.cards.find((c) => c.id === deck.revealedCardId) ?? null;

  async function persist(next: DeckState) {
    setError("");
    setStatus("");
    try {
      setDeck(next);
      await saveDeck(next);
      setStatus("Salvo");
      window.setTimeout(() => setStatus(""), 1200);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao salvar.");
    }
  }

  function patchCard(id: string, patch: Partial<Card>) {
    const cards = deck.cards.map((card) => card.id === id ? { ...card, ...patch } : card);
    void persist({ ...deck, cards });
  }

  async function createCard() {
    const card = blankCard();
    await persist({ ...deck, cards: [...deck.cards, card] });
    setSelectedId(card.id);
    setEditing(card);
  }

  async function duplicateCard(card: Card) {
    const copy = { ...card, id: crypto.randomUUID(), name: `${card.name} — cópia`, selected: false, createdAt: Date.now() };
    await persist({ ...deck, cards: [...deck.cards, copy] });
    setSelectedId(copy.id);
  }

  async function deleteCard(id: string) {
    const nextCards = deck.cards.filter((card) => card.id !== id);
    const revealedCardId = deck.revealedCardId === id ? null : deck.revealedCardId;
    await persist({ ...deck, cards: nextCards, revealedCardId });
    if (selectedId === id) setSelectedId(null);
  }

  async function reveal(card: Card) {
    if (!isGM) return;
    const nextCards = deck.cards.map((c) => ({ ...c, selected: c.id === card.id, visibility: c.id === card.id ? "REVEALED" as const : c.visibility }));
    await persist({ ...deck, cards: nextCards, revealedCardId: card.id });
    await broadcastReveal(card.id);
  }

  async function hideReveal() {
    if (!isGM) return;
    await persist({ ...deck, revealedCardId: null, cards: deck.cards.map(c => c.visibility === "REVEALED" ? { ...c, visibility: "AVAILABLE" as const } : c) });
    await broadcastReveal(null);
  }

  async function discard(card: Card) {
    await persist({ ...deck, cards: deck.cards.map(c => c.id === card.id ? { ...c, visibility: "DISCARDED", selected: false } : c) });
  }

  async function shuffle() {
    const cards = [...deck.cards];
    for (let i = cards.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [cards[i], cards[j]] = [cards[j], cards[i]];
    }
    await persist({ ...deck, cards });
  }

  async function moveCard(id: string, direction: -1 | 1) {
    const index = deck.cards.findIndex(c => c.id === id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= deck.cards.length) return;
    const cards = [...deck.cards];
    [cards[index], cards[target]] = [cards[target], cards[index]];
    await persist({ ...deck, cards });
  }

  async function chooseAsset(field: "frontUrl" | "backUrl") {
    const downloads = await OBR.assets.downloadImages(false, undefined, "ATTACHMENT");
    const image = downloads[0]?.image;
    if (!image) return;
    if (editing) {
      setEditing({ ...editing, [field]: image.url });
    } else if (selectedCard) {
      patchCard(selectedCard.id, { [field]: image.url });
    }
  }

  async function importDeck() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json,.json";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const parsed = JSON.parse(await file.text()) as DeckState;
        if (!Array.isArray(parsed.cards)) throw new Error("Arquivo de deck inválido.");
        await persist({ ...deck, cards: parsed.cards, cardSize: parsed.cardSize ?? deck.cardSize });
      } catch (e) {
        setError(e instanceof Error ? e.message : "Importação inválida.");
      }
    };
    input.click();
  }

  function exportDeck() {
    const payload = JSON.stringify(deck, null, 2);
    const blob = new Blob([payload], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "sistema-cartas-deck.json";
    a.click();
    URL.revokeObjectURL(url);
  }

  async function uploadFromFile(field: "frontUrl" | "backUrl") {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file || !editing) return;
      try {
        const data = await file.arrayBuffer();
        await OBR.assets.uploadImages([buildImageUpload(new File([data], file.name, { type: file.type })).build()], "ATTACHMENT");
        setStatus("Imagem enviada para os assets do Owlbear. Selecione-a pelo botão Biblioteca.");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Falha ao enviar imagem.");
      }
    };
    input.click();
  }

  if (!ready) return <div className="shell"><div className="loading">Carregando Sistema de Cartas…</div></div>;

  return (
    <div className="shell">
      <header className="topbar">
        <div>
          <div className="eyebrow">OWLBEAR RODEO</div>
          <h1>Sistema de Cartas</h1>
        </div>
        <span className={isGM ? "role gm" : "role"}>{isGM ? "MESTRE" : "JOGADOR"}</span>
      </header>

      {error && <div className="error">{error}</div>}
      {status && <div className="toast">{status}</div>}

      {isGM ? (
        <section className="controls">
          <button className="primary" onClick={() => void createCard()}>＋ Nova carta</button>
          <button onClick={() => void shuffle()}>⤨ Embaralhar</button>
          <button onClick={() => void importDeck()}>Importar</button>
          <button onClick={exportDeck}>Exportar</button>
          <label className="select-row">Tamanho
            <select value={deck.cardSize} onChange={(e) => void persist({ ...deck, cardSize: e.target.value as CardSize })}>
              <option value="small">Pequena</option>
              <option value="medium">Média</option>
              <option value="large">Grande</option>
            </select>
          </label>
        </section>
      ) : (
        <div className="player-note">A bandeja administrativa pertence ao Mestre. Aqui aparecem apenas cartas reveladas.</div>
      )}

      {isGM && (
        <section className="filters">
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="⌕ Pesquisar carta…" />
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            <option>Todas</option>
            {CATEGORIES.map(c => <option key={c}>{c}</option>)}
          </select>
        </section>
      )}

      {isGM && (
        <section className="deck-area">
          <div className="section-title"><span>DECK</span><small>{filteredCards.length} cartas</small></div>
          <div className={`card-tray size-${deck.cardSize}`}>
            {filteredCards.length === 0 && <div className="empty">Nenhuma carta encontrada.</div>}
            {filteredCards.map((card) => (
              <article
                key={card.id}
                className={`card-shell ${selectedId === card.id ? "selected" : ""}`}
                draggable
                onDragStart={(e) => e.dataTransfer.setData("text/card-id", card.id)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  const source = e.dataTransfer.getData("text/card-id");
                  if (!source || source === card.id) return;
                  const cards = [...deck.cards];
                  const a = cards.findIndex(c => c.id === source);
                  const b = cards.findIndex(c => c.id === card.id);
                  if (a >= 0 && b >= 0) {
                    const [item] = cards.splice(a, 1);
                    cards.splice(b, 0, item);
                    void persist({ ...deck, cards });
                  }
                }}
                onClick={() => setSelectedId(card.id)}
                onDoubleClick={() => setEditing({ ...card })}
              >
                <div className="card">
                  <img src={card.visibility === "HIDDEN" ? (card.backUrl || card.frontUrl) : (card.frontUrl || card.backUrl)} alt="" />
                  <div className="card-shade" />
                  <div className="card-meta">
                    <span>{card.category}</span>
                    <strong>{card.name}</strong>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      {isGM && selectedCard && (
        <section className="drawer">
          <div className="drawer-head">
            <div><span className="eyebrow">CARTA SELECIONADA</span><h2>{selectedCard.name}</h2></div>
            <button onClick={() => setSelectedId(null)}>×</button>
          </div>
          <div className="drawer-actions">
            <button className="primary" onClick={() => void reveal(selectedCard)}>◉ Revelar para todos</button>
            <button onClick={() => setEditing({ ...selectedCard })}>Editar</button>
            <button onClick={() => void duplicateCard(selectedCard)}>Duplicar</button>
            <button onClick={() => void discard(selectedCard)}>Descartar</button>
            <button onClick={() => void moveCard(selectedCard.id, -1)}>←</button>
            <button onClick={() => void moveCard(selectedCard.id, 1)}>→</button>
            <button className="danger" onClick={() => void deleteCard(selectedCard.id)}>Excluir</button>
          </div>
        </section>
      )}

      {editing && isGM && (
        <div className="modal-backdrop" onMouseDown={(e) => e.currentTarget === e.target && setEditing(null)}>
          <form className="editor" onSubmit={(e) => {
            e.preventDefault();
            patchCard(editing.id, editing);
            setEditing(null);
          }}>
            <div className="drawer-head"><div><span className="eyebrow">EDITOR</span><h2>Configurar carta</h2></div><button type="button" onClick={() => setEditing(null)}>×</button></div>
            <label>Nome<input value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })} required /></label>
            <label>Categoria<select value={editing.category} onChange={e => setEditing({ ...editing, category: e.target.value })}>{CATEGORIES.map(c => <option key={c}>{c}</option>)}</select></label>
            <label>Descrição<textarea rows={4} value={editing.description} onChange={e => setEditing({ ...editing, description: e.target.value })} /></label>
            <div className="image-fields">
              <label>Frente<input value={editing.frontUrl} onChange={e => setEditing({ ...editing, frontUrl: e.target.value })} placeholder="URL da imagem" /><span><button type="button" onClick={() => void chooseAsset("frontUrl")}>Biblioteca</button><button type="button" onClick={() => void uploadFromFile("frontUrl")}>Enviar</button></span></label>
              <label>Verso<input value={editing.backUrl} onChange={e => setEditing({ ...editing, backUrl: e.target.value })} placeholder="URL da imagem" /><span><button type="button" onClick={() => void chooseAsset("backUrl")}>Biblioteca</button><button type="button" onClick={() => void uploadFromFile("backUrl")}>Enviar</button></span></label>
            </div>
            <label>Estado inicial<select value={editing.visibility} onChange={e => setEditing({ ...editing, visibility: e.target.value as Card["visibility"] })}><option value="HIDDEN">Oculta</option><option value="AVAILABLE">Disponível</option><option value="DISCARDED">Descartada</option></select></label>
            <button className="primary full" type="submit">Salvar carta</button>
          </form>
        </div>
      )}

      {revealedCard && (
        <div className="reveal-backdrop">
          <div className="reveal-card">
            <button className="close-reveal" onClick={() => isGM && void hideReveal()} aria-label="Fechar">×</button>
            <div className="reveal-image-wrap">
              <img src={revealedCard.frontUrl || revealedCard.backUrl} alt={revealedCard.name} />
            </div>
            <div className="reveal-info"><span>{revealedCard.category}</span><h2>{revealedCard.name}</h2>{revealedCard.description && <p>{revealedCard.description}</p>}</div>
          </div>
        </div>
      )}
    </div>
  );
}