/* =============================================================================
 *  resolve.js  —  Pipeline de resolução de hit (ordem BT3)
 * =============================================================================
 *
 *  POR QUE A ORDEM EXISTE. No BT3 um acerto não é "esfera encostou em
 *  cápsula": é uma esteira de decisões que roda TODO frame, numa ordem fixa
 *  (`btl_char_hit.h:8-18`):
 *
 *      BeginFrame → CheckClash → CheckRush → CheckProximityAll
 *      → TestHit → ResolveTrades → ApplyHit
 *
 *  A ordem é o mecanismo, não estilo:
 *
 *   - CheckClash ANTES de tudo: dois corpos em ação de clash que se tocam
 *     param o passo INTEIRO (nada de dano) — o encontro de golpes é
 *     resolvido antes de qualquer hitbox individual existir.
 *   - TestHit SÓ PREENCHE um alvo pendente (status.target); o dano acontece
 *     no ApplyHit, depois do ResolveTrades. É isso que permite duas pessoas
 *     se acertarem no mesmo frame e a prioridade do record decidir quem
 *     atravessa — se o dano saísse no TestHit, a troca já teria acontecido
 *     antes de existir regra.
 *   - Um hit NÃO interrompe o atacante: ele muda o DEFENSOR via reação
 *     enfileirada (`pendingReaction`, consumida pelo CheckForced do lutador
 *     no update seguinte — §4.1). O atacante só muda pelo próprio decide.
 *   - A guarda roda DENTRO do TestHit (CheckGuard/ApplyGuard), com os 9
 *     resultados (btl_char_hit.h:27-36): golpe por costas não é guardado,
 *     contador tem prioridade, e o blocked NÃO emenda o combo do atacante
 *     (ele mantém a ação e come o recovery naturalmente).
 *
 *  As strings/mecânicas antigas (sonic sway, Z-Counter, defenseMatrix,
 *  poise, launch.type, chainResetFrames, Perfect Smash) foram REMOVIDAS por
 *  não terem equivalente BT3 (BT3-REFACTOR §2). Isto é código único BT3.
 *
 *  Seam congelado com fighter.js (WP2a, em paralelo):
 *    LÊ:  f.act = { current, request, phase, frame [, atkId, motionId, step,
 *                   nivel] }, f.facing/position/velocity, f.center/char.socket
 *    ESCREVE: f.pendingReaction (id da tabela bt3.reactions; consumido pelo
 *             CheckForced), f.hitRegistered (hit-confirm do atacante),
 *             f.guardResult (0..8|null), f.counterArmed (+ counterAction).
 * ========================================================================== */

import * as THREE from 'three';
import { TUNING } from '../tuning.js';
import {
  recordOf, motionOf, janelaHitAberta, hitboxOf, hitstopFor,
  acaoParaAtaque, acaoParaMotion, moveGuardDamage,
} from './moves.js';

const _hitPos = new THREE.Vector3();
const _atcC = new THREE.Vector3();
const _victimC = new THREE.Vector3();
const _mid = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _fwd = new THREE.Vector3();

/* ========================================================================== */
/*  Conjuntos de ação (subconjunto MVP — §4.6)                                 */
/* ========================================================================== */
const ACAO_RUSH = 0x44;
const ACAO_GUARDA = 0x38;
const ACAO_CONTADOR = 0x39;
/** Ações de clash (0x130..0x132). CheckClash só dispara com os DOIS lá. */
const ACOES_CLASH = new Set([0x130, 0x131, 0x132]);
/** Reações forçadas: quem está nelas não está "livre" (BtlChar_IsFree). */
const ACOES_REACAO = new Set([
  0x39,             // contador
  0xCE,             // lançado
  0xD3, 0xD4,       // stun / knockback
  0xD5, 0xD6, 0xDF, // blowaway
  0xE0,             // stun aéreo
]);
const LANCADOS = new Set([0xCE]);
const BLOWAWAYS = new Set([0xD5, 0xD6, 0xDF]);
const NO_AR = new Set([0x14, 0x16, 0x26, 0xE0]);
/** Reações que são LANÇAMENTO (decomp: 0x14/0x15/0x16/0x25/0x31). */
const REACAO_LANCA = new Set([0x14, 0x15, 0x16, 0x25, 0x31]);

/* ========================================================================== */
/*  Adaptadores de pose / direção                                              */
/* ========================================================================== */
/*
 *  `f.facing` pode chegar como número (yaw), Vector3 ou {x,z} — o seam
 *  congelado com o WP2a diz "facing", e o fighter antigo expunha `yaw`.
 *  Adaptar aqui é mais barato do que travar uma escolha de nome agora.
 */
