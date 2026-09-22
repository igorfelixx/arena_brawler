/* =============================================================================
 *  fighter.js  —  Máquina de estados do lutador
 * =============================================================================
 *
 *  Decisão de arquitetura que importa mais do que parece:
 *
 *  O Fighter NÃO lê o teclado. Ele consome um objeto COMMAND — um retrato do que
 *  o jogador quis fazer naquele frame. Quem produz o command é o controlador:
 *  o do jogador lê o Input, o da IA inventa.
 *
 *      Input  ─┐
 *              ├─→ Command ──→ Fighter.update()
 *      IA     ─┘
 *
 *  Por que isso vale o incômodo: quando esse jogo for pra rede, o que trafega
 *  entre cliente e servidor é exatamente o Command — alguns bytes por frame.
 *  É o mesmo modelo de rollback/prediction que os jogos de luta usam. Se o
 *  Fighter lesse o teclado direto, essa porta estaria fechada e a reescrita
 *  seria o projeto inteiro.
 *
 *  Todo tempo aqui é contado em FRAMES a 60fps, batendo com tuning.js.
 * ========================================================================== */

import * as THREE from 'three';
import { TUNING } from '../tuning.js';

export const S = {
  IDLE: 'idle',
  MOVE: 'move',
  DASH: 'dash',
  ATTACK: 'attack',
  GUARD: 'guard',
  STEP: 'step',
  VANISH: 'vanish',
  CHARGE: 'charge',
  BLAST: 'blast',
  ULTIMATE: 'ultimate',
  HITSTUN: 'hitstun',
  BLOWAWAY: 'blowaway',
  KNOCKDOWN: 'knockdown',
  GETUP: 'getup',
  RECOVER: 'recover',
  DEAD: 'dead',
};

/** Command neutro — a "forma" que todo controlador precisa devolver. */
export function emptyCommand() {
  return {
    moveX: 0, moveY: 0, vertical: 0,
    rush: false, smash: false, blast: false, blastHeld: false,
    guard: false, vanish: false, dash: false, charge: false, ultimate: false,
    // direção do smash: 'forward' | 'up' | 'down'
    smashDir: 'forward',
  };
}

const UP = new THREE.Vector3(0, 1, 0);

export class Fighter {
  /**
   * @param {object} opts
   * @param {Character} opts.character  resultado de loadCharacter()
   * @param {THREE.Vector3} opts.spawn
   * @param {number} opts.auraColor
   * @param {string} opts.name
   */
  constructor({ character, spawn, auraColor = 0x7fd8ff, name = 'fighter' }) {
    this.char = character;
    this.name = name;
    this.auraColor = auraColor;

    this.position = spawn.clone();
    this.velocity = new THREE.Vector3();
    this.yaw = 0;

    this.health = TUNING.fighter.maxHealth;
    this.ki = TUNING.ki.max * TUNING.ki.startPercent;
    this.poise = TUNING.fighter.maxPoise;

    this.state = S.IDLE;
    this.stateFrame = 0;

    this.move = null;            // definição do golpe atual (de TUNING.moves)
    this.moveKey = null;
    this.comboKey = null;        // próximo elo possível
    this.hitThisMove = new Set();

    this.guardStamina = 100;
    this.vanishChain = 0;
    this.vanishChainTimer = 0;
    this.stepCooldown = 0;
    this.blastCooldown = 0;
    this.outOfBoundsFrames = 0;
    this.invulnFrames = 0;
    this.flashFrames = 0;

    this.chargeFrames = 0;       // acumulador do blast carregado
    this.dashFrames = 0;
    this.dashHits = new Set();   // quem já foi trombado neste dash (1 toque cada)
    this.dashCooldown = 0;
    /* Exige SOLTAR o botão antes de um novo dash. Sem isso, segurar Shift
     * encadeia tromba atrás de tromba: no teste, 28 de dano em meio segundo,
     * sem combo nenhum. Spammar dash não pode ser melhor do que lutar. */
    this.dashBlocked = false;

    // Frames desde que o botão de vanish foi apertado. A resolução de acerto
    // compara isto com o `vanishWindow` do golpe recebido: apertar ANTES do
    // impacto é o que caracteriza a leitura. Começa alto = "não apertou".
    this.vanishPressFrame = 999;
    this.alive = true;
    this.eliminated = false;
    this.ringOutCause = null;

    /* Lock-on. Com `false`, o lutador para de encarar o alvo automaticamente e
     * passa a olhar pra onde se move, e os golpes perdem o homing.
     *
     * Existe porque lock permanente prende: não dá pra fugir, reposicionar,
     * olhar em volta, nem escolher outro adversário. Com 20–30 jogadores isso
     * deixa de ser conforto e vira necessidade. */
    this.lockOn = true;

    // preenchidos pelo jogo
    this.target = null;
    this.aura = null;
    this.trail = null;

    this._afterimageTick = 0;
    this._tmp = new THREE.Vector3();
    this._tmp2 = new THREE.Vector3();
    this._desired = new THREE.Vector3();

    // eventos que o jogo consome e limpa a cada frame
    this.events = [];

    this.char.root.position.copy(this.position);
  }

  /* ================================================================== */
  /*  Consultas                                                          */
  /* ================================================================== */
  get busy() {
    return this.state === S.ATTACK || this.state === S.HITSTUN
        || this.state === S.BLOWAWAY || this.state === S.KNOCKDOWN
        || this.state === S.GETUP || this.state === S.VANISH
        || this.state === S.BLAST || this.state === S.ULTIMATE
        || this.state === S.STEP || this.state === S.RECOVER;
    }

