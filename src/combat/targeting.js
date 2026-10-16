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
const _olhoA = new THREE.Vector3();
const _olhoB = new THREE.Vector3();

/* ==========================================================================
 *  LINHA DE VISÃO  —  obstáculos (só no modo arena)
 * ==========================================================================
 *  O módulo de obstáculos é registrado UMA vez no boot. Sem registro (ou com
 *  a lista vazia, como no duelo) `enxerga()` devolve true no primeiro teste e
 *  nada abaixo muda de comportamento.
 *
 *  Duas regras, que são a mesma histerese de detectionRange/loseTargetRange
 *  aplicada ao TEMPO em vez da distância:
 *
 *    ADQUIRIR  exige ver AGORA. Não se acha ninguém através de uma coluna.
 *    PERDER    exige ficar SEM VER por `obstacles.losLoseFrames` seguidos.
 *              Sem o atraso, o lock PISCA toda vez que a briga contorna uma
 *              coluna — o alvo some, volta, some — e a câmera pula junto.
 * ========================================================================== */
let _obst = null;

/** Registra o módulo de obstáculos (main.js, no boot). */
export function definirObstaculos(o) { _obst = o; }

/** `a` enxerga `b`? Olho a `eyeHeight` acima dos pés dos dois. */
export function enxerga(a, b) {
  if (!_obst || _obst.lista.length === 0) return true;
  const h = TUNING.obstacles.eyeHeight;
  _olhoA.copy(a.position); _olhoA.y += h;
  _olhoB.copy(b.position); _olhoB.y += h;
  return _obst.visaoLivre(_olhoA, _olhoB);
}

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
    // Não se mira em quem está atrás de uma coluna (exceto o alvo atual, que
    // tem a sua própria regra de perder de vista em `aindaVejo`).
    if (f !== locked && !enxerga(self, f)) continue;

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

/**
 * O inimigo vivo mais próximo DENTRO DO ALCANCE DE DETECÇÃO.
 *
 * ---------------------------------------------------------------------------
 * Devolver `null` é o ponto desta função, não um caso de borda.
 * ---------------------------------------------------------------------------
 * Ela varria a lista inteira e sempre achava alguém — o lutador mais distante
 * da arena ainda virava alvo. Era onisciência, e era a causa medida de os
 * lutadores passarem 74–77% do tempo em combate INDEPENDENTE do tamanho da
 * arena (testado de 513 a 6.286 m² por pessoa: o número não se move).
 *
 * Sem poder PERDER alguém de vista, não existe fugir de uma briga — só correr
 * enquanto o outro persegue. E sem poder fugir não existe tática: o jogo vira
 * porradaria contínua, que é o que cansa.
 *
 * Com alcance, afastar-se tem consequência dos dois lados.
 *
 * @param {number} [range]  alcance máximo. Sem ele, usa `detectionRange`.
 *                          Passe `Infinity` pra forçar o comportamento antigo.
 */
export function nearestEnemy(self, fighters, range = null) {
  const T = TUNING.targeting;
  const limite = range !== null ? range
    : (T.detectionEnabled ? T.detectionRange : Infinity);
  const limite2 = limite === Infinity ? Infinity : limite * limite;

  /* Primeiro o mais próximo por distância; a linha de visão só é testada
   * pra quem já passou no alcance — é a conta cara, e com 30 lutadores a
   * maioria está longe demais pra precisar dela. Testa em ordem de distância
   * pra que o escolhido seja o mais próximo VISÍVEL, não o mais próximo. */
  const cand = _cand;
  cand.length = 0;
  for (const f of fighters) {
    if (f === self || !f.alive) continue;
    const d = self.position.distanceToSquared(f.position);
    if (d > limite2) continue;
    cand.push(d, f);
  }
  let melhor = null, melhorD = Infinity;
  if (!_obst || _obst.lista.length === 0) {
    for (let i = 0; i < cand.length; i += 2) {
      if (cand[i] < melhorD) { melhorD = cand[i]; melhor = cand[i + 1]; }
    }
    return melhor;
  }
  // Com obstáculos: o mais próximo QUE SE VÊ.
  const usados = _usados; usados.length = 0;
  for (;;) {
    let k = -1; melhorD = Infinity;
    for (let i = 0; i < cand.length; i += 2) {
      if (cand[i] < melhorD && !usados.includes(i)) { melhorD = cand[i]; k = i; }
    }
    if (k < 0) return null;
    if (enxerga(self, cand[k + 1])) return cand[k + 1];
    usados.push(k);
  }
}
const _cand = [];
const _usados = [];

/**
 * Este alvo ainda está ao alcance, ou o perdi de vista?
 *
 * Usa `loseTargetRange`, maior que o de aquisição. A histerese é o que impede
 * quem ronda na distância exata de entrar e sair de combate a cada frame.
 * Com obstáculos, também perde quem ficou atrás de uma coluna por mais de
 * `obstacles.losLoseFrames` seguidos.
 */
export function aindaVejo(self, alvo) {
  if (!alvo || !alvo.alive) return false;
  const T = TUNING.targeting;
  if (!T.detectionEnabled) return true;
  if (self.position.distanceToSquared(alvo.position) > T.loseTargetRange ** 2) return false;

  /* Linha de visão, com ATRASO pra perder (ver o bloco no topo). O contador
   * mora no próprio lutador e é por ALVO: trocar de alvo zera. Chamada uma
   * vez por frame por lutador (main.js), então o contador é em frames. */
  if (!_obst || _obst.lista.length === 0) return true;
  if (self._semVisaoDe !== alvo) { self._semVisaoDe = alvo; self._semVisaoFrames = 0; }
  if (enxerga(self, alvo)) { self._semVisaoFrames = 0; return true; }
  self._semVisaoFrames++;
  return self._semVisaoFrames <= TUNING.obstacles.losLoseFrames;
}