function frente(f) {
  const fc = f.facing;
  if (typeof fc === 'number') return _fwd.set(Math.sin(fc), 0, Math.cos(fc));
  if (fc && typeof fc.x === 'number') {
    _fwd.set(fc.x, 0, fc.z);
    if (_fwd.lengthSq() > 1e-8) return _fwd.normalize();
  }
  return _fwd.set(Math.sin(f.yaw ?? 0), 0, Math.cos(f.yaw ?? 0));
}

/**
 * BtlHit_IsFromBehind (btl_char_hit.c:142): o golpe veio POR COSTAS quando o
 * defensor olha para LONGE do atacante (as duas frentes quase paralelas).
 * É o que torna o golpe de costas não-guardável e dá o bônus de +20%.
 */
function porCostas(atk, def) {
  _dir.subVectors(def.position, atk.position).setY(0);
  if (_dir.lengthSq() < 1e-6) return false;
  _dir.normalize();
  return frente(def).dot(_dir) > 0.15;
}

/** TestHit: o golpe só conecta dentro do arco frontal de 90° (record flag 8 fura). */
function noArcoFrontal(atk, def, flags) {
  if (flags & 8) return true;
  _dir.subVectors(def.position, atk.position).setY(0);
  if (_dir.lengthSq() < 1e-6) return true;
  _dir.normalize();
  return frente(atk).dot(_dir) > 0;
}

/* ========================================================================== */
/*  Áudio BT3 — contrato `sfx.bt3(ev)` (WP4 implementa; chega via ctx.sfx)     */
/* ========================================================================== */
function som(ctx, ev) {
  ctx?.sfx?.bt3?.(ev);
}

/**
 * Voz da vítima por reação (BtlHit_GetVoiceKind, btl_char_hit.c:154-170):
 * reação id 1..49 → kind 0..4. Tabela do decomp, copiada por valor.
 */
const VOZ_POR_REACAO = (() => {
  const t = new Array(50).fill(0);
  const g1 = [5, 6, 7, 8, 9, 10, 29, 30, 35, 36, 42, 47, 48];
  const g2 = [15, 16, 17, 19];
  const g3 = [18, 40, 41];
  const g4 = [12, 13, 23, 24, 25, 26, 27, 28, 38, 39];
  for (const r of g1) t[r] = 1;
  for (const r of g2) t[r] = 2;
  for (const r of g3) t[r] = 3;
  for (const r of g4) t[r] = 4;
  return t;
})();
const vozParaReacao = (react) => VOZ_POR_REACAO[react] ?? 0;

/* ========================================================================== */
/*  Helpers de estado                                                         */
/* ========================================================================== */

/**
 * Attack id + motion id do atacante atual. Prioridade: campos explícitos do
 * `f.act` (se o WP2a publicar `atkId`/`motionId`, eles mandam), senão a
 * tabela de alias ação→id (moves.js). `passo` é o elo do rush; `niveis` é a
 * carga do smash (0..2), que escolhe entre os 3 attack ids por direção.
 */
function ataqueAtualDe(f) {
  const act = f.act;
  if (!act || act.current == null) return { atkId: null, motionId: null, passo: 0 };
  const passo = act.step ?? f.rushStep ?? f.comboCount ?? 0;
  const niveis = act.nivel ?? f.smashLevel ?? nivelDeCarga(f);
  const atkId = act.atkId ?? act.attackId
    ?? acaoParaAtaque(act.current, TUNING.bt3?.actionMap, { passo, niveis });
  const motionId = act.motionId
    ?? acaoParaMotion(act.current, passo, TUNING.bt3?.actionMotionMap);
  return { atkId, motionId, passo };
}

/** Quantos frames o smash já carregou → nível 0/1/2 (mínimo/cheio, §4.3). */
function nivelDeCarga(f) {
  const cf = f.chargeFrames ?? 0;
  const C = TUNING.bt3?.chargeSmash;
  if (!C) return 2;
  return cf >= (C.fullFrames ?? 90) ? 2 : (cf >= (C.minFrames ?? 45) ? 1 : 0);
}

function marcarContato(atk, def) {
  if (!atk.hitThisMove) atk.hitThisMove = new Set();
  atk.hitThisMove.add(def);
}

function danoEm(f, dmg) {
  f.health = Math.max(0, (f.health ?? 0) - dmg);
  if (f.immortal && f.health <= 0) f.health = 1;
}

function estaDeGuarda(f) {
  if (f.guarding === true) return true;
  return f.act?.current === ACAO_GUARDA;
}

function defLivre(f) {
  const a = f.act?.current;
  if (a == null) return true;
  return !ACOES_REACAO.has(a);
}

/** Stance de guarda do defensor (BT3: anim 0xEC..0xF7 → kinds 1..5/6). */
function guardKindDe(f) {
  if (f.guardKind != null) return f.guardKind;
  return estaDeGuarda(f) ? 1 : 0;
}

