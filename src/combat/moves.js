/* =============================================================================
 *  moves.js  —  Loader de ATTACK RECORDS e MOTIONS (schema BT3)
 * =============================================================================
 *
 *  POR QUE ESTE ARQUIVO EXISTE (e por que mudou de forma).
 *
 *  Antes ele era um catálogo de "golpes" em strings (`rush_1`,
 *  `smash_forward`…) com startup/active/recovery escritos à mão. O BT3 não
 *  funciona assim: um golpe é um ATTACK RECORD binário de 0x30 bytes
 *  (btl_tech_a.h:59-96) indexado por attack id numérico, e a JANELA de hit
 *  não vem de frame data — vem de eventos do arquivo de animação
 *  (`bobj_a.h:13-37`: o motion abre/fecha a hitbox por evento, e o teste
 *  geométrico roda enquanto ela está aberta). Trocar strings por records e
 *  startup/active/recovery por `motions[id].events` não é cosmética: é a
 *  única forma de o port reproduzir a ordem de resolução real
 *  (`btl_char_hit.h:8-18`).
 *
 *  Os NÚMEROS continuam autorados em `src/tuning.js` (WP1) — o decomp não
 *  extrai frame data de golpe (é AFS/ISO, ver BT3-REFACTOR §1.2). Este
 *  arquivo só NORMALIZA e CONSULTA, nunca inventa balanceamento.
 *
 *  ---------------------------------------------------------------------------
 *  NORMALIZAÇÃO MUTA os objetos de `TUNING.bt3.records` em vez de copiar, pela
 *  mesma razão de sempre (armadilha 8.19): o painel (P) escreve nos records ao
 *  vivo, e uma cópia faria o slider parar de funcionar em silêncio.
 * ---------------------------------------------------------------------------
 *
 *  ESCOPO: UM PERSONAGEM (Goku). Decisão idêntica à do protótipo — ver o
 *  cabeçalho antigo deste arquivo e BT3-REFACTOR §1.3.
 * ========================================================================== */

import { TUNING } from '../tuning.js';

/* ========================================================================== */
/*  Consulta a tabelas BT3                                                     */
/* ========================================================================== */

let _ready = false;

/**
 * Attack record por attack id. Aceita id numérico, string numérica ou
 * ação BT3 (via tabela de alias, abaixo) — o consumidor nem sempre sabe
 * qual dos três está na mão (o `f.act.current` é ação; o record é
 * indexado por attack id; o tuning pode chamar de qualquer jeito).
 */
export function recordOf(atkId) {
  if (atkId == null) return null;
  const T = TUNING.bt3;
  if (!T || !T.records) return null;
  const direto = T.records[atkId];
  if (direto) return direto;
  const alias = acaoParaAtaque(atkId, T.actionMap);
  return alias != null ? (T.records[alias] ?? null) : null;
}

/**
 * Motion (visual + eventos da janela de hit) por motion id. Mesma
 * flexibilidade de `recordOf`: motion id direto, ou ação BT3 traduzida
 * (o rush 0x44 vira 0x37 + elo).
 */
export function motionOf(motionId, passo = 0) {
  if (motionId == null) return null;
  const T = TUNING.bt3;
  if (!T || !T.motions) return null;
  const direto = T.motions[motionId];
  if (direto) return direto;
  const alias = acaoParaMotion(motionId, passo, T.actionMotionMap);
  return alias != null ? (T.motions[alias] ?? null) : null;
}

/* ========================================================================== */
/*  Alias ação BT3 → attack id / motion id                                    */
/* ========================================================================== */
/*
 *  POR QUE alias: no BT3, a AÇÃO (máquina de estados, 0x44 = rush) e o
 *  ATTACK ID (record, 0..9 = elos do rush) são coisas diferentes. Quem
 *  resolve hit recebe o `f.act.current` (ação) e precisa achar o record e o
 *  motion. O decomp faz isso dentro do código de cada ação; no port isso vira
 *  DADO (a tabela mora no tuning via `TUNING.bt3.actionMap` /
 *  `actionMotionMap` — ver /tmp/opencode/wp2b-requests.md). O que está aqui é
 *  o FALLBACK do kit MVP (BT3-REFACTOR §4.2/§4.3/§4.6), em código, para o
 *  jogo funcionar mesmo antes de o WP1 preencher os maps.
 */

