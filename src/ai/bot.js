/* =============================================================================
 *  bot.js  —  Controlador de IA
 * =============================================================================
 *
 *  A IA devolve o MESMO objeto Command que o jogador produz. Ela não tem acesso
 *  privilegiado a nada: não teleporta, não ignora custo de ki, não lê o futuro.
 *  Isso importa por um motivo prático — se ela ganhasse trapaceando, o combate
 *  pareceria injusto e você não conseguiria julgar o balanceamento, que é a
 *  única coisa que este protótipo existe pra testar.
 *
 *  O que ela TEM é tempo de reação artificial (`reactionFrames`). Uma IA que
 *  responde no mesmo frame é perfeita e insuportável. O atraso é o que a faz
 *  parecer humana — e é o parâmetro que mais muda a dificuldade percebida.
 *
 *  Comportamento em camadas, da mais urgente pra menos:
 *     1. estou sendo atingido?          → vanish / guarda / recuperação aérea
 *     2. estou sem ki?                  → carregar (se houver espaço seguro)
 *     3. estou perto da borda?          → voltar pro centro
 *     4. estou longe?                   → dash / blast
 *     5. estou em alcance?              → combo, com chance de finalizar em smash
 *     6. nada disso                     → reposicionar orbitando
 * ========================================================================== */

import * as THREE from 'three';
import { TUNING } from '../tuning.js';
import { emptyCommand, S } from '../combat/fighter.js';

const _v = new THREE.Vector3();
const _toFoe = new THREE.Vector3();

export class BotController {
  constructor(fighter, seed = 1337) {
    this.f = fighter;
    this.cmd = emptyCommand();

    this._rand = mulberry32(seed);
    this._decisionTimer = 0;
    this._reactionDelay = 0;
    this._pendingIntent = null;
    this._intent = 'approach';
    this._intentFrames = 0;

    this._comboCount = 0;
    this._strafeDir = this._rand() > 0.5 ? 1 : -1;
    this._strafeTimer = 0;
    this._blastHold = 0;

    /* Quantos frames ainda vai SEGURAR a guarda.
     *
     * Sem isto a IA sorteava "bloquear?" a cada frame e devolvia guard=true por
     * um frame só. Como a guarda exige o botão pressionado, ela piscava e nunca
     * bloqueava de fato — medido: 1% de tempo em guarda, enquanto apanhava.
     * Decisão por frame não produz input segurado: é preciso COMPROMISSO. */
    this._holdGuard = 0;
  }