const nivelContador = (f) => f.counterLevel ?? f.nivelContador ?? 0;
const nivelArmor = (f) => f.armorLevel ?? f.nivelArmor ?? 0;
/** Flag 0x200 da ANIMAÇÃO do defensor = armadura durante a anim. */
const armorAnima = (f) => !!(f.armored || f.animFlags200 || ((f.animFlags ?? 0) & 0x200));

/* ========================================================================== */
/*  VOLUME DE HIT (TestHit geométrico)                                         */
/* ========================================================================== */
/*
 *  Igual BtlHit_BuildVolumes: o volume nasce da POSE (sockets que o procAnim
 *  anima — hand_r, foot_l…), definido por `motion.hitbox` (ver wp2b-requests).
 *  Sem socket declarado, cai na esfera de proximidade centro-a-centro (estilo
 *  BtlHit_CheckTouch) — menos preciso, mas nunca inventa alcance.
 */
function volumeEncosta(atk, def, motion) {
  const hb = hitboxOf(motion);
  def.center?.(_victimC) || _victimC.copy(def.position);
  if (hb?.socket && typeof atk.char?.socket === 'function') {
    const socket = atk.char.socket(hb.socket);
    if (socket) {
      socket.getWorldPosition(_hitPos);
      const reach = (hb.radius ?? 0.68) + TUNING.fighter.radius * 1.35;
      return _hitPos.distanceToSquared(_victimC) <= reach * reach;
    }
  }
  atk.center?.(_atcC) || _atcC.copy(atk.position);
  const reach = (hb?.radius ?? 0) + TUNING.fighter.radius * 2.4;
  return _atcC.distanceToSquared(_victimC) <= reach * reach;
}

/* ========================================================================== */
/*  PIPELINE                                                                   */
/* ========================================================================== */

/**
 * Uma passada de hit por frame, na ordem BT3. Chamado por main.js depois de
 * `fighters.update()` — a hitbox testa a posição JÁ atualizada do frame.
 */
export function resolveMelee(fighters, ctx) {
  /* --- 1. BeginFrame (btl_char_hit.c:794-816) ---
   * Reação volta a "nada" (1), alvo pendente zera, e o "hit já tratado"
   * (flag 0x60) cai quando a janela/ação muda. O reset de pendingReaction
   * acontece AQUI (e não no update) porque a ordem por frame é:
   * update (CheckForced consome) → resolve (reescreve para o próximo). */
  for (const f of fighters) {
    f.pendingReaction = null;
    f.guardResult = null;
    f._alvoPendente = null;
    f._recPendente = null;
    if (!f.alive) continue;

    const { motionId, passo } = ataqueAtualDe(f);
    const motion = motionOf(motionId, passo);
    const aberta = !!(f.act && janelaHitAberta(motion, f.act.frame ?? -1));
    const chave = f.act ? `${f.act.current}|${motionId}|${passo}` : null;
    if (f._hitChave !== chave) {
      f._hitChave = chave;
      f.hitThisMove = new Set();
      f._hitHandled = false;
    }
    if (!aberta) f._hitHandled = false;   // janela fechou: próximo hit pode sair
    f._janelaAberta = aberta;
  }

  /* --- 2. CheckClash (btl_char_hit.c:820-876) ---
   * Dois lutadores em AÇÃO DE CLASH que se tocam: para o passo inteiro.
   * Mesmo tipo (as duas ações iguais — o análogo dos dois com flag 0x47) =
   * stop 6 f; misto = 2 f (bt3.clash). Nenhum dano. */
  if (checkClash(fighters, ctx)) return;

  /* --- 3. CheckRush (btl_char_hit.c:881-1004) ---
   * Contato de corpo do RUSH contra guarda frontal: o defensor paga ki e o
   * atacante é empurrado (flag 0x6F). Os demais contatos do rush seguem
   * pelo caminho normal (TestHit) — aqui não há dano duplicado porque o par
   * fica marcado. */
  checkRush(fighters, ctx);

  /* --- 4. CheckProximityAll (btl_char_hit.c:1008-1024) ---
   * Por proximidade: a PEGADA (CheckGrab). A guarda não responde a grab
   * (btl_char_hit.c:346) — ela é resolvida aqui, antes do TestHit. */
  checkProximityAll(fighters, ctx);

  /* --- 5. TestHit (btl_char_hit.c:1029-1068): preenche alvos pendentes --- */
  for (const atk of fighters) testHit(atk, fighters, ctx);

  /* --- 6. ResolveTrades (btl_char_hit.c:1072-1106): prioridade do record --- */
  resolveTrades(fighters, ctx);

  /* --- 7. ApplyHit (btl_char_hit.c:1112-1397): dano, reação, ki, hit-stop --- */
  for (const atk of fighters) applyHit(atk, ctx);
}

