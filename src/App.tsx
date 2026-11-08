import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import OBR from "@owlbear-rodeo/sdk";
import type { AnimationType, LightConfig, LightPreset, LightRecord, TokenOption } from "./types";
import { BUILT_IN_PRESETS } from "./presets";
import { DEFAULT_CONFIG, LIGHT_META_KEY, PLAYER_META_KEY, TOOL_ID, TOOL_MODE_ID } from "./types";
import { getLightRecords, validateConfig } from "./utils";
import { applyPreset, createLightAt, deleteLight, duplicateLight, getSceneItems, updateLight, updateLightRadius } from "./repository";
import { LightingRenderer } from "./renderer";

const renderer = new LightingRenderer();
const ANIMATION_LABELS: Record<AnimationType, string> = {
  STATIC: "Estática", BLINK: "Piscante", PULSE: "Pulsante", FLICKER: "Flicker",
  EMERGENCY: "Emergência", OSCILLATE: "Oscilante", CUSTOM: "Customizada",
};

function readPlayerData(metadata: Record<string, unknown>) {
  return (metadata[PLAYER_META_KEY] && typeof metadata[PLAYER_META_KEY] === "object"
    ? metadata[PLAYER_META_KEY]
    : {}) as { selectedId?: string | null; savedPresets?: LightPreset[] };
}

function Range({ label, value, min, max, step = 0.01, suffix = "", onChange }: {
  label: string; value: number; min: number; max: number; step?: number; suffix?: string; onChange: (value: number) => void;
}) {
  return <label className="range-field">
    <span className="field-head"><span>{label}</span><output>{Number(value.toFixed(2))}{suffix}</output></span>
    <input type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} />
  </label>;
}

