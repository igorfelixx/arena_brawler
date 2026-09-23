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
    // (`airDrag` foi removido: nunca foi lido. O arrasto do voo normal já sai
    //  de `flight.decel`, e o do blowaway de `blowaway.drag`. Número que não é
    //  lido mente sobre o que o jogo faz — e este arquivo é o produto.)
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
    // (`pushForce` removido: nunca foi lido. A separação de corpos em
    //  `resolveOverlap` é POSICIONAL de propósito — um empurrão por velocidade
    //  brigaria com o homing e com o avanço do golpe, e o combate ficaria
    //  escorregadio justamente na distância em que ele acontece.)

    /* POISE — o disjuntor anti-stunlock.
     *
     * Ele existia, armava e disparava. E não desarmava nada.
     *
     * Ao quebrar, a vítima ia pra BLOWAWAY carregando a velocidade DO GOLPE
     * que quebrou — um rush, 1.8 m/s. Só que o blowaway só se sustenta acima
     * de `blowaway.minSpeedToExit` (4.0), então o estado terminava no frame
     * seguinte. Medido: o poise quebrou 16 vezes em 30 s de martelada e o
     * blowaway durou 4 FRAMES em média. A vítima voltava exatamente pro lugar
     * onde estava apanhando.
     *
     * Agora a quebra tem impulso PRÓPRIO, independente do golpe. Ele existe
     * pra fazer uma coisa só: SEPARAR OS CORPOS e devolver o neutro. E, de
     * quebra, abre a janela de perseguição — o disjuntor vira oportunidade em
     * vez de anticlímax.
     *
     * 18 m/s com arrasto 1.35 ≈ 13 m de separação: longe o bastante pra sair
     * do alcance do rush (2.6 m) e perto o bastante pra valer perseguir. */
    maxPoise: 34,
    poiseRegenPerSec: 14,
    poiseBreakStunFrames: 30,
    poiseBreakKnockback: 18.0,
    poiseBreakKnockup: 4.0,
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

    // (`aiScanLimit` removido: nunca foi lido. Era otimização para 20–30
    //  lutadores, e a escala é outro problema — volta quando for encarado.)
  },

  /* ================================================================== */
  /*  MODO TREINO  (tecla T cicla)                                       */
  /* ================================================================== */
  /*  Boneco de treino não é só "IA desligada". Pra treinar combo de verdade
   *  ele precisa de três coisas que a IA normal atrapalha:
   *
   *    1. não AGIR — mas continuar REAGINDO (hitstun, knockback, voar longe).
   *       Alvo que não reage não ensina nada sobre o combo.
   *    2. não morrer no meio do treino
   *    3. voltar sozinho quando você mandar ele pra fora com um smash
   *
   *  A bancada tem SEIS modos, um por pergunta que o combate precisa responder:
   *
   *    NORMAL       IA ligada — o jogo de verdade
   *    PARADO       não age, mas reage       → ritmo do combo, cancels
   *    GUARDA       segura guarda            → é aqui que se aprende que só o
   *                                            smash abre, e onde se sente o
   *                                            relógio da estamina de guarda
   *    SEM REAÇÃO   toma dano e não sai do lugar → hitbox, alcance, frame data
   *                                            sem perseguir o alvo pela arena
   *    KNOCKBACK    não se recupera nunca    → ler a TRAJETÓRIA do smash e
   *                                            medir quanto falta pro ring-out
   *    RECUPERAÇÃO  sempre recupera na 1ª chance → treinar a leitura da
   *                                            recuperação, que é a segunda
   *                                            disputa depois do smash
   *
   *  T cicla, G recoloca os bonecos na distância de treino. */
  training: {
    healDelayFrames: 75,        // sem levar dano por isto, a vida volta ao cheio
    respawnDelayFrames: 45,     // mandou pra fora? volta sozinho

    /* Onde o boneco reaparece. A distância importa: 3 m é logo depois do
     * `rushApproach.attackAt` (2.3), então cada repetição começa com uma
     * investida curta — que é exatamente o começo do loop real de combate.
     * Se ele voltasse colado, você treinaria um jogo que não existe. */
    practiceDistance: 3.0,
    practiceHeight: 14.0,

    /* Recolocar o boneco sozinho depois de mandá-lo longe. Sem isto, cada
     * smash bem-sucedido cobra uma viagem de 34 m de volta, e você para de
     * testar smash — que é justamente a mecânica mais importante do MVP. */
    autoReturnDistance: 22.0,   // passou disto, volta sozinho
    autoReturnDelayFrames: 70,  // mas só depois de você ver a trajetória inteira
  },

  /* ================================================================== */
  /*  PARTIDA                                                            */
  /* ================================================================== */
  match: {
    /* Nº de oponentes controlados por IA.
     *
     * Está em 1 porque o MVP a validar é 1 jogador × 1 oponente: com um
     * terceiro na arena é impossível julgar uma troca — você nunca sabe se
     * apanhou porque leu errado ou porque alguém chegou por trás. Primeiro o
     * duelo fica bom; só depois a escala vira pergunta.
     *
     * Subir este número continua funcionando (IAs brigam entre si, mira por
     * direção, HUD do alvo atual). Custa CPU: cada um roda uma máquina de
     * estados e uma árvore de decisão por frame, e o teto real na sua máquina
     * ainda é desconhecido. */
    opponents: 1,
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

    /* E BLOQUEAR conta como "encostou"?  NÃO.
     *
     * Esta é a regra que o comentário do bloco `moves` sempre afirmou e que o
     * código nunca implementou: "quem BLOQUEIA sai do stun antes de quem
     * atacou, e ganha o turno". Não ganhava, porque a emenda era liberada por
     * QUALQUER contato — inclusive bloqueio. Na prática:
     *
     *   bloqueei o golpe 1 → ele emenda no 2 → emenda no 3 → …
     *
     * O atacante nunca ficava exposto contra a guarda, então defender não
     * cobrava preço nenhum e a única saída era gastar ki no vanish. Com
     * `cancelOnBlock: false` as três situações passam a ser distintas:
     *
     *   acertou   → emenda, o combo flui           (piso baixo, é gostoso)
     *   bloqueou  → NÃO emenda, come o recovery    (o turno vira)
     *   errou     → NÃO emenda, come o recovery    (punição)
     *
     * Com o rush_r (recovery 9, blockstun 4) isso dá ~+9 de vantagem pro
     * defensor: tempo de sobra pra revidar com um rush de 4 de startup. É o
     * que obriga o atacante a misturar SMASH (que quebra guarda) em vez de
     * martelar — e é o eixo ATAQUE ↔ BLOCK ↔ COUNTER que faltava.
     *
     * Está no painel (P) porque é a alavanca mais forte do arquivo: ligar isto
     * devolve o comportamento antigo na hora, pra comparar lado a lado. */
    cancelOnBlock: false,

    /* ================================================================
     *  A ROTA — e por que o teto antigo não segurava nada
     * ================================================================
     *  `maxChain` existia e era verificado assim:
     *
     *      const emendando = this.state === S.ATTACK;
     *      if (emendando && comboCount >= maxChain) return false;
     *
     *  Ou seja: só valia DENTRO do estado de ataque. Quando o último elo
     *  terminava sozinho, `_sAttack` zerava `comboCount` e voltava pra IDLE —
     *  e o próximo J começava uma cadeia nova do zero.
     *
     *  Medido, martelando J por 30 s contra boneco parado:
     *      elo máximo atingido     6     (o teto "funcionava")
     *      acertos                126    (21 cadeias de 6, emendadas)
     *      vítima presa           77% do tempo
     *      janelas livres >=12f     5    em 30 segundos
     *
     *  A correção é que a ROTA tem dono e tem fim. Ao esgotar, rush deixa de
     *  sair — de verdade, inclusive vindo da IDLE — até a interação resetar.
     *  Sobram os ENDERS (smash) e o reposicionamento. É a diferença entre
     *  "quem segura o combo?" e "quem ganha a próxima troca?".
     */
    maxChain: 4,

    /* Quantos frames sem atacar para a rota zerar e o neutro voltar.
     *
     * É o beat de respiro que o combate não tinha. Baixo demais e martelar
     * volta a funcionar; alto demais e o jogo fica lento e punitivo com quem
     * está aprendendo. 36f = 0,6 s — tempo de o defensor decidir alguma coisa,
     * não só de segurar guarda. */
    chainResetFrames: 36,

    /* Acertar o ENDER (smash) libera a rota na hora. Finalizar direito é
     * recompensado: você fica livre pra reengajar ou perseguir sem esperar. */
    enderClearsChain: true,
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
    /* 17 m era uma COLEIRA, não uma ferramenta de engajar: qualquer distância
     * criada abaixo disso era anulada por um único J, inclusive logo depois de
     * um lançamento. 9 m ainda resolve o problema que a investida veio
     * resolver (armadilha 8.14 — sem ela, 0 de dano em 25 s de luta), mas
     * deixa de cobrir meia arena. Acima disso, aproximar é trabalho do Dragon
     * Dash — que custa ki e é uma decisão. */
    range: 9.0,                 // até esta distância, J vira investida
    speed: 40.0,                // m/s
    turnSpeed: 13.0,            // rad/s — persegue bem, o alvo se move
    maxFrames: 50,              // desiste depois disso
    attackAt: 2.3,              // ao chegar aqui, emenda no rush direcional
    kiCost: 0,                  // de graça: é a ferramenta básica de engajar
  },

  /* ================================================================== */
  /*  HOMING  —  assistência de mira, NÃO ímã                            */
  /* ================================================================== */
  /*  O homing era a maior causa isolada do "boneco gruda no adversário".
   *
   *  Ele escreve em POSITION direto, não em velocidade — o corpo atravessa o
   *  espaço sem física. Com `homingRange: 5.0` e nenhum teto, medido durante
   *  os 4 frames de startup de um rush:
   *
   *      de 2 m → 1.34 m   (puxou 0.66 m)
   *      de 3 m → 1.52 m   (puxou 1.48 m)
   *      de 4 m → 1.71 m   (puxou 2.29 m)
   *      de 5 m → 1.89 m   (puxou 3.11 m)   ← três metros em 4 frames
   *
   *  Apertar J resolvia distância, ângulo e trajetória sozinho. O jogador não
   *  contribuía com posicionamento nenhum, e é por isso que o combate parecia
   *  uma macro de teclado em vez de uma disputa.
   *
   *  A correção NÃO é remover (ver armadilha 8.4 do doc de passagem: sem
   *  homing os dois primeiros socos erram e o jogador culpa o controle). É
   *  limitar o que ele resolve:
   *
   *    1. alcance curto  — ele fecha o ÚLTIMO pedaço, não a distância toda
   *    2. teto por golpe — nunca puxa mais que `maxPull` metros
   *
   *  Resultado pretendido: dentro de ~2,8 m o soco perdoa a mira; fora disso
   *  você precisa ter chegado com movimento. Posição volta a ser do jogador. */
  homing: {
    // Teto absoluto de quanto um único golpe pode te puxar. É este número que
    // separa "assistência" de "teleporte".
    maxPull: 1.1,
    // Distância que o homing tenta manter (centro a centro). Encostado, mas
    // não dentro do outro.
    idealGap: 1.4,
  },

  /* ================================================================== */
  /*  PURSUIT  —  a segunda disputa, depois do lançamento                */
  /* ================================================================== */
  /*  A peça que faltava pro combate ter IDA E VOLTA.
   *
   *  Antes, lançar alguém era um beco sem saída: o corpo voava, você
   *  re-aproximava com um J (a investida cobria 17 m) e recomeçava a mesma
   *  cadeia. O lançamento não era um evento — era uma pausa.
   *
   *  No Tenkaichi, o lançamento ABRE uma janela em que o atacante precisa
   *  ESCOLHER, e o defensor precisa responder:
   *
   *      LANÇOU ──→ ╔══════ JANELA DE PERSEGUIÇÃO ══════╗
   *                 ║  Shift  perseguir (custa ki)      ║
   *                 ║  K      spike / re-lançar         ║
   *                 ║  L      blast à distância         ║
   *                 ║  nada   deixar voltar, reposicionar║
   *                 ╚═══════════════════╤═══════════════╝
   *      defensor:  recuperar / vanish / cair e levantar
   *
   *  REGRA QUE NÃO PODE SER QUEBRADA: perseguir NÃO é combo infinito.
   *  A perseguição custa ki, é comprometida em linha reta, e o defensor tem
   *  recuperação aérea pra puni-la. Ela é uma LEITURA, não uma continuação.
   *
   *  O prêmio de acertar a leitura é uma ROTA NOVA (`clearsChainOnArrive`):
   *  é assim que a pressão se estende por mérito, e não por martelar.        */
  pursuit: {
    // Quanto tempo a janela fica aberta depois de você lançar alguém.
    windowFrames: 75,
    speed: 52.0,                // m/s — mais rápido que voar, menos que dash
    turnSpeed: 12.0,
    maxFrames: 60,
    attackAt: 2.4,              // chegou: devolve o controle EM ALCANCE
    /* Quanto da velocidade do alvo você HERDA ao alcançá-lo.
     *
     * Medido no navegador: sem isto, a perseguição terminava com você parado
     * e a vítima ainda voando a 12 m/s — você encostava e ela ia embora no
     * mesmo instante. "Alcancei" virava "toquei". Herdando a velocidade, os
     * dois viajam juntos por um momento, que é o tempo de você emendar o
     * golpe e é a imagem que esses jogos vendem: dois corpos cruzando o céu
     * na mesma trajetória. */
    carryVelocity: 0.88,
    /* Por quantos frames você VOA JUNTO com ele depois de alcançar.
     *
     * Só herdar a velocidade não bastou: medido no navegador, o controle de
     * voo normal desacelera pra zero no frame seguinte (não há direcional
     * apertado) e a vítima ia embora do mesmo jeito — o banner dizia
     * "ALCANÇOU!" e a distância virava 13 m. Estes frames são a janela em que
     * os dois corpos cruzam o céu na mesma trajetória e você decide o
     * follow-up. É a imagem que esses jogos vendem. */
    carryFrames: 18,
    kiCost: 12,                 // perseguir é decisão, não reflexo
    /* Chegar perseguindo abre uma rota nova. É a recompensa por ler o
     * lançamento — e é o que separa "estender a pressão por perícia" de
     * "estender a pressão por martelar". */
    clearsChainOnArrive: true,
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
      homingRange: 2.8,
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
      homingRange: 2.8,
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
      homingRange: 2.8,
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
      homingRange: 2.8,
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
      homingRange: 3.2,
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
      homingRange: 3.2,
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
      homingRange: 3.2,
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
      // (`enterFrames`/`exitFrames` removidos: nunca foram lidos — a guarda
      //  sempre foi instantânea. E deve continuar: responder na hora é o §7.1,
      //  e o preço de defender agora é a ESTAMINA abaixo, que é um custo de
      //  decisão, não de latência.)
      kiPerHit: 3,              // guarda gasta ki no Tenkaichi

      /* ESTAMINA DE GUARDA — o relógio que impede turtle.
       *
       * O campo `guardStamina` existia no Fighter desde o começo: era
       * inicializado, regenerado e zerado no guard break. E NUNCA era lido por
       * ninguém. Mecânica fantasma — segurar F era essencialmente grátis.
       *
       * Agora ela é o contrapeso de `combo.cancelOnBlock: false`. Se bloquear
       * devolve o turno, defender precisa custar ALGUMA coisa, senão a resposta
       * ótima vira "segure F pra sempre" e o jogo trava no outro extremo.
       *
       * O drena por TEMPO (segurar) e por HIT (aguentar pressão) são separados
       * de propósito: segurar guarda no vazio é barato, aguentar um combo é
       * caro. Ao zerar, a guarda arrebenta sozinha — e aí você fica exposto em
       * pé por `breakStunFrames`, que é punível mas não é morte.
       *
       * Note a diferença deliberada entre as DUAS quebras de guarda:
       *   por SMASH     → blowaway, voa longe  → é a ferramenta de RING-OUT
       *   por EXAUSTÃO  → stun em pé, punível  → é a ferramenta de PRESSÃO
       */
      maxStamina: 100,
      staminaPerHit: 13,          // cada golpe aparado
      staminaDrainPerSec: 8,      // custo de só ficar segurando
      staminaRegenPerSec: 26,
      staminaRegenDelayFrames: 34, // só volta a encher N frames depois de soltar
      breakStunFrames: 42,        // exposto em pé após a guarda arrebentar

      /* Rebater ki blast. `deflectWindowFrames` existia e não era usado: o
       * projétil voltava por SÓ ESTAR de guarda, sem timing nenhum — perícia
       * zero. Agora exige apertar a guarda perto do impacto; segurar guarda
       * continua ABSORVENDO (o normal), mas só o timing rebate. */
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

      /* ERRAR O VANISH PRECISA CUSTAR.
       *
       * Antes você só pagava ki quando o vanish FUNCIONAVA. Apertar V no vazio
       * era de graça, então martelar V era estritamente melhor que ler o
       * adversário — e a mecânica assinatura do jogo virava botão de pânico
       * sem multa. Não existe leitura onde chutar não custa.
       *
       * Agora, se o toque expira sem nenhum golpe ter chegado, cobra-se uma
       * fração do ki e um cooldown curto. Pequeno de propósito: é pra punir
       * quem MARTELA, não quem tenta e erra o timing por pouco. */
      whiffKiCost: 7,
      whiffCooldownFrames: 22,
      /* A partir de quantos frames um toque de vanish é considerado chute.
       * Tem que ser >= a maior `vanishWindow` de qualquer golpe (hoje 14, do
       * smash), senão você seria cobrado por um vanish que ainda ia funcionar. */
      maxUsefulWindow: 16,
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
    // (`chaseWindowFrames` removido: nunca foi lido. A janela de perseguir quem
    //  está voando já é o próprio tempo de blowaway — não havia segundo relógio.)
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

    /* ================================================================
     *  PERFIS — estilos de bot para TESTAR o sistema (tecla B)
     * ================================================================
     *  Não é "IA melhor". É instrumento de medição.
     *
     *  Um bot só responde uma pergunta: "o combate funciona contra ISTO?".
     *  Com um estilo só, você afina o jogo contra um comportamento e descobre
     *  tarde que ele quebra contra outro. Cada perfil abaixo existe pra
     *  estressar um eixo diferente do design:
     *
     *    PRESSÃO    não larga de você        → a DEFESA tem resposta?
     *    DEFESA     bloqueia e pune          → o ATAQUE tem como abrir?
     *    BORDA      luta perto da borda      → o RING-OUT é justo ou roleta?
     *    AGRESSIVO  quer te jogar pra fora   → dá pra ler e virar o jogo?
     *    EVASIVO    foge, esquiva, recupera  → dá pra ALCANÇAR quem não quer
     *                                          lutar? (o pior cenário do voo
     *                                          livre, e o mais revelador)
     *
     *  São só sobreposições dos campos acima — o que não estiver listado
     *  continua vindo de `ai`, inclusive ajustado ao vivo pelo painel (P). */
    profiles: {
      EQUILIBRADO: {},

      'PRESSÃO': {
        aggression: 0.92,
        preferredRange: 2.6,
        guardChance: 0.12,
        anticipateGuardChance: 0.15,
        punishChance: 0.45,
        smashChance: 0.42,
        blastChance: 0.06,
        vanishChance: 0.25,
        decisionIntervalFrames: 8,
      },

      DEFESA: {
        aggression: 0.22,
        preferredRange: 5.5,
        guardChance: 0.85,
        anticipateGuardChance: 0.90,
        guardHoldFrames: 40,
        // Bloquear só neutraliza; o que torna a defesa uma AMEAÇA é punir.
        punishChance: 0.95,
        punishCooldownFrames: 14,
        smashChance: 0.50,
        blastChance: 0.15,
      },

      BORDA: {
        // Sobreviver encostado no limite: é o teste do §17.
        edgeAwareness: 1.0,
        ringOutIntent: 0.10,
        aggression: 0.30,
        preferredRange: 7.0,
        vanishChance: 0.70,
        recoverChance: 0.95,
        blastChance: 0.50,
      },

      AGRESSIVO: {
        // Só quer te empurrar pra fora, e aceita o risco de se expor por isso.
        aggression: 0.80,
        ringOutIntent: 1.0,
        smashChance: 0.70,
        edgeAwareness: 0.25,
        punishChance: 0.60,
        preferredRange: 3.0,
      },

      EVASIVO: {
        aggression: 0.25,
        preferredRange: 9.0,
        stepChance: 0.80,
        vanishChance: 0.85,
        recoverChance: 1.0,
        guardChance: 0.50,
        blastChance: 0.60,
        dashRange: 14.0,
      },
    },
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

  /* ---- O eixo ataque ↔ defesa. É aqui que mora a maior diferença desta
   * passada: bloquear passou a devolver o turno, e defender passou a ter um
   * relógio. Os dois são ajustáveis ao vivo porque o ponto certo entre
   * "turtle domina" e "pressão domina" só sai de playtest. ---- */
  ['__group', 'Guarda / Turnos'],
  ['combo.cancelOnBlock',           0, 1,   1,   'Bloqueio deixa emendar? (liga = antigo)'],
  ['moves.rush_r.blockstun',        0, 30,  1,   'Blockstun do rush'],
  ['moves.smash_forward.blockstun', 0, 60,  1,   'Blockstun do smash'],
  ['defense.guard.staminaPerHit',   0, 50,  1,   'Guarda: desgaste por golpe'],
  ['defense.guard.staminaDrainPerSec', 0, 40, 1, 'Guarda: desgaste por segundo'],
  ['defense.guard.staminaRegenPerSec', 0, 80, 1, 'Guarda: recuperação'],
  ['defense.guard.breakStunFrames', 0, 90,  1,   'Exposto após guarda esgotar'],
  ['defense.guard.deflectWindowFrames', 0, 20, 1,'Janela de rebater blast'],

  ['__group', 'Vanish / Defesa'],
  ['moves.smash_forward.vanishWindow', 0, 30, 1, 'Janela de vanish (smash)'],
  ['moves.rush_r.vanishWindow',     0, 30,  1,   'Janela de vanish (rush)'],
  ['defense.vanish.whiffKiCost',    0, 40,  1,   'Custo de ERRAR o vanish'],
  ['defense.vanish.whiffCooldownFrames', 0, 60, 1, 'Cooldown após errar vanish'],
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
  /* Medido: contra quem martela, o bot DEFESA passa 37% do tempo em guarda e
   * ainda assim leva 88 golpes limpos contra 32 aparados. O gargalo não é a
   * chance de decidir bloquear — é por quanto tempo ele SUSTENTA a decisão.
   * Esta é a alavanca pra isso. */
  ['ai.guardHoldFrames',            4, 90,  1,   'IA: frames segurando a guarda'],
  // Lembrete: o perfil (tecla B) SOBRESCREVE estes campos. Se arrastar um
  // slider aqui e a IA ignorar, é porque o perfil ativo define aquele valor.
  ['match.opponents',               1, 12,  1,   'Oponentes (recarregue p/ valer)'],

  ['__group', 'Treino'],
  ['training.practiceDistance',     1, 20,  0.5, 'Distância do boneco'],
  ['training.autoReturnDistance',   5, 60,  1,   'Boneco volta se passar de'],
  ['training.healDelayFrames',     15, 300, 5,   'Boneco se cura após (frames)'],
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