/* -------------------------------------------------------------------------- */
/*  CheckClash                                                                 */
/* -------------------------------------------------------------------------- */
function checkClash(fighters, ctx) {
  const r = TUNING.fighter.radius * 2.6;
  for (let i = 0; i < fighters.length; i++) {
    const a = fighters[i];
    if (!a.alive || !ACOES_CLASH.has(a.act?.current)) continue;
    for (let j = i + 1; j < fighters.length; j++) {
      const b = fighters[j];
      if (!b.alive || !ACOES_CLASH.has(b.act?.current)) continue;
      if (a.position.distanceToSquared(b.position) > r * r) continue;

      const mesmo = a.act.current === b.act.current;
      const stop = mesmo
        ? (TUNING.bt3?.clash?.sameStop ?? 6)
        : (TUNING.bt3?.clash?.mixedStop ?? 2);
      _mid.copy(a.position).lerp(b.position, 0.5).y += 0.9;

      ctx.congelarTroca?.(a, b, stop);
      ctx.juice?.impact({ shake: mesmo ? 1.2 : 0.8, zoom: 0.8 });
      ctx.vfx?.burst(_mid, { count: 44, color: 0xffffff, speed: 14, life: 0.5 });
      ctx.vfx?.ring(_mid, { billboard: true, color: 0xcfefff, from: 0.5, to: 11, life: 0.5 });
      som(ctx, { tipo: 'clash', kind: mesmo ? 'mesmo' : 'misto', pos: _mid.clone() });
      ctx.onClash?.(_mid.clone());
      return true;   // o passo de hit inteiro termina (decomp: return 1)
    }
  }
  return false;
}

/* -------------------------------------------------------------------------- */
/*  CheckRush                                                                  */
/* -------------------------------------------------------------------------- */
function checkRush(fighters, ctx) {
  const RUSH_GUARD_KI = TUNING.bt3?.rushContact?.guardKi ?? 20;  // 20000/1000
  for (const atk of fighters) {
    if (!atk.alive || atk.act?.current !== ACAO_RUSH) continue;
    const { atkId } = ataqueAtualDe(atk);
    const rec = recordOf(atkId);
    const alcance = TUNING.fighter.radius * 2.2;
    for (const def of fighters) {
      if (def === atk || !def.alive) continue;
      if (def.invulnerable) continue;
      if (atk.position.distanceToSquared(def.position) > alcance * alcance) continue;
      if (atk.hitThisMove?.has(def)) continue;
      if (!estaDeGuarda(def) || porCostas(atk, def)) continue;

      marcarContato(atk, def);
      def.ki = Math.max(0, (def.ki ?? 0) - RUSH_GUARD_KI);
      if ((def.ki ?? 0) <= 0) def.guardCollapsing = true;   // flag 0xBE
      def.guardResult = 0;

      // Empurra o ATACANTE para trás (flag 0x6F).
      _dir.subVectors(atk.position, def.position).setY(0);
      if (_dir.lengthSq() < 1e-6) _dir.set(1, 0, 0);
      _dir.normalize();
      const push = rec?.pushGuard ?? 6;
      atk.velocity.x = _dir.x * push;
      atk.velocity.z = _dir.z * push;

      _mid.copy(atk.position).lerp(def.position, 0.5).y += 0.9;
      som(ctx, { tipo: 'guardSE', pos: _mid.clone() });
      ctx.onHit?.({ attacker: atk, victim: def, move: rec, result: 'guard', guardResult: 0, point: _mid.clone() });
      break;   // um contato de rush por atacante por frame
    }
  }
}

/* -------------------------------------------------------------------------- */
/*  CheckProximityAll — a pegada                                               */
/* -------------------------------------------------------------------------- */
/*
 *  BT3 resolve o grab na fase de proximidade (CheckGrab), porque a pegada
 *  não é um acerto geométrico: é um encontro de corpos com hit-confirm
 *  próprio. Aqui mantemos a chamada ao `beginGrab` do lutador — se o WP2a
 *  mover a lógica de grab para dentro da máquina de estados, o método some e
 *  este ramo fica inerte de propósito (sem shim).
 */
function checkProximityAll(fighters, ctx) {
  for (const atk of fighters) {
    if (!atk.alive || typeof atk.beginGrab !== 'function') continue;
    const { atkId } = ataqueAtualDe(atk);
    const rec = recordOf(atkId);
    if (!rec || rec.kind !== 5) continue;                 // só grabs (0x55/0x56)
    const alcance = TUNING.fighter.radius * 2 + 1.0;
    for (const def of fighters) {
      if (def === atk || !def.alive) continue;
      if (def.invulnerable) continue;
      if (atk.position.distanceToSquared(def.position) > alcance * alcance) continue;
      if (atk.hitThisMove?.has(def)) continue;

      marcarContato(atk, def);
      atk.beginGrab(def, ctx);
      _mid.copy(atk.position).lerp(def.position, 0.5).y += 0.9;
      ctx.congelarTroca?.(atk, def, hitstopFor(rec));
      ctx.onGrab?.(atk, def, _mid.clone());
      break;
    }
  }
}