  get canAct() {
    return this.alive && !this.busy;
  }

  get invulnerable() { return this.invulnFrames > 0; }

  get guarding() { return this.state === S.GUARD; }

  /** Frames desde o início do golpe atual, e em que fase ele está. */
  get attackPhase() {
    if (this.state !== S.ATTACK || !this.move) return null;
    const f = this.stateFrame;
    if (f < this.move.startup) return 'startup';
    if (f < this.move.startup + this.move.active) return 'active';
    return 'recovery';
  }

  distanceTo(other) { return this.position.distanceTo(other.position); }

  /* ================================================================== */
  /*  Loop principal                                                     */
  /* ================================================================== */
  update(dt, cmd, ctx) {
    if (!this.alive) return;

    this.events.length = 0;
    this.stateFrame++;

    // Janela de vanish: guardamos há quantos frames o botão foi apertado.
    if (cmd.vanish) this.vanishPressFrame = 0;
    else if (this.vanishPressFrame < 999) this.vanishPressFrame++;

    // --- timers ---
    if (this.stepCooldown > 0) this.stepCooldown--;
    if (this.blastCooldown > 0) this.blastCooldown--;
    if (this.dashCooldown > 0) this.dashCooldown--;
    // Soltar o botão rearma o dash.
    if (!cmd.dash) this.dashBlocked = false;
    if (this.invulnFrames > 0) this.invulnFrames--;
    if (this.flashFrames > 0) this.flashFrames--;
    if (this.vanishChainTimer > 0) {
      this.vanishChainTimer--;
      if (this.vanishChainTimer === 0) this.vanishChain = 0;
    }

    // --- regeneração ---
    this.poise = Math.min(TUNING.fighter.maxPoise,
      this.poise + TUNING.fighter.poiseRegenPerSec * dt);

    if (this.state !== S.CHARGE) {
      this.ki = Math.min(TUNING.ki.max, this.ki + TUNING.ki.passiveRegenPerSec * dt);
    }

    this.guardStamina = Math.min(TUNING.defense.guard.maxStamina ?? 100,
      this.guardStamina + 22 * dt);

    // --- estado ---
    this._runState(dt, cmd, ctx);

    // --- física ---
    this._integrate(dt, ctx);

    // --- transform visual ---
    this.char.root.position.copy(this.position);
    this.char.root.rotation.y = this.yaw;

    // --- aura e afterimages ---
    this._updateVisuals(dt, ctx);
  }

  /* ================================================================== */
  /*  Estados                                                            */
  /* ================================================================== */
  _runState(dt, cmd, ctx) {
    switch (this.state) {
      case S.IDLE:
      case S.MOVE:      this._sFree(dt, cmd, ctx); break;
      case S.DASH:      this._sDash(dt, cmd, ctx); break;
      case S.ATTACK:    this._sAttack(dt, cmd, ctx); break;
      case S.GUARD:     this._sGuard(dt, cmd, ctx); break;
      case S.STEP:      this._sStep(dt, cmd, ctx); break;
      case S.CHARGE:    this._sCharge(dt, cmd, ctx); break;
      case S.VANISH:    this._sVanish(dt, cmd, ctx); break;
      case S.BLAST:     this._sBlast(dt, cmd, ctx); break;
      case S.ULTIMATE:  this._sUltimate(dt, cmd, ctx); break;
      case S.HITSTUN:   this._sHitstun(dt, cmd, ctx); break;
      case S.BLOWAWAY:  this._sBlowaway(dt, cmd, ctx); break;
      case S.KNOCKDOWN: this._sKnockdown(dt, cmd, ctx); break;
      case S.GETUP:     this._sGetup(dt, cmd, ctx); break;
      case S.RECOVER:   this._sRecover(dt, cmd, ctx); break;
    }
  }

