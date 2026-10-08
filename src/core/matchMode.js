/* =============================================================================
 *  matchMode.js  —  DUELO ou ARENA
 * =============================================================================
 *
 *  Dois modos que são jogos diferentes, e a separação existe por uma razão de
 *  método, não de organização:
 *
 *    DUELO  é o MVP VALIDADO. Todo número medido neste projeto — 7 golpes
 *           esgotam a guarda, defensor sai +8 frames, rota de 4 elos, Perfect
 *           Smash em 18–26f — foi colhido com ele. Ele NÃO SOBRESCREVE NADA.
 *
 *    ARENA  é 20–30 jogadores em 20–25 minutos. Precisa de outra arena, outro
 *           ritmo e outro HP. Se esses números vazassem pro duelo, a base de
 *           comparação do projeto inteiro morreria.
 *
 *  O contrato é o mesmo dos perfis de IA: o modo lista SOBREPOSIÇÕES, e o que
 *  não estiver listado continua vindo do `TUNING` normal — inclusive ajustado
 *  ao vivo pelo painel (P).
 *
 *  ---------------------------------------------------------------------------
 *  POR QUE AS SOBREPOSIÇÕES SÃO APLICADAS, E NÃO CONSULTADAS
 *  ---------------------------------------------------------------------------
 *  Seria mais "limpo" o jogo perguntar `modo.fighter.maxHealth` em vez de
 *  escrever em `TUNING.fighter.maxHealth`. Seria também um jeito de quebrar o
 *  painel de debug e espalhar `if (modo === ...)` por todo lado — as duas
 *  coisas que este projeto evita.
 *
 *  Aplicamos UMA VEZ no boot, guardando o valor original. `restaurar()` desfaz.
 *  O resto do código nunca sabe que modos existem.
 * ========================================================================== */

import { TUNING } from '../tuning.js';

let _ativo = null;
let _original = null;

/** Lê o modo e o nº de lutadores da URL. `?modo=arena&n=30` */
export function lerURL() {
  const q = new URLSearchParams(location.search);
  const modo = (q.get('modo') || q.get('mode') || TUNING.match.mode || 'duelo').toLowerCase();
  const n = parseInt(q.get('n') || '', 10);
  return { modo: TUNING.match.modes[modo] ? modo : 'duelo', n: Number.isFinite(n) ? n : null };
}

/**
 * Aplica um modo. Devolve a config efetiva.
 * @param {string} id     'duelo' | 'arena'
 * @param {number|null} n  nº de lutadores (sobrepõe o do modo)
 */
export function aplicar(id, n = null) {
  const modo = TUNING.match.modes[id] || TUNING.match.modes.duelo;

  restaurar();
  _original = {};

  /* Sobreposições rasas por bloco: `fighter`, `arena`, `combo`, etc.
   * `recover` é tratado à parte porque mora em `defense.recover`, e um
   * caminho especial aqui é mais honesto que achatar a estrutura do tuning
   * só pra facilitar a vida deste arquivo. */
  for (const [bloco, campos] of Object.entries(modo)) {
    if (['label', 'fighters', 'phases', 'hardCapMin', 'recover'].includes(bloco)) continue;
    if (!TUNING[bloco] || typeof campos !== 'object') continue;
    _original[bloco] = {};
    for (const [k, v] of Object.entries(campos)) {
      _original[bloco][k] = TUNING[bloco][k];
      TUNING[bloco][k] = v;
    }
  }

  if (modo.recover) {
    _original.__recover = {};
    for (const [k, v] of Object.entries(modo.recover)) {
      _original.__recover[k] = TUNING.defense.recover[k];
      TUNING.defense.recover[k] = v;
    }
  }

  /* Confere a restrição que impede a partida de nunca terminar.
   * Ver a nota longa em `TUNING.targeting`: se a arena final for maior que o
   * alcance de visão, dois sobreviventes se evitam pra sempre. Medido: 149
   * minutos sem vencedor. Avisar é barato; descobrir isso num playtest de uma
   * hora não é. */
  if (modo.phases && TUNING.targeting.detectionEnabled) {
    const raioFinal = modo.phases[modo.phases.length - 1].raio;
    const vista = TUNING.targeting.loseTargetRange;
    if (raioFinal * 2 >= vista) {
      console.warn(
        `[matchMode] ARENA FINAL GRANDE DEMAIS: raio ${raioFinal} m (diâmetro ` +
        `${raioFinal * 2}) >= alcance de visão ${vista} m.\n` +
        '            Dois sobreviventes podem se evitar indefinidamente e a ' +
        'partida pode não terminar.\n' +
        `            Baixe o raio da última fase pra menos de ${(vista / 2).toFixed(0)} m, ` +
        'ou suba targeting.loseTargetRange.');
    }
  }

  _ativo = {
    id,
    label: modo.label || id.toUpperCase(),
    fighters: Math.max(2, n || modo.fighters || 2),
    phases: modo.phases || null,
    hardCapMin: modo.hardCapMin || null,
  };
  return _ativo;
}

/** Desfaz as sobreposições. Sem isto, trocar de modo acumula. */
export function restaurar() {
  if (!_original) return;
  for (const [bloco, campos] of Object.entries(_original)) {
    if (bloco === '__recover') {
      for (const [k, v] of Object.entries(campos)) TUNING.defense.recover[k] = v;
      continue;
    }
    for (const [k, v] of Object.entries(campos)) TUNING[bloco][k] = v;
  }
  _original = null;
}

export const modoAtivo = () => _ativo;
export const temFases = () => !!(_ativo && _ativo.phases);

/* ==========================================================================
 *  CRONOGRAMA DE FASES
 * ==========================================================================
 *  Substitui o encolhimento linear por uma curva com NOME. O jogador precisa
 *  ler em que momento da partida está: "CONFRONTO" diz mais que "raio 38 m", e
 *  é o que transforma o encolhimento de cronômetro em narrativa.
 *
 *  Entre duas fases os valores são interpolados com easeInOut — a arena nunca
 *  dá saltos, e o começo/fim de cada fase é suave (encolhimento linear parece
 *  mecânico, é a mesma razão da curva original).
 * ========================================================================== */

/**
 * @param {number} elapsedSec
 * @returns {{radius, ceiling, label, sub, fase, proximaEm, shrinking}|null}
 */
export function faseEm(elapsedSec) {
  if (!temFases()) return null;
  const F = _ativo.phases;
  const min = elapsedSec / 60;

  // Antes da primeira fase (não deveria acontecer: a primeira começa em 0).
  if (min <= F[0].min) {
    return {
      radius: F[0].raio, ceiling: F[0].teto,
      label: F[0].label, sub: F[0].sub, fase: 0,
      proximaEm: (F[0].min - min) * 60, shrinking: false,
    };
  }

  for (let i = 0; i < F.length - 1; i++) {
    const a = F[i], b = F[i + 1];
    if (min >= b.min) continue;

    const k = (min - a.min) / (b.min - a.min);
    const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
    return {
      radius: a.raio + (b.raio - a.raio) * e,
      ceiling: a.teto + (b.teto - a.teto) * e,
      label: a.label, sub: a.sub, fase: i,
      proximaEm: (b.min - min) * 60,
      proximaLabel: b.label,
      shrinking: b.raio < a.raio,
    };
  }

  const ult = F[F.length - 1];
  return {
    radius: ult.raio, ceiling: ult.teto,
    label: ult.label, sub: ult.sub, fase: F.length - 1,
    proximaEm: Infinity, shrinking: false,
  };
}
