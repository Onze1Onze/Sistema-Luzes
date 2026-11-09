import { useEffect, useMemo, useState } from "react";
import OBR, { buildImageUpload } from "@owlbear-rodeo/sdk";
import { broadcastReveal, subscribeDeck, subscribeReveal } from "./sync";
import { loadDeck, normalizeDeckState, saveDeck } from "./storage";
import { Card, CardDeck, CardSize, DeckState, EMPTY_DECK } from "./types";

const CATEGORIES = ["Equipamento", "Evento", "Inimigo", "Pista", "Local", "NPC", "Habilidade", "Condição", "Item", "Narrativa", "Outros"];
type View = "decks" | "library" | "settings";

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

function makeDeck(name: string): CardDeck {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    name,
    cards: [],
    revealedCardId: null,
    createdAt: now,
    updatedAt: now
  };
}

function cardImage(card: Card): string {
  return card.visibility === "HIDDEN"
    ? card.backUrl || card.frontUrl
    : card.frontUrl || card.backUrl;
}

export default function App() {
  const [deck, setDeck] = useState<DeckState>(EMPTY_DECK);
  const [role, setRole] = useState<"GM" | "PLAYER">("PLAYER");
  const [ready, setReady] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Card | null>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("Todas");
  const [view, setView] = useState<View>("decks");
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  const isGM = role === "GM";
  const activeDeck = deck.decks.find((item) => item.id === deck.activeDeckId) ?? deck.decks[0];

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
        unsubDeck = subscribeDeck((next) => setDeck(normalizeDeckState(next)));
        unsubReveal = subscribeReveal(({ cardId }) => {
          setDeck((prev) => ({
            ...prev,
            decks: prev.decks.map((item) => item.id === prev.activeDeckId
              ? { ...item, revealedCardId: cardId, updatedAt: Date.now() }
              : item)
          }));
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : "Não foi possível carregar a coleção.");
      }
    })();

    return () => {
      mounted = false;
      unsubDeck();
      unsubReveal();
    };
  }, []);

  const selectedCard = activeDeck?.cards.find((card) => card.id === selectedId) ?? null;
  const revealedCard = activeDeck?.cards.find((card) => card.id === activeDeck.revealedCardId) ?? null;

  const filteredCards = useMemo(() => {
    const q = query.trim().toLocaleLowerCase();
    return (activeDeck?.cards ?? []).filter((card) => {
      const textMatch = !q || `${card.name} ${card.description}`.toLocaleLowerCase().includes(q);
      const categoryMatch = category === "Todas" || card.category === category;
      return textMatch && categoryMatch;
    });
  }, [activeDeck, query, category]);

  const libraryCards = useMemo(() => {
    const q = query.trim().toLocaleLowerCase();
    return deck.decks.flatMap((group) => group.cards.map((card) => ({ card, deckId: group.id, deckName: group.name })))
      .filter(({ card }) => {
        const textMatch = !q || `${card.name} ${card.description}`.toLocaleLowerCase().includes(q);
        const categoryMatch = category === "Todas" || card.category === category;
        return textMatch && categoryMatch;
      });
  }, [deck.decks, query, category]);

  const availableCount = (activeDeck?.cards ?? []).filter((card) => card.visibility === "AVAILABLE").length;
  const hiddenCount = (activeDeck?.cards ?? []).filter((card) => card.visibility === "HIDDEN").length;
  const discardedCount = (activeDeck?.cards ?? []).filter((card) => card.visibility === "DISCARDED").length;
  const totalCount = (activeDeck?.cards ?? []).length;

  async function persist(next: DeckState) {
    setError("");
    setStatus("");
    try {
      setDeck(next);
      await saveDeck(next);
      setStatus("Coleção sincronizada");
      window.setTimeout(() => setStatus(""), 1500);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao salvar a coleção.");
    }
  }

  function withActiveDeck(patch: Partial<CardDeck>): DeckState {
    return {
      ...deck,
      decks: deck.decks.map((item) => item.id === activeDeck.id
        ? { ...item, ...patch, updatedAt: Date.now() }
        : item)
    };
  }

  async function selectDeck(id: string) {
    await persist({ ...deck, activeDeckId: id });
    setSelectedId(null);
    setQuery("");
    setCategory("Todas");
    setView("decks");
  }

  async function createDeck() {
    const nextDeck = makeDeck(`Baralho ${deck.decks.length + 1}`);
    await persist({ ...deck, decks: [...deck.decks, nextDeck], activeDeckId: nextDeck.id });
    setSelectedId(null);
    setView("decks");
  }

  async function deleteDeck(item: CardDeck) {
    if (deck.decks.length <= 1) {
      setError("A coleção precisa manter ao menos um baralho.");
      return;
    }
    if (!window.confirm(`Excluir o baralho “${item.name}” e todas as cartas dele?`)) return;
    const remaining = deck.decks.filter((entry) => entry.id !== item.id);
    const nextActiveId = item.id === deck.activeDeckId ? remaining[0].id : deck.activeDeckId;
    await persist({ ...deck, decks: remaining, activeDeckId: nextActiveId });
    setSelectedId(null);
  }

  function patchCard(id: string, patch: Partial<Card>) {
    const cards = activeDeck.cards.map((card) => card.id === id ? { ...card, ...patch } : card);
    void persist(withActiveDeck({ cards }));
  }

  async function createCard() {
    const card = blankCard();
    await persist(withActiveDeck({ cards: [...activeDeck.cards, card] }));
    setSelectedId(card.id);
    setEditing(card);
  }

  async function duplicateCard(card: Card) {
    const copy = { ...card, id: crypto.randomUUID(), name: `${card.name} — cópia`, selected: false, createdAt: Date.now() };
    await persist(withActiveDeck({ cards: [...activeDeck.cards, copy] }));
    setSelectedId(copy.id);
  }

  async function deleteCard(id: string) {
    const cards = activeDeck.cards.filter((card) => card.id !== id);
    const revealedCardId = activeDeck.revealedCardId === id ? null : activeDeck.revealedCardId;
    await persist(withActiveDeck({ cards, revealedCardId }));
    if (selectedId === id) setSelectedId(null);
  }

  async function reveal(card: Card) {
    if (!isGM) return;
    const cards = activeDeck.cards.map((item) => ({
      ...item,
      selected: item.id === card.id,
      visibility: item.id === card.id ? "REVEALED" as const : item.visibility
    }));
    await persist(withActiveDeck({ cards, revealedCardId: card.id }));
    await broadcastReveal(card.id);
  }

  async function hideReveal() {
    if (!isGM) return;
    const cards = activeDeck.cards.map((card) => card.visibility === "REVEALED"
      ? { ...card, visibility: "AVAILABLE" as const }
      : card);
    await persist(withActiveDeck({ revealedCardId: null, cards }));
    await broadcastReveal(null);
  }

  async function discard(card: Card) {
    await persist(withActiveDeck({
      cards: activeDeck.cards.map((item) => item.id === card.id
        ? { ...item, visibility: "DISCARDED", selected: false }
        : item),
      revealedCardId: activeDeck.revealedCardId === card.id ? null : activeDeck.revealedCardId
    }));
    if (activeDeck.revealedCardId === card.id) await broadcastReveal(null);
  }

  async function shuffle() {
    const cards = [...activeDeck.cards];
    for (let i = cards.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [cards[i], cards[j]] = [cards[j], cards[i]];
    }
    await persist(withActiveDeck({ cards }));
  }

  async function moveCard(id: string, direction: -1 | 1) {
    const index = activeDeck.cards.findIndex((card) => card.id === id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= activeDeck.cards.length) return;
    const cards = [...activeDeck.cards];
    [cards[index], cards[target]] = [cards[target], cards[index]];
    await persist(withActiveDeck({ cards }));
  }

  async function drawRandom() {
    const candidates = activeDeck.cards.filter((card) => card.visibility === "AVAILABLE" || card.visibility === "HIDDEN");
    if (candidates.length === 0) {
      setError("Não há cartas disponíveis para sortear neste baralho.");
      return;
    }
    const card = candidates[Math.floor(Math.random() * candidates.length)];
    await reveal(card);
  }

  async function chooseAsset(field: "frontUrl" | "backUrl") {
    try {
      const downloads = await OBR.assets.downloadImages(false, undefined, "ATTACHMENT");
      const image = downloads[0]?.image;
      if (!image) return;
      if (editing) setEditing({ ...editing, [field]: image.url });
      else if (selectedCard) patchCard(selectedCard.id, { [field]: image.url });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível abrir a biblioteca de imagens.");
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
        const imported = normalizeDeckState(JSON.parse(await file.text()));
        await persist(imported);
        setSelectedId(null);
        setView("decks");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Arquivo de coleção inválido.");
      }
    };
    input.click();
  }

  function exportDeck() {
    const payload = JSON.stringify(deck, null, 2);
    const blob = new Blob([payload], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "sistema-cartas-colecao.json";
    anchor.click();
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
        await OBR.assets.uploadImages(
          [buildImageUpload(new File([data], file.name, { type: file.type })).build()],
          "ATTACHMENT"
        );
        setStatus(`Imagem enviada. Abra a Biblioteca para aplicá-la à ${field === "frontUrl" ? "frente" : "ao verso"}.`);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Falha ao enviar imagem.");
      }
    };
    input.click();
  }

  async function openLibraryCard(deckId: string, cardId: string) {
    if (deckId !== activeDeck.id) await persist({ ...deck, activeDeckId: deckId });
    setSelectedId(cardId);
    setView("decks");
  }

  function handleDrop(targetId: string, sourceId: string) {
    if (!sourceId || sourceId === targetId) return;
    const cards = [...activeDeck.cards];
    const from = cards.findIndex((card) => card.id === sourceId);
    const to = cards.findIndex((card) => card.id === targetId);
    if (from < 0 || to < 0) return;
    const [item] = cards.splice(from, 1);
    cards.splice(to, 0, item);
    void persist(withActiveDeck({ cards }));
  }

  if (!ready) {
    return <div className="app-loading"><div className="loading-emblem">✦</div><strong>DECK & CARDS</strong><span>Preparando a mesa...</span></div>;
  }

  if (!isGM) {
    return (
      <div className="player-screen">
        <header className="player-header"><div className="brand-emblem">✦</div><div><strong>DECK & CARDS</strong><span>ÁREA DOS JOGADORES</span></div><span className="role-pill">JOGADOR</span></header>
        {revealedCard ? (
          <div className="player-reveal">
            <div className="reveal-caption">CARTA REVELADA PELO MESTRE</div>
            {revealedCard.frontUrl || revealedCard.backUrl
              ? <img src={revealedCard.frontUrl || revealedCard.backUrl} alt={revealedCard.name} />
              : <div className="player-card-placeholder">✦</div>}
            <div className="player-card-info"><span>{revealedCard.category}</span><h1>{revealedCard.name}</h1><p>{revealedCard.description}</p></div>
          </div>
        ) : (
          <div className="player-waiting"><div className="waiting-seal">✦</div><h1>A mesa aguarda.</h1><p>Quando o Mestre revelar uma carta, ela aparecerá aqui para todos os jogadores.</p></div>
        )}
      </div>
    );
  }

  return (
    <div className="app-shell">
      <header className="masthead">
        <div className="brand-group">
          <div className="brand-emblem">✦</div>
          <div className="brand-name"><strong>DECK <span>&</span> CARDS</strong><small>Salão de cartas • Sistema compartilhado</small></div>
        </div>
        <div className="masthead-right">
          <span className="sync-state"><i /> {status || "SINCRONIZADO"}</span>
          <span className="role-pill gm-pill">MESTRE</span>
        </div>
      </header>

      <nav className="main-nav">
        <button className={view === "decks" ? "nav-tab active" : "nav-tab"} onClick={() => setView("decks")}><span>♜</span> Meus baralhos</button>
        <button className={view === "library" ? "nav-tab active" : "nav-tab"} onClick={() => { setView("library"); setCategory("Todas"); }}><span>▤</span> Biblioteca</button>
        <button className={view === "settings" ? "nav-tab active" : "nav-tab"} onClick={() => setView("settings")}><span>⚙</span> Configurações</button>
        <div className="nav-spacer" />
        <span className="nav-room">SALA COMPARTILHADA <b>● ONLINE</b></span>
      </nav>

      {error && <div className="notice error-notice"><span>!</span>{error}<button onClick={() => setError("")}>×</button></div>}

      <div className="workspace">
        <aside className="sidebar">
          <div className="side-title"><span>SEUS BARALHOS</span><button onClick={() => void createDeck()} title="Criar baralho">＋ NOVO</button></div>
          <div className="deck-list">
            {deck.decks.map((item, index) => (
              <div key={item.id} className={item.id === activeDeck.id ? "deck-entry selected" : "deck-entry"}>
                <button className="deck-entry-main" onClick={() => void selectDeck(item.id)}>
                  <span className="deck-thumb">{item.cards[0]?.frontUrl ? <img src={item.cards[0].frontUrl} alt="" /> : <i>✦</i>}</span>
                  <span className="deck-entry-copy"><strong>{item.name}</strong><small>{item.cards.length} {item.cards.length === 1 ? "carta" : "cartas"}</small></span>
                  <span className="deck-index">{String(index + 1).padStart(2, "0")}</span>
                </button>
                {deck.decks.length > 1 && <button className="deck-delete" onClick={() => void deleteDeck(item)} aria-label={`Excluir ${item.name}`}>×</button>}
              </div>
            ))}
          </div>

          <div className="side-divider" />
          <div className="side-title category-title"><span>CATEGORIAS</span><small>{totalCount} TOTAL</small></div>
          <div className="category-list">
            <button className={category === "Todas" ? "category-option active" : "category-option"} onClick={() => setCategory("Todas")}><span>✧ Todas as cartas</span><b>{totalCount}</b></button>
            {CATEGORIES.map((name) => {
              const count = activeDeck.cards.filter((card) => card.category === name).length;
              return <button key={name} className={category === name ? "category-option active" : "category-option"} onClick={() => { setCategory(name); setView("decks"); }}><span>{name}</span><b>{count}</b></button>;
            })}
          </div>

          <div className="sidebar-bottom">
            <div className="mini-card-fan"><i /><i /><i /><i /><i /></div>
            <div><strong>{availableCount} CARTAS NA PILHA</strong><small>{hiddenCount} ocultas • {discardedCount} descartadas</small></div>
          </div>
        </aside>

        <main className="main-stage">
          {view === "settings" ? (
            <section className="settings-view">
              <div className="view-kicker">MESA DO MESTRE / PREFERÊNCIAS</div>
              <h1>Configurações da coleção</h1>
              <p className="view-intro">Ajuste a apresentação das cartas e gerencie os arquivos compartilhados desta sala.</p>
              <div className="settings-grid">
                <article className="setting-card"><span className="setting-icon">▤</span><h2>Tamanho das cartas</h2><p>Escolha a escala usada na mesa de gerenciamento.</p><div className="size-options"><button className={deck.cardSize === "small" ? "chosen" : ""} onClick={() => void persist({ ...deck, cardSize: "small" })}>Pequena</button><button className={deck.cardSize === "medium" ? "chosen" : ""} onClick={() => void persist({ ...deck, cardSize: "medium" })}>Média</button><button className={deck.cardSize === "large" ? "chosen" : ""} onClick={() => void persist({ ...deck, cardSize: "large" })}>Grande</button></div></article>
                <article className="setting-card"><span className="setting-icon">⇅</span><h2>Importar e exportar</h2><p>Faça uma cópia de segurança de todos os baralhos, cartas e imagens vinculadas por URL.</p><div className="setting-actions"><button onClick={() => void importDeck()}>Importar coleção</button><button className="gold-button" onClick={exportDeck}>Exportar coleção</button></div></article>
                <article className="setting-card"><span className="setting-icon">♜</span><h2>Espaço da sala</h2><p>O armazenamento compartilhado usa o metadata da sala do Owlbear Rodeo.</p><div className="storage-meter"><span style={{ width: `${Math.min(100, (new TextEncoder().encode(JSON.stringify(deck)).length / (16 * 1024)) * 100)}%` }} /></div><small>{new TextEncoder().encode(JSON.stringify(deck)).length.toLocaleString("pt-BR")} bytes de 16 KB usados nesta coleção</small></article>
                <article className="setting-card"><span className="setting-icon">✦</span><h2>Baralhos da sala</h2><p>{deck.decks.length} baralhos • {deck.decks.reduce((sum, item) => sum + item.cards.length, 0)} cartas armazenadas.</p><button onClick={() => void createDeck()}>＋ Criar novo baralho</button></article>
              </div>
            </section>
          ) : view === "library" ? (
            <section className="library-view">
              <div className="stage-heading"><div><div className="view-kicker">ACERVO COMPARTILHADO</div><h1>Biblioteca de cartas</h1><p>Visualize todas as cartas existentes em seus baralhos.</p></div><span className="total-counter">{libraryCards.length} RESULTADOS</span></div>
              <div className="library-tools"><label className="search-box"><span>⌕</span><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar nome ou descrição..." /></label><select value={category} onChange={(e) => setCategory(e.target.value)}><option value="Todas">Todas as categorias</option>{CATEGORIES.map((item) => <option key={item}>{item}</option>)}</select></div>
              <div className="library-grid">
                {libraryCards.length === 0 && <div className="empty-library">Nenhuma carta corresponde a esta busca.</div>}
                {libraryCards.map(({ card, deckId, deckName }) => (
                  <button key={`${deckId}-${card.id}`} className="library-card" onClick={() => void openLibraryCard(deckId, card.id)}>
                    <span className="library-art">{cardImage(card) ? <img src={cardImage(card)} alt="" /> : <i>✦</i>}</span>
                    <strong>{card.name}</strong><small>{deckName} • {card.category}</small>
                  </button>
                ))}
              </div>
            </section>
          ) : (
            <>
              <div className="stage-heading">
                <div><div className="view-kicker">MESA DO MESTRE / BARALHO ATIVO</div><h1>{activeDeck.name}</h1><p>Organize, prepare e revele cartas para todos na sala.</p></div>
                <span className="total-counter">{totalCount} / 60 CARTAS</span>
              </div>

              <section className="deck-banner" style={activeDeck.cards[0]?.frontUrl ? { backgroundImage: `linear-gradient(90deg, #100e14 4%, #100e14dd 45%, #100e1470), url("${activeDeck.cards[0].frontUrl}")` } : undefined}>
                <div className="banner-ornament">✦</div>
                <div className="banner-content"><span>CRÔNICAS DA MESA</span><h2>{activeDeck.name}</h2><p>Uma coleção de histórias, encontros e descobertas.</p><div className="banner-stats"><b>{totalCount} CARTAS</b><i /> <b>{availableCount} DISPONÍVEIS</b><i /> <b>{discardedCount} DESCARTADAS</b></div></div>
                <div className="banner-actions"><button onClick={() => void shuffle()}>⤨ Embaralhar</button><button className="gold-button" onClick={() => void drawRandom()}>✦ Sortear carta</button></div>
              </section>

              <div className="card-toolbar">
                <div className="toolbar-label"><span>✧</span> CARTAS DO BARALHO <small>{filteredCards.length} exibidas</small></div>
                <div className="toolbar-tools"><label className="search-box"><span>⌕</span><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Pesquisar..." /></label><select value={category} onChange={(e) => setCategory(e.target.value)}><option value="Todas">Todas</option>{CATEGORIES.map((item) => <option key={item}>{item}</option>)}</select><button className="new-card-button" onClick={() => void createCard()}>＋ Nova carta</button></div>
              </div>

              <div className={`card-grid size-${deck.cardSize}`}>
                {filteredCards.length === 0 && <div className="empty-library"><span>✦</span><strong>Este baralho está vazio</strong><small>Crie uma carta para começar a montar sua coleção.</small><button className="gold-button" onClick={() => void createCard()}>＋ Criar primeira carta</button></div>}
                {filteredCards.map((card, index) => (
                  <article
                    key={card.id}
                    className={selectedId === card.id ? "table-card selected" : "table-card"}
                    draggable
                    onDragStart={(event) => event.dataTransfer.setData("text/card-id", card.id)}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => handleDrop(card.id, event.dataTransfer.getData("text/card-id"))}
                    onClick={() => setSelectedId(card.id)}
                    onDoubleClick={() => setEditing({ ...card })}
                  >
                    <div className="table-card-art">
                      {cardImage(card) ? <img src={cardImage(card)} alt="" /> : <div className="card-placeholder"><span>✦</span><small>DECK & CARDS</small></div>}
                      <span className="card-number">{String(index + 1).padStart(2, "0")}</span>
                      <button className="card-more" onClick={(event) => { event.stopPropagation(); setSelectedId(card.id); setEditing({ ...card }); }} aria-label="Editar carta">•••</button>
                      <div className="card-art-gradient" />
                    </div>
                    <div className="table-card-copy"><span>{card.category}</span><strong>{card.name}</strong><small className={`state-label state-${card.visibility.toLowerCase()}`}>{card.visibility === "HIDDEN" ? "OCULTA" : card.visibility === "DISCARDED" ? "DESCARTADA" : card.visibility === "REVEALED" ? "REVELADA" : "DISPONÍVEL"}</small></div>
                  </article>
                ))}
              </div>

              <section className="draw-zone">
                <div className="draw-zone-copy"><span>✧</span><div><strong>PILHA DE COMPRA</strong><small>{availableCount + hiddenCount} cartas aguardando na pilha</small></div></div>
                <div className="draw-stack" aria-hidden="true"><i /><i /><i /><i /><i /></div>
                <button onClick={() => void drawRandom()} disabled={availableCount + hiddenCount === 0}>Sortear próxima carta <span>→</span></button>
              </section>
            </>
          )}
        </main>

        {view === "decks" && (
          <aside className="inspector">
            {selectedCard ? (
              <>
                <div className="inspector-heading"><span>DETALHES DA CARTA</span><button onClick={() => setSelectedId(null)} aria-label="Fechar detalhes">×</button></div>
                <div className="inspector-art">
                  {cardImage(selectedCard) ? <img src={cardImage(selectedCard)} alt={selectedCard.name} /> : <div className="card-placeholder"><span>✦</span><small>DECK & CARDS</small></div>}
                </div>
                <div className="inspector-category">{selectedCard.category}</div>
                <h2>{selectedCard.name}</h2>
                <p className="inspector-description">{selectedCard.description || "Esta carta ainda não possui uma descrição."}</p>
                <div className="inspector-status"><span>ESTADO</span><b>{selectedCard.visibility === "HIDDEN" ? "Oculta" : selectedCard.visibility === "DISCARDED" ? "Descartada" : selectedCard.visibility === "REVEALED" ? "Revelada" : "Disponível"}</b></div>
                <div className="inspector-actions"><button className="gold-button wide" onClick={() => void reveal(selectedCard)}>✦ Revelar para todos</button><button onClick={() => setEditing({ ...selectedCard })}>✎ Editar carta</button><button onClick={() => void duplicateCard(selectedCard)}>▣ Duplicar</button><button onClick={() => void discard(selectedCard)}>↘ Descartar</button><div className="inspector-row"><button onClick={() => void moveCard(selectedCard.id, -1)}>← Mover</button><button onClick={() => void moveCard(selectedCard.id, 1)}>Mover →</button></div><button className="delete-card-action" onClick={() => void deleteCard(selectedCard.id)}>Excluir carta</button></div>
              </>
            ) : (
              <div className="inspector-empty"><div className="inspector-seal">✦</div><span>ÁREA DE INSPEÇÃO</span><h2>Selecione uma carta</h2><p>Clique em uma carta para ver seus detalhes e acessar as ações do Mestre.</p><div className="inspection-tip"><b>DICA DA MESA</b><small>Dê um duplo clique em qualquer carta para abrir o editor completo.</small></div></div>
            )}
          </aside>
        )}
      </div>

      {editing && (
        <div className="modal-backdrop" onMouseDown={(event) => event.currentTarget === event.target && setEditing(null)}>
          <form className="editor-modal" onSubmit={(event) => { event.preventDefault(); patchCard(editing.id, editing); setEditing(null); }}>
            <div className="modal-heading"><div><span>OFICINA DO MESTRE</span><h2>Configurar carta</h2></div><button type="button" onClick={() => setEditing(null)}>×</button></div>
            <label>Nome da carta<input value={editing.name} onChange={(event) => setEditing({ ...editing, name: event.target.value })} required /></label>
            <label>Categoria<select value={editing.category} onChange={(event) => setEditing({ ...editing, category: event.target.value })}>{CATEGORIES.map((item) => <option key={item}>{item}</option>)}</select></label>
            <label>Descrição<textarea rows={4} value={editing.description} onChange={(event) => setEditing({ ...editing, description: event.target.value })} /></label>
            <div className="editor-image-row">
              <label>Imagem da frente<input value={editing.frontUrl} onChange={(event) => setEditing({ ...editing, frontUrl: event.target.value })} placeholder="https://..." /><span><button type="button" onClick={() => void chooseAsset("frontUrl")}>Biblioteca</button><button type="button" onClick={() => void uploadFromFile("frontUrl")}>Enviar</button></span></label>
              <label>Imagem do verso<input value={editing.backUrl} onChange={(event) => setEditing({ ...editing, backUrl: event.target.value })} placeholder="https://..." /><span><button type="button" onClick={() => void chooseAsset("backUrl")}>Biblioteca</button><button type="button" onClick={() => void uploadFromFile("backUrl")}>Enviar</button></span></label>
            </div>
            <label>Estado inicial<select value={editing.visibility} onChange={(event) => setEditing({ ...editing, visibility: event.target.value as Card["visibility"] })}><option value="HIDDEN">Oculta</option><option value="AVAILABLE">Disponível</option><option value="DISCARDED">Descartada</option></select></label>
            <div className="modal-actions"><button type="button" onClick={() => setEditing(null)}>Cancelar</button><button className="gold-button" type="submit">Salvar carta</button></div>
          </form>
        </div>
      )}

      {revealedCard && (
        <div className="reveal-backdrop">
          <div className="reveal-card">
            <button className="close-reveal" onClick={() => void hideReveal()} aria-label="Fechar">×</button>
            <div className="reveal-art">{revealedCard.frontUrl || revealedCard.backUrl ? <img src={revealedCard.frontUrl || revealedCard.backUrl} alt={revealedCard.name} /> : <div className="player-card-placeholder">✦</div>}</div>
            <div className="reveal-info"><span>{revealedCard.category}</span><h2>{revealedCard.name}</h2>{revealedCard.description && <p>{revealedCard.description}</p>}</div>
            <div className="reveal-footer">REVELADA PARA TODOS OS JOGADORES</div>
          </div>
        </div>
      )}
    </div>
  );
}