/* -------------------------------------------------------------------------- */
/*  TestHit (btl_char_hit.c:1029-1068)                                         */
/* -------------------------------------------------------------------------- */
/*
 *  Só PRENDE o alvo pendente (status.target) quando:
 *    janela do motion aberta · atacante dentro do arco de 90° · volume da
 *    pose encosta · e nenhum dos testes de anulação pega (invencibilidade /
 *    armadura / guarda). O dano é o ApplyHit, depois das trocas.
 */
function testHit(atk, fighters, ctx) {
  if (!atk.alive || atk._hitHandled) return;
  if (!atk.act || !atk._janelaAberta) return;
  const { atkId, motionId, passo } = ataqueAtualDe(atk);
  if (atkId == null) return;
  const rec = recordOf(atkId);
  if (!rec) return;
  const motion = motionOf(motionId, passo);
  const flags = rec.flags ?? 0;

  for (const def of fighters) {
    if (def === atk || !def.alive) continue;
    if (atk.hitThisMove?.has(def)) continue;
    if (!noArcoFrontal(atk, def, flags)) continue;
    if (!volumeEncosta(atk, def, motion)) continue;

    const primeiro = !atk.hitThisMove?.has(def);
    marcarContato(atk, def);
    atk._hitHandled = true;                     // flag 0x60: hit tratado
    _mid.copy(atk.position).lerp(def.position, 0.5).y += 0.9;
    const point = _mid.clone();

    /* IsVoid: i-frames (step / vanish / recuperação — flags 0x42..0x46 no
     * decomp). O golpe passa por cima sem efeito nenhum. */
    if (def.invulnerable) {
      ctx.vfx?.burst(point, { count: 6, color: 0xffffff, speed: 3, life: 0.2 });
      continue;
    }

    /* CheckArmor (btl_char_hit.c:641): flag 0x200 da anim + flag 2 do
     * record → hit IGNORADO; `armorIgnore` no record fura. */
    if (armorAnima(def) && (flags & 2) && (rec.armorIgnore ?? 0) <= 0) {
      som(ctx, { tipo: 'impactLight', pos: point });
      ctx.onHit?.({ attacker: atk, victim: def, move: rec, result: 'armor', point });
      continue;
    }

    /* CheckGuard (btl_char_hit.c:665): devolve 0..8 ou null (passou). */
    const gr = checkGuard(atk, def, rec, primeiro);
    if (gr != null) {
      applyGuard(atk, def, gr, rec, ctx, point);
      if (gr !== 8) {                            // contador: sem chip (*full=0)
        const chip = moveGuardDamage(rec);
        if (chip > 0) danoEm(def, chip);
      }
      ctx.onHit?.({ attacker: atk, victim: def, move: rec, result: 'guard', guardResult: gr, point });
      continue;
    }

    atk._alvoPendente = def;                     // status.target
    atk._recPendente = rec;
    return;                                      // um alvo por atacante (BT3)
  }
}

/* -------------------------------------------------------------------------- */
/*  CheckGuard / ApplyGuard — os 9 resultados (btl_char_hit.h:27-36)           */
/* -------------------------------------------------------------------------- */
/*
 *  0 PLAIN · 1 FLAG40 (só vs golpes id < 0xB) · 2-4 TIMED (janelas de input,
 *  não portadas — exigem ler o botão do defensor no resolve) · 5 KI (paga
 *  guardKi; ki no fim colapsa) · 6 PUSH (empurra + meio stock de blast) ·
 *  7 PUSH_STOP (+ stop + voz 0x12) · 8 COUNTER (flag 0x7B → ação 0x39, sem
 *  chip; golpe escolhido por (nível def + nível atk) % 3 → 0x89/0x8A/0x8B).
 *
 *  Golpe por COSTAS não é guardado (exceto stance de guarda 6).
 *  NÃO emenda o combo do atacante: ele mantém a ação e come o recovery.
 */
function checkGuard(atk, def, rec, primeiro) {
  if (!defLivre(def)) return null;               // não livre → passa reto
  const guard = guardKindDe(def);
  if (guard === 0) return null;                  // não está em guarda
  if (guard !== 6 && porCostas(atk, def)) return null;

  // Contador (result 8): primeiro golpe + nível de contador > 0.
  if (primeiro && nivelContador(def) > 0) return 8;

  // FLAG40 (result 1): auto-guarda contra fracos (attack id < 0xB).
  if (def.guardFlag40 && Number(rec.__id ?? rec.id) < 0xB) return 1;

  // Resultado do record pela stance de guarda do defensor (kinds 1..5).
  let res = 0;
  switch (guard) {
    case 1: res = rec.guardA ?? 0; break;
    case 2: res = rec.guardB ?? 0; break;
    case 3: res = rec.guardC ?? 0; break;
    case 5: res = rec.guardE ?? 0; break;
    case 4: res = rec.guardBest ?? rec.guardA ?? 0; break;
    default: res = 0;
  }
  if (res === 3) return null;                    // "não guardável": passa
  switch (res) {
    case 1: return 5;                            // KI
    case 2: return 6;                            // PUSH
    case 4: return 7;                            // PUSH_STOP
    default: return 0;                           // PLAIN
  }
}

