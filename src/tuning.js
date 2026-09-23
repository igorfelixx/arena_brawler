/* =============================================================================
 *  tuning.js  —  TODOS OS NÚMEROS DO JOGO EM UM LUGAR SÓ
 *  MODELO DE COMBATE: Dragon Ball Budokai Tenkaichi 3 (Sparking! Meteor)
 * =============================================================================
 *
 *  Isto aqui é o que sobrevive ao protótipo.
 *
 *  O código three.js é descartável — não porta pra Unreal. Estes NÚMEROS portam:
 *  vira uma Data Table no Unreal, um ScriptableObject no Unity. Todo frame data
 *  está em FRAMES a 60fps, exatamente como uma engine de luta espera.
 *
 *  ---------------------------------------------------------------------------
 *  O QUE DEFINE O COMBATE TENKAICHI (e o que este arquivo modela)
 *  ---------------------------------------------------------------------------
 *   1. VOO LIVRE em 360° — não é jogo de chão. Altura é dimensão de verdade.
 *   2. LOCK-ON PERMANENTE — a câmera e o movimento sempre orbitam o alvo.
 *   3. RUSH COMBO — sequência rápida que termina em SMASH (manda voando longe).
 *   4. VANISH — sumir e reaparecer atrás de quem te bate. A mecânica assinatura.
 *      É o que transforma troca de socos em duelo de leitura.
 *   5. KI como recurso único — dash, vanish, blast, ultimate, tudo bebe da mesma
 *      barra. Carregar ki te deixa parado e vulnerável. É o loop de risco.
 *   6. DRAGON DASH — fechar distância em alta velocidade, colidindo.
 *   7. BLASTS — projéteis rápidos e ultimate cinematográfico.
 *
 *  Anatomia de um golpe:
 *
 *     |<- startup ->|<- active ->|<----- recovery ----->|
 *     0             4            7                      16
 *                   ^^^^^^^^^^^^
 *                   hitbox ligada
 *                   |<--- vanishWindow --->|
 *                   a vítima pode sumir aqui
 *
 *  Regra de ouro do Tenkaichi: o combo é RÁPIDO, o smash é LENTO e o vanish é a
 *  válvula de escape. Se ficar sem graça, o problema quase sempre é que o smash
 *  não está mandando longe o bastante — aumente `knockback` antes de tudo.
 * ========================================================================== */