  /* --- livre: voando, pode fazer tudo ------------------------------- */
  _sFree(dt, cmd, ctx) {
    // Ordem de prioridade = ordem de leitura. Ultimate ganha de tudo.
    if (cmd.ultimate && this._tryUltimate(ctx)) return;
    if (cmd.charge) { this._enter(S.CHARGE); this.char.play('charge', { fade: 0.1 }); return; }
    if (cmd.smash && this._tryAttack(this._smashKey(cmd.smashDir), ctx)) return;
    if (cmd.rush && this._tryAttack('rush_1', ctx)) return;
    if (cmd.blast && this._tryBlast(ctx)) return;

    if (cmd.guard) {
      const moving = Math.abs(cmd.moveX) > 0.3 || Math.abs(cmd.moveY) > 0.3;
      if (moving && this.stepCooldown === 0) { this._enterStep(cmd, ctx); return; }
      this._enter(S.GUARD);
      this.char.play('block', { fade: 0.08 });
      return;
    }

    if (cmd.dash && !this.dashBlocked && this.dashCooldown === 0
        && this.ki >= TUNING.dragonDash.kiCost) {
      this.ki -= TUNING.dragonDash.kiCost;
      this._enter(S.DASH);
      this.dashFrames = 0;
      this.dashHits.clear();

      /* TRAVA A DIREÇÃO NO PRIMEIRO FRAME — seja perseguindo, seja fugindo.
       *
       * Antes, o dash herdava a direção da VELOCIDADE ATUAL e só ia curvando
       * rumo à intenção a `turnSpeed`. Isso produziu os dois bugs de mira:
       *
       *   perseguindo: com o inimigo acima/abaixo, a componente vertical
       *     demorava a ser adquirida, o dash chegava atrasado e ultrapassava
       *     (distância mínima de 5,2 m — nunca encostava)
       *   fugindo: uma deriva de 0,6 m/s definia o rumo de um dash de 62 m/s,
       *     e recuar raspava no inimigo a 1,7 m antes de virar
       *
       * Nos dois casos a raiz é a mesma: velocidade residual não é intenção.
       * Curvar devagar é o compromisso de MUDAR DE IDEIA no meio do dash. */
      this.velocity
        .copy(this._dashDirection(cmd, ctx, this._tmp))
        .multiplyScalar(TUNING.flight.dashSpeed);

      this.char.play('dash', { fade: 0.1 });
      return;
    }

    // --- movimento livre ---
    this._applyFlightInput(dt, cmd, ctx, 1);
    this._faceTarget(dt);

    const speed = this.velocity.length();
    if (speed > TUNING.flight.baseSpeed * 0.72) {
      this._enter(S.MOVE, false);
      this.char.play('run', { fade: 0.16 });
    } else if (speed > 0.6) {
      this._enter(S.MOVE, false);
      this.char.play('walk', { fade: 0.16 });
    } else {
      this._enter(S.IDLE, false);
      this.char.play('idle', { fade: 0.2 });
    }
  }

  /* --- Dragon Dash -------------------------------------------------- */
  /**
   * O dash tem TRÊS usos, e a direção depende do que você está segurando:
   *
   *   sem direção + lock  → persegue o alvo          (atacar)
   *   com direção         → vai pra onde você aponta (fugir, desviar pro lado)
   *   sem lock            → vai pra onde você aponta / pra frente
   *
   * A primeira versão só perseguia o alvo, ignorando o direcional. Isso tirava
   * do dash dois dos três usos que ele tem no Tenkaichi — dava pra atacar, mas
   * não pra escapar nem contornar.
   */
  _sDash(dt, cmd, ctx) {
    this.dashFrames++;
    const D = TUNING.dragonDash;

    if (!cmd.dash || this.dashFrames > D.maxFrames) {
      // Estourou o tempo segurando: trava até soltar, senão reinicia sozinho.
      if (this.dashFrames > D.maxFrames) this.dashBlocked = true;
      this._enter(S.IDLE);
      return;
    }

    // Ataque durante o dash: cancela em rush (a abertura clássica do Tenkaichi).
    if (cmd.rush && this._tryAttack('rush_1', ctx)) return;
    if (cmd.smash && this._tryAttack(this._smashKey(cmd.smashDir), ctx)) return;

    const chasing = this._isChasing(cmd);
    this._dashDirection(cmd, ctx, this._tmp);

    /* Perseguindo com lock, o dash corrige bem (o alvo se move e a correção é
     * o que torna o dash uma ferramenta de aproximação). Dirigindo na mão, ele
     * curva devagar — aí sim vale o compromisso de não poder mudar de ideia. */
    const turn = chasing ? D.chaseTurnSpeed : D.turnSpeed;

    const cur = this._tmp2.copy(this.velocity);
    if (cur.lengthSq() < 1e-6) cur.copy(this._tmp);
    cur.normalize();
    cur.lerp(this._tmp, 1 - Math.exp(-turn * dt)).normalize();

    this.velocity.copy(cur).multiplyScalar(TUNING.flight.dashSpeed);
    this.yaw = Math.atan2(cur.x, cur.z);

    this.char.play('dash', { fade: 0.1 });
  }

  /**
   * Bateu em alguém durante o dash. Chamado por resolveDashImpact().
   * O dash PARA aqui — no Tenkaichi você trombá no adversário e é barrado,
   * não atravessa e segue reto.
   */
  dashImpact(victim, ctx) {
    const D = TUNING.dragonDash;
    this.dashHits.add(victim);

    this._tmp.subVectors(victim.position, this.position).setY(0);
    if (this._tmp.lengthSq() < 1e-6) this._tmp.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    this._tmp.normalize();

    victim.applyHit({
      move: {
        damage: D.impactDamage,
        poiseDamage: D.impactPoiseDamage,
        knockback: D.impactKnockback,
        knockup: D.impactKnockup,
        hitstun: D.impactHitstun,
        blockstun: D.impactBlockstun,
        chipDamage: D.impactDamage * 0.25,
        hitstop: D.impactHitstop,
        shake: D.impactShake,
        causesBlowaway: false,
        guardBreak: false,
      },
      attacker: this,
      direction: this._tmp,
      guarded: victim.guarding && this._facing(victim),
      ctx,
    });

    // Freia o dash em vez de atravessar, e exige soltar o botão pra repetir.
    this.velocity.multiplyScalar(D.impactSelfSlowdown);
    this.dashBlocked = true;
    this.dashCooldown = D.impactCooldownFrames;
    this._enter(S.IDLE);
    this.char.play('idle', { fade: 0.1 });
    this.events.push({ type: 'dashImpact', victim });
  }