function applyGuard(atk, def, result, rec, ctx, point) {
  const G = TUNING.bt3?.guardResults?.[result] ?? {};
  def.guardResult = result;

  /* Empurra o DEFENSOR na direção que o atacante encara
   * (BtlMove_SetImpulseYaw(def, atk.yaw, pushGuard * scale)). */
  const escala = (result === 5 || result === 6) ? 0.5 : 1;   // decomp: scale
  const push = (rec.pushGuard ?? 4) * escala;
  const fx = frente(atk);
  def.velocity.x = fx.x * push;
  def.velocity.z = fx.z * push;

  /* Resultado 6/7/8 também empurra o ATACANTE (flag 0x6F). */
  const repulsarAtacante = () => {
    _dir.subVectors(atk.position, def.position).setY(0);
    if (_dir.lengthSq() < 1e-6) _dir.set(1, 0, 0);
    _dir.normalize();
    const p = rec.pushGuard ?? 4;
    atk.velocity.x = _dir.x * p;
    atk.velocity.z = _dir.z * p;
  };

  switch (result) {
    case 5: {   // KI: paga guardKi; reserva no fim → colapso (0xBE)
      def.ki = Math.max(0, (def.ki ?? 0) - (rec.guardKi ?? G.ki ?? 0));
      if ((def.ki ?? 0) <= 0) def.guardCollapsing = true;
      break;
    }
    case 6: {   // PUSH: meio stock de blast (50000/1000)
      def.blast = Math.min(100, (def.blast ?? 0) + (G.blast ?? 50));
      repulsarAtacante();
      break;
    }
    case 7: {   // PUSH_STOP: o mesmo + hit-stop + voz 0x12
      repulsarAtacante();
      ctx.congelarTroca?.(atk, def, G.stopLen ?? 2);
      som(ctx, { tipo: 'voice', kind: G.voice ?? 0x12, pos: point });
      break;
    }
    case 8: {   // CONTADOR: flag 0x7B → CheckForced muda pra 0x39
      repulsarAtacante();
      const niv = (nivelContador(def)) + (atk.counterLevel ?? atk.level ?? 0);
      const tabela = TUNING.bt3?.counterActions ?? [0x89, 0x8A, 0x8B];
      def.counterArmed = true;                  // seam: fighter faz 0x39
      def.counterAction = tabela[niv % tabela.length];
      ctx.congelarTroca?.(atk, def, G.stopLen ?? 3);
      break;
    }
    default:
      break;
  }
  som(ctx, { tipo: 'guardSE', pos: point });
}

/* -------------------------------------------------------------------------- */
/*  ResolveTrades (btl_char_hit.c:1072-1106)                                   */
/* -------------------------------------------------------------------------- */
/*
 *  Os DOIS com alvo pendente um do outro no mesmo frame:
 *    prioridade MAIOR do record atravessa (o outro alvo é limpo);
 *    prioridade IGUAL → OS DOIS cancelam (fx 0x22, shake 2.0/0.3).
 *  Quem perde NÃO toma stun aqui — ele perde o alvo, e o golpe do
 *  vencedor entra no ApplyHit logo abaixo, com guarda/etc intacta.
 */
function resolveTrades(fighters, ctx) {
  for (let i = 0; i < fighters.length; i++) {
    const a = fighters[i];
    if (!a._alvoPendente) continue;
    for (let j = i + 1; j < fighters.length; j++) {
      const b = fighters[j];
      if (!b._alvoPendente) continue;
      if (!(a._alvoPendente === b && b._alvoPendente === a)) continue;

      const pa = a._recPendente?.priority ?? 0;
      const pb = b._recPendente?.priority ?? 0;
      if (pa > pb) {
        b._alvoPendente = null;
        _mid.copy(a.position).lerp(b.position, 0.5).y += 0.9;
        ctx.onTradeWin?.(a, b, _mid.clone());
      } else if (pa < pb) {
        a._alvoPendente = null;
        _mid.copy(a.position).lerp(b.position, 0.5).y += 0.9;
        ctx.onTradeWin?.(b, a, _mid.clone());
      } else {
        a._alvoPendente = null;
        b._alvoPendente = null;
        _mid.copy(a.position).lerp(b.position, 0.5).y += 0.9;
        ctx.juice?.impact({ shake: 2.0, zoom: 1 });
        ctx.vfx?.burst(_mid, { count: 40, color: 0xffe9a0, speed: 15, life: 0.5 });
        som(ctx, { tipo: 'clash', kind: 'mesmo', pos: _mid.clone() });
        ctx.onTradeClash?.(a, b, _mid.clone());
      }
    }
  }
}