/** Ação de SMASH cheio → grupo de 5 direções (frente, cima, baixo, esq, dir). */
const SMASH_CHEIO = { 0x4D: 0, 0x4E: 1, 0x4F: 2, 0x50: 3, 0x51: 4, 0x52: 0 };
/** Ação de DASH SMASH → mesma direção (0x53..0x57). */
const DASH_SMASH = { 0x53: 0, 0x54: 1, 0x55: 2, 0x56: 3, 0x57: 4 };
/** Ações de GRAB/THROW → attack ids de arremesso (btl_act_h.c / CheckThrowBreak: só 0x55). */
const GRAB = { 0xB4: 0x55, 0xB5: 0x55, 0xB6: 0x55, 0xB7: 0x55, 0xB8: 0x55,
               0xB9: 0x56, 0xBA: 0x56, 0xBB: 0x56, 0xBC: 0x56 };
/** Ações de VANISH STRIKE (0x2B..0x2E) → attack id próprio, se o WP1 criar. */
const VANISH_STRIKE = { 0x2B: 0x2B, 0x2C: 0x2C, 0x2D: 0x2D, 0x2E: 0x2E };
/** Ações de CONTADOR (0x89/0x8A/0x8B) → attack id próprio, se existir. */
const CONTADOR = { 0x89: 0x89, 0x8A: 0x8A, 0x8B: 0x8B };

/**
 * Ação → attack id. `passo` é o elo do rush (unkD60, 0..9) quando a ação é
 * 0x44; para os smashes, `niveis` (0 fraco / 1 médio / 2 cheio) escolhe um
 * dos três attack ids por direção (§4.3: 0x13..0x21 = 5 dir × 3 níveis).
 *
 * Ordem dos grupos de smash (frente/cima/baixo/esq/dir) é [AUTORADA] — o
 * decomp só diz "5 direções × 3 níveis"; trocar a ordem é editar esta tabela
 * (ou melhor: preencher `TUNING.bt3.actionMap`).
 */
export function acaoParaAtaque(acao, map = null, { passo = 0, niveis = 0 } = {}) {
  if (map && map[acao] != null) return map[acao];
  if (acao === 0x44) return passo % 10;               // rush: elo 0..9 → record 0..9
  const dir = SMASH_CHEIO[acao];
  if (dir !== undefined) return 0x13 + dir * 3 + clampInt(niveis, 0, 2);
  const dirD = DASH_SMASH[acao];
  if (dirD !== undefined) return 0x13 + dirD * 3 + 1; // dash smash = nível médio
  if (GRAB[acao] != null) return GRAB[acao];
  if (VANISH_STRIKE[acao] != null) return VANISH_STRIKE[acao];
  if (CONTADOR[acao] != null) return CONTADOR[acao];
  return acao;                                        // tenta a própria chave (técnicas)
}

/** Ação → motion id. O rush anima com 0x37 + elo (btl_act_a.c:323-441). */
export function acaoParaMotion(acao, passo = 0, map = null) {
  if (map && map[acao] != null) return map[acao];
  if (acao === 0x44) return 0x37 + (passo % 10);
  return acao;                                        // demais: motion id = ação
}

function clampInt(v, lo, hi) {
  v = v | 0;
  return v < lo ? lo : (v > hi ? hi : v);
}

/* ========================================================================== */
/*  Janela de hit (eventos do motion)                                          */
/* ========================================================================== */
/*
 *  A janela vem do MOTION, não de startup/active/recovery (bobj_a.c:594-709:
 *  o teste é feito no intervalo (prevFrame, frame] contra eventos hitBegin /
 *  hitEnd). Aqui a versão CUMULATIVA: o estado da janela no frame F é o
 *  resultado de todos os eventos até F — equivalente ao teste por intervalo
 *  quando o frame avança de 1 em 1, e correto também quando o lutador pula
 *  frames (hitstop escopado, por exemplo).
 */
export function janelaHitAberta(motion, frame) {
  if (!motion || !motion.events || !motion.events.length) return false;
  let aberta = false;
  for (const ev of motion.events) {
    if (ev.frame > frame) break;
    if (ev.type === 'hitBegin') aberta = true;
    else if (ev.type === 'hitEnd') aberta = false;
  }
  return aberta;
}

