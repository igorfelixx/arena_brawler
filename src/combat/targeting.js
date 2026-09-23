/* =============================================================================
 *  targeting.js  —  Quem eu estou batendo?
 * =============================================================================
 *
 *  Com dois lutadores esta pergunta é trivial. Com 20–30 ela é O jogo.
 *
 *  Duas regras diferentes, porque servem a momentos diferentes:
 *
 *  LOCK-ON LIGADO   você escolheu um alvo e ele é seu até você trocar (Q).
 *                   A câmera enquadra ele, os golpes perseguem ele. É o modo
 *                   de duelar — previsível de propósito.
 *
 *  LOCK-ON SOLTO    cada golpe mira em quem estiver melhor posicionado NAQUELE
 *                   instante, considerando distância E a direção que você está
 *                   apontando. É o modo de brigar no meio do tumulto: você
 *                   soca pra esquerda, acerta quem está à esquerda.
 *
 *  A consequência prática do segundo caso é o que se pede num brawler de arena:
 *  **trocar de alvo no meio do combo**. Você está combando o A, vira o
 *  direcional pro B que passou perto, e o próximo golpe já sai no B — sem
 *  precisar soltar nada nem mirar com precisão.
 *
 *  O critério de escolha é uma PONTUAÇÃO, não só distância. Distância pura faz
 *  o alvo pular sozinho entre inimigos sempre que um chega meio metro mais
 *  perto, e o jogador perde o controle de quem está batendo.
 * ========================================================================== */

import * as THREE from 'three';
import { TUNING } from '../tuning.js';

const _toFoe = new THREE.Vector3();
const _aim = new THREE.Vector3();

/**
 * Escolhe o melhor alvo para ESTE golpe.
 *
 * @param {Fighter} self
 * @param {Fighter[]} fighters   todos, incluindo o próprio
 * @param {object} cmd           comando do frame (dá a direção apontada)
 * @param {object} basis         { forward, right } da câmera
 * @param {Fighter|null} locked  alvo travado, se houver
 * @returns {Fighter|null}
 */
export function pickAttackTarget(self, fighters, cmd, basis, locked) {
  const T = TUNING.targeting;

  // Com lock-on, o alvo travado manda — desde que ainda seja válido.
  if (self.lockOn && locked && locked.alive
      && self.position.distanceTo(locked.position) <= T.lockKeepRange) {
    return locked;
  }

  // Direção apontada. Sem direcional, usa a frente do personagem.
  _aim.set(0, 0, 0)
    .addScaledVector(basis.right, cmd.moveX || 0)
    .addScaledVector(basis.forward, cmd.moveY || 0);
  _aim.y += (cmd.vertical || 0) * 0.8;

  const apontando = _aim.lengthSq() > 0.05;
  if (apontando) _aim.normalize();
  else _aim.set(Math.sin(self.yaw), 0, Math.cos(self.yaw));

  let melhor = null;
  let melhorNota = -Infinity;

  for (const f of fighters) {
    if (f === self || !f.alive) continue;

    _toFoe.subVectors(f.position, self.position);
    const d = _toFoe.length();
    if (d > T.acquireRange || d < 1e-4) continue;

    _toFoe.divideScalar(d);
    const alinhamento = _toFoe.dot(_aim);              // -1..1

    // Atrás das costas e sem estar apontando pra lá: ignora.
    if (alinhamento < T.minAlignment && apontando) continue;

    /* Nota = proximidade + alinhamento com a direção apontada.
     * O peso do alinhamento é o que dá CONTROLE ao jogador: sem ele o alvo
     * troca sozinho sempre que alguém chega um pouco mais perto, e você perde
     * a noção de quem está batendo. */
    let nota = (1 - d / T.acquireRange) * T.distanceWeight
             + (alinhamento * 0.5 + 0.5) * T.aimWeight;

    // Histerese: quem já está sendo atacado leva bônus. Impede troca nervosa
    // a cada frame quando dois inimigos estão a distâncias parecidas.
    if (f === locked) nota += T.stickyBonus;

    // Alvo indefeso vale mais: combar quem está no ar é a jogada certa.
    if (f.state === 'blowaway' || f.state === 'hitstun') nota += T.helplessBonus;

    if (nota > melhorNota) { melhorNota = nota; melhor = f; }
  }

  return melhor || (locked && locked.alive ? locked : null);
}

/**
 * Próximo alvo no ciclo (tecla Q com lock-on ligado).
 * Ordena por ângulo em torno do jogador pra que a troca siga a tela, e não
 * uma ordem arbitrária de array.
 */
export function cycleTarget(self, fighters, current, basis) {
  const vivos = fighters.filter((f) => f !== self && f.alive);
  if (vivos.length === 0) return null;
  if (vivos.length === 1) return vivos[0];

  const angulo = (f) => {
    _toFoe.subVectors(f.position, self.position);
    return Math.atan2(_toFoe.dot(basis.right), _toFoe.dot(basis.forward));
  };

  vivos.sort((a, b) => angulo(a) - angulo(b));
  const i = vivos.indexOf(current);
  return vivos[(i + 1) % vivos.length];
}

/** O inimigo vivo mais próximo. Usado pra reengatar quando o alvo morre. */
export function nearestEnemy(self, fighters) {
  let melhor = null, melhorD = Infinity;
  for (const f of fighters) {
    if (f === self || !f.alive) continue;
    const d = self.position.distanceToSquared(f.position);
    if (d < melhorD) { melhorD = d; melhor = f; }
  }
  return melhor;
}