/* -------------------------------------------------------------------------- */
/*  ApplyHit (btl_char_hit.c:1112-1397)                                        */
/* -------------------------------------------------------------------------- */
function applyHit(atk, ctx) {
  const def = atk._alvoPendente;
  atk._alvoPendente = null;
  if (!def || !atk.alive || !def.alive) return;
  const rec = atk._recPendente ?? recordOf(ataqueAtualDe(atk).atkId);
  if (!rec) return;
  atk._recPendente = null;

  const flags = rec.flags ?? 0;
  const atraso = porCostas(atk, def);
  let react = escolherReacao(rec, def);

  /* Armor por NÍVEL (decomp :1152-1191): nível do defensor menos o que o
   * record ignora; com atk flag 4, vira reação 2 ("não perde a ação", mas o
   * dano entra). */
  if (react !== 1) {
    const lvl = nivelArmor(def) - (rec.armorIgnore ?? 0);
    if (lvl > 0 && (flags & 4)) react = 2;
  }

  if (react === 1) return;   // BTL_REACT_NONE: o golpe "não acontece"

  /* Dano. Costas: +20% (dmg + dmg/5, :1366-1370); record flag 0x8000000 zera
   * o bônus. Em BT3 as reações de lançamento 0x14/0x16/0x25 adiam o dano pro
   * código da reação; aqui aplicamos NA HORA (o fighter do port não replica o
   * deferred-damage — decisão registrada em wp2b-notes). */
  let dmg = rec.damage ?? 0;
  if (atraso && !(flags & 0x8000000)) dmg += Math.floor(dmg / 5);
  if (dmg > 0) danoEm(def, dmg);

  /* Reação enfileirada: o fighter consome no CheckForced do PRÓXIMO update
   * (a ordem por frame é update → resolve; §4.1). */
  def.pendingReaction = react;
  const fx = frente(atk);
  def.hitYaw = Math.atan2(fx.x, fx.z);
  if (REACAO_LANCA.has(react)) {
    def.launchSpeed = rec.launchSpeed ?? 0;
    def.launchA = rec.launchA ?? 0;
    def.launchB = rec.launchB ?? 0;
    def.hitBack = atraso;
  } else {
    const push = rec.pushHit ?? 0;                 // SetImpulseYaw(def, yaw, push)
    def.velocity.x = Math.sin(def.hitYaw) * push;
    def.velocity.z = Math.cos(def.hitYaw) * push;
  }

  /* Taxonomia de áudio BT3: voz da vítima (kind por reação), SE de impacto
   * (hit kinds 0..4) e impacto leve/pesado do motion (0x100/0x80). */
  if (!(flags & 0x400)) som(ctx, { tipo: 'voice', kind: vozParaReacao(react), pos: def.position.clone() });
  som(ctx, { tipo: 'hit', kind: rec.hitSound ?? (rec.priority >= 3 ? 2 : 1), pos: _mid.clone() });
  som(ctx, { tipo: rec.priority >= 3 ? 'impactHeavy' : 'impactLight', pos: _mid.clone() });

  if (rec.hitFx) def.flashFrames = TUNING.juice?.impactFlashFrames ?? 4;

  /* Hit-confirm do atacante (seam): é o que o decide dele lê pra saber que
   * o golpe SAIU (cancel/ender). Bloqueio NÃO seta isto — o atacante fica
   * com a ação e come o recovery (cancelOnBlock era invenção antiga). */
  atk.hitRegistered = true;

  /* Ki do atacante (BtlMember_AddKi). */
  atk.ki = Math.min(TUNING.ki?.max ?? 100, (atk.ki ?? 0) + (rec.kiGain ?? 0));

  /* Envelope: main.js faz hitstop (via hitstopFor(move)) + sfx + vfx no
   * onHit — mesma divisão de trabalho de sempre. */
  def.events?.push({ type: 'damaged', result: 'hit', damage: dmg, attacker: atk });
  ctx.onHit?.({ attacker: atk, victim: def, move: rec, result: 'hit', point: _mid.clone() });
}

/** Reação pela situação do DEFENSOR (decomp: flags 0x1000/0x2000/0x4000). */
function escolherReacao(rec, def) {
  const a = def.act?.current;
  if (a != null) {
    if (LANCADOS.has(a)) return rec.reactE ?? rec.react ?? 1;     // st & 0x2000
    if (BLOWAWAYS.has(a) || a === 0xDF) return rec.reactC ?? rec.react ?? 1; // st & 0x4000
    if (NO_AR.has(a)) return rec.reactD ?? rec.react ?? 1;        // st & 0x1000
  }
  return rec.react ?? 1;
}

