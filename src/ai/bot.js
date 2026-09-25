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
  constructor(fighter, seed = 1337, profile = 'EQUILIBRADO') {
    this.f = fighter;
    this.cmd = emptyCommand();

    /* Config efetiva = TUNING.ai + sobreposições do perfil.
     *
     * A mesclagem é feita TODO FRAME dentro de um objeto reaproveitado, e isso
     * é deliberado por dois motivos: congelar uma cópia mataria o painel de
     * tuning ao vivo (você arrastaria o slider e a IA ignoraria), e alocar um
     * objeto novo por bot por frame geraria lixo no laço mais quente com 30
     * lutadores na arena. */
    this._merged = {};
    this.setProfile(profile);

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
    this._smashHold = 0;
    /* Compromisso de carregar ki até acender o Max Power. Ver a nota longa no
     * bloco 2 do update: sorteio por frame não segura botão. */
    this._maxPowerIntent = 0;

    /* Quantos frames ainda vai SEGURAR a guarda.
     *
     * Sem isto a IA sorteava "bloquear?" a cada frame e devolvia guard=true por
     * um frame só. Como a guarda exige o botão pressionado, ela piscava e nunca
     * bloqueava de fato — medido: 1% de tempo em guarda, enquanto apanhava.
     * Decisão por frame não produz input segurado: é preciso COMPROMISSO. */
    this._holdGuard = 0;

    /* Impede a IA de punir TODA brecha. Sem um respiro ela vira uma parede
     * perfeita e o jogo fica injusto do outro lado — punir precisa parecer
     * leitura, não onisciência. */
    this._punishCooldown = 0;
  }

  /** Troca o estilo deste bot. Ver TUNING.ai.profiles. */
  setProfile(name) {
    this.profile = TUNING.ai.profiles[name] ? name : 'EQUILIBRADO';
    this._over = TUNING.ai.profiles[this.profile] || {};
    this._cfg();
  }

  /** Recalcula a config efetiva no objeto reaproveitado. */
  _cfg() {
    Object.assign(this._merged, TUNING.ai, this._over);
    return this._merged;
  }

  /** @returns {object} command */
  update(dt, ctx) {
    const c = this.cmd;
    resetCommand(c);

    const f = this.f;
    const foe = f.target;
    if (!f.alive || !foe || !foe.alive) return c;

    const A = this._cfg();
    if (!A.enabled) return c;

    const diff = A.difficulty;
    const dist = f.position.distanceTo(foe.position);

    if (this._punishCooldown > 0) this._punishCooldown--;

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

    /* ---------- PUNIR ----------
     *
     * A peça que faltava pro jogo ter teto competitivo.
     *
     * Bloquear e esquivar só neutralizam; não CUSTAM nada a quem martela o
     * botão. Enquanto a IA apenas se defendia, apertar rush sem pensar era a
     * jogada ótima — medido: martelar ganhava de jogar bem.
     *
     * Num jogo de luta o que desencoraja martelar é o CONTRA-ATAQUE na janela
     * de recovery. Todo golpe tem uma brecha depois dos frames ativos; quem
     * percebe, revida. É isso que separa quem aperta botão de quem joga.
     *
     * Vem ANTES do bloco de guarda de propósito: se viesse depois, a IA
     * continuaria bloqueando durante a brecha em vez de aproveitá-la.
     */
    /* A IA precisa MEDIR a brecha antes de revidar.
     *
     * Primeira tentativa: punir sempre que o adversário estivesse em recovery.
     * Ficou pior — contra quem martela, o adversário está em recovery quase
     * sempre, mas CANCELA no elo seguinte antes que o contra-ataque saia. A IA
     * largava a guarda, começava um golpe de 4 frames de startup e levava o
     * próximo soco no meio. Punir na hora errada é pior que não punir.
     *
     * A conta certa é frame data, e é a mesma que um jogador bom faz de
     * cabeça: "sobra recovery suficiente pro meu golpe sair antes do próximo
     * dele?" Se o golpe ainda estiver dentro da janela de cancelamento, a
     * brecha não existe — ele pode emendar. */
    const ocupado = foe.state === S.CHARGE || foe.state === S.BLAST || foe.state === S.ULTIMATE;
    let brechaFrames = 0;

    if (foe.state === S.ATTACK && foe.attackPhase === 'recovery' && foe.move) {
      const m = foe.move;
      const total = m.startup + m.active + m.recovery;
      brechaFrames = total - foe.stateFrame;

      /* Ainda pode cancelar no próximo elo → a brecha é ilusória.
       *
       * `contactAllowsChain` é a MESMA consulta que o Fighter usa pra decidir a
       * emenda — de propósito. Se a IA usasse uma conta paralela, as duas
       * divergiriam no primeiro ajuste de tuning e ela puniria na hora errada.
       * E isto não é trapaça: ver o adversário errar um soco (ou vê-lo bater na
       * sua guarda) é exatamente a informação que um humano usa pra punir. */
      const podeCancelar = foe.contactAllowsChain
        && m.cancelWindow && foe.stateFrame <= m.cancelWindow[1];
      if (podeCancelar) brechaFrames = 0;
    } else if (ocupado) {
      brechaFrames = 40;                       // carregar ki / ultimate: brecha enorme
    }

    // Startup do golpe mais rápido que a IA tem — é com ele que ela puniria.
    const meuStartup = TUNING.moves.rush_r.startup;
    const brechaVale = brechaFrames > meuStartup + A.punishMarginFrames;
    const janelaDePunicao = brechaVale && dist < A.punishRange;

    if (janelaDePunicao && this._punishCooldown === 0 && this._roll(A.punishChance * diff)) {
      this._holdGuard = 0;               // larga a guarda: agora é a minha vez
      this._punishCooldown = A.punishCooldownFrames;
      this._setMoveToward(c, _toFoe, ctx, dist > A.attackRange ? 1 : 0.3);

      // Brecha grande o bastante pro smash sair? Aí vale o golpe que dói.
      const brechaLonga = brechaFrames > TUNING.moves.smash_forward.startup + A.punishMarginFrames;
      if (brechaLonga && this._roll(0.55 + diff * 0.3)) {
        c.smash = true;
        c.smashDir = this._pickSmashDir(foe, ctx);
        this._smashHold = this._rollSmashCharge();
      } else {
        c.rush = true;
      }
      return c;
    }

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

    /* ---------- 1.4 RESPONDER À VANISH BATTLE ----------
     *
     * A janela tem 12 frames. Se a IA não responder, a vanish battle só existe
     * quando o JOGADOR é vanishado — ou seja, ela é uma mecânica de mão única e
     * o jogador nunca vê a troca acontecer contra ele. Vem antes de tudo porque
     * a janela é a mais curta do jogo.
     *
     * A chance é `vanishChance` reduzida: a IA às vezes deixa passar, e é isso
     * que a torna legível. Uma IA que SEMPRE responde transforma a troca num
     * teste de quem tem mais ki, não numa leitura. */
    if (f.counterVanishFrames > 0) {
      if (f.ki >= f.vanishCost() && this._roll(A.vanishChance * diff * 0.85)) {
        c.vanish = true;
        return c;
      }
    }

    /* ---------- 1.5 PERSEGUIR ----------
     *
     * A IA precisa participar da segunda disputa, senão ela só existe pro
     * jogador e o lançamento volta a ser um beco sem saída do outro lado.
     * Vem cedo na ordem de propósito: a janela é curta e perder ela é perder
     * a leitura inteira. */
    if (f.pursuitFrames > 0 && !f.exhausted && this._roll(A.aggression * 0.8 + diff * 0.2)) {
      /* ESCOLHE O TIPO (§10). Sem isto a IA só usava a direta e os outros dois
       * tipos nunca apareciam contra o jogador — existiriam no tuning e não no
       * jogo. A escolha é situacional, do jeito que um humano faria:
       *
       *   alvo já perto da borda  → ALTA VELOCIDADE (o spike re-lança = ring-out)
       *   alvo longe e com ki     → VANISH (garante chegar, ele ia recuperar)
       *   resto                   → DIRETA (barata, e a que rende rota nova)   */
      const alvoBorda = ctx.arena.edgeProximity(foe.position);
      const podeAlta = f.ki >= TUNING.pursuit.types.highSpeed.kiCost;
      const podeVanish = f.ki >= TUNING.pursuit.types.vanish.kiCost;

      if (alvoBorda > 0.45 && podeAlta && this._roll(A.ringOutIntent + 0.25)) {
        c.smash = true;                       // Shift+K
      } else if (dist > 16 && podeVanish && this._roll(0.4 * diff)) {
        c.vanish = true;                      // Shift+V
      }

      c.dash = true;
      this._setMoveToward(c, _toFoe, ctx);
      return c;
    }

    /* ---------- 1.6 GRAB: a resposta a quem só bloqueia ----------
     *
     * A medição desta sessão dizia que contra a guarda o ataque tinha uma
     * resposta só (o smash). Se a IA não usar o grab, o jogador nunca descobre
     * que segurar F tem um preço — e a ferramenta fica inerte pelo mesmo motivo
     * que `cancelOnBlock` ficou: ninguém a usa contra ele.
     *
     * A condição é o adversário ESTAR DEFENDENDO e estar colado. É exatamente
     * quando o grab é bom, e é o comportamento que ensina o jogador a não
     * bloquear cegamente. */
    const eleDefende = foe.state === S.GUARD || foe.blockstunFrames > 0;
    if (eleDefende && dist <= TUNING.defense.grab.range * 1.15
        && f.grabCooldown === 0 && f.canAct
        && this._roll(A.grabChance * (0.6 + diff * 0.6))) {
      c.grab = true;
      this._setMoveToward(c, _toFoe, ctx, 0.4);
      return c;
    }

    /* ---------- 2. carregar ki ----------
     *
     * Em EXAUSTÃO carregar é a única jogada sensata: nada que custa ki sai, e
     * ficar tentando é apertar botão morto. Mas só se houver espaço — carregar
     * colado no adversário é suicídio, e a IA não pode ser burra de um jeito que
     * falseie a medição do combate. */

    /* ================================================================
     *  MAX POWER: a IA precisa de uma INTENÇÃO, não de um sorteio
     * ================================================================
     *  Medido em 32 s de luta real: `maxPowerStart` disparou ZERO vezes. A causa
     *  eram duas condições mutuamente exclusivas:
     *
     *     a IA só carregava com    ki < chargeKiBelow  (28)
     *     o Max Power só acende com ki >= enterKiThreshold (78)
     *
     *  Ou seja, ela largava o charge aos 28 e nunca chegava perto do limiar.
     *  `ai.maxPowerChance` era um número inalcançável — a armadilha 8.19 mais
     *  uma vez, num parâmetro que eu mesmo acabei de criar.
     *
     *  A correção é a mesma lição da 8.15 (`guardHoldFrames`): decisão por frame
     *  não produz botão segurado. Acender exige 26 frames CONTÍNUOS de charge
     *  acima do limiar, então precisa ser um COMPROMISSO com prazo, não um
     *  sorteio a cada frame. */
    if (this._maxPowerIntent > 0) {
      this._maxPowerIntent--;
      // Abortar se o adversário chegou: carregar colado é suicídio, e insistir
      // faria a IA parecer quebrada em vez de ambiciosa.
      if (dist > 7 && !f.inMaxPower && !f.exhausted) { c.charge = true; return c; }
      this._maxPowerIntent = 0;
    } else if (!f.inMaxPower && !f.exhausted && dist > 10
               && f.ki >= TUNING.maxPower.enterKiThreshold * 0.8
               && this._roll(A.maxPowerChance * diff * 0.12)) {
      /* A chance é pequena POR FRAME porque este teste roda todo frame: 12% de
       * `maxPowerChance` dá ~uma tentativa a cada poucos segundos de neutro
       * afastado, que é a frequência que um humano usaria. */
      this._maxPowerIntent = TUNING.maxPower.enterHoldFrames + 40;
      c.charge = true;
      return c;
    }

    if ((f.exhausted || f.ki < A.chargeKiBelow) && dist > 8) {
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

      case 'attack': {
        this._setMoveToward(c, _toFoe, ctx, dist > A.attackRange ? 1 : 0.2);
        c.vertical = clampSign(vertical, 0.8);

        /* ROTA ESGOTADA: martelar rush não sai mais (nem a investida). Se a IA
         * insistisse, ela ficaria apertando um botão morto — que é exatamente
         * a experiência que estamos tirando do jogador. Ela tem que tomar a
         * MESMA decisão que o humano: finalizar ou sair. */
        if (f.comboCount >= TUNING.combo.maxChain) {
          if (dist <= A.attackRange * 1.3) {
            c.smash = true;
            c.smashDir = this._pickSmashDir(foe, ctx);
            this._smashHold = this._rollSmashCharge();
          } else {
            this._intent = 'reposition';
          }
          break;
        }

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
              this._smashHold = this._rollSmashCharge();
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
      }

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

    /* ================================================================
     *  A IA CARREGA O SMASH  (§7, §8)
     * ================================================================
     *  Sem isto o Perfect Smash é uma mecânica de mão única: o jogador pode
     *  acertar a janela, mas nunca sente o que é ENFRENTAR um smash carregado —
     *  que é justamente o mind game que a carga existe pra criar ("quando ele vai
     *  soltar?"). E é a metade do §34 que testa se o timing tem profundidade dos
     *  dois lados.
     *
     *  A IA não acerta a janela sempre: ela sorteia um alvo DENTRO da janela e
     *  erra por alguns frames conforme a dificuldade. Uma IA que acerta 100% dos
     *  Perfect Smashes não mediria o combate, mediria a paciência do jogador. */
    if (this._smashHold > 0) {
      this._smashHold--;
      c.smashHeld = true;
      c.smash = true;
    }

    return c;
  }

  /** Decide por quantos frames vai SEGURAR este smash. */
  _rollSmashCharge() {
    const A = this._merged;
    const CH = TUNING.smashCharge;
    if (!CH.enabled || !this._roll(A.smashChargeChance)) return 0;

    const [ini, fim] = CH.perfectWindow;
    const meio = (ini + fim) / 2;
    // Erro de timing que encolhe com a dificuldade: na difícil ela quase sempre
    // acerta a janela; na fácil solta cedo ou tarde e sai um smash comum.
    const erro = (this._rand() - 0.5) * 2 * (1 - A.difficulty) * (fim - ini) * 1.8;
    return Math.max(1, Math.round(meio + erro));
  }

  /* ---------------------------------------------------------------- */
  _chooseIntent(dist, diff, ctx) {
    const A = this._merged;
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
    const A = this._merged;
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
    const A = this._merged;
    const t = 1 - A.difficulty;
    return Math.round(A.reactionFramesMin + (A.reactionFramesMax - A.reactionFramesMin) * t);
  }

  _roll(p) { return this._rand() < p; }

  reset() {
    this._intent = 'approach';
    this._decisionTimer = 0;
    this._comboCount = 0;
    this._blastHold = 0;
    this._smashHold = 0;
    this._maxPowerIntent = 0;
    this._holdGuard = 0;
    this._punishCooldown = 0;
    resetCommand(this.cmd);
  }
}

/* ========================================================================== */
function resetCommand(c) {
  c.moveX = 0; c.moveY = 0; c.vertical = 0;
  c.rush = false; c.smash = false; c.blast = false; c.blastHeld = false;
  c.guard = false; c.vanish = false; c.dash = false; c.charge = false; c.ultimate = false;
  c.grab = false; c.smashHeld = false;
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