  /**
   * O jogador está mandando uma direção? Se sim, ela manda no dash — perseguir
   * o alvo passa a ser secundário. É o que separa "investir" de "fugir".
   */
  _isSteering(cmd) {
    return Math.abs(cmd.moveX) > 0.3
        || Math.abs(cmd.moveY) > 0.3
        || Math.abs(cmd.vertical) > 0.3;
  }

  /** Dash sem direção e com lock = perseguição. */
  _isChasing(cmd) {
    return this.lockOn && this.target && this.target.alive && !this._isSteering(cmd);
  }

  /**
   * Para onde este dash deve ir NESTE frame.
   *
   * Usada em dois lugares — ao ENTRAR no dash (pra travar a direção inicial) e
   * a cada frame (pra corrigir). É importante que seja a mesma função nos dois:
   * quando eram lógicas separadas, o dash entrava numa direção e corrigia pra
   * outra, e os dois bugs de mira vieram daí.
   */
  _dashDirection(cmd, ctx, out) {
    if (this._isChasing(cmd)) {
      out.subVectors(this.target.position, this.position);
    } else if (this._isSteering(cmd)) {
      const basis = ctx.moveBasis;
      out.set(0, 0, 0)
        .addScaledVector(basis.right, cmd.moveX)
        .addScaledVector(basis.forward, cmd.moveY);
      out.y += cmd.vertical;
    } else {
      out.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    }

    if (out.lengthSq() < 1e-6) out.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    return out.normalize();
  }

  /** A vítima está de frente pra mim? (usado pra decidir se a guarda vale) */
  _facing(victim) {
    this._tmp2.subVectors(victim.position, this.position).setY(0).normalize();
    const fwd = this._tmp.set(Math.sin(victim.yaw), 0, Math.cos(victim.yaw));
    return fwd.dot(this._tmp2) < -0.15;
  }

  /* --- ataque ------------------------------------------------------- */
  _sAttack(dt, cmd, ctx) {
    const m = this.move;
    const f = this.stateFrame;
    const total = m.startup + m.active + m.recovery;

    // Homing e avanço acontecem no startup: é o que faz o soco ACERTAR num
    // jogo aéreo. Sem isso, o combo erra e a culpa parece ser do jogador.
    if (f <= m.startup) this._applyHoming(dt, m, ctx);

    if (m.advanceFrames && f >= m.advanceFrames[0] && f <= m.advanceFrames[1]) {
      const fwd = this._tmp.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
      this.velocity.addScaledVector(fwd, m.advanceSpeed * 60 * dt);
    }

    // Cancelar pro próximo elo do combo.
    if (m.cancelWindow && f >= m.cancelWindow[0] && f <= m.cancelWindow[1]) {
      if (cmd.smash) {
        const key = this._smashKey(cmd.smashDir);
        if (m.cancelInto.includes(key) && this._tryAttack(key, ctx)) return;
      }
      if (cmd.rush) {
        const next = m.cancelInto.find((k) => k.startsWith('rush'));
        if (next && this._tryAttack(next, ctx)) return;
      }
    }

    if (f >= total) {
      this._enter(S.IDLE);
      this.char.play('idle', { fade: 0.14 });
    }
  }

  /* --- guarda ------------------------------------------------------- */
  _sGuard(dt, cmd, ctx) {
    if (!cmd.guard) { this._enter(S.IDLE); this.char.play('idle', { fade: 0.1 }); return; }

    const moving = Math.abs(cmd.moveX) > 0.3 || Math.abs(cmd.moveY) > 0.3;
    if (moving && this.stepCooldown === 0) { this._enterStep(cmd, ctx); return; }

    // Guardando ainda dá pra se reposicionar, mas devagar.
    this._applyFlightInput(dt, cmd, ctx, 0.35);
    this._faceTarget(dt, 1.6);
    this.char.play('block', { fade: 0.08 });
  }

