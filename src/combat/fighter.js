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
import {
  moveOf, rushKeyFor, smashKeyFor,
  pursuitTypeFor, pursuitSpec, moveCharge, moveGuardDamage,
  moveTotalFrames, defenseWorks,
} from './moves.js';

export const S = {
  IDLE: 'idle',
  MOVE: 'move',
  DASH: 'dash',
  APPROACH: 'approach',   // voando até o alvo pra emendar o combo
  PURSUIT: 'pursuit',     // perseguindo quem você acabou de lançar
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

  /* --- estados novos ---------------------------------------------------
   *
   * GRAB / GRABBED / THROW são três porque a pegada é uma INTERAÇÃO entre dois
   * corpos, não um golpe. Quem agarra e quem é agarrado precisam de estados
   * distintos: o primeiro está esperando o relógio do arremesso, o segundo está
   * numa janela de escape. Um estado só não conseguiria descrever os dois lados.
   *
   * MAXPOWER é só o CLARÃO DE ENTRADA, não o estado de poder. O poder em si é um
   * timer (`maxPowerFrames`), porque a graça dele é lutar estando nele — se
   * fosse um estado, o lutador estaria "ocupado" e não poderia atacar, que é o
   * oposto do que se quer. */
  GRAB: 'grab',           // agarrando: segurando a vítima até o arremesso
  GRABBED: 'grabbed',     // agarrado: janela de escape correndo
  THROW: 'throw',         // arremessando
  MAXPOWER: 'maxpower',   // clarão de entrada no Max Power (invulnerável)
};

/** Command neutro — a "forma" que todo controlador precisa devolver. */
export function emptyCommand() {
  return {
    moveX: 0, moveY: 0, vertical: 0,
    rush: false, smash: false, blast: false, blastHeld: false,
    guard: false, vanish: false, dash: false, charge: false, ultimate: false,
    /* `smash` vem do BUFFER de input (vale ~10 frames depois do toque);
     * `smashHeld` é o botão de fato apertado AGORA. A carga do smash precisa do
     * segundo: com o primeiro, todo toque carregaria dez frames sozinho e a
     * janela do Perfect Smash sairia por acidente. */
    smashHeld: false,
    /* GRAB é um campo PRÓPRIO, e não "guarda + rush" deduzido dentro do
     * Fighter. A entrada do jogador é F+J, mas essa tradução mora em quem
     * produz o command — porque a IA aperta guarda e rush por motivos
     * independentes, e se o Fighter deduzisse, ela agarraria por acidente todas
     * as vezes que decidisse bloquear e revidar no mesmo frame. */
    grab: false,
    // direção do smash: 'forward' | 'up' | 'down'
    smashDir: 'forward',
  };
}

const UP = new THREE.Vector3(0, 1, 0);

/* Vetores de rascunho EXCLUSIVOS de _facing(). Ver o comentário lá: enquanto
 * ele emprestava os `_tmp` do lutador, sobrescrevia a direção do knockback que
 * já tinha sido passada por referência pro applyHit. */