export const TUNING = {

  /* ================================================================== */
  /*  SIMULAÇÃO                                                          */
  /* ================================================================== */
  sim: {
    fps: 60,                    // passo fixo. NÃO mude — todo frame data depende disto.
    maxCatchUpFrames: 5,        // teto de recuperação após travada
  },

  /* ================================================================== */
  /*  VOO E MOVIMENTO  —  o jogo é 100% aéreo                            */
  /* ================================================================== */
  flight: {
    baseSpeed: 13.0,            // m/s — voo normal
    boostSpeed: 30.0,           // m/s — segurando boost
    dashSpeed: 62.0,            // m/s — Dragon Dash (投 em direção ao alvo)
    accel: 55,                  // m/s²
    decel: 42,
    verticalSpeed: 11.0,        // m/s — subir/descer
    turnSpeed: 9.0,             // rad/s — giro do corpo (baixo = mais peso)
    strafeMul: 0.9,             // orbitar o alvo é um pouco mais lento
    // Recuar é um COMPROMISSO, não fuga grátis. A 0.7 dava 9,1 m/s de ré —
    // o adversário escapava de qualquer aproximação só segurando pra trás,
    // que foi exatamente a reclamação ("o cara só apertando S se esquiva").
    backMul: 0.48,

    // Altura livre. O chão existe só como referência visual e pra slam.
    minY: 0.6,
    maxY: 85.0,

    hoverBobAmp: 0.11,          // flutuação sutil parado (vida ao personagem)
    hoverBobSpeed: 1.7,
  },

  dragonDash: {
    kiCost: 14,
    startupFrames: 6,
    maxFrames: 90,              // dura enquanto segurar, até este teto
    // Curva DIRIGINDO NA MÃO (sem lock, ou segurando direção). Baixo de
    // propósito: é o compromisso de não poder mudar de ideia no meio do dash.
    turnSpeed: 4.5,             // rad/s
    // Curva PERSEGUINDO com lock-on. Precisa ser bem maior, senão o dash chega
    // atrasado num alvo que está acima/abaixo e passa reto. A mira INICIAL já
    // sai travada no alvo; isto aqui é só a correção enquanto ele se move.
    chaseTurnSpeed: 11.0,       // rad/s

    /* IMPACTO — trombar no adversário durante o dash.
     * Dano quase simbólico de propósito: o dash é ferramenta de POSIÇÃO, não de
     * dano. O valor dele é chegar perto e barrar o outro; se machucasse muito,
     * spammar dash seria melhor que combar. */
    impactDamage: 4,
    impactPoiseDamage: 6,
    impactKnockback: 11,
    impactKnockup: 1.2,
    impactHitstun: 18,
    impactBlockstun: 12,
    impactHitstop: 9,
    impactShake: 0.3,
    // Quanto da própria velocidade o atacante mantém ao trombar.
    // 0.12 = praticamente para. É o que impede de atravessar e seguir reto.
    impactSelfSlowdown: 0.12,
    // Margem extra de colisão. A 62 m/s o corpo anda ~1 m por frame, então sem
    // folga o teste de distância pula por cima do adversário entre dois frames.
    impactReachBonus: 1.4,
    impactVanishWindow: 10,     // dá pra vanishar de uma tromba de dash
    // Após trombar, precisa SOLTAR e reapertar — e ainda esperar isto.
    // Sem os dois, segurar o botão encadeia trombas e vira a melhor jogada.
    impactCooldownFrames: 18,
    // Dash contra dash = clash (os dois ricocheteiam). Puro espetáculo.
    clashEnabled: true,
    clashKnockback: 24,
    clashHitstop: 22,
    clashShake: 0.8,
  },

  /* ================================================================== */
  /*  KI  —  recurso único. Tudo bebe daqui.                             */
  /* ================================================================== */
  ki: {
    max: 100,
    startPercent: 0.55,
    passiveRegenPerSec: 2.2,    // regen lento só andando

    // Carregar ki: parado, vulnerável, mas enche rápido. O loop de risco.
    chargeRatePerSec: 46,
    chargeStartupFrames: 8,
    chargeVulnerableMul: 1.35,  // toma 35% mais dano carregando

    // Ki baixo bloqueia as ferramentas de escape — é o que gera pressão.
    lowKiThreshold: 20,
  },

  /* ================================================================== */
  /*  FÍSICA                                                             */
  /* ================================================================== */
  /*  O jogo é aéreo: NÃO há gravidade no voo normal. Estes valores só
   *  entram quando o corpo perde o controle (blowaway, queda, knockdown). */
  physics: {
    gravity: 26,                // m/s² — só em blowaway/knockdown
    knockbackDecay: 4.5,        // quão rápido o empurrão do hitstun morre
    maxFlightSpeed: 90,         // teto duro de velocidade (anti-explosão numérica)
    airDrag: 0.3,
  },

  /* ================================================================== */
  /*  QUEDA / LEVANTAR                                                   */
  /* ================================================================== */
  knockdown: {
    groundFrames: 34,           // tempo caído no chão
    getupFrames: 22,
    getupIframes: [0, 14],      // invencível levantando (evita "oki" infinito)
  },

  /* ================================================================== */
  /*  LUTADOR                                                            */
  /* ================================================================== */
  fighter: {
    maxHealth: 100,
    radius: 0.55,               // raio de colisão
    height: 1.8,
    pushForce: 7,

    // Poise: quantos golpes aguenta sem cambalear. Impede stunlock eterno.
    maxPoise: 34,
    poiseRegenPerSec: 14,
    poiseBreakStunFrames: 30,
  },

  /* ================================================================== */
  /*  MIRA  —  com 20–30 jogadores, "em quem eu bato?" é O jogo           */
  /* ================================================================== */
  targeting: {
    acquireRange: 14.0,         // até onde um golpe procura alvo (lock solto)
    lockKeepRange: 60.0,        // acima disto o lock-on se rompe sozinho

    /* Pesos da pontuação de escolha. O de ALINHAMENTO é o que dá controle ao
     * jogador: só distância faz o alvo pular sozinho entre inimigos sempre que
     * um chega meio metro mais perto, e você perde a noção de quem está batendo. */
    distanceWeight: 1.0,
    aimWeight: 1.6,
    minAlignment: -0.25,        // ignora quem está às costas, se você apontou

    stickyBonus: 0.35,          // histerese: evita troca nervosa entre dois alvos
    helplessBonus: 0.5,         // combar quem está indefeso é a jogada certa

    // Quantos inimigos a IA considera. Mantém o custo previsível com 30 na arena.
    aiScanLimit: 6,
  },

  /* ================================================================== */
  /*  PARTIDA                                                            */
  /* ================================================================== */
  match: {
    /* Nº de oponentes controlados por IA. Suba pra sentir o tumulto que o
     * jogo final propõe (o alvo é 20–30 no total). Custa CPU: cada um roda
     * uma máquina de estados e uma árvore de decisão por frame. */
    opponents: 2,
  },

  /* ================================================================== */
  /*  REGRAS DE COMBO                                                    */
  /* ================================================================== */
  combo: {
    /* Só dá pra emendar no próximo elo se o golpe ENCOSTOU (acerto ou defesa).
     *
     * É a regra que impede martelar botão de ser a jogada ótima, e é padrão
     * em jogo de luta ("chain on hit/block"). Sem ela o combo emenda no vazio,
     * o atacante nunca fica exposto, e não existe brecha pra punir — medido:
     * martelar J ganhava de todo o resto, e a IA estava CERTA em não tentar
     * revidar, porque janela segura de fato não havia.
     *
     * Com ela, as duas coisas que o jogo precisa acontecem ao mesmo tempo:
     *   acertou  → o combo flui, é gostoso, qualquer um consegue
     *   errou    → come o recovery inteiro e leva punição
     *
     * Ou seja: o piso continua baixo (encostar é fácil) e o teto sobe
     * (atacar no vazio passa a custar caro). */
    cancelOnlyOnContact: true,

    /* Teto de elos antes de ser obrigado a finalizar (ou soltar).
     * Com golpes direcionais emendando uns nos outros livremente, sem teto o
     * combo vira laço infinito e a vítima nunca joga. Ao estourar, só resta
     * smash — que é lento e vanishável, devolvendo a chance de escapar. */
    maxChain: 6,
  },

  /* ================================================================== */
  /*  INVESTIDA DE RUSH  —  apertar ataque de longe te LEVA até o inimigo */
  /* ================================================================== */
  /*  A mecânica que faltava, e a mais importante deste arquivo pro jogo
   *  ser divertido.
   *
   *  Sem ela, medido em 25 s de luta real: 0 de dano dos dois lados,
   *  distância mediana de 14,7 m, 20% do tempo dentro do alcance. Os dois
   *  lutadores voavam sem nunca se tocar. O motivo é que atacar CONGELA o
   *  movimento (o estado de ataque não lê o direcional), então martelar o
   *  botão deixava o jogador parado enquanto o adversário se afastava.
   *
   *  No Tenkaichi, apertar rush a média distância faz você voar até o
   *  adversário e emendar o combo. O ataque É a ferramenta de aproximação.
   *
   *  Isto baixa o piso (qualquer um encosta no inimigo) sem baixar o teto:
   *  a investida é comprometida e em linha reta, então dá pra ser bloqueada,
   *  punida com smash, ou passada com vanish. Quem lê ganha. */
  rushApproach: {
    range: 17.0,                // até esta distância, J vira investida
    speed: 40.0,                // m/s
    turnSpeed: 13.0,            // rad/s — persegue bem, o alvo se move
    maxFrames: 50,              // desiste depois disso
    attackAt: 2.3,              // ao chegar aqui, emenda no rush direcional
    kiCost: 0,                  // de graça: é a ferramenta básica de engajar
  },

  /* ================================================================== */
  /*  RUSH COMBO  —  a sequência rápida de socos                         */
  /* ================================================================== */
  /*  Cada elo é curto (~14 frames total) e emenda no seguinte. O ÚLTIMO
   *  elo é o SMASH: lento, forte, manda voando. É o ritmo do Tenkaichi.
   *
   *  REGRA DE BALANCEAMENTO: `blockstun` é MENOR que o recovery do golpe.
   *  Isso significa que quem BLOQUEIA sai do stun antes de quem atacou, e
   *  ganha o turno. É o que pune martelar botão na guarda alheia — sem isso,
   *  o atacante mantém a vez pra sempre e apertar rush vira a jogada ótima.  */
  moves: {
    /* ---- RUSH DIRECIONAL ----
     *
     * A direção que você segura escolhe o golpe. Não há ordem fixa: você
     * COMPÕE o combo. Qualquer elo emenda em qualquer outro (se encostar),
     * até `combo.maxChain`.
     *
     *   J          soco de direita
     *   J + A      soco de esquerda
     *   J + W      gancho — levanta o alvo, abre perseguição aérea
     *   J + S      chute de cima pra baixo — crava o alvo
     *
     * Direita e esquerda quase não deslocam o alvo (servem pra prender no
     * combo). Cima e baixo deslocam de verdade — são as ferramentas de
     * posicionamento, e é com elas que se prepara o ring-out ou o slam.
     * O finalizador pesado continua sendo o smash (K). */

    rush_r: {
      clip: 'attack_light_1',
      startup: 4, active: 3, recovery: 9,
      damage: 5,
      poiseDamage: 6,
      socket: 'hand_r',
      hitboxRadius: 0.68,
      knockback: 1.8,
      knockup: 0.0,
      hitstop: 4,
      shake: 0.09,
      hitstun: 14,
      blockstun: 4,
      chipDamage: 0.3,
      cancelInto: ['rush_r', 'rush_l', 'rush_u', 'rush_d',
                   'smash_forward', 'smash_up', 'smash_down'],
      cancelWindow: [5, 16],
      homingRange: 5.0,
      homingStrength: 0.85,
      advanceSpeed: 7.0,
      advanceFrames: [1, 6],
      vanishWindow: 9,
    },

    rush_l: {
      clip: 'attack_light_2',
      startup: 4, active: 3, recovery: 9,
      damage: 5,
      poiseDamage: 6,
      socket: 'hand_l',
      hitboxRadius: 0.68,
      knockback: 1.8,
      knockup: 0.0,
      hitstop: 4,
      shake: 0.09,
      hitstun: 14,
      blockstun: 4,
      chipDamage: 0.3,
      cancelInto: ['rush_r', 'rush_l', 'rush_u', 'rush_d',
                   'smash_forward', 'smash_up', 'smash_down'],
      cancelWindow: [5, 16],
      homingRange: 5.0,
      homingStrength: 0.85,
      advanceSpeed: 7.0,
      advanceFrames: [1, 6],
      vanishWindow: 9,
    },

    rush_u: {                     // gancho: manda pra cima
      clip: 'attack_up',
      startup: 6, active: 3, recovery: 12,
      damage: 6,
      poiseDamage: 9,
      socket: 'hand_r',
      hitboxRadius: 0.70,
      knockback: 1.2,
      knockup: 9.0,               // levanta o alvo — abre perseguição aérea
      hitstop: 6,
      shake: 0.16,
      hitstun: 20,
      blockstun: 6,
      chipDamage: 0.4,
      cancelInto: ['rush_r', 'rush_l', 'rush_u', 'rush_d',
                   'smash_forward', 'smash_up', 'smash_down'],
      cancelWindow: [7, 20],
      homingRange: 5.0,
      homingStrength: 0.85,
      advanceSpeed: 6.0,
      advanceFrames: [1, 7],
      vanishWindow: 10,
    },

    rush_d: {                     // chute descendente: crava
      clip: 'attack_down',
      startup: 6, active: 3, recovery: 13,
      damage: 7,
      poiseDamage: 10,
      socket: 'foot_r',
      hitboxRadius: 0.72,
      knockback: 1.2,
      knockup: -11.0,             // crava pra baixo — prepara o slam no chão
      hitstop: 7,
      shake: 0.18,
      hitstun: 22,
      blockstun: 7,
      chipDamage: 0.5,
      cancelInto: ['rush_r', 'rush_l', 'rush_u', 'rush_d',
                   'smash_forward', 'smash_up', 'smash_down'],
      cancelWindow: [7, 21],
      homingRange: 5.0,
      homingStrength: 0.85,
      advanceSpeed: 6.0,
      advanceFrames: [1, 7],
      vanishWindow: 10,
    },

    /* ---- SMASH ATTACKS — o que manda o inimigo pra fora da arena ---- */

    smash_forward: {            // direção + soco: manda reto pra longe
      clip: 'attack_heavy',
      startup: 13, active: 4, recovery: 24,
      damage: 16,
      poiseDamage: 40,
      socket: 'hand_r',
      hitboxRadius: 0.75,
      knockback: 46.0,          // ← É ISTO que causa ring-out. Mexa aqui primeiro.
      knockup: 3.0,
      hitstop: 16,
      shake: 0.8,
      hitstun: 55,
      blockstun: 26,
      chipDamage: 3.0,
      guardBreak: true,
      cancelInto: [],
      cancelWindow: null,
      homingRange: 5.5,
      homingStrength: 0.9,
      // Impulso pra frente durante o golpe. Sem isto, atacar congela
      // o movimento e o adversário simplesmente anda pra trás.
      advanceSpeed: 11.0,
      advanceFrames: [6, 16],
      vanishWindow: 14,         // janela generosa — smash tem que ser evitável
      causesBlowaway: true,     // vítima entra em estado "voando descontrolado"
      trail: true,
      punchZoom: true,
    },

    smash_up: {                 // manda pra cima — prepara perseguição aérea
      clip: 'attack_heavy',
      startup: 12, active: 4, recovery: 22,
      damage: 14,
      poiseDamage: 38,
      socket: 'hand_l',
      hitboxRadius: 0.72,
      knockback: 12.0,
      knockup: 38.0,
      hitstop: 14,
      shake: 0.65,
      hitstun: 50,
      blockstun: 24,
      chipDamage: 2.6,
      guardBreak: true,
      cancelInto: [],
      cancelWindow: null,
      homingRange: 5.5,
      homingStrength: 0.9,
      // Impulso pra frente durante o golpe. Sem isto, atacar congela
      // o movimento e o adversário simplesmente anda pra trás.
      advanceSpeed: 10.0,
      advanceFrames: [6, 15],
      vanishWindow: 14,
      causesBlowaway: true,
      trail: true,
    },

    smash_down: {               // crava pro chão — slam com cratera
      clip: 'attack_heavy',
      startup: 14, active: 4, recovery: 26,
      damage: 18,
      poiseDamage: 42,
      socket: 'hand_r',
      hitboxRadius: 0.75,
      knockback: 8.0,
      knockup: -42.0,           // negativo = pra baixo
      hitstop: 18,
      shake: 0.9,
      hitstun: 58,
      blockstun: 28,
      chipDamage: 3.4,
      guardBreak: true,
      cancelInto: [],
      cancelWindow: null,
      homingRange: 5.5,
      homingStrength: 0.9,
      // Impulso pra frente durante o golpe. Sem isto, atacar congela
      // o movimento e o adversário simplesmente anda pra trás.
      advanceSpeed: 11.0,
      advanceFrames: [7, 17],
      vanishWindow: 14,
      causesBlowaway: true,
      groundSlam: true,         // impacto extra + cratera ao bater no chão
      trail: true,
      punchZoom: true,
    },
  },

  /* ================================================================== */
  /*  BLASTS  —  projéteis de ki                                         */
  /* ================================================================== */
  blasts: {
    ki_blast: {                 // tiro rápido, spam barato
      startup: 6, recovery: 10,
      kiCost: 4,
      damage: 5,
      speed: 48,
      radius: 0.35,
      lifetimeSec: 2.6,
      homingStrength: 0.30,     // curva atrás do alvo — perdoa mira ruim
      knockback: 5.0,
      hitstop: 5,
      shake: 0.12,
      hitstun: 12,
      color: 0x55ccff,
      deflectable: true,        // dá pra rebater com guarda no timing
    },

    charged_blast: {            // segurar pra carregar
      startup: 10, recovery: 22,
      kiCost: 18,
      minChargeFrames: 20,
      maxChargeFrames: 90,
      damage: 12,               // no mínimo de carga
      damageAtFull: 34,
      speed: 34,
      radius: 0.9,
      radiusAtFull: 1.9,
      lifetimeSec: 3.4,
      homingStrength: 0.18,
      knockback: 26.0,
      knockbackAtFull: 44.0,
      hitstop: 14,
      shake: 0.6,
      hitstun: 44,
      color: 0x66eaff,
      causesBlowaway: true,
      deflectable: false,
    },

    ultimate: {                 // o Kamehameha. Caro, lento, decide a luta.
      startup: 40,              // telegrafadíssimo de propósito
      recovery: 60,
      kiCost: 70,
      damage: 52,
      beamLengthMax: 70,
      beamRadius: 2.2,
      durationFrames: 70,
      tickDamageFrames: 6,      // dano a cada N frames enquanto o feixe pega
      knockback: 70.0,
      hitstop: 24,
      shake: 1.6,
      hitstun: 90,
      color: 0x88f0ff,
      cinematicFrames: 46,      // câmera dramática na largada
      causesBlowaway: true,
      // 0 = a mira trava no disparo e o feixe vai reto (padrão, e o certo:
      // um feixe que persegue é indesviável). Suba um pouco só se acertar
      // estiver difícil demais. Acima de ~0.3 vira teleguiado.
      aimTracking: 0,
    },
  },

  /* ================================================================== */
  /*  DEFESA E ESCAPE                                                    */
  /* ================================================================== */
  defense: {
    guard: {
      damageReduction: 0.80,
      knockbackReduction: 0.60,
      enterFrames: 2,
      exitFrames: 4,
      kiPerHit: 3,              // guarda gasta ki no Tenkaichi
      guardBreakStunFrames: 42,
      // Rebater ki blast: apertar guarda no timing devolve o projétil.
      deflectWindowFrames: 8,
      deflectSpeedMul: 1.25,
    },

    /* VANISH — a mecânica assinatura. Some e reaparece atrás do atacante.
     * Custa ki. Se o atacante também tiver ki, ele pode contra-vanishar:
     * é assim que nascem as trocas em alta velocidade do Tenkaichi. */
    vanish: {
      kiCost: 20,
      // Só funciona se apertado dentro do `vanishWindow` do golpe recebido.
      startupFrames: 2,
      recoveryFrames: 12,
      reappearDistance: 1.9,    // metros atrás do atacante
      reappearBehind: true,
      hitstop: 12,
      slowMoFrames: 16,         // câmera lenta no vanish — leitura dramática
      slowMoScale: 0.3,
      shake: 0.35,
      afterimageCount: 5,       // rastro de imagens residuais
      afterimageLifeSec: 0.32,
      // Chain limit: impede vanish-war infinito entre dois jogadores cheios.
      maxChain: 4,
      chainKiMultiplier: 1.4,   // cada vanish seguido custa 40% a mais
    },

    /* Step dodge — esquiva curta, barata, sem custo de ki. */
    step: {
      clip: 'dodge',
      totalFrames: 20,
      iframes: [2, 11],
      distance: 4.2,
      speedCurve: [0, 1, 0.95, 0.4, 0],
      cooldownFrames: 12,
      kiCost: 0,
    },

    /* Recuperação no ar após levar smash — aperta no timing e para de voar. */
    recover: {
      kiCost: 10,
      windowAfterFrames: 12,    // só pode recuperar após N frames voando
      frames: 18,
      iframes: [0, 12],
      // Sem isto, levar um smash = morte garantida. Com isto, vira leitura.
    },
  },

  /* ================================================================== */
  /*  BLOWAWAY  —  estado de "voando descontrolado" após um smash         */
  /* ================================================================== */
  blowaway: {
    drag: 1.35,                 // desaceleração no ar (baixo = voa MUITO longe)

    /* A saída do blowaway é por VELOCIDADE, nunca por tempo. Devolver o
     * controle com o corpo ainda voando rápido cria um estado esquisito em que
     * o jogador não consegue se mover (a inércia come o input) mas já pode
     * atacar — parece socar estando desmaiado. */
    minSpeedToExit: 4.0,        // abaixo disso sai do estado
    maxFrames: 150,             // a partir daqui começa a FREAR (não solta)
    overtimeBrake: 6.0,         // força do freio depois do maxFrames
    overtimeMaxFrames: 120,     // rede de segurança: nunca travar no estado
    groundBounceRestitution: 0.42,
    groundBounceDamage: 4,
    groundBounceShake: 0.35,
    craterOnImpact: true,
    // Perseguir quem está voando (dash + soco) = a jogada mais satisfatória.
    chaseWindowFrames: 60,
  },

  /* ================================================================== */
  /*  ARENA                                                              */
  /* ================================================================== */
  /*  Arena Tenkaichi é GRANDE. Precisa de espaço pro smash mandar longe.
   *  Ela encolhe como uma cúpula (raio E teto), não como um círculo.       */
  arena: {
    // Dimensionada pelo SMASH, não por gosto. Com knockback 46 m/s e drag 1.35,
    // um corpo lançado percorre ~34 m antes de parar. Raio 48 significa que um
    // smash acertado no CENTRO não põe ninguém pra fora — mas um smash acertado
    // na metade externa põe. É o que transforma posicionamento em jogo: você
    // luta tentando empurrar o outro pra fora antes que ele te empurre.
    // (No primeiro teste o raio era 40 e um único smash matava de qualquer
    //  lugar da arena — virou roleta em vez de duelo.)
    startRadius: 48.0,          // metros
    minRadius: 15.0,
    startCeiling: 52.0,         // teto da cúpula
    minCeiling: 24.0,
    shrinkStartSec: 30,
    shrinkDurationSec: 150,
    warningSec: 5,
    edgeDangerBand: 6.0,        // faixa da borda que pisca
    ringOutRadiusGrace: 2.0,    // margem antes de contar como fora
    ringOutY: -8.0,
    outOfBoundsFrames: 50,      // frames fora antes de eliminar (dá tempo de voltar)
    floorY: 0,
  },

  /* ================================================================== */
  /*  JUICE  —  no Tenkaichi isto não é enfeite, é METADE do jogo         */
  /* ================================================================== */
  juice: {
    hitstopEnabled: true,
    hitstopScale: 1.0,
    hitstopShakeAmp: 0.05,      // vibração DURANTE o congelamento

    shakeEnabled: true,
    shakeScale: 1.0,
    shakeDecay: 7.0,
    shakeFrequency: 34,
    shakeMaxOffset: 0.9,

    impactFlashFrames: 4,
    impactSparkCount: 26,
    impactSparkSpeed: 9.0,
    impactSparkLife: 0.40,

    punchZoomEnabled: true,
    punchZoomAmount: 7.0,
    punchZoomFrames: 10,

    // Aura de ki: o visual que define Dragon Ball. É procedural, sem asset.
    auraEnabled: true,
    auraParticles: 60,
    auraRiseSpeed: 3.4,
    auraIntensity: 1.0,
    auraChargeMultiplier: 2.6,  // aura explode ao carregar ki

    // Speed lines radiais no dash — vende a velocidade sozinho.
    speedLinesEnabled: true,
    speedLinesThreshold: 24,    // m/s a partir do qual aparecem

    afterimageEnabled: true,
    afterimageInterval: 3,      // a cada N frames em alta velocidade
    afterimageLifeSec: 0.26,

    trailSegments: 16,
    // Bloom alto é a armadilha mais fácil de cair num jogo com muita luz: fica
    // bonito numa screenshot parada e ilegível em movimento. Threshold ALTO faz
    // só o que é de fato brilhante (ki, faísca, aura) florescer — o resto da
    // cena fica nítido. Se quiser mais brilho, suba o threshold junto.
    bloomStrength: 0.55,
    bloomRadius: 0.42,
    bloomThreshold: 0.86,
  },

  /* ================================================================== */
  /*  CÂMERA  —  lock-on permanente, estilo Tenkaichi                     */
  /* ================================================================== */
  camera: {
    fov: 58,
    // A câmera fica ATRÁS do jogador, enquadrando o alvo à frente.
    // 6.2 e não 7.5: no primeiro teste os dois lutadores ficavam pequenos
    // demais na tela e a pose do golpe virava ilegível.
    distance: 6.2,
    height: 1.7,
    shoulderOffset: 0.7,        // desloca pro lado (ombro) — tira o alvo do centro

    followLag: 11.0,
    rotateLag: 9.0,

    // Afasta conforme os dois se distanciam, pra manter os dois na tela.
    widenPerMeter: 0.16,
    maxDistance: 22.0,
    lockBreakRange: 90.0,

    // Em alta velocidade a câmera recua e o FOV abre = sensação de velocidade.
    speedFovPerUnit: 0.30,
    speedFovMax: 26,
    speedDistancePerUnit: 0.07,

    manualPitchMin: -0.9,       // radianos
    manualPitchMax: 0.9,
    mouseSensitivity: 0.0026,
  },

  /* ================================================================== */
  /*  IA DO OPONENTE                                                     */
  /* ================================================================== */
  ai: {
    enabled: true,
    difficulty: 0.6,            // 0..1 — afeta reação, agressão e uso de vanish

    /* Tempo de reação, em frames desde o início do golpe adversário.
     *
     * ATENÇÃO: isto só funciona se for MENOR que o startup do golpe. Com
     * min 10 / max 24 e o rush tendo 4 frames de startup, a IA nunca
     * conseguia reagir a nada — nem guarda, nem vanish. Ela parecia difícil
     * por outros motivos, mas estava desarmada na defesa. */
    reactionFramesMin: 2,
    reactionFramesMax: 9,
    // Distância que tenta manter. Estava em 6 e a luta acontecia a ~15 m.
    preferredRange: 4.0,
    engageRange: 45.0,
    attackRange: 2.6,
    dashRange: 22.0,

    aggression: 0.58,
    guardChance: 0.40,
    /* Chance de segurar guarda por ANTECIPAÇÃO com o adversário colado —
     * não por reação. É este número que impede "martelar um botão" de ser uma
     * estratégia vencedora, sem exigir da IA reflexos impossíveis.
     * Suba pra deixar a IA mais paredão; baixe pra deixar a luta mais solta. */
    anticipateGuardChance: 0.55,

    /* PUNIR — contra-atacar na janela de recovery do adversário.
     *
     * É o parâmetro que decide se martelar botão funciona. Bloquear só
     * neutraliza; punir COBRA um preço. Enquanto a IA só se defendia, apertar
     * rush sem pensar era a jogada ótima.
     *
     * punishChance é a mais importante do arquivo pro equilíbrio casual vs
     * competitivo: alto demais e o jogo pune iniciante sem dó; baixo demais e
     * martelar volta a ganhar. Mexa aqui primeiro. */
    punishChance: 0.7,
    punishRange: 5.0,
    punishCooldownFrames: 24,   // respiro: punir tem que parecer leitura, não onisciência
    /* Margem de segurança da conta de frame data. A IA só revida se a brecha
     * do adversário for maior que o startup do próprio golpe MAIS isto.
     * Zero faria ela punir brechas apertadíssimas e perder a troca; alto
     * demais faz ela deixar passar punição legítima. */
    punishMarginFrames: 4,
    /* Por quantos frames a IA SEGURA a guarda depois de decidir bloquear.
     * Decisão por frame não produz input segurado — sem este compromisso a
     * guarda pisca e não bloqueia nada. Alto demais vira paredão passivo. */
    guardHoldFrames: 26,
    stepChance: 0.26,
    vanishChance: 0.45,         // chance de escapar de um golpe (se tiver ki)
    smashChance: 0.34,          // chance de finalizar combo com smash
    blastChance: 0.30,
    chargeKiBelow: 28,          // carrega ki quando abaixo disto
    recoverChance: 0.6,         // chance de se recuperar após levar smash

    decisionIntervalFrames: 12,
    // Consciência de borda: quanto a IA evita ser empurrada pra fora.
    edgeAwareness: 0.7,
    // Quanto a IA tenta posicionar o JOGADOR de costas pra borda.
    ringOutIntent: 0.55,
  },
};