/**
 * Volume de hit deste motion: `{ socket, radius }` ou `null`.
 *
 *  POR QUE motion e não record: no BT3 o volume nasce da ANIMAÇÃO
 *  (BtlObjHit_BuildVolumes por matriz de nó, bobj_a.c:1231+). No port a
 *  informação entra por `motion.hitbox` (ou no evento hitBegin) — se o WP1
 *  não publicar o campo, `resolve.js` cai no teste de proximidade centro a
 *  centro (raio somado), que é honesto mas menos preciso. Ver
 *  /tmp/opencode/wp2b-requests.md.
 */
export function hitboxOf(motion) {
  if (!motion) return null;
  if (motion.hitbox) return motion.hitbox;
  if (motion.events) {
    for (const ev of motion.events) {
      if (ev.type === 'hitBegin' && (ev.socket || ev.radius)) {
        return { socket: ev.socket, radius: ev.radius };
      }
    }
  }
  return null;
}

/* ========================================================================== */
/*  Normalização                                                               */
/* ========================================================================== */
function inferirKind(id, r) {
  if (r.kind != null) return r.kind;
  if (GRAB[id] === id || id === 0x55 || id === 0x56) return 5; // arremesso
  return 0;
}

/** Preenche o que falta NO PRÓPRIO record (o painel escreve aqui ao vivo). */
function normalizeRecord(id, r) {
  if (r.__bt3) return r;
  r.__id = id;
  r.flags ??= 0;
  r.damage ??= 0;
  r.guardDamage ??= 0;
  r.guardKi ??= 0;
  r.kiGain ??= 0;
  r.pushHit ??= 0;
  r.pushGuard ??= 0;
  r.priority ??= 0;
  r.react ??= 1;            // 1 = BTL_REACT_NONE: "nada acontece"
  r.reactSub ??= 0;         // HitReact.unk4 (record +0x20)
  r.shakePower ??= 3;
  r.shakeTime ??= 0.12;
  r.shakePowerB ??= 2;
  r.shakeTimeB ??= 0.1;
  r.guardFlagSel ??= 0;
  r.armorIgnore ??= 0;
  r.kind = inferirKind(id, r);
  r.__bt3 = true;
  return r;
}

function normalizeMotion(id, m) {
  if (m.__bt3) return m;
  m.__id = id;
  m.durationFrames ??= 30;
  if (!m.events) m.events = [];
  // Ordem garantida: o janelaHitAberta assume eventos em ordem de frame.
  m.events.sort((a, b) => a.frame - b.frame);
  m.__bt3 = true;
  return m;
}

/**
 * Chamado uma vez no boot (main.js chama no topo do módulo, antes do DebugPanel
 * montar sliders). Tolerante a `TUNING.bt3` ainda ausente: o WP1 escreve as
 * tabelas em paralelo, e o jogo deve subir avisando no console, não quebrar.
 */
export function initMoves() {
  if (_ready) return;
  const T = TUNING.bt3;
  if (!T || !T.records || !T.motions) {
    console.warn('[moves] TUNING.bt3 ausente/incompleto — records e motions não carregados (esperado até o WP1 assinar as tabelas).');
    return;
  }
  for (const [id, r] of Object.entries(T.records)) normalizeRecord(Number(id), r);
  for (const [id, m] of Object.entries(T.motions)) normalizeMotion(Number(id), m);
  _ready = true;
}

/* ========================================================================== */
/*  Consultas (nomes preservados do contrato de integração — §3)               */
/* ========================================================================== */

/** Nome antigo preservado: `moveOf(chave)` → attack record BT3. */
export const moveOf = (key) => recordOf(key);

/**
 * Hitstop deste contato, derivado dos CANAIS BT3 (prioridade / guarda /
 * clash). O record NÃO tem stopLen — em BT3 `stopLen` é estado do lutador
 * (btl_char_hit.h:152-153), preenchido por clash/guard result 7-8/técnicas.
 * Para o hit limpo, derivamos da prioridade [AUTORADO] na faixa 2..6 f,
 * igual à faixa de clash. `juice.hitstopScale` continua sendo o gain de
 * apresentação (consumidor: `Fighter.applyHitstop`).
 *
 * Guarda comum devolve 0 de propósito: no BT3 só os guard results 7/8
 * congelam (ApplyGuard, btl_char_hit.c:229-240) — o congelamento do contato
 * aparado vem do ApplyGuard, não daqui. main.js chama isto com
 * `{ guarded: true }` e `congelarTroca(..., 0)` é no-op.
 */