function Section({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  return <section className="section"><div className="section-head"><span>{title}</span>{right}</div>{children}</section>;
}

function IconButton({ title, onClick, children, danger = false, disabled = false }: {
  title: string; onClick: () => void; children: ReactNode; danger?: boolean; disabled?: boolean;
}) {
  return <button className={`icon-button ${danger ? "danger" : ""}`} type="button" title={title} aria-label={title} onClick={onClick} disabled={disabled}>{children}</button>;
}

export default function App() {
  const [ready, setReady] = useState(false);
  const [role, setRole] = useState<"GM" | "PLAYER">("PLAYER");
  const [items, setItems] = useState<any[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [savedPresets, setSavedPresets] = useState<LightPreset[]>([]);
  const [presetName, setPresetName] = useState("Minha luz");
  const [status, setStatus] = useState("AGUARDANDO CENA");

  const records = useMemo(() => getLightRecords(items), [items]);
  const selected = useMemo(() => records.find((record) => record.id === selectedId) ?? null, [records, selectedId]);
  const tokens: TokenOption[] = useMemo(() => items
    .filter((item) => item.layer === "CHARACTER")
    .map((item) => ({ id: item.id, name: item.name || "Token sem nome", position: item.position }))
    .sort((a, b) => a.name.localeCompare(b.name)), [items]);

  const [config, setConfig] = useState<LightConfig>(DEFAULT_CONFIG);
  const [radius, setRadius] = useState(240);

  useEffect(() => {
    if (selected) {
      setConfig(validateConfig(selected.config));
      setRadius(selected.radius);
    }
  }, [selectedId, selected?.item?.metadata, selected?.radius]);

  useEffect(() => {
    renderer.setContext(items, role, selectedId);
  }, [items, role, selectedId]);

  useEffect(() => {
    let stopItems: (() => void) | undefined;
    let stopPlayer: (() => void) | undefined;
    let stopReady: (() => void) | undefined;
    let stopSdkReady: (() => void) | undefined;
    let alive = true;

    const initialize = async () => {
      try {
        const isSceneReady = await OBR.scene.isReady();
        if (!alive || !isSceneReady) {
          if (alive) setStatus("SEM CENA ATIVA");
          return;
        }
        const [sceneItems, currentRole, playerMetadata] = await Promise.all([
          getSceneItems(), OBR.player.getRole(), OBR.player.getMetadata(),
        ]);
        if (!alive) return;
        const playerData = readPlayerData(playerMetadata);
        setItems(sceneItems);
        setRole(currentRole);
        setSelectedId(playerData.selectedId ?? null);
        setSavedPresets(Array.isArray(playerData.savedPresets) ? playerData.savedPresets : []);
        setStatus("SISTEMA OPERACIONAL");
        stopItems?.();
        stopItems = OBR.scene.items.onChange((nextItems) => {
          if (alive) {
            setItems(nextItems);
            const lightIds = new Set(getLightRecords(nextItems).map((record) => record.id));
            setSelectedId((current) => current && lightIds.has(current) ? current : null);
          }
        });
        if (!stopPlayer) {
          stopPlayer = OBR.player.onChange((player) => {
            if (!alive) return;
            setRole(player.role);
            const data = readPlayerData(player.metadata ?? {});
            setSelectedId(data.selectedId ?? null);
            setSavedPresets(Array.isArray(data.savedPresets) ? data.savedPresets : []);
          });
        }
      } catch (error) {
        console.error("[Sistema de Luzes] Não foi possível iniciar:", error);
        if (alive) setStatus("FALHA AO INICIAR");
      }
    };

    const onSdkReady = () => {
      stopReady?.();
      stopReady = OBR.scene.onReadyChange((isSceneReady) => {
        if (isSceneReady) void initialize();
        else {
          stopItems?.();
          stopItems = undefined;
          setStatus("SEM CENA ATIVA");
        }
      });
      void initialize();
    };

    if (OBR.isReady) onSdkReady();
    else stopSdkReady = OBR.onReady(onSdkReady);
    setReady(true);
    return () => {
      alive = false;
      stopSdkReady?.();
      stopItems?.();
      stopPlayer?.();
      stopReady?.();
      renderer.dispose();
    };
  }, []);

  const persistPlayerData = useCallback(async (patch: Partial<{ selectedId: string | null; savedPresets: LightPreset[] }>) => {
    const current = readPlayerData(await OBR.player.getMetadata());
    await OBR.player.setMetadata({ [PLAYER_META_KEY]: { ...current, ...patch } });
  }, []);

  const selectLight = useCallback(async (id: string | null) => {
    setSelectedId(id);
    try { await persistPlayerData({ selectedId: id }); }
    catch (error) { console.warn("[Sistema de Luzes] Não foi possível sincronizar a seleção:", error); }
  }, [persistPlayerData]);

  const commitConfig = useCallback(async (next: LightConfig) => {
    const safe = validateConfig(next);
    setConfig(safe);
    if (!selected) return;
    try { await updateLight(selected.id, safe); }
    catch (error) { console.error("[Sistema de Luzes] Falha ao salvar luz:", error); }
  }, [selected]);

  const patchConfig = useCallback((patch: Partial<LightConfig>) => {
    void commitConfig({ ...config, ...patch });
  }, [config, commitConfig]);

  const changeRadius = useCallback((value: number) => {
    const safe = Math.max(24, Math.min(5000, value));
    setRadius(safe);
    if (selected) void updateLightRadius(selected.id, safe);
  }, [selected]);

  const createLight = useCallback(async () => {
    try {
      const position = await OBR.viewport.getPosition();
      const id = await createLightAt(position, DEFAULT_CONFIG);
      await selectLight(id);
      setStatus("NOVA LUZ CRIADA");
    } catch (error) {
      console.error(error);
      setStatus("ERRO AO CRIAR LUZ");
    }
  }, [selectLight]);

  const removeSelected = useCallback(async () => {
    if (!selected) return;
    await deleteLight(selected.id);
    await selectLight(null);
  }, [selected, selectLight]);

  const copySelected = useCallback(async () => {
    if (!selected) return;
    const id = await duplicateLight(selected.item);
    if (id) await selectLight(id);
  }, [selected, selectLight]);

  const apply = useCallback(async (preset: LightPreset) => {
    if (!selected) {
      const position = await OBR.viewport.getPosition();
      const id = await createLightAt(position, validateConfig({ ...preset.config, name: preset.name }));
      await selectLight(id);
      return;
    }
    await applyPreset(selected.id, preset);
  }, [selected, selectLight]);

  const bindToken = useCallback(async (tokenId: string) => {
    if (!selected) return;
    if (!tokenId) {
      await commitConfig({ ...config, linkedTokenId: null, offset: { x: 0, y: 0 } });
      return;
    }
    const token = tokens.find((candidate) => candidate.id === tokenId);
    if (!token) return;
    await commitConfig({
      ...config,
      linkedTokenId: tokenId,
      offset: { x: selected.position.x - token.position.x, y: selected.position.y - token.position.y },
    });
  }, [selected, tokens, config, commitConfig]);

  const savePreset = useCallback(async () => {
    const name = presetName.trim().slice(0, 32);
    if (!name) return;
    const { linkedTokenId: _linkedTokenId, offset: _offset, locked: _locked, visibility: _visibility, ...presetConfig } = config;
    const preset: LightPreset = {
      id: `custom-${Date.now()}`,
      name,
      config: presetConfig,
    };
    const next = [...savedPresets.filter((entry) => entry.name !== name), preset].slice(-20);
    setSavedPresets(next);
    await persistPlayerData({ savedPresets: next });
    setStatus("PRESET ARMAZENADO");
  }, [config, presetName, savedPresets, persistPlayerData]);

  const allPresets = [...BUILT_IN_PRESETS, ...savedPresets];
  const rgb = useMemo(() => {
    const n = Number.parseInt(config.color.slice(1), 16);
    return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
  }, [config.color]);

  if (!ready) return <main className="shell"><div className="boot"><span className="sigil">SL</span><span>INICIANDO TERMINAL</span></div></main>;

  return <main className="shell">
    <header className="topbar">
      <div className="brand-mark">SL</div>
      <div className="brand-copy"><strong>SISTEMA DE LUZES</strong><small>DIVISÃO DE CONTENÇÃO · Nº 04</small></div>
      <span className={`role-tag ${role === "GM" ? "gm" : "player"}`}>{role === "GM" ? "MESTRE" : "AGENTE"}</span>
    </header>

    <div className="status-line"><span className="status-dot" />{status}<span className="status-right">v1.0.1 / OR</span></div>

    <Section title="FONTES DE LUZ" right={<span className="count">{records.length.toString().padStart(2, "0")}</span>}>
      {role === "GM" && <button className="primary-button" onClick={createLight}><span>＋</span> NOVA LUZ NO CENTRO</button>}
      <div className="light-list">
        {records.length === 0 && <div className="empty">NENHUMA FONTE REGISTRADA</div>}
        {records.map((record) => <button key={record.id} className={`light-row ${record.id === selectedId ? "selected" : ""}`} onClick={() => selectLight(record.id)}>
          <span className="light-swatch" style={{ background: record.config.color, boxShadow: `0 0 12px ${record.config.color}88` }} />
          <span className="light-label"><strong>{record.config.name}</strong><small>{record.config.linkedTokenId ? "VINCULADA A TOKEN" : "FIXA NO MAPA"} · {ANIMATION_LABELS[record.config.animation.type].toUpperCase()}</small></span>
          <span className={`light-state ${record.config.enabled ? "on" : "off"}`}>{record.config.enabled ? "●" : "○"}</span>
        </button>)}
      </div>
      {role === "GM" && <div className="tool-hint">Ferramenta SL no mapa: clique vazio para criar · arraste uma luz para mover · arraste a borda para redimensionar.</div>}
    </Section>

    {role === "GM" && selected && <>
      <Section title="LUZ SELECIONADA" right={<div className="row-actions">
        <IconButton title={config.enabled ? "Desativar" : "Ativar"} onClick={() => patchConfig({ enabled: !config.enabled })}>{config.enabled ? "◉" : "○"}</IconButton>
        <IconButton title={config.locked ? "Desbloquear" : "Bloquear"} onClick={() => patchConfig({ locked: !config.locked })}>{config.locked ? "▣" : "◇"}</IconButton>
        <IconButton title="Duplicar" onClick={copySelected}>▢</IconButton>
        <IconButton title="Excluir" danger onClick={removeSelected}>×</IconButton>
      </div>}>
        <label className="field"><span>IDENTIFICAÇÃO</span><input value={config.name} maxLength={48} onChange={(event) => patchConfig({ name: event.target.value })} /></label>
        <div className="field-head"><span>COR / HEX</span><output>RGB {rgb}</output></div>
        <div className="color-row"><input aria-label="Selecionar cor" type="color" value={config.color} onChange={(event) => patchConfig({ color: event.target.value })} /><input aria-label="Código hexadecimal" className="hex-input" value={config.color.toUpperCase()} maxLength={7} onChange={(event) => {
          const value = event.target.value;
          if (/^#[0-9a-fA-F]{6}$/.test(value)) patchConfig({ color: value });
        }} /></div>
        <div className="swatch-grid">
          {["#FFFFFF", "#C8DEFF", "#FFD39B", "#FF343D", "#4D91FF", "#42D889", "#A65BDB", "#FFD84A", "#31D4E5", "#EE58C7", "#FF5A1F", "#A20D1B"].map((color) => <button key={color} title={color} style={{ background: color }} className={config.color.toUpperCase() === color ? "active" : ""} onClick={() => patchConfig({ color })} />)}
        </div>
        <Range label="INTENSIDADE" value={config.intensity} min={0} max={2.5} onChange={(value) => patchConfig({ intensity: value })} />
        <Range label="OPACIDADE" value={config.opacity} min={0} max={1} onChange={(value) => patchConfig({ opacity: value })} />
        <Range label="RAIO" value={radius} min={24} max={2000} step={8} suffix=" u" onChange={changeRadius} />
        <Range label="FALLOFF" value={config.falloff} min={0} max={1} onChange={(value) => patchConfig({ falloff: value })} />
        <Range label="SUAVIDADE DE SOMBRA" value={config.softness} min={0} max={240} step={4} suffix=" u" onChange={(value) => patchConfig({ softness: value })} />
        <Range label="TEMPERATURA" value={config.temperature} min={1600} max={10000} step={100} suffix=" K" onChange={(value) => patchConfig({ temperature: value })} />
        <label className="field"><span>VISIBILIDADE</span><select value={config.visibility} onChange={(event) => patchConfig({ visibility: event.target.value as LightConfig["visibility"] })}><option value="ALL">Todos os jogadores</option><option value="GM_ONLY">Somente Mestre</option></select></label>
      </Section>

      <Section title="ANIMAÇÃO">
        <label className="field"><span>PADRÃO</span><select value={config.animation.type} onChange={(event) => patchConfig({ animation: { ...config.animation, type: event.target.value as AnimationType, startedAt: Date.now() / 1000 } })}>
          {Object.entries(ANIMATION_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select></label>
        {config.animation.type !== "STATIC" && <>
          <Range label="VELOCIDADE" value={config.animation.speed} min={0.05} max={8} step={0.05} onChange={(value) => patchConfig({ animation: { ...config.animation, speed: value } })} />
          <Range label="INTENSIDADE MÍNIMA" value={config.animation.min} min={0} max={1} onChange={(value) => patchConfig({ animation: { ...config.animation, min: value } })} />
          <Range label="INTENSIDADE MÁXIMA" value={config.animation.max} min={0} max={1} onChange={(value) => patchConfig({ animation: { ...config.animation, max: value } })} />
          <Range label="FREQUÊNCIA" value={config.animation.frequency} min={0.1} max={30} step={0.1} suffix=" Hz" onChange={(value) => patchConfig({ animation: { ...config.animation, frequency: value } })} />
          <Range label="IRREGULARIDADE" value={config.animation.irregularity} min={0} max={1} onChange={(value) => patchConfig({ animation: { ...config.animation, irregularity: value } })} />
          {config.animation.type === "CUSTOM" && <Range label="INTERVALO" value={config.animation.interval} min={0.05} max={5} step={0.05} suffix=" s" onChange={(value) => patchConfig({ animation: { ...config.animation, interval: value } })} />}
        </>}
      </Section>

      <Section title="VINCULAÇÃO AO TOKEN">
        <label className="field"><span>ACOMPANHAR</span><select value={config.linkedTokenId ?? ""} onChange={(event) => void bindToken(event.target.value)}>
          <option value="">Luz independente</option>
          {tokens.map((token) => <option key={token.id} value={token.id}>{token.name}</option>)}
        </select></label>
        {config.linkedTokenId && <p className="note">A luz acompanha o token e mantém o deslocamento configurado. A movimentação manual é desativada enquanto vinculada.</p>}
      </Section>
    </>}

    {role === "GM" && <Section title="PROTOCOLOS / PRESETS">
      <div className="preset-grid">{allPresets.map((preset) => <button key={preset.id} className="preset" onClick={() => void apply(preset)}>
        <span className="preset-dot" style={{ background: preset.config.color, boxShadow: `0 0 10px ${preset.config.color}99` }} />
        <span>{preset.name}</span>
      </button>)}</div>
      {selected && <div className="save-preset"><input value={presetName} maxLength={32} onChange={(event) => setPresetName(event.target.value)} aria-label="Nome do preset" /><button onClick={() => void savePreset()}>SALVAR PRESET</button></div>}
    </Section>}

    {role === "PLAYER" && <div className="player-notice">VISUALIZAÇÃO DE AGENTE — as fontes de luz disponíveis na cena são renderizadas automaticamente neste dispositivo.</div>}

    <footer className="footer"><span>ARQUIVO: SL-04 / OPERAÇÃO NOTURNA</span><span>BUILD 1.0.1</span></footer>
  </main>;
}