/* =============================================================================
 *  Campos expostos no painel de debug (tecla P). Formato:
 *    ['caminho.no.TUNING', min, max, passo, 'rótulo']
 *  Mexa ao vivo, sinta a diferença, e só depois me diga o que mudar no arquivo.
 * ========================================================================== */
export const DEBUG_SLIDERS = [
  ['__group', 'Smash / Ring-out'],
  ['moves.smash_forward.knockback', 5, 120, 1,   'Smash frente: empurrão (m/s)'],
  ['moves.smash_up.knockup',        5, 90,  1,   'Smash cima: levantada'],
  ['moves.smash_down.knockup',    -90, -5,  1,   'Smash baixo: cravada'],
  ['blowaway.drag',               0.1, 6,   0.05,'Blowaway: freio no ar'],
  ['moves.smash_forward.startup',   4, 40,  1,   'Smash: startup (frames)'],

  ['__group', 'Impacto / Juice'],
  ['juice.hitstopScale',            0, 3,   0.05,'Hitstop (congelamento)'],
  ['juice.shakeScale',              0, 3,   0.05,'Tremor de câmera'],
  ['juice.punchZoomAmount',         0, 20,  0.5, 'Punch zoom (FOV)'],
  ['juice.impactSparkCount',        0, 80,  1,   'Faíscas por acerto'],
  ['juice.auraIntensity',           0, 3,   0.05,'Intensidade da aura'],
  ['juice.bloomStrength',           0, 3,   0.05,'Bloom (brilho)'],

  ['__group', 'Velocidade / Voo'],
  ['flight.baseSpeed',              3, 40,  0.5, 'Voo normal'],
  ['flight.boostSpeed',             5, 80,  1,   'Voo com boost'],
  ['dragonDash.kiCost',             0, 50,  1,   'Dragon Dash: custo de ki'],
  ['flight.turnSpeed',              2, 25,  0.5, 'Velocidade de giro'],
  ['camera.speedFovMax',            0, 50,  1,   'FOV extra na velocidade'],

  ['__group', 'Ki'],
  ['ki.chargeRatePerSec',           5, 120, 1,   'Velocidade de carregar ki'],
  ['ki.passiveRegenPerSec',         0, 20,  0.2, 'Regen passivo'],
  ['defense.vanish.kiCost',         0, 60,  1,   'Vanish: custo de ki'],

  ['__group', 'Vanish / Defesa'],
  ['moves.smash_forward.vanishWindow', 0, 30, 1, 'Janela de vanish (smash)'],
  ['moves.rush_r.vanishWindow',     0, 30,  1,   'Janela de vanish (rush)'],
  ['combo.maxChain',                1, 12,  1,   'Máx. de elos no combo'],
  ['ai.punishChance',               0, 1,   0.02,'IA: chance de punir recovery'],
  ['ai.anticipateGuardChance',      0, 1,   0.02,'IA: guarda por antecipação'],
  ['defense.vanish.maxChain',       1, 10,  1,   'Máx. vanishes seguidos'],
  ['defense.vanish.slowMoScale',  0.05, 1,  0.05,'Câmera lenta no vanish'],
  ['defense.step.distance',       0.5, 10,  0.2, 'Distância do step'],

  ['__group', 'Arena'],
  ['arena.startRadius',            10, 120, 1,   'Raio inicial'],
  ['arena.startCeiling',           15, 150, 1,   'Teto inicial'],
  ['arena.shrinkDurationSec',      10, 400, 5,   'Tempo até encolher tudo'],

  ['__group', 'Câmera'],
  ['camera.fov',                   35, 95,  1,   'FOV'],
  ['camera.distance',               3, 20,  0.2, 'Distância'],
  ['camera.shoulderOffset',        -2, 2,   0.1, 'Offset de ombro'],
  ['camera.followLag',              1, 25,  0.5, 'Cola da câmera'],

  ['__group', 'IA'],
  ['ai.difficulty',                 0, 1,   0.02,'Dificuldade'],
  ['ai.aggression',                 0, 1,   0.02,'Agressividade'],
  ['ai.vanishChance',               0, 1,   0.02,'Chance de vanish'],
  ['ai.smashChance',                0, 1,   0.02,'Chance de smash'],
];

/* Lê/escreve TUNING por caminho ('moves.smash_forward.knockback'). */
export function getTuning(path) {
  return path.split('.').reduce((o, k) => (o == null ? o : o[k]), TUNING);
}

export function setTuning(path, value) {
  const keys = path.split('.');
  const last = keys.pop();
  const obj = keys.reduce((o, k) => o[k], TUNING);
  obj[last] = value;
}

/* Converte frames (@60fps) para segundos. */
export const F = (frames) => frames / TUNING.sim.fps;