const _faceA = new THREE.Vector3();
const _faceB = new THREE.Vector3();

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
    this.poise = this.maxPoise;

    this.state = S.IDLE;
    this.stateFrame = 0;

    this.move = null;            // definição do golpe atual (de TUNING.moves)
    this.moveKey = null;
    this.comboKey = null;        // próximo elo possível
    this.hitThisMove = new Set();
    /* Separados porque BLOQUEAR e ACERTAR liberam coisas diferentes agora.
     * `hitThisMove` só diz "encostou em alguém"; quem decide se o combo pode
     * emendar é o tipo de contato. Ver `contactAllowsChain`. */
    this.hitConfirmThisMove = false;    // acerto limpo (ou guarda quebrada)
    this.blockConfirmThisMove = false;  // o adversário aparou

    this.guardStamina = this.maxGuardStamina;
    this._guardRegenDelay = 0;
    /* Frames travado depois de aparar um golpe. Existia como `blockstun` no
     * tuning desde o primeiro dia, era escrito em `_stunFrames` e NUNCA era
     * lido — porque `_stunFrames` só é consultado em `_sHitstun`, e quem
     * bloqueia vai pro estado GUARD. Blockstun simplesmente não existia. */
    this.blockstunFrames = 0;
    this.vanishCooldown = 0;
    /* Quantos frames desde que a guarda foi apertada. Só o TIMING rebate um
     * ki blast; segurar guarda absorve. Ver defense.guard.deflectWindowFrames. */
    this.guardPressFrame = 999;
    this._guardWasHeld = false;

    /* Z-COUNTER: o toque de guarda ARMA o contador, e só um a cada
     * `attemptCooldownFrames`. Separado de `guardPressFrame` (que serve ao
     * rebate de blast) de propósito — se martelar a guarda armasse o contador
     * a cada edge, F viraria o novo botão dominante. */
    this.counterArm = 999;
    this.counterCooldown = 0;
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
    this.comboCount = 0;         // elos da rota atual (teto em combo.maxChain)
    this.chainResetTimer = 0;    // enquanto corre, a rota ainda é a mesma

    /* JANELA DE PERSEGUIÇÃO. Aberta quando VOCÊ lança alguém; enquanto correr,
     * o dash vira perseguição em vez de locomoção. É a segunda disputa. */
    this.pursuitFrames = 0;
    this.pursuitTarget = null;
    this._pursuitCarry = 0;
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

    /* Modificadores de BONECO DE TREINO. Vivem no Fighter (e não numa
     * subclasse) porque o boneco tem que ser o mesmo lutador, com a mesma
     * máquina de estados — a reação dele É a informação que o jogador lê.
     * Ver TUNING.training e o ciclo da tecla T. */
    this.noReaction = false;   // toma dano sem sair do lugar (ler hitbox/timing)
    this.autoRecover = false;  // recupera do blowaway assim que puder (ler perseguição)
    this.immortal = false;     // vida nunca chega a zero

    /* ================================================================== */
    /*  SMASH CARREGADO  (§7, §8)                                          */
    /* ================================================================== */
    /* `chargeFrames` já existia e é do BLAST. Estes são do smash, separados de
     * propósito: carregar um blast e carregar um smash são coisas diferentes e
     * compartilhar o contador faria um vazar no outro. */
    this.smashChargeFrames = 0;
    this.smashHolding = false;
    this.smashPerfect = false;       // o último smash saiu na janela?
    this._smashTelegraphed = false;  // já avisei que a janela abriu?

    /* ================================================================== */
    /*  GRAB  (§17)                                                        */
    /* ================================================================== */
    this.grabbing = null;       // a vítima que EU estou segurando
    this.grabbedBy = null;      // quem está me segurando
    this.grabHold = 0;          // frames restantes até o arremesso
    this.grabCooldown = 0;

    /* ================================================================== */
    /*  VANISH BATTLE  (§12)                                               */
    /* ================================================================== */
    /* Quando alguém vanisha o MEU golpe, eu ganho uma janela pra contra-vanishar.
     * Fica no Fighter (e não num objeto global de "batalha em andamento") porque
     * o §31 pede que a simulação seja sincronizável: estado de duelo guardado
     * fora dos participantes é exatamente o que não se consegue replicar. */
    this.counterVanishFrames = 0;
    this.counterVanishFoe = null;
    this.vanishExchange = 0;

    /* ================================================================== */
    /*  KI: MAX POWER E EXAUSTÃO  (§18, §19)                               */
    /* ================================================================== */
    this.maxPowerFrames = 0;    // > 0 = está em Max Power
    this._maxPowerCharge = 0;   // frames carregando ACIMA do limiar de entrada
    this.exhaustFrames = 0;     // > 0 = sem nenhuma ferramenta de ki

    /* Prioridade/armor: quanto poise o golpe atual já absorveu sem quebrar. */
    this._armorAbsorbed = 0;
    this.tradeLostFrames = 0;

    /* Tipo da perseguição em curso — a telemetria precisa mostrar QUAL saiu. */
    this.pursuitType = 'direct';
    this._pursuitSpec = null;
    /* Alvo da fase de ACOMPANHAMENTO, separado de `pursuitTarget` de propósito.
     * Ver a nota longa em `_sPursuit`: compartilhar os dois fazia o alcance
     * durar um frame. */
    this._carryTarget = null;

    // preenchidos pelo jogo
    this.target = null;
    this.aura = null;
    this.trail = null;

    this._afterimageTick = 0;
    this._homingPulled = 0;
    this._bobT = 0;
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
    return this.state === S.ATTACK || this.state === S.APPROACH || this.state === S.PURSUIT
        || this.state === S.HITSTUN
        || this.state === S.BLOWAWAY || this.state === S.KNOCKDOWN
        || this.state === S.GETUP || this.state === S.VANISH
        || this.state === S.BLAST || this.state === S.ULTIMATE
        || this.state === S.STEP || this.state === S.RECOVER
        || this.state === S.GRAB || this.state === S.GRABBED
        || this.state === S.THROW || this.state === S.MAXPOWER;
    }

  get canAct() {
    return this.alive && !this.busy;
  }

  /* ---- tetos ------------------------------------------------------- */
  /* Getters e não campos copiados no construtor: os sliders do painel mexem em
   * `TUNING.fighter.maxPoise` e `combo.maxChain` ao vivo, e um valor congelado
   * ignoraria o slider. */
  get maxPoise() { return TUNING.fighter.maxPoise; }
  get maxGuardStamina() { return TUNING.defense.guard.maxStamina; }
  get maxChain() { return TUNING.combo.maxChain; }

  /* ---- Max Power e exaustão (§18, §19) ----------------------------- */
  get inMaxPower() { return this.maxPowerFrames > 0; }
  get exhausted() { return this.exhaustFrames > 0; }

  /** Multiplicador de dano de saída. É por aqui que o Max Power dói mais. */
  get damageMul() { return this.inMaxPower ? TUNING.maxPower.damageMul : 1; }

  /**
   * Custo efetivo de ki de uma ação.
   *
   * Centralizar isto é o que faz o Max Power valer a pena sem inflar dano: em
   * Max Power TODAS as ferramentas (dash, vanish, perseguição, blast) ficam 35%
   * mais baratas de uma vez. Um multiplicador num lugar em vez de seis números
   * duplicados.
   */
  kiCost(base) {
    return base * (this.inMaxPower ? TUNING.maxPower.kiCostMul : 1);
  }

  /**
   * Consegue pagar isto?
   *
   * Durante a EXAUSTÃO a resposta é sempre não, independente da barra. É o que
   * transforma zerar o ki num evento com consequência em vez de um número baixo:
   * você fica com voo, rush, smash e guarda, e tem que sobreviver com isso.
   */
  canSpend(base) {
    if (this.exhausted) return false;
    return this.ki >= this.kiCost(base);
  }

  /** Paga, e cai na exaustão se isto zerou a barra. */
  spendKi(base) {
    const custo = this.kiCost(base);
    if (this.exhausted || this.ki < custo) return false;
    this.ki -= custo;
    if (this.ki <= 0.001) this._enterExhaustion();
    return true;
  }

  get invulnerable() { return this.invulnFrames > 0; }

  get guarding() { return this.state === S.GUARD; }

  /**
   * Este golpe já encostou de um jeito que LIBERA a emenda?
   *
   * Acerto sempre libera. Bloqueio só libera se `combo.cancelOnBlock` estiver
   * ligado — e está desligado, porque é isso que devolve o turno a quem
   * defende. A IA usa a MESMA consulta pra medir a brecha do adversário: ela
   * precisa saber se ele pode cancelar, senão pune na hora errada.
   */
  get contactAllowsChain() {
    if (!TUNING.combo.cancelOnlyOnContact) return true;
    if (this.hitConfirmThisMove) return true;
    return TUNING.combo.cancelOnBlock && this.blockConfirmThisMove;
  }

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

    /* Janela de vanish: guardamos há quantos frames o botão foi apertado.
     *
     * E quando o toque EXPIRA sem que nenhum golpe tenha chegado, cobra-se o
     * preço do chute. Sem isso, apertar V no vazio é grátis e martelar V bate
     * qualquer leitura — a mecânica assinatura vira botão de pânico. */
    /* EXCEÇÃO: durante a janela de perseguição com o dash apertado, o V não é
     * um vanish — é o MODIFICADOR que escolhe a perseguição de vanish (§10).
     *
     * Medido no navegador: sem esta exceção, Shift+V cobrava o custo da
     * perseguição (12) MAIS a multa de vanish desperdiçado (7) e um cooldown de
     * 22 frames, porque `update()` registrava o toque como uma tentativa de
     * vanish que nunca ia encontrar golpe nenhum. 18,2 de ki para uma ação que
     * devia custar 26 — e o jogador ficava sem vanish defensivo depois, sem
     * entender por quê. Botão com dois significados precisa que o SEGUNDO
     * significado desarme o primeiro. */
    const vAsModificador = cmd.dash && this.pursuitFrames > 0;

    if (cmd.vanish && !vAsModificador && this.vanishCooldown === 0) {
      this.vanishPressFrame = 0;
    } else if (this.vanishPressFrame < 999) {
      this.vanishPressFrame++;
      const V = TUNING.defense.vanish;
      // Nenhum golpe tem janela maior que a do smash: passou disso, foi chute.
      if (this.vanishPressFrame === V.maxUsefulWindow) {
        this.vanishPressFrame = 999;
        this.ki = Math.max(0, this.ki - V.whiffKiCost);
        this.vanishCooldown = V.whiffCooldownFrames;
        this.events.push({ type: 'vanishWhiff' });
      }
    }

    // --- timers ---
    /* Relógio da ROTA. Enquanto correr, o combo continua sendo o MESMO combo,
     * mesmo que você tenha voltado pra IDLE entre um golpe e outro. É o que
     * transforma "quem segura a cadeia" em "quem ganha a próxima troca". */
    if (this.chainResetTimer > 0) {
      this.chainResetTimer--;
      if (this.chainResetTimer === 0 && this.state !== S.ATTACK) this.comboCount = 0;
    }
    if (this.vanishCooldown > 0) this.vanishCooldown--;
    if (this.pursuitFrames > 0) {
      this.pursuitFrames--;
      // Alvo se recuperou ou morreu: não há mais o que perseguir.
      if (!this.pursuitTarget || !this.pursuitTarget.alive
          || this.pursuitTarget.state !== S.BLOWAWAY) this.pursuitFrames = 0;
      if (this.pursuitFrames === 0) this.pursuitTarget = null;
    }
    if (this.blockstunFrames > 0) this.blockstunFrames--;
    if (this._guardRegenDelay > 0) this._guardRegenDelay--;

    // Timing da guarda — só o TOQUE recente rebate projétil (segurar absorve).
    const tocouGuarda = cmd.guard && !this._guardWasHeld;
    if (tocouGuarda) this.guardPressFrame = 0;
    else if (this.guardPressFrame < 999) this.guardPressFrame++;

    /* Z-Counter: um toque arma UMA tentativa; depois trava por um tempo.
     * O cooldown é o ÚNICO freio contra martelada aqui — ver a nota longa em
     * `zCounter` no tuning sobre a multa que foi tentada e revertida. */
    if (this.counterCooldown > 0) this.counterCooldown--;
    if (tocouGuarda && this.counterCooldown === 0) {
      this.counterArm = 0;
      this.counterCooldown = TUNING.defense.zCounter.attemptCooldownFrames;
    } else if (this.counterArm < 999) {
      this.counterArm++;
    }
    this._guardWasHeld = !!cmd.guard;

    if (this.stepCooldown > 0) this.stepCooldown--;
    if (this.blastCooldown > 0) this.blastCooldown--;
    if (this.dashCooldown > 0) this.dashCooldown--;
    if (this.grabCooldown > 0) this.grabCooldown--;
    if (this.tradeLostFrames > 0) this.tradeLostFrames--;

    /* JANELA DE CONTRA-VANISH — a vanish battle (§12).
     *
     * Alguém sumiu do meu golpe e apareceu atrás de mim. Tenho `responseFrames`
     * pra responder na mesma moeda. Vem ANTES do resto do estado de propósito:
     * a janela tem 12 frames e qualquer coisa que a atrase a mata. */
    if (this.counterVanishFrames > 0) {
      this.counterVanishFrames--;
      /* NÃO retornamos de `update()` aqui, mesmo quando o contra-vanish sai.
       * Retornar pularia a integração da física e a atualização visual, e o
       * corpo ficaria um frame na posição antiga — o que num teleporte é
       * exatamente o frame que o jogador está olhando. */
      if (cmd.vanish) this._tryCounterVanish(ctx);
      else if (this.counterVanishFrames === 0) this._endVanishBattle(false);
    }
    // Soltar o botão rearma o dash.
    if (!cmd.dash) this.dashBlocked = false;
    if (this.invulnFrames > 0) this.invulnFrames--;
    if (this.flashFrames > 0) this.flashFrames--;
    if (this.vanishChainTimer > 0) {
      this.vanishChainTimer--;
      if (this.vanishChainTimer === 0) this.vanishChain = 0;
    }

    // --- regeneração ---
    this.poise = Math.min(this.maxPoise,
      this.poise + TUNING.fighter.poiseRegenPerSec * dt);

    /* ================================================================
     *  MAX POWER: o relógio e o escoamento  (§19)
     * ================================================================
     *  O estado DRENA ki enquanto dura, e é isso que o torna uma aposta em vez
     *  de um bônus. Enquanto você está forte, as suas ferramentas de escape
     *  estão encarecendo — ou, mais exatamente, a barra que as paga está
     *  esvaziando. Ser agressivo no Max Power custa a saída dele.
     *
     *  E quando acaba, cai na EXAUSTÃO. Esse encadeamento é o counterplay
     *  inteiro: quem aguentou os 7 segundos ganha uma janela em que o outro não
     *  tem vanish, não tem dash e não tem perseguição. Aguentar é jogar bem.   */
    if (this.maxPowerFrames > 0) {
      this.maxPowerFrames--;
      this.ki = Math.max(0, this.ki - TUNING.maxPower.drainPerSec * dt);
      if (this.maxPowerFrames === 0 || this.ki <= 0) {
        const acabou = this.maxPowerFrames === 0;
        this.maxPowerFrames = 0;
        this.events.push({ type: 'maxPowerEnd' });
        if (TUNING.maxPower.endsInExhaustion) this._enterExhaustion();
        else if (!acabou) this._enterExhaustion();
      }
    }

    /* EXAUSTÃO — regen acelerado, mas nenhuma ferramenta de ki disponível.
     * O regen é maior que o passivo de propósito: a punição é perder as
     * ferramentas por um instante, não ficar de castigo. Castigo longo pune
     * quem está aprendendo (que gasta ki errado) muito mais do que pune quem
     * já sabe administrar. */
    if (this.exhaustFrames > 0) {
      this.exhaustFrames--;
      this.ki = Math.min(TUNING.ki.max, this.ki + TUNING.ki.exhaustRegenPerSec * dt);
      // Sair exige um mínimo na barra, não só tempo — senão você volta com 1 de
      // ki, gasta num dash e recai na exaustão: um serrote em vez de uma
      // recuperação.
      if (this.exhaustFrames === 0 && this.ki < TUNING.ki.exhaustExitKi) {
        this.exhaustFrames = 12;
      } else if (this.exhaustFrames === 0) {
        this.events.push({ type: 'exhaustEnd' });
      }
    } else if (this.state !== S.CHARGE && !this.inMaxPower) {
      this.ki = Math.min(TUNING.ki.max, this.ki + TUNING.ki.passiveRegenPerSec * dt);
    }

    /* Estamina de guarda: só volta a encher quando você NÃO está defendendo e
     * depois de um respiro. Regenerar durante a guarda anularia o relógio
     * inteiro — daria pra segurar F pra sempre, que é exatamente o que o
     * `cancelOnBlock: false` precisa evitar do outro lado. */
    const G = TUNING.defense.guard;
    if (this.state !== S.GUARD && this._guardRegenDelay === 0) {
      this.guardStamina = Math.min(this.maxGuardStamina,
        this.guardStamina + G.staminaRegenPerSec * dt);
    }

    // --- estado ---
    this._runState(dt, cmd, ctx);

    // --- física ---
    this._integrate(dt, ctx);

    // --- transform visual ---
    this.char.root.position.copy(this.position);

    /* Flutuação parado. `flight.hoverBobAmp/Speed` existiam no tuning e nunca
     * eram lidos — parado, o lutador ficava absolutamente imóvel e parecia um
     * boneco congelado. É SÓ visual: mexe na malha, nunca em `this.position`,
     * senão a hitbox e o ring-out passariam a oscilar junto. */
    if (this.state === S.IDLE) {
      this._bobT += dt;
      this.char.root.position.y +=
        Math.sin(this._bobT * TUNING.flight.hoverBobSpeed) * TUNING.flight.hoverBobAmp;
    } else {
      this._bobT = 0;
    }

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
      case S.APPROACH:  this._sApproach(dt, cmd, ctx); break;
      case S.PURSUIT:   this._sPursuit(dt, cmd, ctx); break;
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
      case S.GRAB:      this._sGrab(dt, cmd, ctx); break;
      case S.GRABBED:   this._sGrabbed(dt, cmd, ctx); break;
      case S.THROW:     this._sThrow(dt, cmd, ctx); break;
      case S.MAXPOWER:  this._sMaxPower(dt, cmd, ctx); break;
    }
  }

  /* --- livre: voando, pode fazer tudo ------------------------------- */
  _sFree(dt, cmd, ctx) {
    // Ordem de prioridade = ordem de leitura. Ultimate ganha de tudo.
    if (cmd.ultimate && this._tryUltimate(ctx)) return;

    /* PERSEGUIÇÃO VEM ANTES DO SMASH, e a ordem é a mecânica.
     *
     * O tipo de perseguição é escolhido pelo que você está SEGURANDO junto com
     * o Shift (Shift+V = vanish, Shift+K = alta velocidade). Com o smash lido
     * primeiro, Shift+K disparava um smash no vazio e a perseguição de alta
     * velocidade simplesmente não tinha entrada — o tipo existia no tuning e era
     * inalcançável. É a armadilha 8.19 de novo: dado que ninguém lê.
     *
     * Fora da janela de perseguição nada muda: K continua sendo smash. */
    if (cmd.dash && !this.dashBlocked && this.pursuitFrames > 0
        && this._tryPursuit(ctx, cmd)) return;

    if (cmd.charge) { this._enter(S.CHARGE); this.char.play('charge', { fade: 0.1 }); return; }

    /* GRAB antes do smash e do rush: F+J tem que significar grab de forma
     * confiável, e quem produz o command já garantiu que `grab` só vem quando a
     * intenção foi essa. */
    if (cmd.grab && this._tryGrab(ctx)) return;

    if (cmd.smash && this._tryAttack(this._smashKey(cmd.smashDir), ctx)) return;
    // Rush longe = INVESTIDA (voa até o alvo). Rush perto = soco direcional.
    if (cmd.rush && this._tryRushApproach(ctx)) return;
    if (cmd.rush && this._tryAttack(this._rushKey(cmd), ctx, cmd)) return;
    if (cmd.blast && this._tryBlast(ctx)) return;

    if (cmd.guard) {
      const moving = Math.abs(cmd.moveX) > 0.3 || Math.abs(cmd.moveY) > 0.3;
      if (moving && this.stepCooldown === 0) { this._enterStep(cmd, ctx); return; }
      this._enter(S.GUARD);
      this.char.play('block', { fade: 0.08 });
      return;
    }

    /* (A perseguição é testada no TOPO deste método — ver a nota lá sobre por
     *  que ela precisa vir antes do smash.) */

    if (cmd.dash && !this.dashBlocked && this.dashCooldown === 0
        && this.canSpend(TUNING.dragonDash.kiCost)) {
      this.spendKi(TUNING.dragonDash.kiCost);
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
    if (cmd.rush && this._tryAttack(this._rushKey(cmd), ctx, cmd)) return;
    if (cmd.smash && this._tryAttack(this._smashKey(cmd.smashDir), ctx, cmd)) return;

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

  /* --- Investida de rush ------------------------------------------- */
  /**
   * Apertar rush longe do alvo não soca o ar: LEVA você até ele.
   *
   * É a ferramenta que faz o combate acontecer. Sem ela, atacar congela o
   * movimento (o estado de ataque não lê o direcional) e os dois lutadores
   * ficam voando sem se tocar — medido: 0 de dano em 25 s de luta.
   *
   * Barato e sem custo de ki de propósito: engajar é a ação BÁSICA, e cobrar
   * por ela puniria justamente quem ainda não domina o jogo.
   */
  _tryRushApproach(ctx) {
    const A = TUNING.rushApproach;
    if (!this.lockOn || !this.target || !this.target.alive) return false;

    // Rota esgotada: a investida também não sai. Sem isto, J te levava até o
    // alvo e não acontecia nada — pior que o botão simplesmente não responder.
    if (this.comboCount >= TUNING.combo.maxChain) return false;

    const d = this.position.distanceTo(this.target.position);
    if (d <= A.attackAt || d > A.range) return false;
    if (this.ki < A.kiCost) return false;

    this.ki -= A.kiCost;
    this._enter(S.APPROACH);
    this.char.play('dash', { fade: 0.08 });
    this.events.push({ type: 'rushApproach' });
    return true;
  }

  _sApproach(dt, cmd, ctx) {
    const A = TUNING.rushApproach;
    const f = this.stateFrame;

    if (!this.target || !this.target.alive) {
      this._enter(S.IDLE);
      this.char.play('idle', { fade: 0.15 });
      return;
    }

    // Cancelamentos: a investida é comprometida, mas não é uma prisão.
    if (cmd.guard) { this._enter(S.GUARD); this.char.play('block', { fade: 0.08 }); return; }
    if (cmd.smash && this._tryAttack(this._smashKey(cmd.smashDir), ctx)) return;

    const d = this.position.distanceTo(this.target.position);

    // Chegou: emenda no primeiro elo do combo.
    if (d <= A.attackAt) { this._tryAttack(this._rushKey(cmd), ctx, cmd); return; }

    // Desistiu (alvo fugiu, ou tempo esgotado).
    if (f > A.maxFrames || d > A.range * 1.4) {
      this._enter(S.IDLE);
      this.char.play('idle', { fade: 0.15 });
      return;
    }

    this._tmp.subVectors(this.target.position, this.position).normalize();
    const cur = this._tmp2.copy(this.velocity);
    if (cur.lengthSq() < 1e-6) cur.copy(this._tmp);
    cur.normalize();
    cur.lerp(this._tmp, 1 - Math.exp(-A.turnSpeed * dt)).normalize();

    this.velocity.copy(cur).multiplyScalar(A.speed);
    this.yaw = Math.atan2(cur.x, cur.z);
    this.char.play('dash', { fade: 0.1 });
  }

  /* --- perseguição --------------------------------------------------- */
  /**
   * Abre a janela. Chamado pela resolução de acerto quando este lutador
   * MANDA alguém pro blowaway — inclusive por quebra de poise.
   */
  openPursuit(victim) {
    this.pursuitFrames = TUNING.pursuit.windowFrames;
    this.pursuitTarget = victim;
    this.events.push({ type: 'pursuitOpen', victim });
  }

  /**
   * Quantos frames JÁ passaram desde que a janela abriu.
   * A perseguição de vanish tem janela própria (mais curta), e é por aqui que
   * ela cobra a decisão rápida.
   */
  get pursuitElapsed() {
    return TUNING.pursuit.windowFrames - this.pursuitFrames;
  }

  /**
   * Dispara a perseguição. O TIPO sai do que está sendo segurado (§10).
   *
   *     Shift        DIRETA           barata, viaja, dá ROTA NOVA, pode errar
   *     Shift + V    VANISH           caríssima, infalível, NÃO dá rota
   *     Shift + K    ALTA VELOCIDADE  acerta um spike que RE-LANÇA, recovery enorme
   *
   * Nenhuma tecla nova: a perseguição continua sendo Shift, e o modificador é
   * um botão que o jogador já usa pra aquela mesma ideia (V = sumir,
   * K = golpe pesado). É o §29 aplicado — contexto em vez de teclado novo.
   */
  _tryPursuit(ctx, cmd) {
    const alvo = this.pursuitTarget;
    if (!alvo || !alvo.alive) return false;

    const tipo = pursuitTypeFor(cmd || {});
    const spec = pursuitSpec(tipo);

    // Janela própria do tipo: a de vanish exige decidir antes.
    if (this.pursuitElapsed > spec.windowFrames) return false;
    if (!this.canSpend(spec.kiCost)) return false;
    if (this.position.distanceTo(alvo.position) > spec.range) return false;

    this.spendKi(spec.kiCost);
    this.dashBlocked = true;          // exige soltar e reapertar, como o dash
    this._pursuitCarry = 0;
    this.pursuitType = tipo;
    this._pursuitSpec = spec;
    this._enter(S.PURSUIT);
    this.char.play('dash', { fade: 0.08 });

    /* PERSEGUIÇÃO DE VANISH — não viaja, APARECE.
     *
     * Sem trajetória não há como o defensor ver chegando, e é por isso que ela
     * custa mais que o dobro da direta e NÃO dá rota nova. Se desse, seria
     * estritamente melhor que a direta e as outras duas viravam decoração. */
    if (spec.teleport) {
      this._tmp.subVectors(this.position, alvo.position);
      if (this._tmp.lengthSq() < 1e-6) this._tmp.set(0, 0, 1);
      this._tmp.normalize().multiplyScalar(spec.appearDistance);
      this.position.copy(alvo.position).add(this._tmp);
      this.velocity.copy(alvo.velocity).multiplyScalar(spec.carryVelocity);
      this.invulnFrames = Math.max(this.invulnFrames, spec.iframes);
      this._carryTarget = alvo;
      this._pursuitCarry = spec.carryFrames;
      this.pursuitFrames = 0;
      this.pursuitTarget = null;
      this._faceTargetNow(alvo);
      this.events.push({ type: 'pursuitStart', victim: alvo, style: tipo, teleport: true });
      return true;
    }

    this.events.push({ type: 'pursuitStart', victim: alvo, style: tipo });
    return true;
  }

  /** Vira na hora pra um alvo. Sem isto o teleporte aparece olhando pro nada. */
  _faceTargetNow(alvo) {
    this._tmp.subVectors(alvo.position, this.position);
    if (this._tmp.lengthSq() > 1e-6) this.yaw = Math.atan2(this._tmp.x, this._tmp.z);
  }

  /**
   * Voar até quem você lançou. NÃO ataca sozinho ao chegar — devolve o
   * controle em alcance e a decisão continua sua. É a diferença entre uma
   * segunda disputa e uma continuação automática do combo.
   */
  _sPursuit(dt, cmd, ctx) {
    const P = this._pursuitSpec || pursuitSpec('direct');
    const f = this.stateFrame;

    /* ================================================================
     *  FASE DE ACOMPANHAMENTO — alcançou, agora voa junto.
     * ================================================================
     *  O alvo desta fase mora em `_carryTarget`, um campo PRÓPRIO, e não em
     *  `pursuitTarget`.
     *
     *  A razão é um bug de ordem: `pursuitTarget` é zerado no frame da chegada
     *  (a janela fechou, ela cumpriu o papel), e o timer em `update()` também o
     *  zera. Só que a primeira linha deste método abortava pra IDLE quando não
     *  havia `pursuitTarget` — então a fase de acompanhamento, que existe pra
     *  durar `carryFrames`, tinha o alvo arrancado no frame seguinte ao de
     *  entrar nela.
     *
     *  É o sintoma que `carryFrames` foi criado pra resolver: "o banner dizia
     *  ALCANÇOU! e a distância virava 13 m". Separar os dois campos é o que
     *  faz os dois corpos de fato cruzarem o céu juntos.
     *
     *  Aqui o controle de voo NÃO entra: é ele que mata a velocidade herdada.
     *  Rush e smash cancelam desta fase — ela É a decisão de follow-up.        */
    if (this._pursuitCarry > 0) {
      const junto = this._carryTarget;
      this._pursuitCarry--;

      if (junto && junto.alive) {
        this.velocity.copy(junto.velocity).multiplyScalar(P.carryVelocity);
        this._faceTargetNow(junto);
      }

      if (cmd.rush && this._tryAttack(this._rushKey(cmd), ctx, cmd)) return;
      if (cmd.smash && this._tryAttack(this._smashKey(cmd.smashDir), ctx, cmd)) return;

      if (this._pursuitCarry === 0) {
        this._carryTarget = null;
        this._enter(S.IDLE);
        this.char.play('idle', { fade: 0.12 });
      }
      return;
    }

    const alvo = this.pursuitTarget;
    if (!alvo || !alvo.alive) { this._enter(S.IDLE); this.char.play('idle', { fade: 0.15 }); return; }

    /* Cancelar em smash é o que permite chegar e emendar de imediato quem leu
     * certo — mas NÃO nos primeiros frames, e nunca na perseguição de alta
     * velocidade.
     *
     * Os primeiros frames: Shift+K é a ENTRADA da perseguição de alta
     * velocidade, e o buffer de smash continua vivo por 10 frames. Sem a
     * carência, a perseguição começava e se cancelava sozinha no frame seguinte,
     * com o próprio comando que a criou.
     *
     * A de alta velocidade: ela já traz um golpe embutido (o spike). Deixar
     * cancelar em smash daria dois finalizadores pelo preço de um. */
    const carencia = f > 6;
    if (!P.autoHit && carencia && cmd.smash
        && this._tryAttack(this._smashKey(cmd.smashDir), ctx, cmd)) return;

    const d = this.position.distanceTo(alvo.position);

    if (d <= P.attackAt || f > P.maxFrames) {
      const chegou = d <= P.attackAt;

      /* ROTA NOVA — e SÓ a perseguição direta a dá.
       *
       * É o prêmio por ter lido o lançamento, e é o único jeito legítimo de
       * estender a pressão (martelar não abre rota). As outras duas compram
       * posição e dano; se todas dessem rota, a perseguição seria o combo
       * infinito que o `maxChain` existe pra impedir. */
      if (chegou && P.clearsChainOnArrive) {
        this.comboCount = 0;
        this.chainResetTimer = TUNING.combo.chainResetFrames;
      }
      if (chegou) this.events.push({ type: 'pursuitHit', victim: alvo, style: P.type });

      this.pursuitFrames = 0;
      this.pursuitTarget = null;

      if (chegou) {
        /* ALTA VELOCIDADE: acerta SOZINHA um spike que re-lança. O jogador já
         * pagou o risco na escolha do tipo — a recompensa não é uma janela de
         * decisão, é o golpe. */
        if (P.autoHit && P.spikeMove) {
          this._carryTarget = alvo;
          this.target = alvo;
          if (this._tryAttack(P.spikeMove, ctx)) {
            this.events.push({ type: 'pursuitSpike', victim: alvo });
            return;
          }
        }

        // Alcançar é VIAJAR JUNTO, não encostar e parar.
        this._carryTarget = alvo;
        this.velocity.copy(alvo.velocity).multiplyScalar(P.carryVelocity);
        this._pursuitCarry = P.carryFrames;
        return;                       // continua no estado, agora acompanhando
      }

      /* ERROU. E é aqui que os tipos se diferenciam de verdade: a direta só
       * perde a velocidade, a de alta velocidade come `recoveryFrames` — 26
       * frames, mais que o recovery do smash frente. Perseguir assim e não pegar
       * é o maior convite a punição do jogo, e é o preço de ela re-lançar. */
      this.velocity.multiplyScalar(0.25);
      if (P.recoveryFrames > 0) {
        this._stunFrames = P.recoveryFrames;
        this._enter(S.HITSTUN);
        this.char.play('idle', { fade: 0.12 });
        this.events.push({ type: 'pursuitWhiff', style: P.type });
        return;
      }
      this._enter(S.IDLE);
      this.char.play('idle', { fade: 0.12 });
      return;
    }

    this._tmp.subVectors(alvo.position, this.position).normalize();
    const cur = this._tmp2.copy(this.velocity);
    if (cur.lengthSq() < 1e-6) cur.copy(this._tmp);
    cur.normalize().lerp(this._tmp, 1 - Math.exp(-P.turnSpeed * dt)).normalize();
    this.velocity.copy(cur).multiplyScalar(P.speed);
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

  /**
   * A vítima está de frente pra mim? (usado pra decidir se a guarda vale)
   *
   * ATENÇÃO — usa vetores PRÓPRIOS, não `_tmp`/`_tmp2`.
   *
   * A versão anterior usava os temporários compartilhados, e isso produzia um
   * bug silencioso em `dashImpact()`:
   *
   *     victim.applyHit({
   *       direction: this._tmp,                          // guarda a REFERÊNCIA
   *       guarded:  victim.guarding && this._facing(v),  // ← sobrescreve _tmp
   *     })
   *
   * Propriedades de objeto literal avaliam em ordem, então quando `applyHit`
   * lia `direction` ele recebia o vetor que `_facing` tinha acabado de escrever:
   * "pra onde a VÍTIMA está olhando". Trombar alguém empurrava ele na direção
   * em que ele estava virado, não na direção do impacto — knockback aleatório
   * do ponto de vista de quem joga. */
  _facing(victim) {
    _faceA.subVectors(victim.position, this.position).setY(0);
    if (_faceA.lengthSq() < 1e-6) return false;
    _faceA.normalize();
    _faceB.set(Math.sin(victim.yaw), 0, Math.cos(victim.yaw));
    return _faceB.dot(_faceA) < -0.15;
  }

  /* --- ataque ------------------------------------------------------- */
  _sAttack(dt, cmd, ctx) {
    const m = this.move;

    /* ================================================================
     *  SMASH CARREGADO E PERFECT SMASH  (§7, §8)
     * ================================================================
     *  O golpe CONGELA num frame do startup enquanto o botão estiver segurado.
     *  Pinar `stateFrame` em vez de inventar um sub-estado é o que mantém tudo o
     *  que já funciona funcionando: `attackPhase` continua dizendo 'startup',
     *  o homing continua correndo, a hitbox continua desligada, a IA continua
     *  medindo a brecha pela mesma conta. Um estado novo exigiria ensinar todos
     *  esses lugares sobre ele.
     *
     *  O que o jogador ganha segurando NÃO é dano (ver a nota em
     *  `TUNING.smashCharge`): é o direito de escolher o frame do impacto. Isso
     *  bate a antecipação de quem ia cronometrar sway, Z-Counter ou vanish — é a
     *  linha "A changes timing" da sequência do §34, e ela existe sem inflar um
     *  único número.
     *
     *  Soltar dentro da janela = Perfect Smash. Fora dela, carregado ou não, o
     *  golpe é exatamente o smash normal.                                      */
    const CH = moveCharge(m);

    /* A carga só ENGATA quando o golpe já chegou ao frame de congelamento.
     *
     * Detalhe que parece detalhe e não é: pinar `stateFrame` desde o frame 1
     * SALTARIA o startup pra frente (de 1 pra 6), e um smash segurado sairia
     * mais RÁPIDO que um smash tocado. O startup tem que ser cumprido primeiro;
     * o congelamento é uma pausa DEPOIS dele, não um atalho. */
    if (CH && this.smashHolding && this.stateFrame >= CH.holdAtFrame) {
      /* `smashHeld` e não `smash`: o command traz o botão SEGURADO de verdade.
       * `cmd.smash` vem do buffer de input (10 frames), então ele continua
       * verdadeiro depois de soltar — usar ele aqui faria todo toque carregar
       * dez frames sozinho e a janela perfeita sairia por acidente. */
      const seguraAinda = cmd.smashHeld && this.smashChargeFrames < CH.maxHoldFrames;

      if (seguraAinda) {
        this.stateFrame = CH.holdAtFrame;      // pina o golpe no startup
        this.smashChargeFrames++;

        /* AVISO DE JANELA. Sem isto o Perfect Smash é sorte, e mecânica de
         * timing que não se vê não é mecânica de timing — é loteria com passos
         * extras. O aviso é o que transforma "às vezes sai forte" em "eu sei
         * quando soltar". */
        if (!this._smashTelegraphed && this.smashChargeFrames >= CH.perfectWindow[0]) {
          this._smashTelegraphed = true;
          this.events.push({ type: 'smashPerfectWindow' });
        }
        this.events.push({ type: 'smashCharging', held: this.smashChargeFrames });

        this._applyHoming(dt, m, ctx);
        this.velocity.multiplyScalar(Math.exp(-6 * dt));
        return;                                 // o golpe está suspenso
      }

      // Soltou (ou estourou o tempo): resolve a carga e deixa o golpe seguir.
      this._releaseSmashCharge(CH);
    }

    const f = this.stateFrame;
    const total = moveTotalFrames(m);

    // Homing e avanço acontecem no startup: é o que faz o soco ACERTAR num
    // jogo aéreo. Sem isso, o combo erra e a culpa parece ser do jogador.
    if (f <= m.startup) this._applyHoming(dt, m, ctx);

    /* Impulso pra frente durante o golpe.
     *
     * Atenção à forma: isto DEFINE a velocidade alvo, não acumula. A versão
     * anterior fazia `addScaledVector(fwd, advanceSpeed * 60 * dt)`, e como
     * `60 * dt` vale 1, somava a velocidade inteira a cada frame da janela —
     * um avanço de 7 m/s virava 42 m/s em seis frames. */
    if (m.advanceFrames && f >= m.advanceFrames[0] && f <= m.advanceFrames[1]) {
      /* A direção do avanço é 3D quando há alvo.
       *
       * Antes era `(sin(yaw), 0, cos(yaw))` — a armadilha 8.9 do documento de
       * passagem ("yaw NÃO descreve direção num jogo aéreo"), repetida aqui.
       * Como `_desired.y` ficava em zero, TODO ataque zerava a velocidade
       * vertical: socar alguém acima de você te empurrava na horizontal
       * enquanto o homing te puxava na diagonal — dois sistemas brigando, e o
       * corpo dando um solavanco no meio do golpe. */
      this._attackForward(this._tmp);
      this._desired.copy(this._tmp).multiplyScalar(m.advanceSpeed);
      this.velocity.lerp(this._desired, 1 - Math.exp(-20 * dt));
    } else if (f > (m.advanceFrames ? m.advanceFrames[1] : 0)) {
      // Depois da janela, freia — senão o lutador desliza pelo recovery inteiro.
      this.velocity.multiplyScalar(Math.exp(-5 * dt));
    }

    /* CANCELAR O RECOVERY EM PERSEGUIÇÃO.
     *
     * A janela de perseguição abre no frame do lançamento — ou seja, enquanto
     * o smash ainda está nos seus 24 frames de recovery. Sem este cancel, o
     * Shift instintivo logo depois do impacto era simplesmente engolido, e a
     * janela só respondia depois que o golpe terminava. Medido: apertei Shift
     * 260 ms após lançar e nada aconteceu — o corpo estava em `attack`.
     *
     * Deixar o recovery ser cancelado SÓ em perseguição é o que torna
     * "lancei, vou atrás" um gesto contínuo em vez de um tempo de espera.
     * Não é grátis: a perseguição custa ki e o defensor tem a recuperação
     * aérea pra puni-la. */
    if (this.pursuitFrames > 0 && cmd.dash && !this.dashBlocked
        && f > m.startup + m.active && this._tryPursuit(ctx, cmd)) return;

    /* Cancelar pro próximo elo do combo.
     *
     * Três resultados distintos, e é a distinção que faz o jogo ter turnos:
     *
     *   acertou   → emenda; o combo flui e qualquer um consegue
     *   bloqueou  → NÃO emenda; come o recovery e o turno vira pro defensor
     *   errou     → NÃO emenda; come o recovery e leva punição
     *
     * A linha do meio é nova. Antes, bloqueio contava como contato e liberava
     * a emenda igual a um acerto — o atacante nunca ficava exposto contra a
     * guarda, e defender não cobrava preço nenhum. Ver `combo.cancelOnBlock`. */
    if (this.contactAllowsChain && m.cancelWindow
        && f >= m.cancelWindow[0] && f <= m.cancelWindow[1]) {
      if (cmd.smash) {
        const key = this._smashKey(cmd.smashDir);
        if (m.cancelInto.includes(key) && this._tryAttack(key, ctx, cmd)) return;
      }
      if (cmd.rush) {
        // A direção segurada AGORA escolhe o próximo elo — é assim que o
        // jogador compõe o combo em vez de seguir uma ordem fixa.
        const next = this._rushKey(cmd);
        if (m.cancelInto.includes(next) && this._tryAttack(next, ctx, cmd)) return;
      }
    }

    /* O golpe acabar NÃO acaba a rota.
     *
     * Aqui havia um `this.comboCount = 0`, e era ele que tornava o teto de
     * elos decorativo: bastava deixar o último golpe terminar pra recomeçar do
     * zero. Quem zera a rota agora é `chainResetTimer` — tempo real sem
     * atacar — ou um ender acertado. */
    if (f >= total) {
      this._enter(S.IDLE);
      this.char.play('idle', { fade: 0.14 });
    }
  }

  /**
   * Soltou o smash carregado: decide se foi Perfect e ajusta o golpe.
   *
   * A técnica é a mesma do resto deste arquivo: `Object.create(base)` com os
   * campos modificados por cima. O golpe base em `TUNING.moves` NÃO é tocado —
   * se fosse, um Perfect Smash multiplicaria o dano do smash permanentemente e a
   * segunda vez seria mais forte que a primeira. (Esse bug já existiu num
   * protótipo anterior com o multiplicador do charged blast; fica registrado.)
   */
  _releaseSmashCharge(CH) {
    this.smashHolding = false;
    const held = this.smashChargeFrames;
    const perfect = held >= CH.perfectWindow[0] && held <= CH.perfectWindow[1];
    const carregado = held >= CH.minHoldFrames;
    this.smashPerfect = perfect;

    this.events.push({ type: 'smashRelease', perfect, held });

    // Toque: é o smash normal, sem nenhuma modificação. Caminho idêntico ao
    // comportamento anterior — é o que garante que nada regrediu.
    if (!carregado) return;

    const base = this.move;
    const v = Object.create(base);

    const dm = perfect ? CH.perfectDamageMul : CH.chargedDamageMul;
    const km = perfect ? CH.perfectKnockbackMul : CH.chargedKnockbackMul;

    v.damage = base.damage * dm;
    v.knockback = base.knockback * km;
    v.knockup = base.knockup * km;
    v.chipDamage = (base.chipDamage ?? 0) * dm;

    if (perfect) {
      v.poiseDamage = base.poiseDamage * CH.perfectPoiseMul;
      v.hitstop = CH.perfectHitstop;
      v.shake = CH.perfectShake;
      /* Perfect Smash fura a guarda mesmo num golpe que não é `guardBreak`.
       * É o que o torna a RESPOSTA AO TURTLE: o prêmio por acertar o timing não
       * é dano, é a guarda do outro deixar de existir. Dano a mais só faria o
       * defensor morrer mais rápido fazendo a mesma coisa. */
      if (CH.perfectGuardBreak) v.guardBreak = true;
      v.isPerfect = true;
      this.ki = Math.min(TUNING.ki.max, this.ki + CH.perfectKiRefund);
    }

    this.move = v;
  }

  /* --- guarda ------------------------------------------------------- */
  _sGuard(dt, cmd, ctx) {
    const G = TUNING.defense.guard;

    /* BLOCKSTUN — travado no impacto que você aparou.
     *
     * É o que faz a defesa participar do jogo de turnos. Durante estes frames
     * não dá pra soltar a guarda, nem stepar, nem se mover: você comeu o golpe
     * na guarda e está pagando o tempo dele. Quando acaba, quem tem o turno é
     * decidido pela conta de frame data — e como o atacante NÃO pode emendar
     * no bloqueio (combo.cancelOnBlock), quem sai na frente é você. */
    if (this.blockstunFrames > 0) {
      this.velocity.multiplyScalar(Math.exp(-9 * dt));
      this._faceTarget(dt, 1.6);
      this.char.play('block', { fade: 0.08 });
      return;
    }

    if (!cmd.guard) {
      this._guardRegenDelay = G.staminaRegenDelayFrames;
      this._enter(S.IDLE);
      this.char.play('idle', { fade: 0.1 });
      return;
    }

    // Segurar guarda custa — barato, mas custa. É o teto do turtle.
    this.guardStamina -= G.staminaDrainPerSec * dt;
    if (this.guardStamina <= 0) { this._breakGuard(); return; }

    const moving = Math.abs(cmd.moveX) > 0.3 || Math.abs(cmd.moveY) > 0.3;
    if (moving && this.stepCooldown === 0) { this._enterStep(cmd, ctx); return; }

    // Guardando ainda dá pra se reposicionar, mas devagar.
    this._applyFlightInput(dt, cmd, ctx, 0.35);
    this._faceTarget(dt, 1.6);
    this.char.play('block', { fade: 0.08 });
  }

  /**
   * A guarda arrebentou por EXAUSTÃO (estamina no zero).
   *
   * Diferente de propósito da quebra por SMASH: aqui você fica exposto EM PÉ,
   * perto do adversário, por `breakStunFrames`. É punível, mas não te manda
   * pra fora da arena. As duas quebras têm papéis distintos:
   *
   *   por smash    → blowaway → ferramenta de RING-OUT
   *   por exaustão → stun     → ferramenta de PRESSÃO
   */
  _breakGuard() {
    const G = TUNING.defense.guard;
    this.guardStamina = 0;
    this._guardRegenDelay = G.staminaRegenDelayFrames;
    this._stunFrames = G.breakStunFrames;
    this.velocity.multiplyScalar(0.3);
    this._enter(S.HITSTUN);
    this.char.play('hit_react', { fade: 0.05, restart: true });
    this.events.push({ type: 'guardShattered' });
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
    if (!cmd.charge) {
      this._maxPowerCharge = 0;
      this._enter(S.IDLE);
      this.char.play('idle', { fade: 0.14 });
      return;
    }

    if (this.stateFrame > TUNING.ki.chargeStartupFrames) {
      this.ki = Math.min(TUNING.ki.max, this.ki + TUNING.ki.chargeRatePerSec * dt);
    }

    /* ================================================================
     *  ENTRADA NO MAX POWER  (§19)
     * ================================================================
     *  Não há tecla nova: é o MESMO botão de carregar ki, continuado depois que
     *  a barra passa do limiar. A gramática é a que o §29 pede — "poucos botões
     *  + contexto + timing" — e é a mesma ideia que faz F valer três coisas
     *  conforme o momento.
     *
     *  Por que a entrada tem que ser assim, e não um botão dedicado: o custo
     *  real do Max Power não é o ki, é o TEMPO PARADO. Carregar é a posição mais
     *  vulnerável do jogo. Exigir passar por ela é o que dá ao adversário a
     *  chance de ler e interromper — e é isso que impede "apertei botão, fiquei
     *  invencível", que era a preocupação explícita do pedido.
     *
     *  Em exaustão não entra: seria o loop perfeito de sair do castigo direto
     *  pro modo forte.                                                         */
    const MP = TUNING.maxPower;
    if (!this.inMaxPower && !this.exhausted && this.ki >= MP.enterKiThreshold) {
      this._maxPowerCharge++;
      if (this._maxPowerCharge === 1) this.events.push({ type: 'maxPowerReady' });
      if (this._maxPowerCharge >= MP.enterHoldFrames) {
        this._enterMaxPower();
        return;
      }
    } else {
      this._maxPowerCharge = 0;
    }

    // Parado e vulnerável — é o trade do Tenkaichi.
    this.velocity.multiplyScalar(Math.exp(-8 * dt));
    this._faceTarget(dt, 2.5);
    this.char.play('charge', { fade: 0.12 });

    if (this.stateFrame % 4 === 0) this.events.push({ type: 'chargePulse' });
  }

  /**
   * Acende o Max Power. O clarão de entrada é um ESTADO curto e invulnerável —
   * não por generosidade, mas porque o gesto é "se soltar": quem estava colado
   * em você durante o carregamento precisa ser empurrado, senão acender no meio
   * de um combo não teria efeito nenhum e a mecânica só funcionaria no neutro.
   */
  _enterMaxPower() {
    const MP = TUNING.maxPower;
    this.ki = Math.max(0, this.ki - MP.enterKiCost);
    this._maxPowerCharge = 0;
    this.maxPowerFrames = MP.durationFrames;
    this.invulnFrames = Math.max(this.invulnFrames, MP.entryFrames);
    this.comboCount = 0;
    this.chainResetTimer = 0;
    this.velocity.multiplyScalar(0.2);
    this._enter(S.MAXPOWER);
    this.char.play('charge', { fade: 0.05, restart: true });
    this.events.push({ type: 'maxPowerStart' });
  }

  _sMaxPower(dt, cmd, ctx) {
    this.velocity.multiplyScalar(Math.exp(-10 * dt));
    this._faceTarget(dt, 2.0);
    if (this.stateFrame >= TUNING.maxPower.entryFrames) {
      this._enter(S.IDLE);
      this.char.play('idle', { fade: 0.12 });
    }
  }

  /**
   * Cai na exaustão. Chamado ao zerar o ki gastando, e ao fim do Max Power.
   *
   * Não reseta se já estiver exausto: reentrar renovaria o castigo a cada
   * tentativa de gastar, e o serrote é justamente o que `exhaustExitKi` evita
   * do outro lado.
   */
  _enterExhaustion() {
    if (this.exhausted) return;
    this.ki = 0;
    this.maxPowerFrames = 0;
    this.exhaustFrames = TUNING.ki.exhaustFrames;
    this.events.push({ type: 'exhaustStart' });
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

  /** Custo do próximo vanish deste lutador (escala com a cadeia e com o kit). */
  vanishCost() {
    const V = TUNING.defense.vanish;
    return this.kiCost(V.kiCost * Math.pow(V.chainKiMultiplier, this.vanishChain));
  }

  /** Executa o vanish. Chamado pela resolução de acerto, não pelo estado. */
  doVanish(attacker, ctx) {
    const V = TUNING.defense.vanish;

    const cost = this.vanishCost();
    if (this.exhausted || this.ki < cost || this.vanishChain >= V.maxChain) return false;

    this.ki -= cost;
    if (this.ki <= 0.001) this._enterExhaustion();
    this.vanishChain++;
    this.vanishChainTimer = 120;

    /* ================================================================
     *  ABRE A VANISH BATTLE  (§12)
     * ================================================================
     *  Até aqui o vanish terminava a interação: quem sumiu ganhava a posição e
     *  pronto. Não havia DISPUTA, só um resultado — e a imagem mais reconhecível
     *  do gênero (dois corpos piscando pelo céu, um atrás do outro, até alguém
     *  errar) simplesmente não existia.
     *
     *  Agora o atacante que foi vanishado ganha `responseFrames` pra responder
     *  na mesma moeda. A janela é curta (12 frames) porque isto é o topo da
     *  curva de perícia: não é pra iniciante acertar, é pra ser a coisa que dois
     *  jogadores bons fazem um com o outro.                                     */
    const VB = TUNING.defense.vanishBattle;
    if (VB.enabled && attacker.alive) {
      const troca = (attacker.vanishExchange || 0) + 1;
      if (troca <= VB.maxExchanges) {
        attacker.counterVanishFrames = VB.responseFrames;
        attacker.counterVanishFoe = this;
        attacker.vanishExchange = troca;
        this.vanishExchange = troca;
        this.events.push({ type: 'vanishBattleOpen', foe: attacker, exchange: troca });
      } else {
        /* Teto de trocas: acabou, e quem tinha a vez de responder PAGA. Não
         * "termina empatado" de propósito — sem risco no fim, a troca seria só
         * um desperdício mútuo de ki. Com risco, é uma aposta. */
        attacker.stagger(VB.loserStunFrames);
        attacker.vanishExchange = 0;
        this.vanishExchange = 0;
        this.events.push({ type: 'vanishBattleWin', foe: attacker });
      }
    }

    /* Um toque salva UM golpe. Sem zerar isto, o contador continuava correndo
     * de onde parou e um único V cobria dois acertos seguidos que caíssem na
     * mesma janela — vanish de graça no segundo. */
    this.vanishPressFrame = 999;

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

  /**
   * CONTRA-VANISH — a resposta dentro da vanish battle.
   *
   * Diferente do vanish normal em dois pontos que importam:
   *
   *   1. não precisa de um golpe chegando. O vanish comum é uma RESPOSTA a um
   *      ataque (só sai dentro do `vanishWindow` do golpe recebido); este é uma
   *      resposta a ter sido vanishado. Se exigisse golpe, a troca não podia
   *      nem começar, porque quem acabou de ser vanishado não está levando nada.
   *
   *   2. custa pela CADEIA, e a cadeia é compartilhada pela troca. A quarta
   *      resposta custa ~77 de ki: a barra acaba antes da paciência, e é esse o
   *      freio econômico contra o laço infinito que o §12 manda evitar.
   */
  _tryCounterVanish(ctx) {
    const VB = TUNING.defense.vanishBattle;
    const foe = this.counterVanishFoe;
    if (!foe || !foe.alive) { this._endVanishBattle(false); return false; }

    const cost = this.vanishCost();
    if (this.exhausted || this.ki < cost) return false;

    this.ki -= cost;
    if (this.ki <= 0.001) this._enterExhaustion();
    this.vanishChain++;
    this.vanishChainTimer = 120;
    this.counterVanishFrames = 0;
    this.counterVanishFoe = null;
    this.vanishPressFrame = 999;

    // Reaparece atrás de quem me vanishou — e agora a vez de responder é dele.
    const atras = this._tmp.set(Math.sin(foe.yaw), 0, Math.cos(foe.yaw))
      .multiplyScalar(-VB.reappearDistance);
    this.position.copy(foe.position).add(atras);
    this.position.y = foe.position.y + 0.1;
    this.velocity.set(0, 0, 0);
    this.yaw = foe.yaw;
    this.invulnFrames = Math.max(this.invulnFrames,
      TUNING.defense.vanish.startupFrames + TUNING.defense.vanish.recoveryFrames);

    const troca = (this.vanishExchange || 0) + 1;
    this.vanishExchange = troca;

    if (troca <= VB.maxExchanges) {
      foe.counterVanishFrames = VB.responseFrames;
      foe.counterVanishFoe = this;
      foe.vanishExchange = troca;
    } else {
      foe.stagger(VB.loserStunFrames);
      foe.vanishExchange = 0;
      this.vanishExchange = 0;
      this.events.push({ type: 'vanishBattleWin', foe });
    }

    this._enter(S.VANISH);
    this.char.play('dodge', { fade: 0.02, restart: true });
    this.events.push({ type: 'counterVanish', foe, exchange: troca });
    return true;
  }

  /** A janela de resposta expirou. Só limpa — a perda de posição já é a punição. */
  _endVanishBattle(venceu) {
    this.counterVanishFrames = 0;
    this.counterVanishFoe = null;
    this.vanishExchange = 0;
    if (!venceu) this.events.push({ type: 'vanishBattleLost' });
  }

  /* ================================================================== */
  /*  GRAB / THROW  (§17)                                                */
  /* ================================================================== */
  /**
   * Tenta agarrar. Entrada F+J.
   *
   * O grab existe pra resolver um problema MEDIDO: contra a guarda o ataque
   * tinha uma resposta só (o smash, lento e telegrafado), e o perfil DEFESA
   * levava 88 golpes limpos contra 32 aparados passando 37% do tempo bloqueando.
   * Faltava a segunda ferramenta anti-guarda.
   *
   * O que o mantém honesto — as três relações do §17:
   *
   *   vence  a GUARDA    (a guarda não está em `defenseMatrix.grab`)
   *   perde  pro ESCAPE  (a vítima aperta guarda na janela)
   *   perde  pra TUDO    (`priority: 0`: qualquer golpe atravessa a pegada)
   *
   * A terceira é a que impede o grab de dominar: ele só funciona contra quem
   * está DEFENDENDO. Contra quem ataca você perde a troca; contra quem espera,
   * come o escape. É uma leitura, não um botão bom.
   */
  _tryGrab(ctx) {
    const G = TUNING.defense.grab;
    if (this.grabCooldown > 0) return false;

    const key = 'grab';
    const m = moveOf(key);
    if (!m) return false;

    // Não dá pra agarrar quem já está indefeso: seria dano garantido depois de
    // um lançamento, e a rota fechada que o `maxChain` existe pra impedir.
    const alvo = this.target;
    if (alvo && !alvo.alive) return false;
    if (alvo && G.cannotGrabStates.includes(alvo.state)) return false;

    this.grabCooldown = G.cooldownFrames;
    return this._tryAttack(key, ctx);
  }

  /**
   * A pegada PEGOU. Chamado pela resolução de acerto.
   *
   * Os dois corpos entram em estados diferentes porque estão em situações
   * diferentes: eu espero o relógio do arremesso, ele corre contra a janela de
   * escape. Um estado compartilhado não conseguiria descrever isso.
   */
  beginGrab(victim, ctx) {
    const G = TUNING.defense.grab;
    this.grabbing = victim;
    this.grabHold = G.holdFrames;
    this._enter(S.GRAB);
    this.char.play('attack_light_1', { fade: 0.06, restart: true });

    victim.grabbedBy = this;
    victim.velocity.set(0, 0, 0);
    victim.blockstunFrames = 0;
    victim._enter(S.GRABBED);
    victim.char.play('hit_react', { fade: 0.05, restart: true });
    victim.events.push({ type: 'grabbed', attacker: this });

    this.events.push({ type: 'grabStart', victim });
  }

  /** Segurando: o corpo do outro vem comigo até o arremesso. */
  _sGrab(dt, cmd, ctx) {
    const v = this.grabbing;
    if (!v || !v.alive || v.grabbedBy !== this) { this._releaseGrab(); return; }

    this.velocity.multiplyScalar(Math.exp(-9 * dt));
    this._faceTargetNow(v);

    /* A vítima é COLADA na minha frente. Sem isto ela fica onde estava e o
     * arremesso sai do lugar errado — e o `resolveOverlap` começa a empurrar os
     * dois, o que faz a pegada tremer. */
    this._tmp.set(Math.sin(this.yaw), 0, Math.cos(this.yaw))
      .multiplyScalar(TUNING.fighter.radius * 2.0);
    v.position.copy(this.position).add(this._tmp);
    v.velocity.copy(this.velocity);

    this.grabHold--;
    if (this.grabHold <= 0) this._throw(cmd, ctx);
  }

  /**
   * Agarrado: a janela de escape.
   *
   * O escape é de LEITURA, não de martelada — a janela abre no começo da pegada
   * e fecha. Quem martela guarda por reflexo acerta às vezes; quem PERCEBE a
   * pegada acerta sempre. É a mesma gramática do Z-Counter, e é o terceiro
   * significado que o botão de guarda ganha conforme o timing.
   */
  _sGrabbed(dt, cmd, ctx) {
    const G = TUNING.defense.grab;
    const a = this.grabbedBy;
    if (!a || !a.alive || a.grabbing !== this) { this._enter(S.IDLE); this.grabbedBy = null; return; }

    /* O escape exige um TOQUE novo de guarda, não o botão segurado.
     *
     * Medido no navegador, e é um defeito que anulava a mecânica inteira: com
     * `cmd.guard` o escape saía no PRIMEIRO frame da pegada sempre que a vítima
     * já estivesse segurando a guarda. Ou seja, quem fazia turtle escapava de
     * graça — exatamente a pessoa contra quem o grab existe. O grab passava pela
     * guarda e perdia pro botão que a guarda estava usando.
     *
     * `guardPressFrame === 0` é o frame do toque (edge). É a MESMA gramática do
     * Z-Counter e do rebate de blast: segurar F não faz nada, tocar F na hora
     * certa faz. O botão tem três significados conforme o timing, e é isso que
     * dá profundidade sem tecla nova. */
    const naJanela = this.stateFrame <= G.escapeWindow;
    const tocouAgora = this.guardPressFrame === 0;
    if (naJanela && tocouAgora && this.ki >= G.escapeKiCost) {
      this.ki = Math.max(0, this.ki - G.escapeKiCost);
      this.invulnFrames = Math.max(this.invulnFrames, G.escapeVictimIframes);

      /* Escapou: o AGRESSOR fica exposto. A troca é justa — ele apostou numa
       * leitura e errou, e come uma punição do tamanho do recovery que teria
       * comido se tivesse errado o grab inteiro. */
      a.stagger(G.escapeAttackerStunFrames);
      a.grabbing = null;
      this.grabbedBy = null;
      this._enter(S.IDLE);
      this.char.play('idle', { fade: 0.1 });
      this.events.push({ type: 'grabEscape', attacker: a });
      return;
    }

    this.char.play('hit_react', { fade: 0.08 });
  }

  /** Larga a pegada sem arremessar (a vítima sumiu, morreu, etc). */
  _releaseGrab() {
    if (this.grabbing) this.grabbing.grabbedBy = null;
    this.grabbing = null;
    this.grabHold = 0;
    this._enter(S.IDLE);
    this.char.play('idle', { fade: 0.12 });
  }

  /**
   * O ARREMESSO. A direção segurada escolhe pra onde.
   *
   * É aqui que o grab vira ferramenta de ring-out: agarrar perto da borda e
   * arremessar pra fora é uma jogada inteira que o kit não tinha. O smash
   * empurra na direção em que você está olhando; o arremesso deixa você ESCOLHER,
   * e essa diferença é o valor posicional dele.
   */
  _throw(cmd, ctx) {
    const v = this.grabbing;
    const m = moveOf('grab_throw');
    if (!v || !m) { this._releaseGrab(); return; }

    // Direção: o direcional segurado, relativo à câmera. Sem direcional, pra
    // frente (que é pra onde o corpo está olhando).
    const basis = ctx.moveBasis;
    this._desired.set(0, 0, 0);
    if (basis) {
      this._desired.addScaledVector(basis.right, cmd.moveX || 0)
                   .addScaledVector(basis.forward, cmd.moveY || 0);
    }
    if (this._desired.lengthSq() < 0.09) {
      this._desired.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    }
    this._desired.normalize();

    v.grabbedBy = null;
    this.grabbing = null;

    /* O arremesso é INDEFENSÁVEL (`guarded: false`): a vítima está sendo
     * segurada, não há o que bloquear. A defesa contra o arremesso já aconteceu
     * — era o escape. */
    v.applyHit({
      move: m, attacker: this, direction: this._desired, guarded: false, ctx,
    });

    this.move = m;
    this.moveKey = 'grab_throw';
    this._enter(S.THROW);
    this.char.play(m.clip, { fade: 0.05, restart: true });
    this.events.push({ type: 'throw', victim: v, move: m });

    // Arremessar lança → abre a janela de perseguição, como qualquer lançamento.
    if (v.state === S.BLOWAWAY) this.openPursuit(v);
  }

  _sThrow(dt, cmd, ctx) {
    const m = this.move;
    this.velocity.multiplyScalar(Math.exp(-8 * dt));
    if (!m || this.stateFrame >= moveTotalFrames(m)) {
      this._enter(S.IDLE);
      this.char.play('idle', { fade: 0.14 });
    }
  }

  /* --- Z-Counter / Sonic Sway ----------------------------------------- */
  /**
   * Tocou a guarda no momento exato do golpe: reverte a situação.
   *
   * Chamado pela resolução de acerto ANTES da checagem de guarda normal —
   * a ordem importa, senão um jogador que tocou no tempo certo seria tratado
   * como quem só estava segurando, e a leitura não valeria nada.
   *
   * @returns {boolean} true se o contra saiu
   */
  tryZCounter(attacker, ctx, move = null) {
    const Z = TUNING.defense.zCounter;
    if (this.counterArm > Z.window) return false;
    if (!this.canSpend(Z.kiCost)) return false;

    /* O GOLPE pode ser imune ao contra-ataque (§15, §21).
     *
     * Um grab não é contra-atacável: não há golpe pra ler, há uma pegada. E a
     * matriz de defesa é consultada aqui e não num `if` porque é ela que permite
     * um personagem ter um golpe à prova de Z-Counter sem tocar no código. */
    if (move) {
      if (move.zCounterable === false) return false;
      if (!defenseWorks(move, 'zcounter')) return false;
    }

    /* SÓ DE PÉ. Descoberto olhando a telemetria na tela: o contador era armado
     * em `update()`, que roda em TODOS os estados, então dava pra contra-atacar
     * de dentro do hitstun — martelar F escapava de qualquer combo de graça.
     * Isso anularia o hitstun inteiro e devolveria ao jogo exatamente a doença
     * que esta branch existe pra curar, só que pelo lado da defesa.
     *
     * Contra-atacar é uma leitura feita ANTES de apanhar. Quem já está sendo
     * atingido tem o vanish (que custa ki e escala) — não o contra. */
    if (!this.canAct || this.blockstunFrames > 0) return false;
    // Contra-atacar de costas não faz sentido — é a mesma regra da guarda.
    if (!attacker._facing(this)) return false;

    this.ki -= Z.kiCost;
    this.counterArm = 999;
    this.invulnFrames = Math.max(this.invulnFrames, Z.iframes);
    if (Z.clearsChain) { this.comboCount = 0; this.chainResetTimer = 0; }

    // Vira pro atacante: quem contra-ataca assume a ofensiva.
    this._tmp.subVectors(attacker.position, this.position);
    if (this._tmp.lengthSq() > 1e-6) this.yaw = Math.atan2(this._tmp.x, this._tmp.z);

    attacker.stagger(Z.attackerStunFrames);
    this.events.push({ type: 'zCounter', attacker });
    return true;
  }

  /**
   * O step saiu no tempo certo e o golpe passou raspando.
   *
   * Não é um estado novo — é o `step` reconhecido quando bem cronometrado.
   * Chamado quando um golpe bate em alguém invulnerável: se a invulnerabilidade
   * veio de um step RECÉM-iniciado, foi leitura, não sorte.
   */
  trySonicSway(attacker, ctx) {
    const SW = TUNING.defense.sonicSway;
    const st = TUNING.defense.step;
    if (this.state !== S.STEP) return false;

    if (this.stateFrame > st.iframes[0] + SW.window) return false;

    this.ki = Math.min(TUNING.ki.max, this.ki + SW.kiRefund);
    if (SW.clearsStepCooldown) this.stepCooldown = 0;
    if (SW.clearsChain) { this.comboCount = 0; this.chainResetTimer = 0; }
    this.events.push({ type: 'sonicSway', attacker });
    return true;
  }

  /**
   * Trava este lutador por N frames, interrompendo o que ele estava fazendo.
   * Usado pelo Z-Counter: o preço de ter o golpe lido é ficar exposto.
   */
  stagger(frames) {
    this._stunFrames = frames;
    this.comboCount = 0;
    this.chainResetTimer = 0;
    this.velocity.multiplyScalar(0.2);
    this._enter(S.HITSTUN);
    this.char.play('hit_react', { fade: 0.05, restart: true });
    this.events.push({ type: 'staggered' });
  }

  /* --- blast ---------------------------------------------------------- */
  _tryBlast(ctx) {
    const B = TUNING.blasts.ki_blast;
    if (this.blastCooldown > 0 || !this.canSpend(B.kiCost)) return false;
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

      if (this.canSpend(spec.kiCost)) {
        this.spendKi(spec.kiCost);
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
    if (!this.canSpend(U.kiCost)) return false;
    this.spendKi(U.kiCost);
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
    // `autoRecover` é o boneco de treino no modo RECUPERAÇÃO: ele sempre se
    // recupera na primeira oportunidade, pra você praticar LER a recuperação e
    // chegar em cima dela. Ki não entra na conta nesse modo, senão o boneco
    // pararia de recuperar depois de três smashes.
    if (this.autoRecover && f > TUNING.defense.recover.windowAfterFrames) {
      this._enter(S.RECOVER);
      this.invulnFrames = TUNING.defense.recover.iframes[1];
      this.char.play('dodge', { fade: 0.06, restart: true });
      this.events.push({ type: 'airRecover' });
      return;
    }

    if (f > TUNING.defense.recover.windowAfterFrames
        && (cmd.guard || cmd.vanish)
        && this.canSpend(TUNING.defense.recover.kiCost)) {
      this.spendKi(TUNING.defense.recover.kiCost);
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
  _smashKey(dir) { return smashKeyFor(dir); }

  /**
   * A direção segurada escolhe o golpe.
   *
   *   nada / direita → soco de direita
   *   esquerda       → soco de esquerda
   *   frente/cima    → gancho (levanta)
   *   trás/baixo     → chute descendente (crava)
   *
   * Vertical (Espaço/C) tem prioridade sobre o horizontal: quem aperta
   * Espaço+J está claramente pedindo o gancho, não um soco lateral.
   */
  _rushKey(cmd) { return rushKeyFor(cmd); }

  /**
   * @param {object} [cmd]  se vier, o alvo é reavaliado para ESTE golpe —
   *                        é o que permite trocar de alvo no meio do combo.
   */
  _tryAttack(key, ctx, cmd = null) {
    const m = moveOf(key);
    if (!m) return false;

    /* "É um ender?" passa a vir do TIPO do golpe, não do prefixo do nome.
     * Com kits, um personagem pode ter um finalizador que não se chama
     * `smash_*` — e um teste por string quebraria em silêncio, deixando um
     * ender contar como elo de rota. */
    const ender = m.type === 'smash' || m.type === 'pursuit';

    /* A ROTA TEM FIM — e o fim vale inclusive vindo da IDLE.
     *
     * Antes este teto era `emendando && comboCount >= maxChain`, ou seja, só
     * valia DENTRO do estado de ataque. O último elo terminava sozinho,
     * `_sAttack` zerava `comboCount`, e o próximo J começava uma cadeia nova.
     * Medido: elo máximo 6 (o teto "funcionava") e 126 acertos em 30 s de
     * martelada — vinte e uma cadeias emendadas uma na outra.
     *
     * Agora, esgotada a rota, rush NÃO SAI até a interação resetar
     * (`chainResetFrames` sem atacar). Sobram os enders e o reposicionamento —
     * que é exatamente o ponto de decisão que faltava. */
    if (!ender && this.comboCount >= this.maxChain) return false;

    // Reavalia a mira. Com lock-on solto, cada golpe procura o melhor alvo na
    // direção apontada — é assim que se troca de vítima no meio da sequência.
    if (cmd && ctx.pickTarget) {
      const novo = ctx.pickTarget(this, cmd);
      if (novo && novo !== this.target) {
        this.target = novo;
        /* Vira NA HORA pro novo alvo. O giro normal leva alguns frames, e
         * medindo ficou claro que o golpe da troca errava por isso: você
         * aponta pro outro cara, o comando troca certo, e o soco sai no vazio
         * porque o corpo ainda estava girando. A troca precisa ser instantânea
         * pra que apontar e bater sejam a mesma ação. */
        this._tmp.subVectors(novo.position, this.position);
        if (this._tmp.lengthSq() > 1e-6) this.yaw = Math.atan2(this._tmp.x, this._tmp.z);
        this.events.push({ type: 'targetSwitch', target: novo });
      }
    }

    /* Enders não contam como elo e, ao serem usados, ABREM a rota de novo
     * (`enderClearsChain`). Finalizar direito é recompensado: você fica livre
     * pra reengajar ou perseguir sem esperar o reset. */
    if (ender) {
      /* `noChainClear` existe pro spike de perseguição: ele é um ender, mas NÃO
       * pode devolver rota nova — senão a perseguição de alta velocidade daria
       * dano, distância E pressão, e as outras duas viravam decoração. */
      if (TUNING.combo.enderClearsChain && !m.noChainClear) this.comboCount = 0;
    } else {
      this.comboCount += 1;
    }
    this.chainResetTimer = TUNING.combo.chainResetFrames;

    this.move = m;
    this.moveKey = key;
    this.hitThisMove.clear();
    this.hitConfirmThisMove = false;
    this.blockConfirmThisMove = false;
    this._homingPulled = 0;      // teto de homing é POR GOLPE
    this._armorAbsorbed = 0;     // armor é POR GOLPE, como o homing

    /* Arma a carga se o golpe for carregável. Armamos SEMPRE, inclusive quando o
     * jogador só tocou: no frame seguinte, sem o botão segurado, a carga resolve
     * com zero frames e cai abaixo de `minHoldFrames` — que é exatamente o smash
     * normal de antes. É o que garante que o caminho do toque continue idêntico
     * ao comportamento medido, em vez de virar um segundo caminho parecido. */
    const CH = moveCharge(m);
    this.smashHolding = !!CH;
    this.smashChargeFrames = 0;
    this.smashPerfect = false;
    this._smashTelegraphed = false;

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
    const H = TUNING.homing;
    const gap = dist - H.idealGap;

    if (gap > 0) {
      this._tmp.divideScalar(dist);
      const k = 1 - Math.exp(-m.homingStrength * 30 * dt);
      let passo = gap * k;

      /* TETO POR GOLPE — é este limite que separa assistência de teleporte.
       *
       * Sem ele, medido nos 4 frames de startup de um rush: de 5 m o corpo
       * atravessava 3,11 m sem física nenhuma. Apertar J resolvia distância,
       * ângulo e trajetória sozinho, e o jogador não contribuía com
       * posicionamento — era a maior causa isolada do "boneco gruda".
       *
       * Com teto, o homing fecha o ÚLTIMO pedaço (perdoa mira imprecisa, que
       * é a armadilha 8.4) e devolve ao jogador a responsabilidade de ter
       * chegado perto. */
      const restante = Math.max(0, H.maxPull - this._homingPulled);
      passo = Math.min(passo, restante);
      if (passo > 0) {
        this.position.addScaledVector(this._tmp, passo);
        this._homingPulled += passo;
      }
    }

    this._faceTarget(dt, 4.0);
  }

  /**
   * Pra onde o golpe atual EMPURRA o corpo.
   *
   * Com alvo travado, é o vetor 3D até ele — é o que permite socar alguém
   * acima ou abaixo sem o corpo escorregar pela horizontal. Sem alvo, cai no
   * yaw (que é a única informação disponível), mas preserva a altura em vez de
   * cravar `y = 0`, senão atacar no vazio interrompe a subida/descida.
   */
  _attackForward(out) {
    // Horizontal continua vindo do YAW — é o que o corpo está mostrando, e
    // mudar isso faria o avanço divergir da animação.
    out.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));

    // A componente VERTICAL é a correção: vem do alvo, não de zero.
    if (this.lockOn && this.target && this.target.alive) {
      const dist = this.position.distanceTo(this.target.position);
      if (dist > 1e-4) {
        out.y = (this.target.position.y - this.position.y) / dist;
        out.normalize();
      }
    }
    return out;
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
    /* O dano de SAÍDA é do atacante (Max Power), o de ENTRADA é da vítima.
     * Manter os dois multiplicadores em lados opostos da conta é o que permite
     * ajustar um sem mexer no outro. */
    let damage = move.damage * (attacker?.damageMul ?? 1);
    let knockback = move.knockback;
    let knockup = move.knockup || 0;
    let result = 'hit';

    let exhausted = false;

    /* ================================================================
     *  ARMOR  (§21)
     * ================================================================
     *  O golpe que EU estou dando aguenta este toque sem ser interrompido?
     *
     *  Vale só durante o STARTUP: depois dos frames ativos o golpe já saiu, e
     *  armor no recovery tornaria o golpe pesado imune a punição — que é
     *  exatamente a brecha que o jogo de turnos precisa ter.
     *
     *  Absorver NÃO é de graça: o dano entra inteiro. O que armor compra é não
     *  perder o turno, e é o que permite um personagem pesado atravessar um jab
     *  sem que ele fique imune a um smash (o poiseDamage de um smash passa longe
     *  de qualquer valor de armor razoável). */
    if (this.state === S.ATTACK && this.move && this.move.armor > 0
        && this.stateFrame <= this.move.startup) {
      this._armorAbsorbed += move.poiseDamage || 0;
      if (this._armorAbsorbed < this.move.armor) {
        this.health = Math.max(0, this.health - damage);
        if (this.immortal && this.health <= 0) this.health = 1;
        this.flashFrames = TUNING.juice.impactFlashFrames;
        this.events.push({ type: 'armorAbsorb', attacker, damage });
        return 'armor';
      }
    }

    if (guarded) {
      const G = TUNING.defense.guard;
      if (move.guardBreak) {
        // Quebra por SMASH: dano cheio e voa longe. É a ferramenta de ring-out.
        result = 'guardbreak';
        this.guardStamina = 0;
        this._guardRegenDelay = G.staminaRegenDelayFrames;
      } else {
        result = 'guard';
        damage = move.chipDamage ?? damage * (1 - G.damageReduction);
        knockback *= (1 - G.knockbackReduction);
        knockup *= (1 - G.knockbackReduction);
        this.ki = Math.max(0, this.ki - G.kiPerHit);

        /* Blockstun de verdade. Antes ia pra `_stunFrames`, que só é lido em
         * `_sHitstun` — e quem bloqueia vai pro estado GUARD. Era frame data
         * morto: o defensor saía do bloqueio no mesmo frame. */
        this.blockstunFrames = move.blockstun;

        /* Aguentar pressão gasta o relógio da guarda. O desgaste é do GOLPE
         * quando ele declara (`guardDamage`), senão o padrão — é o que permite
         * um golpe quebra-guarda que não seja um smash. */
        this.guardStamina -= moveGuardDamage(move);
        if (this.guardStamina <= 0) { exhausted = true; result = 'guardexhaust'; }

        this.char.play('block_impact', { fade: 0.04, restart: true });
      }
    }

    this.health = Math.max(0, this.health - damage);
    // Boneco de treino não morre: a sessão precisa durar mais que dez segundos.
    if (this.immortal && this.health <= 0) this.health = 1;
    this.poise -= move.poiseDamage || 0;
    this.flashFrames = TUNING.juice.impactFlashFrames;

    /* BONECO "SEM REAÇÃO": leva o dano e o clarão, mas não sai do lugar nem
     * entra em hitstun. É o estado pra estudar hitbox, alcance e o ritmo do
     * combo sem ter que perseguir o alvo pela arena a cada acerto.
     *
     * Sai ANTES do knockback de propósito — mexer na velocidade e depois
     * "desfazer" deixaria resíduo de inércia. */
    if (this.noReaction) {
      if (this.poise <= 0) this.poise = this.maxPoise;
      this.velocity.set(0, 0, 0);
      this.vanishChain = 0;
      this.events.push({ type: 'damaged', result, damage, attacker });
      return result;
    }

    /* ================================================================
     *  LANÇAMENTO  (§9, §23)
     * ================================================================
     *  Duas formas de escrever a força, porque as duas são úteis:
     *
     *    knockback + knockup   componentes — a forma dos golpes MEDIDOS
     *    launch.speed + angle  polar      — a forma de quem desenha um kit novo
     *
     *  Os golpes atuais continuam em componentes de propósito: são os números
     *  verificados desta sessão, e reescrevê-los em polar mudaria o jogo por
     *  arredondamento. Um kit novo pode usar polar sem tocar em nada.           */
    this._tmp.copy(direction).setY(0);
    if (this._tmp.lengthSq() < 1e-6) this._tmp.set(Math.sin(attacker.yaw), 0, Math.cos(attacker.yaw));
    this._tmp.normalize();

    const L = move.launch;
    if (L && L.speed !== undefined && L.angle !== undefined) {
      // Polar: ângulo acima do horizonte, no plano da direção do golpe.
      const rad = L.angle * Math.PI / 180;
      const horiz = Math.cos(rad) * L.speed;
      this.velocity.copy(this._tmp).multiplyScalar(horiz);
      this.velocity.y = Math.sin(rad) * L.speed;
    } else {
      this.velocity.copy(this._tmp).multiplyScalar(knockback);
      this.velocity.y += knockup;
    }

    // Teto duro: um multiplicador de Perfect Smash sobre um knockback já alto
    // pode estourar a escala e mandar o corpo pro horizonte sem volta.
    const maxL = TUNING.launch.maxSpeed;
    if (this.velocity.lengthSq() > maxL * maxL) this.velocity.setLength(maxL);

    // --- estado resultante ---
    if (this.health <= 0) {
      this._enterBlowaway(move);
    } else if (exhausted) {
      // A guarda arrebentou no impacto: fica exposto em pé, punível.
      this._breakGuard();
    } else if (result === 'guard') {
      this._enter(S.GUARD, false);
      this.stateFrame = 0;
    } else if (move.causesBlowaway || result === 'guardbreak' || this.poise <= 0) {
      /* QUEBRA DE POISE — o disjuntor tem que DESARMAR, não só disparar.
       *
       * Antes, a vítima entrava em blowaway carregando a velocidade do golpe
       * que quebrou: um rush, 1.8 m/s. Como `blowaway.minSpeedToExit` é 4.0, o
       * estado terminava no frame seguinte. Medido em 30 s de martelada: o
       * poise quebrou 16 vezes e o blowaway durou 4 FRAMES em média — a vítima
       * voltava exatamente pro lugar onde estava apanhando.
       *
       * Agora a quebra tem impulso próprio, independente do golpe. O objetivo
       * dele não é dano: é SEPARAR OS CORPOS, devolver o neutro e abrir a
       * janela de perseguição. O disjuntor vira oportunidade. */
      if (this.poise <= 0 && !move.causesBlowaway && result !== 'guardbreak') {
        const F = TUNING.fighter;
        this.poise = this.maxPoise;
        this.velocity.copy(this._tmp).multiplyScalar(F.poiseBreakKnockback);
        this.velocity.y += F.poiseBreakKnockup;
        this.events.push({ type: 'poiseBreak', attacker });
      } else if (this.poise <= 0) {
        this.poise = this.maxPoise;
      }
      this._enterBlowaway(move);
    } else {
      this._enter(S.HITSTUN);
      /* Em Max Power você sai do stun antes. É o modificador mais valioso do
       * estado e o menos visível: não é dano, é TURNO — a diferença entre comer
       * a rota inteira e conseguir revidar no meio dela. */
      this._stunFrames = Math.round(
        move.hitstun * (this.inMaxPower ? TUNING.maxPower.hitstunTakenMul : 1));
      this.char.play('hit_react', { fade: 0.04, restart: true });
    }

    /* Ser atingido LARGA a pegada. Sem isto, um terceiro lutador batendo em quem
     * está agarrando deixava a vítima presa num estado sem dono — e com 20–30
     * lutadores na arena isso não é um caso de canto, é o normal. */
    if (this.grabbing) { this.grabbing.grabbedBy = null; this.grabbing = null; this.grabHold = 0; }
    if (this.grabbedBy) { this.grabbedBy.grabbing = null; this.grabbedBy = null; }

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
      if (this.state === S.MAXPOWER) intensity = TUNING.juice.auraChargeMultiplier * 1.4;
      else if (this.state === S.CHARGE) intensity = TUNING.juice.auraChargeMultiplier;
      else if (this.state === S.DASH) intensity = 1.2;
      else if (this.state === S.ULTIMATE) intensity = 2.0;
      else if (this.velocity.length() > TUNING.flight.baseSpeed * 0.8) intensity = 0.55;
      else intensity = 0.22;

      /* MAX POWER e EXAUSTÃO precisam ser legíveis SEM olhar número (§19).
       *
       * Os dois estados mudam o que o adversário pode fazer contra você, e
       * informação assim não pode estar escondida numa barra: quem está lutando
       * olha o corpo do outro, não a HUD. Aura acesa = cuidado; aura apagada =
       * ele não tem vanish nem dash, é a sua janela. */
      if (this.inMaxPower) intensity = Math.max(intensity, 1.6) * 1.35;
      else if (this.exhausted) intensity = Math.min(intensity, 0.12);

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
      if (state !== S.ATTACK) {
        this.move = null; this.moveKey = null;
        /* Sair do ataque desarma a carga.
         *
         * Visto na tela: interromperam um smash carregado no meio e
         * `smashHolding`/`smashChargeFrames` continuaram valendo `true`/`6`
         * depois do hitstun. Não quebrava o jogo (só `_sAttack` lê, e
         * `_tryAttack` rearma), mas a telemetria passava a mentir sobre o estado
         * do golpe — e a telemetria é o instrumento com que este jogo é afinado.
         * Instrumento que mente é pior que instrumento ausente. */
        this.smashHolding = false;
        this.smashChargeFrames = 0;
        this._smashTelegraphed = false;
      }
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
    this.poise = this.maxPoise;
    this.state = S.IDLE;
    this.stateFrame = 0;
    this.move = null;
    this.moveKey = null;
    this.comboCount = 0;
    this.chainResetTimer = 0;
    this.pursuitFrames = 0;
    this.pursuitTarget = null;
    this._pursuitCarry = 0;
    this._carryTarget = null;
    this.pursuitType = 'direct';
    this._pursuitSpec = null;

    /* Smash carregado, grab, vanish battle, Max Power e exaustão.
     *
     * Zerar TUDO aqui não é zelo: um `grabbing` sobrevivente aponta pra um corpo
     * que já foi reposicionado, e o lutador fica preso segurando um fantasma
     * até o fim do round. Foi assim que `immortal`/`noReaction` grudaram no
     * boneco de treino uma vez (ver `aplicarModoTreino` em main.js). */
    this.smashChargeFrames = 0;
    this.smashHolding = false;
    this.smashPerfect = false;
    this._smashTelegraphed = false;

    if (this.grabbing) this.grabbing.grabbedBy = null;
    if (this.grabbedBy) this.grabbedBy.grabbing = null;
    this.grabbing = null;
    this.grabbedBy = null;
    this.grabHold = 0;
    this.grabCooldown = 0;

    this.counterVanishFrames = 0;
    this.counterVanishFoe = null;
    this.vanishExchange = 0;

    this.maxPowerFrames = 0;
    this._maxPowerCharge = 0;
    this.exhaustFrames = 0;
    this._armorAbsorbed = 0;
    this.tradeLostFrames = 0;

    this.hitThisMove.clear();
    this.hitConfirmThisMove = false;
    this.blockConfirmThisMove = false;
    this._homingPulled = 0;      // teto de homing é POR GOLPE
    this.guardStamina = this.maxGuardStamina;
    this._guardRegenDelay = 0;
    this.blockstunFrames = 0;
    this.vanishCooldown = 0;
    this.guardPressFrame = 999;
    this._guardWasHeld = false;

    /* Z-COUNTER: o toque de guarda ARMA o contador, e só um a cada
     * `attemptCooldownFrames`. Separado de `guardPressFrame` (que serve ao
     * rebate de blast) de propósito — se martelar a guarda armasse o contador
     * a cada edge, F viraria o novo botão dominante. */
    this.counterArm = 999;
    this.counterCooldown = 0;
    this.noReaction = false;
    this.autoRecover = false;
    this.immortal = false;
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