  /* --- step (esquiva curta) ----------------------------------------- */
  _enterStep(cmd, ctx) {
    const st = TUNING.defense.step;
    this._enter(S.STEP);
    this.char.play('dodge', { fade: 0.06, restart: true });

    // Direção do step: relativa à câmera, como o movimento.
    const basis = ctx.moveBasis;
    this._desired.set(0, 0, 0)
      .addScaledVector(basis.right, cmd.moveX)
      .addScaledVector(basis.forward, cmd.moveY);
    if (this._desired.lengthSq() < 1e-6) {
      this._desired.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)).negate();
    }
    this._desired.normalize();
    this.stepCooldown = st.totalFrames + st.cooldownFrames;
    this.events.push({ type: 'step' });
  }

  _sStep(dt, cmd, ctx) {
    const st = TUNING.defense.step;
    const f = this.stateFrame;

    this.invulnFrames = (f >= st.iframes[0] && f <= st.iframes[1]) ? 2 : this.invulnFrames;

    // Perfil de velocidade: sai rápido, freia no fim.
    const k = f / st.totalFrames;
    const speed = sampleCurve(st.speedCurve, k) * (st.distance / (st.totalFrames / 60));
    this.velocity.copy(this._desired).multiplyScalar(speed);

    this._faceTarget(dt, 1.2);

    if (f >= st.totalFrames) { this._enter(S.IDLE); this.char.play('idle', { fade: 0.12 }); }
  }

  /* --- carregar ki --------------------------------------------------- */
  _sCharge(dt, cmd, ctx) {
    if (!cmd.charge) { this._enter(S.IDLE); this.char.play('idle', { fade: 0.14 }); return; }

    if (this.stateFrame > TUNING.ki.chargeStartupFrames) {
      this.ki = Math.min(TUNING.ki.max, this.ki + TUNING.ki.chargeRatePerSec * dt);
    }

    // Parado e vulnerável — é o trade do Tenkaichi.
    this.velocity.multiplyScalar(Math.exp(-8 * dt));
    this._faceTarget(dt, 2.5);
    this.char.play('charge', { fade: 0.12 });

    if (this.stateFrame % 4 === 0) this.events.push({ type: 'chargePulse' });
  }

  /* --- vanish --------------------------------------------------------- */
  _sVanish(dt, cmd, ctx) {
    const V = TUNING.defense.vanish;
    this.velocity.multiplyScalar(Math.exp(-14 * dt));
    if (this.stateFrame >= V.recoveryFrames) {
      this._enter(S.IDLE);
      this.char.play('idle', { fade: 0.1 });
    }
  }

  /** Executa o vanish. Chamado pela resolução de acerto, não pelo estado. */
  doVanish(attacker, ctx) {
    const V = TUNING.defense.vanish;

    const cost = V.kiCost * Math.pow(V.chainKiMultiplier, this.vanishChain);
    if (this.ki < cost || this.vanishChain >= V.maxChain) return false;

    this.ki -= cost;
    this.vanishChain++;
    this.vanishChainTimer = 120;

    // Reaparece ATRÁS do atacante — a recompensa posicional que faz a
    // mecânica valer o ki gasto.
    const behind = this._tmp.set(Math.sin(attacker.yaw), 0, Math.cos(attacker.yaw))
      .multiplyScalar(-V.reappearDistance);
    this.position.copy(attacker.position).add(behind);
    this.position.y = attacker.position.y + 0.1;

    this.velocity.set(0, 0, 0);
    this.yaw = attacker.yaw;          // já olhando pras costas dele
    this.invulnFrames = V.startupFrames + V.recoveryFrames;

    this._enter(S.VANISH);
    this.char.play('dodge', { fade: 0.02, restart: true });
    this.events.push({ type: 'vanish', attacker });
    return true;
  }

  /* --- blast ---------------------------------------------------------- */
  _tryBlast(ctx) {
    const B = TUNING.blasts.ki_blast;
    if (this.blastCooldown > 0 || this.ki < B.kiCost) return false;
    this._enter(S.BLAST);
    this.chargeFrames = 0;
    this.char.play('blast', { fade: 0.08, restart: true });
    return true;
  }

  _sBlast(dt, cmd, ctx) {
    const B = TUNING.blasts.ki_blast;
    const C = TUNING.blasts.charged_blast;
    const f = this.stateFrame;

    this._faceTarget(dt, 2.0);
    this.velocity.multiplyScalar(Math.exp(-6 * dt));

    // Segurar o botão carrega; soltar dispara.
    if (cmd.blastHeld && f >= B.startup) {
      this.chargeFrames++;
      if (this.chargeFrames % 3 === 0) this.events.push({ type: 'blastCharging' });
      if (this.chargeFrames < C.maxChargeFrames) return;
    }

    if (f === B.startup || (!cmd.blastHeld && f > B.startup) || this.chargeFrames >= C.maxChargeFrames) {
      const charged = this.chargeFrames >= C.minChargeFrames;
      const spec = charged ? C : B;

      if (this.ki >= spec.kiCost) {
        this.ki -= spec.kiCost;
        const t = charged
          ? Math.min(1, (this.chargeFrames - C.minChargeFrames) / (C.maxChargeFrames - C.minChargeFrames))
          : 0;
        this.events.push({ type: 'fireBlast', charged, chargeT: t });
      }

      this.blastCooldown = spec.recovery;
      this._enter(S.IDLE);
      this.char.play('idle', { fade: 0.12 });
    }
  }

  /* --- ultimate -------------------------------------------------------- */
  _tryUltimate(ctx) {
    const U = TUNING.blasts.ultimate;
    if (this.ki < U.kiCost) return false;
    this.ki -= U.kiCost;
    this._enter(S.ULTIMATE);
    this.char.play('ultimate', { fade: 0.14, restart: true });
    this.events.push({ type: 'ultimateStart' });
    return true;
  }

  _sUltimate(dt, cmd, ctx) {
    const U = TUNING.blasts.ultimate;
    const f = this.stateFrame;

    this.velocity.multiplyScalar(Math.exp(-10 * dt));
    if (f < U.startup) this._faceTarget(dt, 3.0);

    if (f === U.startup) this.events.push({ type: 'ultimateFire' });
    if (f > U.startup && f < U.startup + U.durationFrames) {
      this.events.push({ type: 'ultimateBeam', frame: f - U.startup });
      this._faceTarget(dt, 0.5);
    }
    if (f >= U.startup + U.durationFrames + U.recovery) {
      this._enter(S.IDLE);
      this.char.play('idle', { fade: 0.2 });
    }
  }

  /* --- levando dano ---------------------------------------------------- */
  _sHitstun(dt, cmd, ctx) {
    this.velocity.multiplyScalar(Math.exp(-TUNING.physics.knockbackDecay * dt));
    if (this.stateFrame >= this._stunFrames) {
      this._enter(S.IDLE);
      this.char.play('idle', { fade: 0.14 });
    }
  }

  _sBlowaway(dt, cmd, ctx) {
    const B = TUNING.blowaway;
    const f = this.stateFrame;

    // Recuperação aérea: aperta guarda/vanish e estabiliza. Sem isso, levar um
    // smash seria sentença — com isso, vira leitura.
    if (f > TUNING.defense.recover.windowAfterFrames
        && (cmd.guard || cmd.vanish)
        && this.ki >= TUNING.defense.recover.kiCost) {
      this.ki -= TUNING.defense.recover.kiCost;
      this._enter(S.RECOVER);
      this.invulnFrames = TUNING.defense.recover.iframes[1];
      this.char.play('dodge', { fade: 0.06, restart: true });
      this.events.push({ type: 'airRecover' });
      return;
    }

    this.velocity.multiplyScalar(Math.exp(-B.drag * dt));

    // Gravidade PARCIAL: o corpo voa quase reto e vai cedendo. Gravidade cheia
    // faria o smash virar um arco curto e sem graça; zero faria o corpo sair da
    // arena pelo horizonte, reto, pra sempre.
    this.velocity.y -= TUNING.physics.gravity * 0.45 * dt;

    /* Estouro de tempo: FREIA, não devolve o controle.
     *
     * Antes, `f > maxFrames` chutava direto pra IDLE. O resultado era devolver
     * o controle com o corpo ainda voando a ~8 m/s: o jogador não conseguia se
     * mover (a inércia comia o input) mas JÁ PODIA ATACAR. Na prática parecia
     * que dava pra socar estando desmaiado — que foi exatamente o sintoma
     * relatado. A saída tem que ser por VELOCIDADE; o tempo só aperta o freio. */
    if (f > B.maxFrames) this.velocity.multiplyScalar(Math.exp(-B.overtimeBrake * dt));

    this.char.play('launched', { fade: 0.1 });

    // Rede de segurança absoluta, pra nunca travar no estado.
    const hardCap = f > B.maxFrames + B.overtimeMaxFrames;

    if (this.velocity.length() < B.minSpeedToExit || hardCap) {
      if (hardCap) this.velocity.multiplyScalar(0.2);
      this._enter(S.IDLE);
      this.char.play('idle', { fade: 0.2 });
    }
  }

  _sKnockdown(dt, cmd, ctx) {
    this.velocity.multiplyScalar(Math.exp(-10 * dt));
    // Levantar antecipado: apertar guarda tira do chão mais cedo.
    const early = cmd.guard && this.stateFrame > 10;
    if (early || this.stateFrame >= TUNING.knockdown.groundFrames) {
      this._enter(S.GETUP);
      this.char.play('getup', { fade: 0.1, restart: true });
    }
  }

  _sGetup(dt, cmd, ctx) {
    const K = TUNING.knockdown;
    if (this.stateFrame >= K.getupIframes[0] && this.stateFrame <= K.getupIframes[1]) {
      this.invulnFrames = Math.max(this.invulnFrames, 2);
    }
    this.velocity.multiplyScalar(Math.exp(-12 * dt));
    if (this.stateFrame >= K.getupFrames) {
      this._enter(S.IDLE);
      this.char.play('idle', { fade: 0.16 });
    }
  }

  _sRecover(dt, cmd, ctx) {
    const R = TUNING.defense.recover;
    this.velocity.multiplyScalar(Math.exp(-11 * dt));
    this._faceTarget(dt, 2.0);
    if (this.stateFrame >= R.frames) { this._enter(S.IDLE); this.char.play('idle', { fade: 0.12 }); }
  }

  /* ================================================================== */
  /*  Ações                                                              */
  /* ================================================================== */
  _smashKey(dir) {
    if (dir === 'up') return 'smash_up';
    if (dir === 'down') return 'smash_down';
    return 'smash_forward';
  }

  _tryAttack(key, ctx) {
    const m = TUNING.moves[key];
    if (!m) return false;

    this.move = m;
    this.moveKey = key;
    this.hitThisMove.clear();
    this._enter(S.ATTACK);
    this.char.play(m.clip, { fade: 0.05, restart: true });

    if (m.trail && this.trail) this.trail.start();
    this.events.push({ type: 'attackStart', key, move: m });
    return true;
  }

  /**
   * Puxa o atacante até o alvo durante o startup do golpe.
   *
   * Isto NÃO é um detalhe de polimento — é o que faz o combo existir. Num jogo
   * aéreo, os dois lutadores nunca estão na distância exata do soco, e sem
   * homing a maioria dos golpes passa perto sem tocar. No primeiro teste, os
   * dois primeiros elos do combo erravam sempre a 2.4 m de distância.
   *
   * A regra: fechar a MAIOR PARTE da distância durante o startup, de forma que
   * no primeiro frame ativo o punho já esteja no alcance. O fechamento é
   * exponencial (não linear) pra parecer atração, não teleporte.
   */
  _applyHoming(dt, m, ctx) {
    // Sem lock, o golpe sai onde você está mirando — sem puxão. É o custo de
    // soltar o lock, e é o que mantém o lock valendo a pena.
    if (!this.lockOn || !m.homingRange || !this.target || !this.target.alive) {
      this._faceTarget(dt, 1.6);
      return;
    }

    this._tmp.subVectors(this.target.position, this.position);
    const dist = this._tmp.length();

    // Fora de alcance: só encara, não puxa. Homing de longe seria teleporte.
    if (dist > m.homingRange || dist < 1e-4) { this._faceTarget(dt, 1.6); return; }

    // Distância ideal: encostado, mas não dentro do outro.
    const ideal = TUNING.fighter.radius * 2 + 0.3;
    const gap = dist - ideal;

    if (gap > 0) {
      this._tmp.divideScalar(dist);
      // 30 é calibrado pra fechar ~80% da distância nos ~4 frames de startup
      // de um rush. Menos que isso e o primeiro soco do combo erra.
      const k = 1 - Math.exp(-m.homingStrength * 30 * dt);
      this.position.addScaledVector(this._tmp, gap * k);
    }

    this._faceTarget(dt, 4.0);
  }

  _faceTarget(dt, mul = 1) {
    // Sem lock: encara pra onde está indo. Se estiver parado, mantém o rumo —
    // voltar pro alvo aqui anularia o propósito de ter soltado o lock.
    if (!this.lockOn) {
      const v = this._tmp2.copy(this.velocity).setY(0);
      if (v.lengthSq() < 0.5) return;
      const want = Math.atan2(v.x, v.z);
      const k = 1 - Math.exp(-TUNING.flight.turnSpeed * mul * dt);
      this.yaw = angleLerp(this.yaw, want, k);
      return;
    }

    if (!this.target || !this.target.alive) return;
    this._tmp.subVectors(this.target.position, this.position);
    if (this._tmp.lengthSq() < 1e-6) return;
    const want = Math.atan2(this._tmp.x, this._tmp.z);
    const k = 1 - Math.exp(-TUNING.flight.turnSpeed * mul * dt);
    this.yaw = angleLerp(this.yaw, want, k);
  }

  _applyFlightInput(dt, cmd, ctx, mul = 1) {
    const F = TUNING.flight;
    const basis = ctx.moveBasis;

    let speed = cmd.dash ? F.boostSpeed : F.baseSpeed;
    if (cmd.moveY < 0) speed *= F.backMul;
    else if (Math.abs(cmd.moveX) > 0.5) speed *= F.strafeMul;
    speed *= mul;

    this._desired.set(0, 0, 0)
      .addScaledVector(basis.right, cmd.moveX)
      .addScaledVector(basis.forward, cmd.moveY);

    const mag = Math.min(1, this._desired.length());
    if (mag > 1e-4) this._desired.normalize().multiplyScalar(speed * mag);

    this._desired.y = cmd.vertical * F.verticalSpeed * mul;

    const rate = mag > 0.01 || Math.abs(cmd.vertical) > 0.01 ? F.accel : F.decel;
    const k = 1 - Math.exp(-rate / Math.max(speed, 1) * 6 * dt);
    this.velocity.lerp(this._desired, k);
  }

  /* ================================================================== */
  /*  Recebendo dano                                                     */
  /* ================================================================== */
  /**
   * Aplica um acerto. Chamado por combat/resolve.js.
   * @returns {string} 'hit' | 'guard' | 'guardbreak'
   */
  applyHit({ move, attacker, direction, guarded, ctx }) {
    let damage = move.damage;
    let knockback = move.knockback;
    let knockup = move.knockup || 0;
    let result = 'hit';

    if (guarded) {
      const G = TUNING.defense.guard;
      if (move.guardBreak) {
        result = 'guardbreak';
        this._stunFrames = G.guardBreakStunFrames;
        this.guardStamina = 0;
      } else {
        result = 'guard';
        damage = move.chipDamage ?? damage * (1 - G.damageReduction);
        knockback *= (1 - G.knockbackReduction);
        knockup *= (1 - G.knockbackReduction);
        this.ki = Math.max(0, this.ki - G.kiPerHit);
        this._stunFrames = move.blockstun;
        this.char.play('block_impact', { fade: 0.04, restart: true });
      }
    }

    this.health = Math.max(0, this.health - damage);
    this.poise -= move.poiseDamage || 0;
    this.flashFrames = TUNING.juice.impactFlashFrames;

    // --- knockback ---
    this._tmp.copy(direction).setY(0);
    if (this._tmp.lengthSq() < 1e-6) this._tmp.set(Math.sin(attacker.yaw), 0, Math.cos(attacker.yaw));
    this._tmp.normalize();

    this.velocity.copy(this._tmp).multiplyScalar(knockback);
    this.velocity.y += knockup;

    // --- estado resultante ---
    if (this.health <= 0) {
      this._enterBlowaway(move);
    } else if (result === 'guard') {
      this._enter(S.GUARD, false);
      this.stateFrame = 0;
    } else if (move.causesBlowaway || result === 'guardbreak' || this.poise <= 0) {
      if (this.poise <= 0) this.poise = TUNING.fighter.maxPoise;
      this._enterBlowaway(move);
    } else {
      this._enter(S.HITSTUN);
      this._stunFrames = move.hitstun;
      this.char.play('hit_react', { fade: 0.04, restart: true });
    }

    // Levar dano zera a cadeia de vanish — senão dava pra vanishar pra sempre.
    this.vanishChain = 0;
    this.events.push({ type: 'damaged', result, damage, attacker });
    return result;
  }

  _enterBlowaway(move) {
    this._enter(S.BLOWAWAY);
    this.char.play('launched', { fade: 0.06, restart: true });
    if (this.trail) this.trail.stop();
  }

  /* ================================================================== */
  /*  Física                                                             */
  /* ================================================================== */
  _integrate(dt, ctx) {
    this.position.addScaledVector(this.velocity, dt);

    const F = TUNING.flight;
    const floorY = TUNING.arena.floorY;

    // Chão: só importa nos estados em que o corpo "cai".
    const falling = this.state === S.BLOWAWAY || this.state === S.KNOCKDOWN;

    if (this.position.y < floorY + F.minY) {
      if (falling && this.velocity.y < -TUNING.blowaway.minSpeedToExit) {
        // Quica e abre cratera.
        this.position.y = floorY + F.minY;
        this.velocity.y = -this.velocity.y * TUNING.blowaway.groundBounceRestitution;
        this.velocity.x *= 0.55;
        this.velocity.z *= 0.55;
        this.health = Math.max(0, this.health - TUNING.blowaway.groundBounceDamage);
        this.events.push({ type: 'groundSlam', speed: Math.abs(this.velocity.y) });
        if (Math.abs(this.velocity.y) < 4) {
          this._enter(S.KNOCKDOWN);
          this.char.play('knockdown', { fade: 0.06, restart: true });
        }
      } else {
        this.position.y = floorY + F.minY;
        if (this.velocity.y < 0) this.velocity.y = 0;
      }
    }

    if (this.position.y > F.maxY) {
      this.position.y = F.maxY;
      if (this.velocity.y > 0) this.velocity.y = 0;
    }

    const maxV = TUNING.physics.maxFlightSpeed;
    if (this.velocity.lengthSq() > maxV * maxV) this.velocity.setLength(maxV);
  }

  /* ================================================================== */
  /*  Visual                                                             */
  /* ================================================================== */
  _updateVisuals(dt, ctx) {
    // --- aura ---
    if (this.aura) {
      let intensity = 0;
      if (this.state === S.CHARGE) intensity = TUNING.juice.auraChargeMultiplier;
      else if (this.state === S.DASH) intensity = 1.2;
      else if (this.state === S.ULTIMATE) intensity = 2.0;
      else if (this.velocity.length() > TUNING.flight.baseSpeed * 0.8) intensity = 0.55;
      else intensity = 0.22;

      // Ki baixo apaga a aura — leitura visual grátis do recurso.
      intensity *= 0.35 + 0.65 * (this.ki / TUNING.ki.max);
      this.aura.set(intensity);
    }

    // --- clarão de impacto ---
    if (this.char.setFlash) {
      const k = this.flashFrames / Math.max(1, TUNING.juice.impactFlashFrames);
      this.char.setFlash(k * 0.9);
    }

    // --- afterimages em alta velocidade ---
    const speed = this.velocity.length();
    if (speed > TUNING.juice.speedLinesThreshold * 0.8) {
      this._afterimageTick++;
      if (this._afterimageTick >= TUNING.juice.afterimageInterval) {
        this._afterimageTick = 0;
        this.events.push({ type: 'afterimage' });
      }
    } else {
      this._afterimageTick = 0;
    }

    // --- rastro do punho ---
    if (this.trail && this.state !== S.ATTACK) this.trail.stop();
  }

  /* ================================================================== */
  /*  Utilidades                                                         */
  /* ================================================================== */
  _enter(state, resetFrame = true) {
    if (this.state === state && !resetFrame) return;
    if (this.state !== state) {
      this.state = state;
      this.stateFrame = 0;
      if (state !== S.ATTACK) { this.move = null; this.moveKey = null; }
    } else if (resetFrame) {
      this.stateFrame = 0;
    }
  }

  /** Posição do centro de massa (alvo de hitbox e de câmera). */
  center(out = new THREE.Vector3()) {
    return out.copy(this.position).setY(this.position.y + TUNING.fighter.height * 0.5);
  }

  eliminate(cause) {
    if (this.eliminated) return;
    this.eliminated = true;
    this.alive = false;
    this.ringOutCause = cause;
    this.events.push({ type: 'eliminated', cause });
  }

  reset(spawn) {
    this.position.copy(spawn);
    this.velocity.set(0, 0, 0);
    this.health = TUNING.fighter.maxHealth;
    this.ki = TUNING.ki.max * TUNING.ki.startPercent;
    this.poise = TUNING.fighter.maxPoise;
    this.state = S.IDLE;
    this.stateFrame = 0;
    this.move = null;
    this.moveKey = null;
    this.hitThisMove.clear();
    this.vanishChain = 0;
    this.stepCooldown = 0;
    this.blastCooldown = 0;
    this.invulnFrames = 0;
    this.flashFrames = 0;
    this.outOfBoundsFrames = 0;
    this.dashFrames = 0;
    this.dashHits.clear();
    this.dashCooldown = 0;
    this.dashBlocked = false;
    this.vanishPressFrame = 999;
    this.lockOn = true;
    this.alive = true;
    this.eliminated = false;
    this.ringOutCause = null;
    this.events.length = 0;
    if (this.trail) this.trail.stop();
    this.char.play('idle', { fade: 0 });
  }
}

/* ========================================================================== */
function angleLerp(a, b, t) {
  let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

/** Amostra uma curva definida por pontos igualmente espaçados. */
function sampleCurve(curve, t) {
  t = Math.max(0, Math.min(1, t));
  const n = curve.length - 1;
  const x = t * n;
  const i = Math.min(Math.floor(x), n - 1);
  const f = x - i;
  return curve[i] + (curve[i + 1] - curve[i]) * f;
}