  /** @returns {object} command */
  update(dt, ctx) {
    const c = this.cmd;
    resetCommand(c);

    const f = this.f;
    const foe = f.target;
    if (!f.alive || !foe || !foe.alive) return c;

    const A = TUNING.ai;
    if (!A.enabled) return c;

    const diff = A.difficulty;
    const dist = f.position.distanceTo(foe.position);

    _toFoe.subVectors(foe.position, f.position);
    const vertical = _toFoe.y;
    _toFoe.y = 0;
    _toFoe.normalize();

    /* ---------- 1. defesa ---------- */
    /* Defesa NÃO é reação frame-a-frame.
     *
     * A versão anterior exigia `foe.stateFrame >= reactionFrames` para reagir,
     * mas o rush tem 4 frames de startup e o limiar era 10–24. A condição era
     * impossível: a IA nunca bloqueava nem vanishava contra o combo. Resultado
     * medido — martelar um botão dava KO sem resposta.
     *
     * A correção não é acelerar a reação (ninguém reage a 4 frames, nem humano).
     * É separar as duas coisas que jogos de luta separam de verdade:
     *
     *   ANTECIPAR  golpe rápido → você segura guarda ANTES, por leitura
     *   REAGIR     golpe lento (smash, investida) → dá tempo de ver e responder
     */
    if (f.state === S.BLOWAWAY) {
      if (this._roll(A.recoverChance * diff)) { c.guard = true; }
      return c;
    }

    const canVanish = f.ki >= TUNING.defense.vanish.kiCost;
    const investindo = foe.state === S.APPROACH && dist < TUNING.rushApproach.range;
    const atacandoPerto = foe.state === S.ATTACK && dist < 4.5;
    const golpeLento = foe.moveKey?.startsWith('smash') || investindo;

    // Já se comprometeu a bloquear: segura até o fim.
    if (this._holdGuard > 0) {
      this._holdGuard--;
      c.guard = true;
      // Guarda quebrada ou vindo smash: tenta escapar em vez de comer o golpe.
      if (f.state === S.HITSTUN && canVanish && this._roll(A.vanishChance * diff * 0.5)) {
        c.vanish = true;
        this._holdGuard = 0;
      }
      return c;
    }

    // REAGIR: golpe lento o bastante pra ser lido.
    if (golpeLento && (investindo || foe.stateFrame >= this._reactionFrames())) {
      if (canVanish && this._roll(A.vanishChance * diff)) { c.vanish = true; return c; }
      if (this._roll(A.guardChance + 0.25)) {
        this._holdGuard = A.guardHoldFrames;
        c.guard = true;
        if (this._roll(A.stepChance + 0.3)) c.moveX = this._strafeDir;
        return c;
      }
    }

    // ANTECIPAR: adversário colado e agressivo — segura guarda por leitura.
    if (atacandoPerto && this._roll(A.anticipateGuardChance * diff)) {
      this._holdGuard = A.guardHoldFrames;
      c.guard = true;
      return c;
    }

    /* ---------- 2. sem ki ---------- */
    if (f.ki < A.chargeKiBelow && dist > 8) {
      c.charge = true;
      return c;
    }

    /* ---------- 3. perto da própria borda ---------- */
    const edge = ctx.arena.edgeProximity(f.position);
    if (edge > 0.45 * (1 + (1 - A.edgeAwareness))) {
      ctx.arena.towardCenter(f.position, _v);
      this._setMoveToward(c, _v, ctx);
      if (f.position.y > ctx.arena.ceiling * 0.85) c.vertical = -1;
      return c;
    }

    /* ---------- decisão periódica ---------- */
    this._decisionTimer--;
    if (this._decisionTimer <= 0) {
      this._decisionTimer = A.decisionIntervalFrames;
      this._chooseIntent(dist, diff, ctx);
    }

    /* ---------- 4/5/6. execução da intenção ---------- */
    switch (this._intent) {
      case 'dash':
        if (dist > A.attackRange * 1.4 && f.ki > TUNING.dragonDash.kiCost) {
          c.dash = true;
          this._setMoveToward(c, _toFoe, ctx);
          c.vertical = clampSign(vertical, 1.2);
          // Ataca ao chegar: o dash vira abertura, não só locomoção.
          if (dist < A.attackRange * 1.6) c.rush = true;
        } else {
          this._intent = 'attack';
        }
        break;

      case 'blast':
        c.blast = true;
        this._blastHold = this._roll(0.35 * diff) ? 40 : 0;
        this._setMoveToward(c, _toFoe, ctx, 0.3);
        this._intent = 'approach';
        break;

      case 'attack':
        this._setMoveToward(c, _toFoe, ctx, dist > A.attackRange ? 1 : 0.2);
        c.vertical = clampSign(vertical, 0.8);

        // A IA usa a MESMA investida que o jogador: apertar rush a média
        // distância a leva até o alvo. Sem isto ela ficaria parada a 15 m
        // socando o ar — que é o que acontecia antes de a investida existir.
        if (dist > A.attackRange && dist <= TUNING.rushApproach.range) {
          c.rush = true;
          break;
        }

        if (dist <= A.attackRange) {
          const inCombo = f.state === S.ATTACK;
          if (inCombo) {
            const canSmash = f.move?.cancelInto?.some((k) => k.startsWith('smash'));
            if (canSmash && this._roll(A.smashChance * (0.6 + diff * 0.6))) {
              c.smash = true;
              c.smashDir = this._pickSmashDir(foe, ctx);
              this._comboCount = 0;
            } else {
              c.rush = true;
              this._comboCount++;
            }
          } else {
            c.rush = true;
            this._comboCount = 1;
          }
        }
        break;

      case 'reposition':
      default: {
        this._strafeTimer--;
        if (this._strafeTimer <= 0) {
          this._strafeTimer = 40 + Math.floor(this._rand() * 50);
          this._strafeDir *= -1;
        }
        // Orbita mantendo a distância preferida.
        _v.copy(_toFoe);
        const side = new THREE.Vector3(-_v.z, 0, _v.x).multiplyScalar(this._strafeDir);
        const closeIn = dist > A.preferredRange ? 0.6 : -0.5;
        _v.multiplyScalar(closeIn).add(side.multiplyScalar(0.8)).normalize();
        this._setMoveToward(c, _v, ctx);
        c.vertical = clampSign(vertical, 0.6);
        break;
      }
    }

    if (this._blastHold > 0) { this._blastHold--; c.blastHeld = true; }

    return c;
  }