export function hitstopFor(move, { guarded = false, counter = false, clash = null } = {}) {
  const T = TUNING.bt3;
  const rec = (move && typeof move === 'object') ? move : recordOf(move);
  if (clash != null) {
    return (clash === 'misto' ? (T?.clash?.mixedStop ?? 2) : (T?.clash?.sameStop ?? 6));
  }
  if (guarded) return 0;
  if (counter) return T?.guardResults?.[8]?.stopLen ?? 3;
  const p = clampInt(rec?.priority ?? 0, 0, 4);
  return [2, 3, 4, 5, 6][p];
}

/**
 * Carga de smash: BT3 cobra 90 f cheios / 45 f mínimos (1.5 s / 0.75 s @60,
 * btl_act_a.c:194-197). Todos os smashes carregáveis do kit usam a MESMA
 * janela — a escolha por golpe era invenção do protótipo (Perfect Smash),
 * removida em BT3-REFACTOR §2.
 */
export function moveCharge(_m) {
  const C = TUNING.bt3?.chargeSmash;
  if (!C) return null;
  return { fullFrames: C.fullFrames ?? 90, minFrames: C.minFrames ?? 45 };
}

/**
 * Duração total: a do MOTION (durationFrames). Aceita motion, record (tenta
 * o motion da ação) ou id puro. Sem motion, 0 — o chamador trata como
 * "sem animação conhecida".
 */
export function moveTotalFrames(m) {
  if (!m) return 0;
  if (typeof m === 'object') {
    if (m.durationFrames != null) return m.durationFrames;
    const motion = motionOf(m.__id ?? m.id);
    return motion?.durationFrames ?? 0;
  }
  return motionOf(m)?.durationFrames ?? 0;
}

/** Dano de guarda (chip) deste record — BT3 aplica chip no guard full. */
export const moveGuardDamage = (m) =>
  (m && typeof m === 'object' ? m : recordOf(m))?.guardDamage ?? 0;

/**
 * "Esta defesa funciona contra este golpe?" — a MATRIZ FOI REMOVIDA
 * (BT3-REFACTOR §2: defenseMatrix não tem equivalente). A regra BT3 que
 * sobra é uma só: a GUARDA NÃO RESPONDE A GRAB (btl_char_hit.c:346+);
 * vanish/sway/z-counter não existem mais como defesas resolvidas no hit
 * (o kit defensivo é o do BT3: guarda / vanish step / contador, todos
 * decididos pela máquina de estados do lutador). Mantida porque o import
 * antigo de fighter.js pode ainda referenciá-la.
 */
export function defenseWorks(move, defense) {
  const rec = (move && typeof move === 'object') ? move : recordOf(move);
  const grab = rec?.kind === 5 || rec?.__id === 0x55 || rec?.__id === 0x56;
  if (defense === 'guard') return !grab;
  if (defense === 'grab') return grab;
  return false;
}

/* ========================================================================== */
/*  Helpers antigos mantidos (puros; sem leitura de TUNING removido)           */
/* ========================================================================== */
/*
 *  rushKeyFor / smashKeyFor / pursuitTypeFor / pursuitSpec eram importados
 *  pelo fighter antigo. A cadeia fixa (combo.rushChain) e a perseguição de
 *  75 f (pursuit) FORAM REMOVIDAS (§2) — estes helpers ficam como funções
 *  puras sem estado em TUNING, para o import não quebrar enquanto o WP2a
 *  troca o fighter. Não os re-wire a nenhuma tabela nova.
 */

export function rushKeyFor(chain, comboCount) {
  if (!chain || !chain.length) return null;
  const i = Math.min(comboCount, chain.length - 1);
  return chain[i];
}

export function smashKeyFor(dir) {
  if (dir === 'up') return 'smash_up';
  if (dir === 'down') return 'smash_down';
  return 'smash_forward';
}

export function pursuitTypeFor(cmd) {
  if (cmd?.vanish) return 'vanish';
  if (cmd?.smash) return 'highSpeed';
  return 'direct';
}

export function pursuitSpec(type) {
  const P = TUNING.pursuit;   // pode não existir mais — null-safe de propósito
  const t = P?.types?.[type] || P?.types?.direct || {};
  return { ...P, ...t, type };
}