/* ========================================================================== */
/*  resolveTrade — EXPORTADO, agora no-op                                      */
/* ========================================================================== */
/*
 *  A troca de prioridade virou a fase ResolveTrades DENTRO de resolveMelee
 *  (ordem real: TestHit → ResolveTrades → ApplyHit — btl_char_hit.h:15-18).
 *  Rodar "trades" antes do melee, como o loop antigo fazia, não tem
 *  equivalente BT3: o alvo pendente ainda não existe nesse ponto. Mantido
 *  como no-op para o contrato de main.js (§3) — WP6 pode remover a chamada.
 */
export function resolveTrade(_fighters, _ctx) { /* ver cabeçalho */ }

/* ========================================================================== */
/*  Envelope do jogo (camada que FICA — §2.5): dash trombada / clash de dash   */
/* ========================================================================== */
/*
 *  A tromba de dash NÃO é uma mecânica BT3 extraída do decomp: é física do
 *  envelope (Dragon Dash do protótipo). Mantida como estava, com duas trocas
 *  mínimas: a esquiva genérica passa a ser `invulnerable` (o vanish antigo
 *  com janela press-f não existe mais; o vanish BT3 é uma ação com i-frames,
 *  e quem está com i-frames já é poupado aqui), e as chamadas a métodos do
 *  fighter são opcionais (`?.`) porque o WP2a pode renomeá-los.
 */
export function resolveDashImpact(fighters, ctx) {
  for (const a of fighters) {
    if (!a.alive || a.state !== 'dash') continue;
    if (!a.dashHits) a.dashHits = new Set();

    for (const b of fighters) {
      if (b === a || !b.alive) continue;
      if (b.state === 'dash') continue;          // isso é clash, não impacto
      if (a.dashHits.has(b)) continue;           // um toque por dash
      if (b.invulnerable) continue;              // i-frames (vanish/step)

      const reach = TUNING.fighter.radius * 2 + (TUNING.dragonDash?.impactReachBonus ?? 0);
      if (a.position.distanceToSquared(b.position) > reach * reach) continue;

      a.dashImpact?.(b, ctx);
      a.dashHits.add(b);
      ctx.congelarTroca?.(a, b, TUNING.dragonDash?.impactHitstop ?? 6);
      ctx.onDashImpact?.(a, b);
      break;                                      // o dash acabou; sai do laço
    }
  }
}

/** Dois lutadores em dash que se encontram ricocheteiam — puro espetáculo. */
export function resolveDashClash(fighters, ctx) {
  const D = TUNING.dragonDash;
  if (!D?.clashEnabled) return;

  for (let i = 0; i < fighters.length; i++) {
    const a = fighters[i];
    if (!a.alive || a.state !== 'dash') continue;

    for (let j = i + 1; j < fighters.length; j++) {
      const b = fighters[j];
      if (!b.alive || b.state !== 'dash') continue;

      const r = TUNING.fighter.radius * 2.6;
      if (a.position.distanceToSquared(b.position) > r * r) continue;

      _dir.subVectors(b.position, a.position).normalize();
      a.velocity.copy(_dir).multiplyScalar(-(D.clashKnockback ?? 20));
      b.velocity.copy(_dir).multiplyScalar(D.clashKnockback ?? 20);
      a._enter?.('idle');
      b._enter?.('idle');

      _mid.copy(a.position).lerp(b.position, 0.5).y += 0.9;
      ctx.congelarTroca?.(a, b, D.clashHitstop ?? 8);
      ctx.juice?.impact({ shake: D.clashShake ?? 0.6, zoom: 1 });
      ctx.vfx?.burst(_mid, { count: 50, color: 0xffffff, speed: 16, life: 0.5 });
      ctx.vfx?.ring(_mid, { billboard: true, color: 0xcfefff, from: 0.5, to: 12, life: 0.5 });
      ctx.onClash?.(_mid.clone());
    }
  }
}

/** Empurra lutadores sobrepostos — evita que fiquem "dentro" um do outro. */
export function resolveOverlap(fighters) {
  const minDist = TUNING.fighter.radius * 2;
  for (let i = 0; i < fighters.length; i++) {
    const a = fighters[i];
    if (!a.alive) continue;
    for (let j = i + 1; j < fighters.length; j++) {
      const b = fighters[j];
      if (!b.alive) continue;

      _dir.subVectors(b.position, a.position);
      const d = _dir.length();
      if (d > minDist || d < 1e-5) continue;

      // Quem está lançado/blowaway não empurra: ele atravessa, senão o corpo
      // voando fica preso batendo no adversário.
      if (a.state === 'blowaway' || b.state === 'blowaway') continue;
      if (LANCADOS.has(a.act?.current) || BLOWAWAYS.has(a.act?.current)) continue;
      if (LANCADOS.has(b.act?.current) || BLOWAWAYS.has(b.act?.current)) continue;

      _dir.divideScalar(d);
      const push = (minDist - d) * 0.5;
      a.position.addScaledVector(_dir, -push);
      b.position.addScaledVector(_dir, push);
    }
  }
}