  /* ---------------------------------------------------------------- */
  _chooseIntent(dist, diff, ctx) {
    const A = TUNING.ai;
    const r = this._rand();

    if (dist > A.dashRange) {
      this._intent = r < 0.7 ? 'dash' : 'blast';
    } else if (dist > A.attackRange * 2.2) {
      if (r < A.blastChance) this._intent = 'blast';
      else if (r < A.blastChance + 0.45) this._intent = 'dash';
      else this._intent = 'attack';
    } else if (dist > A.attackRange) {
      this._intent = r < A.aggression * (0.7 + diff * 0.5) ? 'attack' : 'reposition';
    } else {
      this._intent = r < A.aggression ? 'attack' : 'reposition';
    }
  }

  /** Escolhe a direção do smash. Perto da borda: manda PRA FORA. */
  _pickSmashDir(foe, ctx) {
    const A = TUNING.ai;
    const foeEdge = ctx.arena.edgeProximity(foe.position);

    // Se o adversário já está na borda, o smash horizontal é ring-out.
    if (foeEdge > 0.35 && this._roll(A.ringOutIntent + 0.3)) return 'forward';

    // Alto demais: cravar pro chão. Muito baixo: mandar pra cima.
    if (foe.position.y > ctx.arena.ceiling * 0.55) return 'down';
    if (this._roll(0.3)) return 'up';
    return 'forward';
  }

  _setMoveToward(c, worldDir, ctx, scale = 1) {
    // Converte direção do mundo pra eixos do command (relativos à câmera).
    const basis = ctx.moveBasis;
    c.moveX = clamp(worldDir.dot(basis.right) * scale, -1, 1);
    c.moveY = clamp(worldDir.dot(basis.forward) * scale, -1, 1);
  }

  _reactionFrames() {
    const A = TUNING.ai;
    const t = 1 - A.difficulty;
    return Math.round(A.reactionFramesMin + (A.reactionFramesMax - A.reactionFramesMin) * t);
  }

  _roll(p) { return this._rand() < p; }

  reset() {
    this._intent = 'approach';
    this._decisionTimer = 0;
    this._comboCount = 0;
    this._blastHold = 0;
    this._holdGuard = 0;
    resetCommand(this.cmd);
  }
}

/* ========================================================================== */
function resetCommand(c) {
  c.moveX = 0; c.moveY = 0; c.vertical = 0;
  c.rush = false; c.smash = false; c.blast = false; c.blastHeld = false;
  c.guard = false; c.vanish = false; c.dash = false; c.charge = false; c.ultimate = false;
  c.smashDir = 'forward';
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const clampSign = (v, k) => clamp(v * 0.35, -1, 1) * k;

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
