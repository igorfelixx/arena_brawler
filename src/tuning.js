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
    // 13 → 20 (Etapa 1). Medido na bancada: cruzeiro de 13 m/s contra dash de
    // 62 m/s = razão 4,8:1 — o voo normal parecia parado perto do dash, e é a
    // sensação de "meia boca" no deslocamento. 20 mantém a hierarquia
    // (20 cruzeiro < 30 boost < 62 dash) e NÃO é lido pelo dash (que usa
    // dashSpeed direto), então a rampa recém-feita não muda.
    baseSpeed: 20.0,            // m/s — voo normal
    boostSpeed: 30.0,           // m/s — segurando boost
    dashSpeed: 62.0,            // m/s — Dragon Dash (投 em direção ao alvo)
    accel: 55,                  // m/s²
    /* FRENAGEM MEDIDA e preservada. A fórmula é k = 1 − exp(−decel/baseSpeed
     * × 6dt): a velocidade-ALVO está no denominador, então mudar baseSpeed
     * muda o freio SEM ninguém pedir. Medições (bancada, dash solto a 62):
     *
     *   base 13 / decel 42 → 62 → 44,9 no +1f, → 8,9 no +6f, → 0 em ~16f
     *   base 20 / decel 42 → 62 → 50,3 no +1f, → 0 em ~36f   (A/B medido)
     *   base 20 / decel 65 → 62 → 44,9 no +1f, → 0 em ~16f   (restaurado)
     *
     * Suspeitei de "corte seco" na frenagem e era artefato do meu cenário:
     * media o rescaldo de dash que já tinha trombado (dashImpact faz
     * velocity *= 0,12 e sai do estado). Veredicto: manter a curva exponencial
     * de ~16f. Por isso decel = 65 = 42 × 20/13 — escala junto com baseSpeed
     * pra conservar k. Divida os dois por N se quiser o freio mais/menos firme.
     */
    decel: 65,
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
    /* Rampa de arrancada. Existia como `startupFrames: 6` MORTO — só a
     * declaração, nada lia; a velocidade era degrau 0 → 62 m/s no frame do
     * input (bancada: framesAte90pct = 0, pico no frame 0 = "teleporta").
     * Agora a velocidade sobe de launchSpeedMul ao teto nestes frames, com
     * aceleração crescente (t²): já sai andando e TERMINA rápido, que é a
     * leitura visual de "enrola e estoura". 6f = 100 ms. */
    startupFrames: 6,
    /* Fração da velocidade máxima no frame 0. 0 = fica parado 1-2 frames
     * (input lag disfarçado de anticipation); 1,0 = o teleporta medido.
     * 0,35 = 21,7 m/s na entrada, 62 no frame 6. */
    launchSpeedMul: 0.35,
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
  /*  MAX POWER (SPARKING)  —  o estado de poder máximo                  */
  /* ================================================================== */
  /*  Adaptado do "Max Power com exaustão" pro SPARKING do BT3 (§4.5).
   *  A estrutura de ENTRADA é a mesma de propósito — era boa: exigir
   *  carregar até o topo, parado, é a posição mais vulnerável do jogo,
   *  então acender é uma decisão, não um botão de vitória.
   *
   *      ki CHEIO (+ blast gauge cheio)  →  segurar `enterHoldFrames`
   *                              ↓
   *                      SPARKING (drena ki por frame)
   *                              ↓
   *                      ki = 0  →  sem ferramentas de ki até recarregar
   *
   *  O que MUDOU: o estado não tem mais duração própria nem termina em
   *  um estado de EXAUSTÃO separado (que foi removido de `ki`) — o
   *  sparking drena a barra até zero e o ESVaziamento é o fim. Contar
   *  com isso é apostar: quem sobrevive à sua própria barra fica sem
   *  vanish/dash/blast na reta final, que é o counterplay.
   *
   *  O dreno vive em `bt3.gauges.maxPowerDrainPerFrame` (0,22/f ≈ 7,5 s
   *  com a barra cheia). Aqui ficam só os campos de entrada e os
   *  modificadores que o runtime lê neste bloco.                       */
  maxPower: {
    enterKiThreshold: 100,         // precisa estar com o ki CHEIO (§4.5)
    enterBlastThreshold: 100,      // blast gauge CHEIO também (§4.5 — ver wp1-requests.md)
    enterHoldFrames: 26,           // frames segurando com as barras cheias
    entryFrames: 18,               // estado de entrada (o clarão), invulnerável

    /* Modificadores. Deliberadamente MODESTOS: um multiplicador grande
     * transformaria o estado em "quem acender primeiro ganha", que é o oposto
     * de um jogo de leitura. O valor do estado está em CONSISTÊNCIA (ki mais
     * barato, sai do hitstun antes), não em dano bruto. */
    damageMul: 1.20,
    kiCostMul: 0.65,               // vanish/dash/blast ficam baratos
    speedMul: 1.12,
    hitstunTakenMul: 0.82,         // sai do stun um pouco antes
    // (`durationFrames`/`drainPerSec` sumiram: a duração É kiCheio ÷ taxa
    //  de dreno, em bt3.gauges. `poiseMul` sumiu junto com o poise.
    //  `endsInExhaustion`/`enterKiCost`: sem exaustão separada — o preço
    //  de acender é a barra gasta e o tempo parado carregando.)
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
    /* ================================================================
     *  VIDA  —  900, e o dano NÃO foi tocado
     * ================================================================
     *  Medido: com 100 de vida, um 1×1 entre dois bots dura 14,5 SEGUNDOS.
     *  A meta é 2–4 minutos de luta engajada, então o TTK precisava subir ~10x.
     *
     *  Duas formas de fazer isso dão exatamente o mesmo resultado, porque só a
     *  RAZÃO importa:
     *      vida 500 e todo dano ×0,55   →  500/0,55 = 909
     *      vida 900 e dano INTACTO      →  900/1,00 = 900
     *  Medidos lado a lado: 1,9 min e 2,1 min. Indistinguíveis.
     *
     *  Escolhida a segunda, e a razão é este arquivo ser o produto: com o dano
     *  intacto, cada número de `damage` continua significando "HP removido", e
     *  a relação entre os golpes (um smash vale 3,2 rushes) fica legível. A
     *  primeira forma produziria dezoito decimais como 2,75 e 1,43, que não
     *  dizem nada a quem for montar a DataTable no Unreal.
     *
     *  O QUE ISSO CUSTA, e é o risco que precisa ficar registrado: cada golpe
     *  passa a mover muito menos a barra.
     *
     *      rush         5/900  =  0,55% da barra
     *      smash       16/900  =  1,8%
     *      rota inteira 36/900 =  4,0%
     *
     *  Quatro por cento por rota completa é pouco, e é o limite de onde um
     *  acerto ainda é VISÍVEL. Foi por isso que 900 foi escolhido e não 1600:
     *  a vida é a MENOR que alcança a faixa de 2 minutos, o que maximiza o que
     *  sobra de legibilidade. Se o playtest disser que o golpe "não sente",
     *  o conserto NÃO é baixar a vida — é a barra de vida mostrar o dano
     *  recente (o rastro branco já faz metade disso), porque baixar a vida
     *  devolve a luta de 15 segundos.
     *
     *  Efeito colateral desejado: com a vida alta, matar por HP demora e o
     *  RING-OUT vira caminho de vitória de igual peso. Medido em 10 lutas:
     *  5 por ring-out, 5 por nocaute. Era 0 por ring-out com vida 100.        */
    maxHealth: 900,
    radius: 0.55,               // raio de colisão
    height: 1.8,
    // (`pushForce` removido: nunca foi lido. A separação de corpos em
    //  `resolveOverlap` é POSICIONAL de propósito — um empurrão por velocidade
    //  brigaria com o homing e com o avanço do golpe, e o combate ficaria
    //  escorregadio justamente na distância em que ele acontece.)

    /* ================================================================
     *  REGENERAÇÃO DE VIDA  —  zero no duelo, é o motor do modo ARENA
     * ================================================================
     *  Medido: 30 lutadores produzem 52 de dano POR SEGUNDO na arena. A
     *  reserva inteira de vida (30 × 140 = 4200) é consumida em 81 segundos.
     *  Para uma partida de 25 minutos seria preciso derrubar isso pra ~2,8/s —
     *  ou dar 2500 de vida a cada um, que é a "sessão de espancamento
     *  administrativo" que o design veta explicitamente.
     *
     *  A causa não é o HP ser baixo. É que 30 lutadores ficam em combate
     *  ININTERRUPTO, e o dano só ACUMULA. Num battle royale de 25 minutos a
     *  maior parte do tempo não é briga: você luta, sobrevive, se afasta, se
     *  recompõe. Sem recomposição, a soma dos danos mata todo mundo rápido
     *  independentemente do tamanho da barra.
     *
     *  Daí a regeneração FORA DE COMBATE. Ela não deixa ninguém mais durão
     *  numa troca — o dano por golpe é o mesmo, a leitura é a mesma, o combo
     *  mata igual. O que ela muda é que PERDER UMA BRIGA deixa de ser uma
     *  sentença acumulada: quem se afastou a tempo volta inteiro, e quem
     *  insiste sob pressão contínua morre do mesmo jeito.
     *
     *  Zero no DUELO, e tem que continuar zero: num 1×1 de 90 segundos,
     *  regeneração só faria a luta não acabar. */
    healthRegenPerSec: 0,
    healthRegenDelaySec: 0,
  },

  /* ================================================================== */
  /*  MIRA  —  com 20–30 jogadores, "em quem eu bato?" é O jogo           */
  /* ================================================================== */
  targeting: {
    acquireRange: 14.0,         // até onde um golpe procura alvo (lock solto)
    lockKeepRange: 60.0,        // acima disto o lock-on se rompe sozinho

    /* ================================================================
     *  LIMITE DE DETECÇÃO  —  a condição pra PODER FUGIR DE UMA BRIGA
     * ================================================================
     *  O problema, medido e teimoso: os lutadores passam 74–77% do tempo em
     *  combate, e esse número NÃO SE MOVE. Testado com 30 e com 84 pessoas, em
     *  arenas de raio 70 até 245 (doze vezes mais área por cabeça):
     *
     *      raio  70m ·   513 m²/pessoa  →  75% em briga
     *      raio 245m · 6.286 m²/pessoa  →  73% em briga
     *
     *  Doze vezes mais espaço, mesmo tempo brigando. Aumentar a arena só
     *  destruiu o ring-out (29% → 9%) e não comprou folga nenhuma.
     *
     *  A causa é que não havia limite de INFORMAÇÃO. `nearestEnemy` varria a
     *  lista inteira de lutadores, então todo mundo sempre sabia onde estava
     *  o mais próximo, por mais longe que fosse — e ia atrás. Espaço não
     *  resolve isso: você pode correr, mas não pode SUMIR.
     *
     *  Com um alcance de detecção, afastar-se passa a ter consequência: quem
     *  sai do seu raio deixa de ser seu alvo, e você deixa de ser alvo dele.
     *  É o que permite a tática que o Torneio do Poder tem o tempo todo —
     *  sair de uma briga que está ruim, recuperar, escolher a próxima.
     *
     *  Histerese de propósito: adquire a 24 m e só larga a 38 m. Com um
     *  limiar só, quem ficasse rondando a distância exata entraria e sairia de
     *  combate a cada frame, e a briga ficaria engasgando.                   */
    detectionRange: 24.0,       // até aqui você ENCONTRA alguém pra lutar
    loseTargetRange: 38.0,      // passou disto, você o PERDE de vista

    /* ================================================================
     *  ⚠️  A RESTRIÇÃO QUE IMPEDE A PARTIDA DE NUNCA ACABAR
     * ================================================================
     *      2 × (raio da ÚLTIMA fase)  <  detectionRange
     *      e NENHUM obstáculo de pé na última fase
     *
     *  Se a arena final for maior que o alcance de DETECÇÃO, dois sobreviventes
     *  podem se evitar INDEFINIDAMENTE: cada um de um lado, nenhum enxergando
     *  o outro, e nada os obrigando a se encontrar.
     *
     *  Medido, 30 lutadores, 5 partidas por configuração:
     *
     *      arena final 17 m  (2×17 = 34 > 24)  →  TRAVA com 2 sobreviventes
     *      arena final 10 m  (2×10 = 20 < 24)  →  termina
     *
     *  E o alcance certo é `detectionRange` (24), não `loseTargetRange` (38).
     *  Errei isso na primeira tentativa: `loseTargetRange` é o quanto você
     *  AGUENTA perseguir quem já é seu alvo; `detectionRange` é o quanto você
     *  enxerga pra ACHAR um. Dois sobreviventes que nunca se viram precisam do
     *  segundo — e com a restrição errada a partida travava com dois vivos a
     *  30 m um do outro, cada um sem alvo, indefinidamente.
     *
     *  Cento e quarenta e nove minutos é o TETO DO MEDIDOR, não a duração: a
     *  partida simplesmente não termina. É o preço de dar a opção de fugir, e
     *  quem paga é o encolhimento da arena — mas só se ele fechar o bastante.
     *
     *  `matchMode.aplicar()` confere isso no boot e avisa no console. */

    /* Com 0 o limite é desligado e volta o comportamento antigo (onisciente).
     * Fica como chave porque o duelo não precisa disto — num 1×1 perder o
     * adversário de vista não é tática, é a luta deixar de existir.
     *
     * ZERO NA BASE, ligado só pelo modo arena (`match.modes.arena.targeting`).
     * Estava em 1 aqui e o duelo herdava: os dois nascem a ~72 m, bem além dos
     * 24 m de detecção, então o 1×1 começava com ninguém enxergando ninguém —
     * sem lock, e a IA derivando em `_foraDeCombate`. O duelo não sobrescreve
     * nada, então a base TEM que ser o comportamento do duelo. */
    detectionEnabled: 0,

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

    /* ================================================================
     *  MODOS DE PARTIDA  —  DUELO e ARENA são jogos diferentes
     * ================================================================
     *  Medido: 30 jogadores com os números do duelo acabam em 53–75 SEGUNDOS.
     *  Um brawler de eliminação com 30 pessoas resolvido em um minuto não é
     *  uma partida curta — é um intervalo comercial com socos.
     *
     *  Mas a correção NÃO é inflar HP. 30 jogadores × uma barra gigante produz
     *  uma sessão de espancamento administrativo: o mesmo jogo, mais devagar,
     *  e chato. O que controla o ritmo de eliminação é outra coisa, e a
     *  medição mostrou qual:
     *
     *      arena raio 48  →  41% de ring-out
     *      arena raio 30  →  79% de ring-out
     *
     *  O ESPAÇO é o botão. Num jogo cuja identidade é o ring-out, quanto mais
     *  perto a borda está, mais rápido as pessoas saem. Então a duração de uma
     *  partida é, antes de tudo, o CRONOGRAMA DA ARENA.
     *
     *  Por isso os dois modos existem separados, e por isso o DUELO não muda
     *  nem um número: ele é o MVP validado, e é contra ele que tudo foi medido.
     *  Mexer nele pra acomodar o modo de 30 jogaria fora a única base de
     *  comparação que o projeto tem.
     *
     *  Escolha na URL:  ?modo=duelo   (padrão)
     *                   ?modo=arena&n=30
     */
    mode: 'duelo',

    modes: {
      /* DUELO — 1×1. NÃO SOBRESCREVE NADA de propósito: usa `arena`,
       * `fighter` e `defense` exatamente como estão no resto deste arquivo.
       * Se um dia este bloco ganhar um campo, a base de comparação morre. */
      duelo: {
        label: 'DUELO',
        fighters: 2,
      },

      /* ================================================================
       *  ARENA — 20 a 30 jogadores, 20–25 minutos
       * ================================================================
       *  A curva-alvo, em jogadores restantes:
       *
       *      0–5 min    INÍCIO      30 → 22   espaço amplo, primeiras quedas
       *      5–12 min   MEIO        22 → 13   a arena começa a fechar
       *      12–18 min  CONFRONTO   13 → 7    disputa por posição
       *      18–25 min  FINAL        7 → 3    arena pequena
       *      25–30 min  CLÍMAX       3 → 1    ring-out decide
       *
       *  O que a faz acontecer: a arena começa GRANDE o bastante pra que um
       *  smash quase nunca mate (raio 110 contra os ~34 m que um corpo lançado
       *  percorre), e termina PEQUENA o bastante pra que qualquer lançamento
       *  seja fatal. A morte deixa de ser um evento e vira uma consequência do
       *  relógio — que é exatamente o arco "começo tranquilo, final caótico".
       *
       *  HP sobe pouco (100 → 140) e só pra que a fase inicial não seja
       *  decidida por nocaute. O aumento é deliberadamente modesto: o objetivo
       *  é que as pessoas saiam pela BORDA, não que demorem mais pra morrer.  */
      arena: {
        label: 'ARENA',
        fighters: 30,

        /* Sobreposições. Tudo que não estiver aqui vem do bloco normal —
         * mesmo contrato dos perfis de IA, e pelo mesmo motivo: um slider
         * arrastado no painel continua valendo. */
        /* SEM sobreposição de vida nem regeneração.
         *
         * Havia `maxHealth: 140` e `healthRegenPerSec: 28` aqui, e os dois
         * saíram: eram curativo pra uma partida que acabava rápido demais
         * porque o COMBATE BASE tinha o TTK baixo. Com a vida em 900 no bloco
         * `fighter`, o modo arena herda o mesmo combate do duelo — que é como
         * tem que ser, senão são dois jogos e só um está balanceado.
         *
         * A regeneração continua existindo (`fighter.healthRegenPerSec`) e em
         * zero. É alavanca, não mecânica em uso. */

        /* Limite de detecção: só existe aqui. Ver `TUNING.targeting`. */
        targeting: { detectionEnabled: 1 },

        /* Obstáculos: só existem aqui. Ver `TUNING.obstacles`. A densidade
         * ao longo da partida é o campo `obst` de cada fase, abaixo. */
        obstacles: { enabled: 1 },

        /* Deriva fora de combate: neutra com a arena grande (ninguém se
         * amontoa na borda), puxando pro centro com ela pequena (o fim
         * junta os sobreviventes). Ver `ai.offCombatPull*`. */
        ai: { offCombatPullFar: 0, offCombatPullNear: 0.6 },


        /* ------------------------------------------------------------
         *  CRONOGRAMA DE FASES — o coração do modo
         * ------------------------------------------------------------
         *  `min` é o minuto em que a fase COMEÇA; `raio`/`teto` são os valores
         *  no FIM dela. Entre duas fases o valor é interpolado, então a arena
         *  nunca dá saltos.
         *
         *  Fases nomeadas em vez de uma curva só porque o jogador precisa
         *  LER em que momento da partida está — "CONFRONTO" diz mais que
         *  "raio 38 m", e é o que transforma o encolhimento de cronômetro em
         *  narrativa.                                                        */
        /* Cronograma CALIBRADO PELA DURAÇÃO REAL, não pela desejada.
         *
         * A primeira versão espalhava as fases por 30 minutos, porque a meta
         * era uma partida de 20–25. Com o combate rebalanceado a partida dura
         * ~6 min de verdade — e o cronograma de 30 min significava que ela
         * inteira acontecia dentro da fase INÍCIO. Medido, 30 lutadores:
         *
         *     cronograma de 30 min   5,6 min · ring-out 18% · 2 de 6 fases
         *     cronograma comprimido  5,4 min · ring-out 32% · 4 de 6 fases
         *
         * Mesma duração, o DOBRO de ring-out e o dobro de arco vivido. Um
         * cronograma que não termina não é pressão, é decoração — a arena
         * precisa fechar dentro do tempo que a partida de fato dura.
         *
         * Se o playtest alongar a partida (humanos recuam, bots não), estes
         * minutos sobem junto. É a primeira coisa a reajustar. */
        /* ------------------------------------------------------------
         *  O ARCO: POUCA BRIGA NO COMEÇO, MUITA NO FIM
         * ------------------------------------------------------------
         *  O cronograma não é um cronômetro — é a CURVA DE ENCONTRO. Com
         *  alcance de detecção fixo (24 m), quantos vizinhos cada lutador tem
         *  dentro do campo de visão depende só do raio:
         *
         *      vizinhos ≈ N × (detecção / raio)²
         *
         *      raio 300 m  →  0,19 vizinhos   quase sempre sozinho
         *      raio 160 m  →  0,68            encontros intermitentes
         *      raio  95 m  →  1,9             briga frequente
         *      raio  50 m  →  6,9             tumulto
         *      raio  17 m  →  todos           ninguém se evita
         *
         *  É a mesma ideia de um battlefield: o começo é calmo porque as
         *  pessoas estão LONGE, e o fim é caótico porque não há mais pra onde
         *  ir. A escalada não é uma regra extra — ela cai sozinha da geometria,
         *  desde que a arena comece grande o bastante.
         *
         *  Começar em 110 m era o erro da versão anterior: 1,4 vizinhos já no
         *  minuto zero, ou seja, briga constante desde o início e nenhum arco.
         *
         *  Os minutos estão esticados pra uma partida de 25–30 min. Se o
         *  playtest mostrar que arrasta, a correção é ENCURTAR OS MINUTOS, não
         *  diminuir os raios — os raios são o que produz o arco.               */
        /* `obst` = fração das colunas DE PÉ naquele minuto (interpolada como
         * o raio). Muitas no começo, nenhuma a partir do CLÍMAX: o fim tem
         * que ser aberto e decisivo, e a restrição de término (ver
         * `targeting`) só vale se nada bloquear a visão na arena final.  */
        phases: [
          { min: 0,  raio: 300, teto: 120, obst: 1.0,  label: 'INÍCIO',    sub: 'procure, ou se esconda' },
          { min: 5,  raio: 230, teto: 100, obst: 1.0,  label: 'MEIO',      sub: 'os primeiros encontros' },
          { min: 10, raio: 160, teto: 80,  obst: 0.6,  label: 'CONFRONTO', sub: 'não dá mais pra sumir' },
          { min: 15, raio: 95,  teto: 58,  obst: 0.25, label: 'FINAL',     sub: 'disputa por posição' },
          { min: 20, raio: 50,  teto: 38,  obst: 0,    label: 'CLÍMAX',    sub: 'não caia' },
          /* 10 m: 2×10 = 20 < detectionRange (24). Dois sobreviventes SEMPRE
           * se acham. Ver a restrição em `targeting`. (Uma versão anterior
           * deste comentário dizia `< loseTargetRange` — estava errado, e o
           * aviso de `matchMode` checava o alcance errado até a passada dos
           * obstáculos.) */
          { min: 26, raio: 10,  teto: 20,  obst: 0,    label: 'MORTE SÚBITA', sub: '' },
        ],

        /* Teto duro. Chegar aqui sem vencedor é um defeito de ritmo, não um
         * final legítimo — e é melhor o protótipo gritar do que arrastar. */
        hardCapMin: 34,

        /* ================================================================
         *  DURAÇÃO: ~6 MIN, e ela EMERGIU — não foi forçada
         * ================================================================
         *  A meta inicial era 20–25 min. O caminho que eu tinha tomado pra lá
         *  estava errado, e o dono do projeto apontou: regeneração de vida e
         *  recuo da IA alongavam a partida MASCARANDO um TTK baixo em vez de
         *  consertá-lo. Os dois foram desligados (estão em zero, como alavanca).
         *
         *  O conserto certo foi o COMBATE BASE: vida 100 → 900 (ver a nota no
         *  bloco `fighter`). Sozinho, ele levou a partida de 30 jogadores de
         *  1,2 min para ~6 min — cinco vezes, sem nenhum curativo.
         *
         *      1,2 min   combate original
         *      2–4 min   com regeneração + recuo (mascarado, descartado)
         *      ~6 min    vida 900, sem curativo nenhum
         *
         *  SEIS MINUTOS É A DURAÇÃO NATURAL DESTE COMBATE com 30 bots, e está
         *  registrada como resultado, não como meta atingida. Chegar aos 20–25
         *  exigiria as mudanças estruturais da seção 10.8 do doc de passagem
         *  (limite de detecção, vidas, equipes) — e a decisão de perseguir isso
         *  ou aceitar partidas de 6–8 min é de gameplay, não de tuning.
         *
         *  Ressalva importante: bots não recuam e não evitam briga. Humanos
         *  fazem as duas coisas, então a duração com jogadores de verdade
         *  provavelmente é MAIOR. Este número é um piso, não um teto.          */
      },
    },
  },

  /* ================================================================== */
  /*  BT3  —  tabelas de mecânica idêntica ao Tenkaichi 3 (blueprint §5) */
  /* ================================================================== */
  /*  ESTE BLOCO É O PRODUTO DO ARQUIVO. Ele substitui moves/combo/
   *  defenseMatrix/launch/smashCharge/pursuit/homing/rushApproach por
   *  dados no SHAPE do decompilado (z3xox/Tenkaichi3Decomp), porque o
   *  pedido é um caminho só: nada de `if (bt3Mode)`. Os campos marcados
   *  abaixo como congelados são contrato com o WP2 — o código de combate
   *  passa a ler AQUI, não de seções inventadas.
   *
   *  UNIDADES (blueprint §1, obrigatórias):
   *    tempo    → frames @60fps (parâmetros BT3 em “segundos” ×30 no decomp
   *               foram convertidos: segundos ×60)
   *    ki       → 0..100 (decomp 0..100000 ÷ 1000)
   *    velocidade → m/s (decomp km/h ÷ 3,6; campos “10 km/h” do decomp
   *               também converteram para m/s)
   *
   *  O QUE VEM DO DECOMP (mecânica/constante estrutural) vs [AUTORADO]
   *  (números por golpe): startup/active/recovery por golpe NÃO são
   *  extraíveis — a janela de hit é evento do arquivo de animação
   *  binário (bobj_a.h) e os attack records vêm de AFS ilegível sem a
   *  ISO. Todo dano/duração/janela por golpe abaixo é [AUTORADO],
   *  calibrado nos baselines do protótipo que este arquivo já carregava.
   *  Quando a ISO chegar (`port/tools/extract_disc.py`), estes são os
   *  primeiros números a substituir. */
  bt3: {

    /* ---------------------------------------------------------------
     *  ATTACK RECORDS  (BtlAtkRecord 0x30 B, btl_tech_a.h:59-96)
     * ---------------------------------------------------------------
     *  Chave = attack id do BT3. Cobrem o kit do MVP Goku (blueprint
     *  §4.6 / §5): rush 0..10, smash carregável 0x13..0x21 (5 direções
     *  × 3 níveis de carga: fraco <0,3 / médio <0,99 / cheio),
     *  throws 0x55/0x56, finishers 0x59..0x5E (ações 0x64/0x65 por
     *  carga). Técnicas não estão aqui: elas vivem em `supers`
     *  (BtlSuperData), como no decomp.
     *
     *  Ordem das 5 direções em 0x13..0x21 [AUTORADO — decomp mapeia as
     *  animações 0x58, 0x5B, 0x52, 0x55, 0x4C|0x4F, mas a ordem das
     *  direções é deduzida dos inputs 0x35..0x38 = cima/baixo/esq/dir
     *  + contextual sem direção]:
     *    índice 0 cima · 1 baixo · 2 esquerda · 3 direita · 4 frente
     *    0x13..0x17 fracos · 0x18..0x1C médios · 0x1D..0x21 cheios
     *
     *  pushHit/pushGuard/launchSpeed: m/s (decomp: unidades de 10 km/h).
     *  shakeTime: frames (decomp: décimos de segundo). launchA/B: graus
     *  (yaw/pitch). flags: bits do decomp; 0x200000 = pitch de lançamento
     *  vem do HitPose.90 (btl_char_hit.h). priority: maior vence em trade
     *  igual-clash; armadura do golpe = flags 0x200 + armorIgnore. */
    records: {

      /* ---- RUSH (ação 0x44): elos 0..9, anim unkD60 + 0x37 ----
       * id 0 = primeiro hit da anim 0x37, id 1 = hits seguintes dela,
       * ids 2..10 = elos 1..9 (animações 0x38..0x40). Baseline de dano
       * do protótipo (rush_1..5: 5/5/6/6/8) distribuída na string de 10. */
      '0':  { flags: 0, damage: 5, guardDamage: 6, guardKi: 2, kiGain: 6, pushHit: 2.0, pushGuard: 1.0, launchSpeed: 0, launchA: 0, launchB: 0, shakePower: 1, shakeTime: 6, react: 5, reactB: 0, reactD: 0, reactE: 0, reactC: 0, hitFx: 1, hitSound: 0, voice: 1, priority: 1, guardB: 0, guardC: 0, guardA: 0, guardE: 0, guardFlagSel: 0, armorIgnore: 0 },  // [AUTORADO]
      '1':  { flags: 0, damage: 5, guardDamage: 6, guardKi: 2, kiGain: 6, pushHit: 2.0, pushGuard: 1.0, launchSpeed: 0, launchA: 0, launchB: 0, shakePower: 1, shakeTime: 6, react: 5, reactB: 0, reactD: 0, reactE: 0, reactC: 0, hitFx: 1, hitSound: 0, voice: 1, priority: 1, guardB: 0, guardC: 0, guardA: 0, guardE: 0, guardFlagSel: 0, armorIgnore: 0 },  // [AUTORADO]
      '2':  { flags: 0, damage: 5, guardDamage: 6, guardKi: 2, kiGain: 6, pushHit: 2.0, pushGuard: 1.0, launchSpeed: 0, launchA: 0, launchB: 0, shakePower: 1, shakeTime: 6, react: 5, reactB: 0, reactD: 0, reactE: 0, reactC: 0, hitFx: 1, hitSound: 0, voice: 1, priority: 1, guardB: 0, guardC: 0, guardA: 0, guardE: 0, guardFlagSel: 0, armorIgnore: 0 },  // [AUTORADO]
      '3':  { flags: 0, damage: 5, guardDamage: 6, guardKi: 2, kiGain: 6, pushHit: 2.0, pushGuard: 1.0, launchSpeed: 0, launchA: 0, launchB: 0, shakePower: 1, shakeTime: 6, react: 5, reactB: 0, reactD: 0, reactE: 0, reactC: 0, hitFx: 1, hitSound: 0, voice: 1, priority: 1, guardB: 0, guardC: 0, guardA: 0, guardE: 0, guardFlagSel: 0, armorIgnore: 0 },  // [AUTORADO]
      '4':  { flags: 0, damage: 6, guardDamage: 8, guardKi: 2, kiGain: 7, pushHit: 2.2, pushGuard: 1.0, launchSpeed: 0, launchA: 0, launchB: 0, shakePower: 2, shakeTime: 7, react: 5, reactB: 0, reactD: 0, reactE: 0, reactC: 0, hitFx: 1, hitSound: 0, voice: 1, priority: 1, guardB: 0, guardC: 0, guardA: 0, guardE: 0, guardFlagSel: 0, armorIgnore: 0 },  // [AUTORADO]
      '5':  { flags: 0, damage: 6, guardDamage: 8, guardKi: 2, kiGain: 7, pushHit: 2.2, pushGuard: 1.0, launchSpeed: 0, launchA: 0, launchB: 0, shakePower: 2, shakeTime: 7, react: 5, reactB: 0, reactD: 0, reactE: 0, reactC: 0, hitFx: 1, hitSound: 0, voice: 1, priority: 1, guardB: 0, guardC: 0, guardA: 0, guardE: 0, guardFlagSel: 0, armorIgnore: 0 },  // [AUTORADO]
      '6':  { flags: 0, damage: 6, guardDamage: 8, guardKi: 3, kiGain: 7, pushHit: 2.4, pushGuard: 1.2, launchSpeed: 0, launchA: 0, launchB: 0, shakePower: 2, shakeTime: 7, react: 7, reactB: 0, reactD: 0, reactE: 0, reactC: 0, hitFx: 2, hitSound: 0, voice: 1, priority: 1, guardB: 0, guardC: 0, guardA: 0, guardE: 0, guardFlagSel: 0, armorIgnore: 0 },  // [AUTORADO]
      '7':  { flags: 0, damage: 7, guardDamage: 8, guardKi: 3, kiGain: 8, pushHit: 2.4, pushGuard: 1.2, launchSpeed: 0, launchA: 0, launchB: 0, shakePower: 2, shakeTime: 7, react: 7, reactB: 0, reactD: 0, reactE: 0, reactC: 0, hitFx: 2, hitSound: 0, voice: 1, priority: 1, guardB: 0, guardC: 0, guardA: 0, guardE: 0, guardFlagSel: 0, armorIgnore: 0 },  // [AUTORADO]
      '8':  { flags: 0, damage: 7, guardDamage: 9, guardKi: 3, kiGain: 8, pushHit: 2.6, pushGuard: 1.2, launchSpeed: 0, launchA: 0, launchB: 0, shakePower: 3, shakeTime: 8, react: 7, reactB: 0, reactD: 0, reactE: 0, reactC: 0, hitFx: 2, hitSound: 1, voice: 2, priority: 1, guardB: 0, guardC: 0, guardA: 0, guardE: 0, guardFlagSel: 0, armorIgnore: 0 },  // [AUTORADO]
      '9':  { flags: 0, damage: 8, guardDamage: 10, guardKi: 3, kiGain: 9, pushHit: 2.8, pushGuard: 1.4, launchSpeed: 0, launchA: 0, launchB: 0, shakePower: 3, shakeTime: 8, react: 9, reactB: 0, reactD: 0, reactE: 0, reactC: 0, hitFx: 3, hitSound: 1, voice: 2, priority: 1, guardB: 0, guardC: 0, guardA: 0, guardE: 0, guardFlagSel: 0, armorIgnore: 0 },  // [AUTORADO]
      '10': { flags: 0, damage: 9, guardDamage: 11, guardKi: 4, kiGain: 10, pushHit: 3.0, pushGuard: 1.6, launchSpeed: 0, launchA: 0, launchB: 0, shakePower: 4, shakeTime: 9, react: 9, reactB: 0, reactD: 0, reactE: 0, reactC: 0, hitFx: 3, hitSound: 1, voice: 2, priority: 1, guardB: 0, guardC: 0, guardA: 0, guardE: 0, guardFlagSel: 0, armorIgnore: 0 },  // [AUTORADO]

      /* ---- SMASH CARREGÁVEL (0x47..0x4C → ids 0x13..0x21) ----
       * Baselines do protótipo: smash frente dano 16 / empurrão 46 m/s;
       * cima 14 / 38 de subida; baixo 18 / 42 de cravada. Níveis de carga
       * escalam ~0,8 / ~1,0 / ~1,5 sobre a base — substitui o Perfect
       * Smash por QUANTIDADE DE CARGA (blueprint §4.3). */
      // — fracos (carga < 0,3) —
      '0x13': { flags: 0x200000, damage: 11, guardDamage: 18, guardKi: 5, kiGain: 8, pushHit: 22, pushGuard: 8, launchSpeed: 22, launchA: 0, launchB: 70, shakePower: 4, shakeTime: 9, react: 9, reactB: 0, reactD: 0, reactE: 0, reactC: 0, hitFx: 2, hitSound: 1, voice: 2, priority: 2, guardB: 0, guardC: 0, guardA: 0, guardE: 0, guardFlagSel: 0, armorIgnore: 1 },   // cima [AUTORADO]
      '0x14': { flags: 0, damage: 13, guardDamage: 18, guardKi: 5, kiGain: 8, pushHit: 26, pushGuard: 10, launchSpeed: 26, launchA: 0, launchB: -50, shakePower: 5, shakeTime: 10, react: 9, reactB: 0, reactD: 0, reactE: 0, reactC: 0, hitFx: 2, hitSound: 1, voice: 2, priority: 2, guardB: 0, guardC: 0, guardA: 0, guardE: 0, guardFlagSel: 0, armorIgnore: 1 },  // baixo [AUTORADO]
      '0x15': { flags: 0, damage: 12, guardDamage: 18, guardKi: 5, kiGain: 8, pushHit: 30, pushGuard: 10, launchSpeed: 30, launchA: -25, launchB: 5, shakePower: 5, shakeTime: 10, react: 9, reactB: 0, reactD: 0, reactE: 0, reactC: 0, hitFx: 2, hitSound: 1, voice: 2, priority: 2, guardB: 0, guardC: 0, guardA: 0, guardE: 0, guardFlagSel: 0, armorIgnore: 1 },  // esquerda [AUTORADO]
      '0x16': { flags: 0, damage: 12, guardDamage: 18, guardKi: 5, kiGain: 8, pushHit: 30, pushGuard: 10, launchSpeed: 30, launchA: 25, launchB: 5, shakePower: 5, shakeTime: 10, react: 9, reactB: 0, reactD: 0, reactE: 0, reactC: 0, hitFx: 2, hitSound: 1, voice: 2, priority: 2, guardB: 0, guardC: 0, guardA: 0, guardE: 0, guardFlagSel: 0, armorIgnore: 1 },   // direita [AUTORADO]
      '0x17': { flags: 0, damage: 13, guardDamage: 18, guardKi: 5, kiGain: 8, pushHit: 30, pushGuard: 10, launchSpeed: 30, launchA: 0, launchB: 8, shakePower: 5, shakeTime: 10, react: 9, reactB: 0, reactD: 0, reactE: 0, reactC: 0, hitFx: 2, hitSound: 1, voice: 2, priority: 2, guardB: 0, guardC: 0, guardA: 0, guardE: 0, guardFlagSel: 0, armorIgnore: 1 },   // frente (contextual) [AUTORADO]
      // — médios (0,3 ≤ carga < 0,99) —
      '0x18': { flags: 0x200000, damage: 15, guardDamage: 22, guardKi: 6, kiGain: 10, pushHit: 26, pushGuard: 12, launchSpeed: 26, launchA: 0, launchB: 70, shakePower: 6, shakeTime: 11, react: 10, reactB: 0, reactD: 0, reactE: 0, reactC: 0, hitFx: 3, hitSound: 1, voice: 2, priority: 3, guardB: 0, guardC: 0, guardA: 0, guardE: 0, guardFlagSel: 0, armorIgnore: 1 },  // cima [AUTORADO]
      '0x19': { flags: 0, damage: 17, guardDamage: 22, guardKi: 6, kiGain: 10, pushHit: 34, pushGuard: 14, launchSpeed: 34, launchA: 0, launchB: -50, shakePower: 6, shakeTime: 11, react: 24, reactB: 0, reactD: 0, reactE: 0, reactC: 0, hitFx: 3, hitSound: 1, voice: 2, priority: 3, guardB: 0, guardC: 0, guardA: 0, guardE: 0, guardFlagSel: 0, armorIgnore: 1 },  // baixo [AUTORADO]
      '0x1A': { flags: 0, damage: 16, guardDamage: 22, guardKi: 6, kiGain: 10, pushHit: 40, pushGuard: 14, launchSpeed: 40, launchA: -25, launchB: 5, shakePower: 6, shakeTime: 11, react: 19, reactB: 0, reactD: 0, reactE: 0, reactC: 0, hitFx: 3, hitSound: 1, voice: 2, priority: 3, guardB: 0, guardC: 0, guardA: 0, guardE: 0, guardFlagSel: 0, armorIgnore: 1 },  // esquerda [AUTORADO]
      '0x1B': { flags: 0, damage: 16, guardDamage: 22, guardKi: 6, kiGain: 10, pushHit: 40, pushGuard: 14, launchSpeed: 40, launchA: 25, launchB: 5, shakePower: 6, shakeTime: 11, react: 19, reactB: 0, reactD: 0, reactE: 0, reactC: 0, hitFx: 3, hitSound: 1, voice: 2, priority: 3, guardB: 0, guardC: 0, guardA: 0, guardE: 0, guardFlagSel: 0, armorIgnore: 1 },  // direita [AUTORADO]
      '0x1C': { flags: 0, damage: 16, guardDamage: 22, guardKi: 6, kiGain: 10, pushHit: 40, pushGuard: 14, launchSpeed: 40, launchA: 0, launchB: 8, shakePower: 6, shakeTime: 11, react: 19, reactB: 0, reactD: 0, reactE: 0, reactC: 0, hitFx: 3, hitSound: 1, voice: 2, priority: 3, guardB: 0, guardC: 0, guardA: 0, guardE: 0, guardFlagSel: 0, armorIgnore: 1 },  // frente [AUTORADO]
      // — cheios (carga ≥ 0,99) — o empurrão daqui é o que causa ring-out
      '0x1D': { flags: 0x200000, damage: 21, guardDamage: 26, guardKi: 8, kiGain: 12, pushHit: 28, pushGuard: 16, launchSpeed: 28, launchA: 0, launchB: 70, shakePower: 8, shakeTime: 12, react: 10, reactB: 0, reactD: 0, reactE: 0, reactC: 0, hitFx: 4, hitSound: 2, voice: 3, priority: 3, guardB: 0, guardC: 0, guardA: 0, guardE: 0, guardFlagSel: 0, armorIgnore: 1 },  // cima [AUTORADO]
      '0x1E': { flags: 0, damage: 24, guardDamage: 26, guardKi: 8, kiGain: 12, pushHit: 44, pushGuard: 16, launchSpeed: 44, launchA: 0, launchB: -50, shakePower: 8, shakeTime: 12, react: 25, reactB: 0, reactD: 0, reactE: 0, reactC: 0, hitFx: 4, hitSound: 2, voice: 3, priority: 3, guardB: 0, guardC: 0, guardA: 0, guardE: 0, guardFlagSel: 0, armorIgnore: 1 },  // baixo [AUTORADO]
      '0x1F': { flags: 0, damage: 22, guardDamage: 26, guardKi: 8, kiGain: 12, pushHit: 48, pushGuard: 16, launchSpeed: 48, launchA: -25, launchB: 5, shakePower: 8, shakeTime: 12, react: 17, reactB: 0, reactD: 0, reactE: 0, reactC: 0, hitFx: 4, hitSound: 2, voice: 3, priority: 3, guardB: 0, guardC: 0, guardA: 0, guardE: 0, guardFlagSel: 0, armorIgnore: 1 },  // esquerda [AUTORADO]
      '0x20': { flags: 0, damage: 22, guardDamage: 26, guardKi: 8, kiGain: 12, pushHit: 48, pushGuard: 16, launchSpeed: 48, launchA: 25, launchB: 5, shakePower: 8, shakeTime: 12, react: 17, reactB: 0, reactD: 0, reactE: 0, reactC: 0, hitFx: 4, hitSound: 2, voice: 3, priority: 3, guardB: 0, guardC: 0, guardA: 0, guardE: 0, guardFlagSel: 0, armorIgnore: 1 },  // direita [AUTORADO]
      '0x21': { flags: 0, damage: 24, guardDamage: 26, guardKi: 8, kiGain: 12, pushHit: 52, pushGuard: 16, launchSpeed: 52, launchA: 0, launchB: 8, shakePower: 9, shakeTime: 13, react: 17, reactB: 0, reactD: 0, reactE: 0, reactC: 0, hitFx: 4, hitSound: 2, voice: 3, priority: 3, guardB: 0, guardC: 0, guardA: 0, guardE: 0, guardFlagSel: 0, armorIgnore: 1 },  // frente [AUTORADO]

      /* ---- ARREMESSOS (ações 0xB4..0xBC; record 0x55 = pegada+throw,
       * 0x56 = variante, btl_tech_a.h:44). A guarda NÃO responde a grab
       * (btl_char_hit.c:346+); escape é por nível (CheckThrowBreak). ---- */
      '0x55': { flags: 0, damage: 13, guardDamage: 0, guardKi: 0, kiGain: 0, pushHit: 34, pushGuard: 0, launchSpeed: 34, launchA: 0, launchB: 12, shakePower: 7, shakeTime: 12, react: 17, reactB: 0, reactD: 0, reactE: 0, reactC: 0, hitFx: 3, hitSound: 1, voice: 2, priority: 0, guardB: 0, guardC: 0, guardA: 0, guardE: 0, guardFlagSel: 0, armorIgnore: 1 },   // throw baseline do protótipo [AUTORADO]
      '0x56': { flags: 0, damage: 11, guardDamage: 0, guardKi: 0, kiGain: 0, pushHit: 30, pushGuard: 0, launchSpeed: 30, launchA: 0, launchB: -30, shakePower: 6, shakeTime: 11, react: 24, reactB: 0, reactD: 0, reactE: 0, reactC: 0, hitFx: 3, hitSound: 1, voice: 2, priority: 0, guardB: 0, guardC: 0, guardA: 0, guardE: 0, guardFlagSel: 0, armorIgnore: 1 },   // variante (cravada) [AUTORADO]

      /* ---- FINISHERS do rush (0x59..0x5E: ações 0x64/0x65 por carga,
       * btl_tech_a.h:46). Identificação aproximada dos records — confirmar
       * quando a ISO liberar os AFS. [AUTORADO] ---- */
      '0x59': { flags: 0, damage: 10, guardDamage: 14, guardKi: 4, kiGain: 8, pushHit: 22, pushGuard: 8, launchSpeed: 22, launchA: 0, launchB: 30, shakePower: 5, shakeTime: 10, react: 9, reactB: 0, reactD: 0, reactE: 0, reactC: 0, hitFx: 2, hitSound: 1, voice: 2, priority: 2, guardB: 0, guardC: 0, guardA: 0, guardE: 0, guardFlagSel: 0, armorIgnore: 0 },
      '0x5A': { flags: 0, damage: 10, guardDamage: 14, guardKi: 4, kiGain: 8, pushHit: 22, pushGuard: 8, launchSpeed: 22, launchA: 0, launchB: 30, shakePower: 5, shakeTime: 10, react: 9, reactB: 0, reactD: 0, reactE: 0, reactC: 0, hitFx: 2, hitSound: 1, voice: 2, priority: 2, guardB: 0, guardC: 0, guardA: 0, guardE: 0, guardFlagSel: 0, armorIgnore: 0 },
      '0x5B': { flags: 0, damage: 14, guardDamage: 18, guardKi: 5, kiGain: 10, pushHit: 30, pushGuard: 10, launchSpeed: 30, launchA: 0, launchB: 30, shakePower: 6, shakeTime: 11, react: 19, reactB: 0, reactD: 0, reactE: 0, reactC: 0, hitFx: 3, hitSound: 1, voice: 2, priority: 2, guardB: 0, guardC: 0, guardA: 0, guardE: 0, guardFlagSel: 0, armorIgnore: 0 },
      '0x5C': { flags: 0, damage: 14, guardDamage: 18, guardKi: 5, kiGain: 10, pushHit: 30, pushGuard: 10, launchSpeed: 30, launchA: 0, launchB: 30, shakePower: 6, shakeTime: 11, react: 19, reactB: 0, reactD: 0, reactE: 0, reactC: 0, hitFx: 3, hitSound: 1, voice: 2, priority: 2, guardB: 0, guardC: 0, guardA: 0, guardE: 0, guardFlagSel: 0, armorIgnore: 0 },
      '0x5D': { flags: 0, damage: 19, guardDamage: 24, guardKi: 7, kiGain: 12, pushHit: 38, pushGuard: 14, launchSpeed: 38, launchA: 0, launchB: 40, shakePower: 8, shakeTime: 12, react: 17, reactB: 0, reactD: 0, reactE: 0, reactC: 0, hitFx: 4, hitSound: 2, voice: 3, priority: 3, guardB: 0, guardC: 0, guardA: 0, guardE: 0, guardFlagSel: 0, armorIgnore: 1 },
      '0x5E': { flags: 0, damage: 19, guardDamage: 24, guardKi: 7, kiGain: 12, pushHit: 38, pushGuard: 14, launchSpeed: 38, launchA: 0, launchB: 40, shakePower: 8, shakeTime: 12, react: 17, reactB: 0, reactD: 0, reactE: 0, reactC: 0, hitFx: 4, hitSound: 2, voice: 3, priority: 3, guardB: 0, guardC: 0, guardA: 0, guardE: 0, guardFlagSel: 0, armorIgnore: 1 },
    },

    /* ---------------------------------------------------------------
     *  MOTIONS  —  motionId → { clip, durationFrames, events[] }
     * ---------------------------------------------------------------
     *  Substitui startup/active/recovery como FONTE DA JANELA DE HIT:
     *  no BT3 a janela abre e fecha por evento do motion (bobj_a.h:13-37,
     *  teste no intervalo (prevFrame, frame]). Tipos de evento espelham
     *  os canais do decomp: hitBegin/hitEnd (janela), swing (whoosh —
     *  evento 2), impactLight (0x100) / impactHeavy (0x80), kiFire
     *  (evento 4), vibrate (45), shake (46).
     *
     *  `clip` é a TABELA DE MAPEAMENTO motion→pose procedural
     *  (procAnim.js): o que não existe vira o clip mais próximo e o gap
     *  está listado no bloco WP5 no fim desta seção. */
    motions: {

      /* Sparking (anim 0x36 do blueprint §4.5) — pose de carga. */
      '0x36': { clip: 'charge', durationFrames: 18, events: [ { frame: 0, type: 'vibrate' } ] },

      /* ---- RUSH: animações 0x37..0x40 = elos 0..9 ----
       * Janelas derivadas dos startups do protótipo (4..6 de startup,
       * 3 de active) escaladas ao longo da string de 10. [AUTORADO] */
      '0x37': { clip: 'attack_light_1', durationFrames: 15, events: [ { frame: 2, type: 'swing' }, { frame: 4, type: 'hitBegin' }, { frame: 7, type: 'hitEnd' }, { frame: 7, type: 'impactLight' } ] },
      '0x38': { clip: 'attack_light_2', durationFrames: 15, events: [ { frame: 2, type: 'swing' }, { frame: 4, type: 'hitBegin' }, { frame: 7, type: 'hitEnd' }, { frame: 7, type: 'impactLight' } ] },
      '0x39': { clip: 'attack_light_3', durationFrames: 16, events: [ { frame: 3, type: 'swing' }, { frame: 5, type: 'hitBegin' }, { frame: 8, type: 'hitEnd' }, { frame: 8, type: 'impactLight' } ] },
      '0x3A': { clip: 'attack_light_4', durationFrames: 16, events: [ { frame: 3, type: 'swing' }, { frame: 5, type: 'hitBegin' }, { frame: 8, type: 'hitEnd' }, { frame: 8, type: 'impactLight' } ] },
      '0x3B': { clip: 'attack_light_5', durationFrames: 17, events: [ { frame: 3, type: 'swing' }, { frame: 5, type: 'hitBegin' }, { frame: 8, type: 'hitEnd' }, { frame: 8, type: 'impactLight' } ] },
      '0x3C': { clip: 'attack_light_1', durationFrames: 17, events: [ { frame: 3, type: 'swing' }, { frame: 5, type: 'hitBegin' }, { frame: 8, type: 'hitEnd' }, { frame: 8, type: 'impactLight' } ] },
      '0x3D': { clip: 'attack_light_2', durationFrames: 17, events: [ { frame: 3, type: 'swing' }, { frame: 5, type: 'hitBegin' }, { frame: 8, type: 'hitEnd' }, { frame: 8, type: 'impactLight' } ] },
      '0x3E': { clip: 'attack_light_3', durationFrames: 18, events: [ { frame: 4, type: 'swing' }, { frame: 6, type: 'hitBegin' }, { frame: 9, type: 'hitEnd' }, { frame: 9, type: 'impactHeavy' } ] },
      '0x3F': { clip: 'attack_light_4', durationFrames: 19, events: [ { frame: 4, type: 'swing' }, { frame: 6, type: 'hitBegin' }, { frame: 9, type: 'hitEnd' }, { frame: 9, type: 'impactHeavy' } ] },
      '0x40': { clip: 'attack_light_5', durationFrames: 20, events: [ { frame: 4, type: 'swing' }, { frame: 6, type: 'hitBegin' }, { frame: 9, type: 'hitEnd' }, { frame: 9, type: 'impactHeavy' } ] },

      /* ---- SMASH: animações carregáveis por direção ----
       * Janelas dos smashes do protótipo (cima 12/4/22, baixo 14/4/26,
       * lado/frente 13/4/24). As animações do smash CHEIO (flag 0x84)
       * reaproveitam estas mesmas com pausa de carga no startup — o que
       * muda é o record (0x1D..0x21), não a janela. [AUTORADO] */
      '0x4C': { clip: 'attack_heavy', durationFrames: 41, events: [ { frame: 8, type: 'swing' }, { frame: 13, type: 'hitBegin' }, { frame: 17, type: 'hitEnd' }, { frame: 17, type: 'impactHeavy' }, { frame: 40, type: 'shake' } ] },  // frente
      '0x4F': { clip: 'attack_heavy', durationFrames: 41, events: [ { frame: 8, type: 'swing' }, { frame: 13, type: 'hitBegin' }, { frame: 17, type: 'hitEnd' }, { frame: 17, type: 'impactHeavy' }, { frame: 40, type: 'shake' } ] },  // frente (alt.)
      '0x52': { clip: 'attack_heavy', durationFrames: 41, events: [ { frame: 8, type: 'swing' }, { frame: 13, type: 'hitBegin' }, { frame: 17, type: 'hitEnd' }, { frame: 17, type: 'impactHeavy' }, { frame: 40, type: 'shake' } ] },  // lateral
      '0x55': { clip: 'attack_heavy', durationFrames: 41, events: [ { frame: 8, type: 'swing' }, { frame: 13, type: 'hitBegin' }, { frame: 17, type: 'hitEnd' }, { frame: 17, type: 'impactHeavy' }, { frame: 40, type: 'shake' } ] },  // lateral
      '0x58': { clip: 'attack_up', durationFrames: 38, events: [ { frame: 7, type: 'swing' }, { frame: 12, type: 'hitBegin' }, { frame: 16, type: 'hitEnd' }, { frame: 16, type: 'impactHeavy' }, { frame: 37, type: 'shake' } ] },     // cima
      '0x5B': { clip: 'attack_down', durationFrames: 44, events: [ { frame: 9, type: 'swing' }, { frame: 14, type: 'hitBegin' }, { frame: 18, type: 'hitEnd' }, { frame: 18, type: 'impactHeavy' }, { frame: 43, type: 'shake' } ] },  // baixo

      /* ---- VANISH ---- */
      '0x20': { clip: 'vanish', durationFrames: 7, events: [] },   // vanishing step (btl_act_e.c:468)
      '0x21': { clip: 'vanish', durationFrames: 7, events: [] },
      '0x22': { clip: 'vanish', durationFrames: 7, events: [] },
      '0x23': { clip: 'vanish', durationFrames: 7, events: [] },
      '0x24': { clip: 'vanish', durationFrames: 14, events: [] },  // vanish behind [AUTORADO duração]
      '0x2B': { clip: 'attack_light_2', durationFrames: 16, events: [ { frame: 2, type: 'swing' }, { frame: 4, type: 'hitBegin' }, { frame: 7, type: 'hitEnd' }, { frame: 7, type: 'impactLight' } ] },  // vanish strike [AUTORADO]
      '0x2C': { clip: 'attack_light_2', durationFrames: 16, events: [ { frame: 2, type: 'swing' }, { frame: 4, type: 'hitBegin' }, { frame: 7, type: 'hitEnd' }, { frame: 7, type: 'impactLight' } ] },
      '0x2D': { clip: 'attack_light_3', durationFrames: 17, events: [ { frame: 3, type: 'swing' }, { frame: 5, type: 'hitBegin' }, { frame: 8, type: 'hitEnd' }, { frame: 8, type: 'impactLight' } ] },
      '0x2E': { clip: 'attack_light_3', durationFrames: 17, events: [ { frame: 3, type: 'swing' }, { frame: 5, type: 'hitBegin' }, { frame: 8, type: 'hitEnd' }, { frame: 8, type: 'impactHeavy' } ] },

      /* ---- GUARDA E CONTADOR ---- */
      '0x38': { clip: 'block', durationFrames: 24, events: [] },            // guarda (segurar; loop visual)
      '0x39': { clip: 'attack_light_1', durationFrames: 24, events: [ { frame: 6, type: 'swing' }, { frame: 10, type: 'hitBegin' }, { frame: 13, type: 'hitEnd' }, { frame: 13, type: 'impactHeavy' } ] },  // contador 0x89/0x8A/0x8B [AUTORADO]
      '0x3B': { clip: 'block_impact', durationFrames: 14, events: [ { frame: 4, type: 'impactHeavy' } ] },  // rebate [AUTORADO]
      '0x3D': { clip: 'block_impact', durationFrames: 14, events: [ { frame: 4, type: 'impactHeavy' } ] },

      /* ---- KI BLAST ---- */
      '0xAE': { clip: 'blast', durationFrames: 16, events: [ { frame: 4, type: 'kiFire' } ] },   // tiro A [AUTORADO janela]
      '0xAF': { clip: 'blast', durationFrames: 18, events: [ { frame: 5, type: 'kiFire' } ] },   // tiro B [AUTORADO]
      '0x95': { clip: 'blast', durationFrames: 30, events: [ { frame: 4, type: 'kiFire' }, { frame: 10, type: 'kiFire' }, { frame: 16, type: 'kiFire' } ] },  // volley; 30f = timer entre rajadas

      /* ---- GRAB / THROW (0xB4..0xBC) ---- */
      '0xB4': { clip: 'attack_light_1', durationFrames: 38, events: [ { frame: 4, type: 'swing' }, { frame: 8, type: 'hitBegin' }, { frame: 12, type: 'hitEnd' } ] },  // dash de grab [AUTORADO]
      '0xB5': { clip: 'attack_heavy', durationFrames: 22, events: [ { frame: 2, type: 'impactHeavy' } ] },  // throw [AUTORADO]
      '0xB6': { clip: 'attack_heavy', durationFrames: 22, events: [ { frame: 2, type: 'impactHeavy' } ] },
      '0xB7': { clip: 'attack_heavy', durationFrames: 26, events: [ { frame: 3, type: 'impactHeavy' } ] },  // lift throw [AUTORADO]
      '0xB8': { clip: 'attack_light_1', durationFrames: 12, events: [] },   // escape/reação de pegada
      '0xB9': { clip: 'attack_heavy', durationFrames: 24, events: [ { frame: 2, type: 'impactHeavy' } ] },
      '0xBA': { clip: 'attack_light_1', durationFrames: 12, events: [] },
      '0xBB': { clip: 'attack_heavy', durationFrames: 26, events: [ { frame: 3, type: 'impactHeavy' } ] },
      '0xBC': { clip: 'attack_heavy', durationFrames: 24, events: [ { frame: 2, type: 'impactHeavy' } ] },

      /* ---- RECUPERAÇÃO ---- */
      '0xC9': { clip: 'recover', durationFrames: 18, events: [] },   // recuperação aérea (chão)
      '0xCA': { clip: 'recover', durationFrames: 18, events: [] },   // recuperação aérea (ar)
      '0xE6': { clip: 'dodge', durationFrames: 18, events: [] },     // recuperação de voo [AUTORADO]

      /* ---- REAÇÕES (durações estruturais quando conhecidas) ---- */
      '0xD3': { clip: 'hit_react', durationFrames: 15, events: [] },        // stun em pé — tiers 15/30/45 via stunTime
      '0xD4': { clip: 'launched', durationFrames: 45, events: [] },         // knockback — duração unkFC8×15 [AUTORADO base]
      '0xD5': { clip: 'launched', durationFrames: 50, events: [] },         // blowaway tipo 1 (1000 km/h)
      '0xD6': { clip: 'launched', durationFrames: 15, events: [] },         // blowaway tipo 2 (2000 km/h)
      '0xDF': { clip: 'launched', durationFrames: 32, events: [] },         // blowaway tipo 3 (2000 km/h)
      '0xCE': { clip: 'launched', durationFrames: 60, events: [] },         // lançado — recuperação a partir do frame 9 [AUTORADO base]
      '0xE0': { clip: 'launched', durationFrames: 15, events: [] },         // stun aéreo — tiers 15/30/45

      /* ---- TÉCNICAS ---- */
      '0x105': { clip: 'ultimate', durationFrames: 40, events: [ { frame: 40, type: 'kiFire' } ] },  // pose de técnica (hit-stop nível 2)
      '0x106': { clip: 'ultimate', durationFrames: 130, events: [ { frame: 40, type: 'kiFire' }, { frame: 110, type: 'shake' } ] },  // feixe (subset Goku) [AUTORADO duração]

      /* ---- CLASH ---- */
      '0x130': { clip: 'block_impact', durationFrames: 12, events: [ { frame: 2, type: 'impactHeavy' } ] },
      '0x131': { clip: 'block_impact', durationFrames: 12, events: [ { frame: 2, type: 'impactHeavy' } ] },
      '0x132': { clip: 'block_impact', durationFrames: 12, events: [ { frame: 2, type: 'impactHeavy' } ] },

      /* WP5 — lista de poses a criar (clip mais próximo já usado acima
       * como placeholder; formato: // WP5: criar pose — <motionId> <motivo>) */
      // WP5: criar pose — 0x2B vanish strike — não existe pose de strike saindo de vanish (clip: attack_light_2)
      // WP5: criar pose — 0x2C vanish strike — idem (clip: attack_light_2)
      // WP5: criar pose — 0x2D vanish strike — idem (clip: attack_light_3)
      // WP5: criar pose — 0x2E vanish strike — idem (clip: attack_light_3)
      // WP5: criar pose — 0x39 contragolpe do contador — reaproveita jab (clip: attack_light_1)
      // WP5: criar pose — 0x3B rebate de ki blast — reaproveita block_impact; pose é repelir com a mão
      // WP5: criar pose — 0x3D rebate de ki blast — idem
      // WP5: criar pose — 0x95 rajada de volley — reaproveita blast; pose é três tiros em sequência
      // WP5: criar pose — 0xB4 dash de grab — reaproveita jab; pose é mergulho de pegada
      // WP5: criar pose — 0xE6 recuperação de voo — reaproveita dodge; pose é estabilizar no ar
      // WP5: criar pose — 0x130 clash — reaproveita block_impact; pose é choque de guarda
      // WP5: criar pose — 0x131 clash — idem
      // WP5: criar pose — 0x132 clash — idem
      // WP5: criar pose — smash cheio (flag 0x84) — mesma animação do carregável com pausa
      //   de carga; se o playtest pedir leitura visual própria, é aqui.
    },

    /* ---------------------------------------------------------------
     *  OS 9 RESULTADOS DA GUARDA  (BtlHit_ApplyGuard, btl_char_hit.h:27-36)
     * ---------------------------------------------------------------
     *  Substituem a antiga matriz de defesa: cada golpe lista QUAL
     *  resultado produz (guardA/B/C/E no record), e cada resultado tem
     *  efeito próprio. Campos: stopLen (hit-stop em frames), ki (saldo
     *  aplicado ao reservatório da guarda, 0..100), blastGain (blast
     *  gauge devolvido, 0..100), chip (aplica dano residual), flags. */
    guardResults: {
      0: { name: 'PLAIN',      stopLen: 6,  ki: 0, blastGain: 0,  chip: true,  flags: 0 },                    // guarda comum [stopLen AUTORADO]
      1: { name: 'FLAG40',     stopLen: 6,  ki: 0, blastGain: 0,  chip: true,  flags: 0x40 },                 // só contra atk id < 0xB
      2: { name: 'TIMED_A',    stopLen: 8,  ki: 0, blastGain: 0,  chip: true,  flags: 0x41 },                 // timed guard janela A (flag 0x68); exige atk flag 0x10
      3: { name: 'TIMED_B',    stopLen: 8,  ki: 0, blastGain: 0,  chip: true,  flags: 0x41 },                 // janela B (0x69)
      4: { name: 'TIMED_C',    stopLen: 8,  ki: 0, blastGain: 0,  chip: true,  flags: 0x41 },                 // janela C (0x6A)
      5: { name: 'KI',         stopLen: 6,  ki: 0, blastGain: 0,  chip: true,  flags: 0x40 },                 // consome o reservatório unkD80; zerou → colapso (ação 0xEA)
      6: { name: 'PUSH',       stopLen: 0,  ki: 0, blastGain: 50, chip: true,  flags: 0 },                    // empurra o atacante + meio stock de blast [stopLen AUTORADO]
      7: { name: 'PUSH_STOP',  stopLen: 10, ki: 0, blastGain: 50, chip: true,  flags: 0, voice: 0x12 },       // PUSH + hit-stop + voz 0x12 [stopLen AUTORADO]
      8: { name: 'COUNTER',    stopLen: 16, ki: 0, blastGain: 0,  chip: false, flags: 0, counterActions: [0x89, 0x8A, 0x8B] },  // contador por nível (def+atk)%3; SEM chip [stopLen AUTORADO]
    },

    /* ---------------------------------------------------------------
     *  REAÇÕES  —  reactionId → ação enfileirada (QueueReaction)
     * ---------------------------------------------------------------
     *  Tabela extraída de btl_act_j.c:719-726 (comentário do decomp).
     *  Um hit não interrompe o ATACANTE — muda o DEFENSOR via reação
     *  enfileirada (blueprint §4.1). Reações 5..13 e 35/36/42/45..47
     *  tomadas 2+ vezes viram 0x10 (gira na direção do hit); morto vira
     *  0xF. `stunFrames` só onde o decomp define (23..28 → 0xD3/0xE0). */
    reactions: {
      1:  { action: 0xC0 },        // nada
      2:  { action: 0xC0 },        // no flinch (só morto reage)
      4:  { action: 0xC1 },
      5:  { action: 0xC2 },
      6:  { action: 0xC3 },
      7:  { action: 0xC4 },
      8:  { action: 0xC5 },
      9:  { action: 0xC6 },
      10: { action: 0xCE },        // lançado (sobe 1200 km/h, cai 1000)
      11: { action: 0xCD },
      12: { action: 0xCB },
      13: { action: 0xCC },
      14: { action: 0xDA },
      15: { action: 0xCF },
      16: { action: 0xD0 },
      17: { action: 0xD5 },        // blowaway tipo 1 (50 f a 1000 km/h)
      18: { action: 0xD6 },        // blowaway tipo 2 (15 f a 2000 km/h)
      19: { action: 0xD4 },        // knockback (700 km/h)
      20: { action: 0xB8 },
      22: { action: 0xBA },
      23: { action: 0xD3, stunFrames: 15 },  // stun em pé, tier 1
      24: { action: 0xD3, stunFrames: 30 },  // stun em pé, tier 2
      25: { action: 0xD3, stunFrames: 45 },  // stun em pé, tier 3
      26: { action: 0xE0, stunFrames: 15 },  // stun aéreo, tier 1
      27: { action: 0xE0, stunFrames: 30 },  // stun aéreo, tier 2
      28: { action: 0xE0, stunFrames: 45 },  // stun aéreo, tier 3
      29: { action: 0x131 },       // + unkE9C (contexto do 0x131)
      30: { action: 0x131 },
      31: { action: 0xDB },
      32: { action: 0xDC },
      33: { action: 0xDD },
      34: { action: 0x137 },       // + unkE9C
      35: { action: 0xC7 },
      36: { action: 0xC8 },
      37: { action: 0xBC },
      38: { action: 0xD1 },
      39: { action: 0xCB },
      40: { action: 0xDF },        // blowaway tipo 3 (32 f a 2000 km/h)
      41: { action: 0x134 },       // + unkFF4
      42: { action: 0xC6 },
      43: { action: 0xC4 },
      44: { action: 0xC5 },
      45: { action: 0xC6 },
      46: { action: 0xC4 },
      47: { action: 0xC6 },
      48: { action: 0xC6 },
      49: { action: 0xBF },
    },

    /* ---------------------------------------------------------------
     *  GAUGES  —  ki e blast gauge (btl_char_action.c:804-956)
     * ---------------------------------------------------------------
     *  Bloqueados por hit-stop/fora de luta. Ki regenera com motion flag
     *  0x10000 abaixo de `kiRegenLimit` (carga sustentada ×4); blast
     *  gauge com flag 0x20000. Taxas por FRAME @60. */
    gauges: {
      kiRecoverRate: 0.10,           // recuperação de ki fora de hit-stop [AUTORADO]
      kiRegenRate: 0.05,             // regen passivo (≈ 3/s; baseline ki.passiveRegenPerSec 2,2) [AUTORADO]
      kiRegenLimit: 60,              // teto do regen passivo [AUTORADO]
      chargeRate: 0.767,             // carregando ki (≈ 46/s = antigo ki.chargeRatePerSec) [AUTORADO]
      chargeSustainMul: 4,           // carga sustentada ×4 (estrutural, decomp)
      blastGain: 0.8,                // blast gauge por acerto limpo [AUTORADO]
      blastVolleyFrames: 30,         // timer entre rajadas de ki blast (btl_act_c.c:1312+)
      /* SPARKING (maxPower): drena por frame até zerar — o fim É o
       * esvaziamento, sem estado de exaustão à parte (blueprint §4.5).
       * 0,22/f ≈ 7,5 s com a barra cheia. [AUTORADO] */
      maxPowerDrainPerFrame: 0.22,
      /* Reservatório da guarda (unkD80, btl_char_hit.h:128): 0..100,
       * drena 400/100000 por frame segurando guarda (blueprint §10). */
      guardKiMax: 100,
      guardKiDrainPerFrame: 0.4,
    },

    /* VANISH — duas mecânicas (btl_act_e.c:468): step direcional barato
     * e behind caro. stepFrames: 7 (estrutural). Custos em ki 0..100. */
    vanish: { stepFrames: 7, stepKi: 10, behindKi: 20 },

    /* Smash carregável: cheia em 1,5 s, mínimo 0,75 s (btl_act_a.c:194-197). */
    chargeSmash: { fullFrames: 90, minFrames: 45 },

    /* Hit-stop de clash: mesmo tipo 6 f, misto 2 f (blueprint §4.5). */
    clash: { sameStop: 6, mixedStop: 2 },

    /* Stun tiers 15/30/45 f (reações 23..28 → 0xD3 em pé / 0xE0 aéreo). */
    stunTiers: [15, 30, 45],

    /* Blowaway (0xD5/0xD6/0xDF): duração e velocidade reais do decomp
     * (1000/2000/2000 km/h ÷ 3,6). [frames, m/s] */
    blowaway: [
      { frames: 50, speed: 277.8 },
      { frames: 15, speed: 555.6 },
      { frames: 32, speed: 555.6 },
    ],

    /* Knockback (0xD4): 700 km/h ÷ 3,6 (btl_act_a.c:3056+). */
    knockback: { speed: 194.4 },

    /* Lançado (0xCE): sobe 1200 km/h, cai 1000 km/h, recuperação a
     * partir do frame 9 (btl_act_a.c:2828+). */
    launched: { up: 333.3, down: 277.8, recoverFromFrame: 9 },

    /* Mash-out de blowaway: 4 + 12×(fraqueza) apertadas (btl_act_a.c). */
    mashOut: { base: 4, perWeakness: 12 },

    /* ---------------------------------------------------------------
     *  KI BLASTS  —  13 records (BtlKiBlastData 0x34 B, btl_tech_b.h:42-49)
     * ---------------------------------------------------------------
     *  Kinds 0/4/8 = sem carga; 1-3 / 5-7 / 9-11 = 3 níveis de carga
     *  (<0,3 / <0,99 / cheio); 12 = volley (ação 0x95). `speed` m/s
     *  (decomp: 10 km/h), `time` em frames (decomp: segundos), `turn`
     *  em graus/s (homing), `ki` 0..100, `hits` espalha dano/push. */
    kiBlasts: {
      '0':  { flags: 0,    type: 0, damage: 5,  guardDamage: 3,  ki: 4,  speed: 48, turn: 120, time: 156, push: 5,  guardPush: 3,  react: 5,  reactS800: 0, reactS4000: 0, reactS200: 0, hits: 1 },  // A solto (baseline ki_blast) [AUTORADO]
      '1':  { flags: 0,    type: 1, damage: 12, guardDamage: 6,  ki: 8,  speed: 40, turn: 140, time: 168, push: 12, guardPush: 6,  react: 5,  reactS800: 0, reactS4000: 0, reactS200: 0, hits: 1 },  // A carga 1 [AUTORADO]
      '2':  { flags: 0,    type: 2, damage: 22, guardDamage: 10, ki: 12, speed: 36, turn: 100, time: 180, push: 20, guardPush: 10, react: 7,  reactS800: 0, reactS4000: 0, reactS200: 0, hits: 1 },  // A carga 2 [AUTORADO]
      '3':  { flags: 0,    type: 3, damage: 34, guardDamage: 14, ki: 16, speed: 32, turn: 60,  time: 192, push: 30, guardPush: 14, react: 17, reactS800: 0, reactS4000: 0, reactS200: 0, hits: 1 },  // A carga 3 (baseline charged_blast) [AUTORADO]
      '4':  { flags: 0,    type: 0, damage: 6,  guardDamage: 3,  ki: 4,  speed: 52, turn: 100, time: 150, push: 5,  guardPush: 3,  react: 5,  reactS800: 0, reactS4000: 0, reactS200: 0, hits: 1 },  // B solto [AUTORADO]
      '5':  { flags: 0,    type: 1, damage: 13, guardDamage: 6,  ki: 8,  speed: 44, turn: 120, time: 162, push: 12, guardPush: 6,  react: 5,  reactS800: 0, reactS4000: 0, reactS200: 0, hits: 1 },  // B carga 1 [AUTORADO]
      '6':  { flags: 0,    type: 2, damage: 24, guardDamage: 10, ki: 12, speed: 40, turn: 90,  time: 174, push: 20, guardPush: 10, react: 7,  reactS800: 0, reactS4000: 0, reactS200: 0, hits: 1 },  // B carga 2 [AUTORADO]
      '7':  { flags: 0,    type: 3, damage: 36, guardDamage: 15, ki: 16, speed: 36, turn: 50,  time: 186, push: 32, guardPush: 14, react: 17, reactS800: 0, reactS4000: 0, reactS200: 0, hits: 1 },  // B carga 3 [AUTORADO]
      '8':  { flags: 0,    type: 0, damage: 4,  guardDamage: 2,  ki: 3,  speed: 56, turn: 80,  time: 138, push: 4,  guardPush: 2,  react: 5,  reactS800: 0, reactS4000: 0, reactS200: 0, hits: 1 },  // C solto [AUTORADO]
      '9':  { flags: 0,    type: 1, damage: 10, guardDamage: 5,  ki: 7,  speed: 48, turn: 100, time: 150, push: 10, guardPush: 5,  react: 5,  reactS800: 0, reactS4000: 0, reactS200: 0, hits: 1 },  // C carga 1 [AUTORADO]
      '10': { flags: 0,    type: 2, damage: 20, guardDamage: 9,  ki: 11, speed: 42, turn: 80,  time: 162, push: 18, guardPush: 9,  react: 7,  reactS800: 0, reactS4000: 0, reactS200: 0, hits: 1 },  // C carga 2 [AUTORADO]
      '11': { flags: 0,    type: 3, damage: 30, guardDamage: 13, ki: 15, speed: 38, turn: 45,  time: 174, push: 28, guardPush: 13, react: 17, reactS800: 0, reactS4000: 0, reactS200: 0, hits: 1 },  // C carga 3 [AUTORADO]
      '12': { flags: 0x20, type: 4, damage: 18, guardDamage: 9,  ki: 10, speed: 50, turn: 90,  time: 150, push: 8,  guardPush: 4,  react: 5,  reactS800: 0, reactS4000: 0, reactS200: 0, hits: 3 },  // volley (0x95) — 3 tiros [AUTORADO]
    },

    /* ---------------------------------------------------------------
     *  TÉCNICAS  —  BtlSuperData SoA (btl_tech_b.h:110-163)
     * ---------------------------------------------------------------
     *  Array paralelo por SLOT (0=TECH_A, 1=TECH_B, 2=ULTIMATE —
     *  BTL_SLOT_*). Campos selecionados do SoA; `time` em frames
     *  (decomp: segundos), `shotSpeed`/`push` em m/s (decomp: 10 km/h),
     *  `ki` 0..100, `damage` total do técnico. Baselines do antigo
     *  `blasts.ultimate` no slot 2. [AUTORADO] */
    supers: {
      flagsA: [0, 0, 0],
      flags: [0, 0, 0x20],
      id: [0, 0, 0],
      shotTime: [24, 18, 40],       // frames de pose antes do disparo
      shotSpeed: [120, 90, 80],     // m/s
      shotTurn: [0, 0, 0],          // graus/s (0 = feixe trava no disparo)
      shots: [1, 1, 1],
      hitsB: [3, 2, 6],
      hitsC: [0, 0, 1],
      steps: [1, 1, 1],
      lastStep: [0, 0, 0],
      hitDirKind: [0, 0, 0],
      type: [1, 1, 1],
      react: [18, 18, 18],
      reactAlt: [0, 0, 0],
      reactS800: [0, 0, 0],
      reactAltS800: [0, 0, 0],
      guardKind: [0, 0, 0],
      hitSound: [[1, 1, 2], [1, 1, 2]],
      push: [40, 50, 70],
      guardPush: [12, 16, 24],
      damage: [28, 36, 52],
      guardDamage: [12, 16, 24],
      ki: [30, 40, 70],
      recoil: [0, 0, 0],
      drain: [0, 0, 0],
      cooldown: [180, 240, 0],      // frames
      chargeLimit: [0, 0, 0],       // frames
      chargeScale: [1, 1, 1],
      throwAngleA: [0, 0, 0],       // graus
      throwAngleB: [0, 0, 0],
      rushSpeed: [0, 0, 0],         // m/s
    },
  },

  /* ================================================================== */
  /*  DEFESA E ESCAPE                                                    */
  /* ================================================================== */
  /*  Reduzida de propósito. O que saiu daqui foi substituído, não
   *  perdido — cada peça mudou de casa pro lado BT3:
   *
   *    vanish / vanishBattle / zCounter / sonicSway  →  não existem no
   *        BT3 (blueprint §4.4: o kit defensivo BT3 é guarda, timed
   *        guard, step, vanish e throw). Os 9 resultados de guarda e a
   *        tabela de reações estão em `bt3.guardResults` /
   *        `bt3.reactions`.
   *    estamina de guarda + quebra por exaustão  →  reservatório de ki
   *        da guarda (`bt3.gauges.guardKi*`, btl_char_hit.h:128) — no
   *        BT3 a guarda drena KI, não uma estamina própria, e o colapso
   *        é ação 0xEA, não um stun inventado.
   *    smash como quebra de guarda  →  o guard-break por SMASH do
   *        protótipo virou o fluxo de resultado PUSH/COUNTER dos
   *        records (guardA/B/C/E), sem chave própria aqui.
   *
   *  Ficaram os três sistemas de MOVIMENTO que o BT3 também tem e que
   *  são lidos pelo runtime atual como estavam: step, recuperação e a
   *  interação de grab (os tempos do THROW estão em
   *  `bt3.records['0x55']`; aqui fica a INTERAÇÃO pegou→escape). */
  defense: {
    guard: {
      damageReduction: 0.80,     // dano absorvido pela guarda comum [AUTORADO]
      knockbackReduction: 0.60,  // empurrão absorvido pela guarda comum [AUTORADO]
      /* O rebate de ki blast continua sendo janela de timing sobre a
       * guarda (btl_char_hit: a guarda é resultado 5 KI / 0 PUSH, o
       * timing decide qual). O resultado em si está em
       * `bt3.guardResults`. */
      deflectWindowFrames: 8,
      deflectSpeedMul: 1.25,
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
      /* 4 e não 10. O ki era o GARGALO da recuperação: medido, baratear este
       * número sozinho levou a luta de 37 s pra 74 s — o maior salto isolado
       * de toda a varredura de TTK. Quem acabou de levar um smash normalmente
       * está com ki baixo justamente por ter gastado defendendo, e aí não
       * tinha como se salvar. */
      kiCost: 4,
      windowAfterFrames: 12,    // só pode recuperar após N frames voando
      frames: 18,
      iframes: [0, 12],
      // Sem isto, levar um smash = morte garantida. Com isto, vira leitura.
    },

    /* ================================================================
     *  GRAB / THROW  —  a pegada, o arremesso e o escape
     * ================================================================
     *  O record do golpe (dano, janela, o que a guarda faz) está em
     *  `bt3.records['0x55']` — no BT3 a guarda NÃO responde a grab
     *  (btl_char_hit.c:346+, atk id 0x55/0x56 fora do alcance do
     *  guardA/B/C/E), então a única defesa contra pegada é o escape.
     *  Aqui ficam os tempos da INTERAÇÃO:
     *
     *      pegou  →  [ holdFrames ]  →  arremesso
     *                      │
     *                 escapeWindow: a vítima aperta guarda e se solta
     *
     *  O escape é de LEITURA, não de martelada: a janela abre no começo
     *  da pegada e fecha. Quem martela guarda por reflexo acerta às
     *  vezes; quem percebe a pegada acerta sempre. É a mesma gramática
     *  do timing de guarda do BT3 (timed guard / rebate), de propósito —
     *  o botão de guarda tem vários significados conforme o timing, e
     *  isso é profundidade sem tecla nova.                                      */
    grab: {
      holdFrames: 20,           // quanto tempo a pegada segura antes de arremessar
      range: 2.2,               // tem que estar colado
      escapeWindow: 12,         // frames iniciais em que o escape funciona
      escapeKiCost: 6,          // escapar custa: não é de graça
      /* Escapou: o AGRESSOR fica exposto. A troca é justa — ele apostou numa
       * leitura e errou, e agora come uma punição do tamanho do recovery que
       * teria comido se tivesse errado o grab inteiro. (BT3: CheckThrowBreak
       * devolve stun no atacante por nível — ver bt3.guardResults[8]). */
      escapeAttackerStunFrames: 30,
      escapeVictimIframes: 8,
      /* Não dá pra agarrar quem já está indefeso. Sem esta regra, grab depois de
       * um lançamento seria dano garantido e o jogo viraria uma sequência
       * fechada — uma vítima em blowaway/knockdown não é alvo de pegada. */
      cannotGrabStates: ['blowaway', 'knockdown', 'getup', 'hitstun', 'dead'],
      // Cooldown após um grab (qualquer resultado): impede spam de pegada.
      cooldownFrames: 40,
      hitstop: 8,
      shake: 0.25,
    },
  },

  /* ================================================================== */
  /*  ARENA                                                              */
  /* ================================================================== */
  /*  Arena Tenkaichi é GRANDE. Precisa de espaço pro smash mandar longe.
   *  Ela encolhe como uma cúpula (raio E teto), não como um círculo.       */
  /* ======================================================================
   *  ⚠️  A ARENA É DIMENSIONADA PELO SMASH — E ISSO SÓ VALE PARA 1×1
   * ======================================================================
   *  O raio 48 abaixo foi escolhido pra que um smash acertado no CENTRO não
   *  mate, e um acertado na metade externa mate. Para um duelo isso é certo.
   *
   *  Para 20–30 jogadores é a decisão errada, e a diferença é gritante. Mesma
   *  partida de 30, mudando SÓ a arena (medido, `tools/diversao.js`):
   *
   *      raio 48, encolhe aos 30 s    →  41% ring-out · 17 nocautes
   *                                      nada morre nos primeiros 20 s, e
   *                                      depois todo mundo morre de uma vez
   *
   *      raio 30, encolhe desde 0 s   →  79% RING-OUT · 6 nocautes
   *                                      primeira morte aos 16 s, funil suave
   *                                      30→28→23→20→16→13→11→9→7→5→3→1
   *
   *  Com raio 48 e 30 pessoas, cada um tem 241 m² — eles se espalham, e o jogo
   *  vira uma disputa de HP com uma borda decorativa. Com raio 30 são 94 m², a
   *  borda está sempre por perto, e o RING-OUT volta a ser o jeito de ganhar.
   *
   *  A regra prática que sai disso: **a arena deve ser dimensionada pela
   *  DENSIDADE, não pelo alcance do smash.** Algo como
   *
   *      raio ≈ 17 · √(jogadores / 2)      (48 para 2 · ~30 para 30)
   *
   *  e `shrinkStartSec` perto de zero quando há muita gente — com 30 jogadores
   *  o encolhimento não é pressão de fim de jogo, é o MOTOR DO RITMO da partida
   *  inteira. Os primeiros 30 s sem encolher são tempo morto.
   *
   *  NÃO alterei os valores: o 1×1 é o MVP validado, e mexer aqui mudaria o
   *  jogo que já foi medido. Isto fica registrado como o botão a girar quando
   *  o modo de 20–30 for pra valer.
   * ====================================================================== */
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
    /* 240 frames = 4 s fora antes de eliminar.
     *
     * Era 50 (0,8 s), e 0,8 s não é tempo de voltar: um smash lança a 46 m/s e
     * o corpo leva ~2,5 s só pra PARAR. Na prática, sair da arena era morte, e
     * a luta acabava no primeiro smash bem colocado — medido, 8 de 8 lutas
     * terminavam em ring-out em ~23 s.
     *
     * Com 4 s, ser lançado vira uma DISPUTA: você ainda morre se não reagir,
     * mas recuperar no tempo certo e voar de volta salva. O ring-out continua
     * pesado (5 de 10 mortes) — deixou de ser sentença e virou leitura, que é
     * o que separa perícia de azar. */
    outOfBoundsFrames: 240,
    floorY: 0,
  },

  /* ================================================================== */
  /*  OBSTÁCULOS  —  terreno que esconde (só no modo ARENA)              */
  /* ================================================================== */
  /*  O problema medido: com o limite de detecção dá pra FUGIR de uma briga,
   *  mas só por DISTÂNCIA. A arena era um vazio de 300 m — não existia
   *  esconder, cobrir, usar terreno. E o arco da partida era plano: % do
   *  tempo em combate por faixa de 5 min 27/24/28/15/12, mortes 7/15/3/2/2.
   *
   *  COLUNAS, e não pedras flutuantes, por três razões medidas/pensadas:
   *
   *    1. a visão é bloqueada no PLANO em que se voa. Medido na linha de base:
   *       altura dos lutadores p10 12 m · p50 24 m · p90 55 m. Uma pedra solta
   *       bloqueia só um cone; uma coluna de 55–100 m bloqueia o plano inteiro
   *       em que a briga acontece. Voar ACIMA dela é possível e é uma escolha
   *       (ver mais longe custa ficar exposto) — terreno com leitura, não
   *       parede invisível.
   *    2. AFUNDAR é legível: a fase muda e as colunas descem pro chão. O
   *       jogador lê "o esconderijo está acabando" sem HUD nenhuma.
   *    3. colisão e linha de visão contra cilindro vertical são contas de 2D
   *       mais uma altura — o mesmo que no Unreal vira um capsule trace.
   *
   *  A DENSIDADE É LIGADA ÀS FASES (`match.modes.arena.phases[].obst`): fração
   *  de colunas de pé naquele minuto. Muitas no INÍCIO/MEIO (dá pra sumir),
   *  ZERO antes da fase final — senão a restrição de término quebra (dois
   *  sobreviventes atrás de uma coluna numa arena de 10 m não se acham nunca).
   *  `matchMode.aplicar()` confere isso no boot.
   *
   *  `enabled` é 0 NA BASE: o duelo não sobrescreve nada, então a base tem
   *  que ser o comportamento do duelo — zero obstáculos. O modo arena liga. */
  obstacles: {
    enabled: 0,

    /* Quantas colunas e onde. Espalhadas num disco do tamanho da PRIMEIRA
     * fase (300 m), com folga mínima entre elas pra sempre existir corredor.
     *
     * A conta da densidade: a chance de um segmento de comprimento d cruzar
     * uma coluna de raio r é ≈ densidade × (2r·d + πr²). Com 340 colunas de
     * raio médio 8 m num disco de 300 m, um par a 20 m tem ~0,6 colunas no
     * caminho — perto de metade dos encontros a curta distância passa a ser
     * "eu sei que tem alguém ali, mas não vejo". */
    count: 720,
    radiusMin: 4.0,
    radiusMax: 10.0,
    heightMin: 55,              // acima do p90 de altura de voo medido (55 m)
    heightMax: 105,
    minGap: 4.5,                // corredor mínimo entre duas colunas (m)
    spawnClearance: 14.0,       // ninguém nasce colado numa coluna
    seed: 4242,                 // posições reproduzíveis entre partidas

    /* AFUNDAR, não sumir. Uma coluna desce até o chão em `sinkSeconds`; a
     * colisão e a visão acompanham a altura ATUAL. Sumir num frame seria um
     * esconderijo apagado debaixo de alguém — afundando, quem está atrás vê
     * o topo descendo e tem tempo de sair. A ordem é sorteada (`seed`): não
     * há região "segura" que dure mais que as outras. */
    sinkSeconds: 18,

    /* LINHA DE VISÃO
     * Adquirir exige ver AGORA. Perder por obstáculo exige ficar SEM ver por
     * `losLoseFrames` seguidos. É a mesma histerese de detectionRange /
     * loseTargetRange, aplicada ao tempo: sem ela o lock PISCA toda vez que
     * a briga contorna uma coluna, e a câmera pularia junto.
     * 90 frames (1,5 s) é mais que a janela de perseguição (75f): um smash
     * que manda o alvo pra trás de uma coluna não quebra a perseguição. */
    losLoseFrames: 90,
    eyeHeight: 1.1,             // altura do "olho" acima dos pés, pra visão

    /* COLISÃO (todos os estados, inclusive blowaway)
     * Fora do blowaway o corpo DESLIZA na coluna (perde só a componente que
     * entra nela) — bater de raspão não pode travar o voo.
     *
     * No BLOWAWAY o corpo QUICA: perde a componente normal × restituição e
     * metade da tangencial. DECISÃO: a coluna é um anteparo contra ring-out —
     * quem luta de costas pra uma coluna perto da borda não sai pelo smash.
     * Isso é terreno com valor tático, e é temporário por construção: as
     * colunas afundam antes do fim, e o fim continua sendo decidido na borda.
     * A alternativa (atravessar no blowaway) faria a coluna sólida pra tudo
     * menos pro golpe mais importante do jogo — incoerente de ler. */
    bounceRestitution: 0.35,
    bounceTangentKeep: 0.5,

    /* WALL-SLAM — DESLIGADO por padrão. Decisão de produto em aberto.
     *
     * Ligado: bater na coluna em blowaway acima de `minImpactSpeed` causa
     * dano e prende o corpo em HITSTUN por `stunFrames` (o "grudou na
     * parede"), que é janela de combo pra quem perseguir. É a versão de
     * parede do `groundSlam` (que já existe e dá `groundBounceDamage` 4).
     *
     * Por que desligado: muda o TTK do modo arena (todo smash perto de
     * coluna vira dano extra) e dá ao terreno um papel OFENSIVO que nunca
     * foi jogado por humano. Ver o que foi medido com ele ligado no doc de
     * passagem (10.10). */
    wallSlam: {
      enabled: 0,
      minImpactSpeed: 16,       // m/s na direção da coluna (smash sai a 46)
      damage: 36,               // ≈ 2,2 smashes de 16 — dói, não mata
      stunFrames: 40,           // > startup do rush (4) + homing: dá pra emendar
    },

    /* CÂMERA — Tenkaichi não deixa a parede comer a cena.
     * A câmera ENCURTA (mola de braço) quando há coluna entre ela e você, e
     * colunas entre a câmera e você/seu alvo ficam TRANSPARENTES. As duas
     * coisas juntas: você nunca some atrás de uma coluna, e o alvo também não. */
    cameraMargin: 0.8,          // distância mínima da câmera à superfície (m)
    occluderOpacity: 0.18,      // opacidade de quem tapa você ou o alvo
  },

  /* ================================================================== */
  /*  BARRA DE VIDA EM CAMADAS  —  a legibilidade do acerto              */
  /* ================================================================== */
  /*  O problema que isto resolve está medido e registrado: com vida 900,
   *  uma ROTA INTEIRA (4 rushes + smash) tira 4,0% da barra, e um rush
   *  tira 0,56%. O acerto some. Foi o custo aceito pra luta durar 2 minutos
   *  em vez de 14 segundos, e o comentário em `fighter.maxHealth` já dizia
   *  qual era o conserto certo: não baixar a vida, e sim a BARRA mostrar
   *  melhor o dano.
   *
   *  A solução é a de Naruto Storm: a barra tem CAMADAS, cada uma com sua
   *  cor. Você não lê "perdi 4% de 900" — lê "comi um quinto da camada
   *  vermelha", e quando ela acaba o adversário vê a cor mudar.
   *
   *  Com 5 camadas de 180:
   *      rush          0,56% do total  →   2,8% da camada
   *      rota inteira  4,0%            →  20% da camada    ← visível
   *      quebrar camada é um EVENTO, com cor nova e um baque na tela
   *
   *  É puramente apresentação: nenhum número de combate muda, e o total
   *  continua sendo 900. O que muda é a escala contra a qual o olho compara.
   *
   *  Efeito colateral de design que vale manter: a troca de cor dá ao jogo
   *  marcos de "fase da luta" que o HP sozinho não dava. Saber que o outro
   *  está na última camada é informação tática — é quando o ring-out deixa
   *  de ser a única via rápida.                                            */
  healthBar: {
    layers: 5,

    /* Da camada CHEIA pra última. A última é vermelha de propósito: é o
     * sinal universal de "acabando", e tem que destoar das outras. */
    colors: ['#6fe8a0', '#9ee86f', '#e8d76f', '#e8a06f', '#ff5a6a'],

    /* A barra mostra UMA camada por vez, CHEIA — não o total picotado.
     *
     * A primeira versão dividia a barra em cinco faixas com linhas. Funcionava
     * como régua e era feia: a barra ficava quase parada, e o dano continuava
     * parecendo pequeno porque o olho comparava com a largura TOTAL.
     *
     * Mostrando uma camada de cada vez, a largura inteira da barra passa a
     * valer 180 de vida em vez de 900. O mesmo golpe que movia 0,56% agora
     * move 2,8% — cinco vezes mais, sem nenhum número de combate mudar. E
     * quando a camada acaba, a barra ENCHE DE NOVO com outra cor, que é o
     * momento em que o jogador sente que arrancou alguma coisa.
     *
     * Os pontinhos abaixo da barra são o que preserva a leitura do TOTAL —
     * sem eles, estar na última camada e na primeira pareceriam iguais. */
    showPips: true,

    /* Quebrar uma camada é um evento: clarão na barra + tremor curto.
     * Sem isso a mudança de cor passa despercebida no meio da luta. */
    flashOnBreak: true,
    breakFlashMs: 420,
    breakShake: 0.22,

    /* Ao quebrar uma camada, o rastro branco é jogado no CHEIO pra drenar a
     * barra nova inteira. É o que vende "arranquei uma camada" — sem isso a
     * barra só troca de cor e o momento passa batido. */
    ghostResetOnBreak: true,
  },

  /* ================================================================== */
  /*  JUICE  —  no Tenkaichi isto não é enfeite, é METADE do jogo         */
  /* ================================================================== */
  /* ==========================================================================
   *  ÁUDIO  —  sintetizado (src/core/audio.js)
   * ==========================================================================
   *  Os timbres são placeholder e morrem no porte. O que porta é a REGRA DE
   *  MIXAGEM abaixo — a mesma lição do hitstop global (8.31): com 30
   *  lutadores, som que não cai com a distância vira chiado e afoga o seu.
   *  `M` liga/desliga.                                                      */
  audio: {
    enabled: true,
    volume: 0.7,

    /* Eventos em que VOCÊ está envolvido tocam sempre cheios. Os dos outros
     * passam por isto: */
    othersGain: 0.55,       // teto pra briga alheia, mesmo colada em você
    refDistance: 12,        // m — até aqui, sem queda
    maxDistance: 60,        // m — além disto, silêncio (≈ 2,5× a detecção)

    maxVoices: 24,          // sons simultâneos, teto duro
    minIntervalSec: 0.035,  // mesmo tipo de som não repete mais rápido que isto
  },

  juice: {
    hitstopEnabled: true,
    hitstopScale: 1.0,
    hitstopShakeAmp: 0.05,      // vibração DURANTE o congelamento

    /* ================================================================
     *  ALCANCE DO HITSTOP  —  o bloqueador da escala
     * ================================================================
     *  O hitstop era GLOBAL: um contador só, e `juice.hitstop()` pegando o
     *  MAIOR entre o atual e o novo. Com dois lutadores isso é perfeito — eles
     *  revezam, e o congelamento pontua cada troca.
     *
     *  Com muitos, vira outra coisa. Medido no navegador, % do tempo com a
     *  simulação inteira parada:
     *
     *       2 lutadores   20,6%     ← o jogo validado. Isto é "gostoso".
     *       4 lutadores   88,7%
     *       8 lutadores   36,2%
     *      16 lutadores   77,0%     ← 12 janelas de 2 s, nenhuma abaixo de 57%
     *
     *  Com 16, a simulação rodava 0,18 passo por frame de render. O jogo não
     *  estava lento por falta de CPU (a simulação custa 0,3 ms) — estava PARADO,
     *  porque sempre havia alguém batendo em alguém, e o congelamento global
     *  nunca soltava. É um defeito de DESIGN que se disfarça de problema de
     *  performance, e não apareceria nunca num teste 1×1.
     *
     *  A raiz é conceitual: hitstop é propriedade de uma TROCA, não do mundo.
     *  Não faz sentido o seu combo congelar porque dois desconhecidos do outro
     *  lado da arena se acertaram.
     *
     *    'player'    (padrão) os DOIS envolvidos congelam sempre; a TELA só
     *                congela quando você é um dos dois. Em 1×1 é idêntico ao
     *                comportamento antigo — toda troca é sua. Com 16, só as
     *                suas trocas param a tela, e as dos outros congelam apenas
     *                os corpos deles.
     *    'fighters'  ninguém congela a tela. Mais correto pra espectador/rede,
     *                menos impactante pra quem joga.
     *    'global'    o comportamento antigo. Só pra comparar lado a lado —
     *                não use acima de 2 lutadores.
     */
    hitstopScope: 'player',

    /* ================================================================
     *  CÂMERA LENTA  —  DESLIGADA
     * ================================================================
     *  A câmera lenta mexe no RELÓGIO DO MUNDO (`loop.timeScale`). No 1×1
     *  é leitura dramática; com 30 lutadores é defeito: qualquer vanish, Z-
     *  Counter ou Perfect Smash de dois desconhecidos do outro lado da arena
     *  deixava TODO MUNDO lento — inclusive a sua briga. Em rede nem existe:
     *  um cliente não pode desacelerar o tempo dos outros.
     *
     *  É o mesmo erro conceitual do hitstop global (ver acima), sem a saída
     *  do escopo por lutador — não dá pra desacelerar só um corpo sem quebrar
     *  o frame data. Então sai inteira. Os `slowMo*` espalhados pelos golpes
     *  ficam nos dados só como registro; com isto em false, nada os lê.
     *
     *  No Unreal: se voltar, volta como efeito LOCAL de câmera/VFX do
     *  envolvido, nunca como `SetGlobalTimeDilation`.                      */
    slowMoEnabled: false,

    /* ================================================================
     *  HITSTOP POR CATEGORIA  (§22)
     * ================================================================
     *  Cada golpe carregava um `hitstop` solto (4, 6, 16, 18…) e não havia como
     *  saber se 16 era "pesado" ou só um número que alguém digitou. Pior: golpes
     *  de peso parecido tinham congelamentos diferentes por descuido, e o
     *  jogador lê isso como inconsistência de impacto sem saber dizer por quê.
     *
     *  Agora existe uma ESCALA nomeada, e o golpe se encaixa numa categoria. O
     *  `hitstop` do golpe continua funcionando e VENCE a categoria quando
     *  presente — é o escape pra um golpe que precisa ser exceção.
     *
     *  A ordem é a hierarquia de peso do jogo, e ela tem que ser respeitada:
     *
     *      guarda  <  normal  <  counter  <  pesado  <  lançamento  <  perfect
     *
     *  O aviso do §22 ("não exagerar") está embutido nos números: o topo é 26
     *  frames, menos de meio segundo. Hitstop generoso demais deixa o combate
     *  pastoso, e o erro é difícil de perceber porque cada golpe isolado parece
     *  ótimo — é a sequência que fica lenta.                                   */
    hitstopProfiles: {
      guard:   6,               // aparar tem que dar um baque, não um freio
      normal:  4,               // rush: curto, o combo precisa fluir
      counter: 16,              // Z-Counter / trade: o momento de reviravolta
      heavy:   16,              // smash
      launch:  18,              // o que manda voando
      perfect: 26,              // Perfect Smash: o teto
    },

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

    /* Lags por estado do jogador — "arrasto" medido com o jogador e o alvo
     * deslizando juntos a velocidade constante (harness da Etapa 2, 150 frames,
     * frames 120+). O erro de regime de um seguidor exponencial é v/k, ou seja
     * v/followLag — por isso um lag fixo não serve: o mesmo 11 que está certo
     * parado sobra demais a 62 m/s.
     *
     * ANTES (followLag 11 / rotateLag 9 em tudo):
     *   move 20 m/s: 1,66 m · hitstun 30: 2,48 m · blowaway 46: 3,81 m
     *   pursuit 52: 4,31 m · dash 62: 5,14 m de arrasto
     * 5 m de arrasto no dash = o jogador sai de quadro na ponta da tela.
     * META do ajuste: dash ~2,5 m (followLag ≈ 24 → 62/24 ≈ 2,6 m).
     *
     * Só acima da base: estados parados/recebendo dano mantêm o lag base,
     * porque aproximar a câmera de um corpo em hitstun só faz a tela tremer
     * com o knockback. */
    lagPorEstado: {
      dash:     { followLag: 24, rotateLag: 16 },
      pursuit:  { followLag: 22, rotateLag: 15 },
      approach: { followLag: 20, rotateLag: 14 },
    },

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

    /* ================================================================
     *  AS FERRAMENTAS NOVAS, DO LADO DA IA
     * ================================================================
     *  Uma mecânica que só o jogador usa não é testável. A lição está registrada
     *  na seção 11 do doc de passagem: `cancelOnBlock` fazia o que prometia e
     *  ficou INERTE porque o bot mal bloqueava — "ferramenta defensiva só cobra
     *  preço se alguém de fato a usar no tempo certo". O mesmo vale do lado
     *  ofensivo, e é por isso que cada mecânica desta passada tem uma chance
     *  aqui.
     *
     *  Nenhuma delas está em 1.0 de propósito. Uma IA que sempre agarra quem
     *  bloqueia, sempre acerta o Perfect Smash e sempre responde à vanish battle
     *  não mede o combate — mede a paciência do jogador, e o resultado vira
     *  "impossível" em vez de "tem profundidade". */

    /* Chance de AGARRAR quando o adversário está defendendo e colado.
     * É a ferramenta que ensina o jogador a não segurar F cegamente — e o único
     * jeito de ele descobrir isso é levando. */
    grabChance: 0.45,

    /* Chance de SEGURAR o smash pra tentar o Perfect (§8).
     * Baixa porque carregar expõe: um bot que carrega todo smash viraria um saco
     * de pancada telegrafado, e o jogador aprenderia a punir carga em vez de
     * aprender a ler o timing — o oposto do que a mecânica existe pra treinar.
     * A precisão dentro da janela escala com `difficulty`, não com isto. */
    smashChargeChance: 0.35,

    /* Chance de acender o MAX POWER quando já está carregando com ki cheio.
     * Importa pro playtest pelo lado RECEPTOR: é a única forma de o jogador
     * sentir o counterplay (aguentar os 7 s e punir a exaustão que vem depois). */
    maxPowerChance: 0.5,
    blastChance: 0.30,
    chargeKiBelow: 28,          // carrega ki quando abaixo disto
    /* 0,85: um jogador competente quase sempre tenta recuperar. Com 0,6 a IA
     * simplesmente se deixava cair em 40% dos lançamentos, e isso encurtava a
     * luta por burrice, não por design. */
    recoverChance: 0.85,        // chance de se recuperar após levar smash

    /* ================================================================
     *  OBSTÁCULOS (só existem no modo arena — ver `TUNING.obstacles`)
     * ================================================================
     *  DESVIAR: a IA olha `obstacleLookahead` metros à frente na direção em
     *  que quer ir e, se houver coluna no caminho, contorna pela tangente.
     *  Sem isto ela bate de frente e desliza — funciona, mas parece burra, e
     *  bater de frente custa velocidade justamente na aproximação.
     *
     *  USAR: fora de combate e com vida abaixo de `hideBelowHealth`, ela vai
     *  pra SOMBRA da coluna mais próxima — o lado oposto de onde viu o último
     *  inimigo — e carrega ki ali. É a versão "com terreno" do que
     *  `_foraDeCombate` já fazia (recompor). Não é trapaça: ela usa só a
     *  última posição que ELA viu, não onde os outros estão de fato.
     *  Não é o recuo vetado (`retreatBelowHealth`, em zero): ela não foge de
     *  briga nenhuma — só escolhe ONDE se recompor depois que a briga acabou. */
    obstacleLookahead: 14.0,
    hideBelowHealth: 0.6,
    hideSearchRadius: 70.0,     // só procura coluna até aqui (não atravessa a arena)

    /* DERIVA FORA DE COMBATE — componente radial (+ = rumo ao centro).
     * Interpolada pelo raio ATUAL da arena: `Far` com a arena em
     * `offCombatFarRadius` ou maior, `Near` em `offCombatNearRadius` ou menor.
     * Na base os dois são −0,25 (afasta do centro — o comportamento de antes,
     * e o duelo nunca fica fora de combate). O modo arena sobrepõe: ver o
     * comentário em `_foraDeCombate` (bot.js) para o que foi medido. */
    offCombatPullFar: -0.25,
    offCombatPullNear: -0.25,
    offCombatFarRadius: 230,
    offCombatNearRadius: 95,

    /* ================================================================
     *  RECUAR  —  a IA não tinha instinto de sobrevivência
     * ================================================================
     *  Ela lutava até morrer, sempre. Num duelo isso passa despercebido (os
     *  dois vão até o fim de qualquer jeito). Numa partida de 30 pessoas é o
     *  que decide a DURAÇÃO da partida inteira, e a medição foi direta:
     *
     *      regeneração  0/s  →  partida de 1,2 min
     *      regeneração 40/s  →  partida de 5,2 min
     *
     *  Quarenta de vida por segundo é cura total em 3,5 s, e ainda assim a
     *  partida durava cinco minutos. Porque o relógio da regeneração só corre
     *  SEM TOMAR DANO, e quem nunca recua nunca para de tomar dano. O botão
     *  não estava no número, estava no comportamento.
     *
     *  Num battle royale a maior parte do tempo não é briga: você luta,
     *  percebe que está perdendo, sai, se recompõe e volta. Sem isso, 30
     *  lutadores consomem a reserva de vida da arena inteira em 81 segundos.
     *
     *  E isto não é "IA mais burra pra durar mais": é o comportamento que um
     *  humano tem naturalmente. A versão anterior é que era irreal. */
    /* ================================================================
     *  DESLIGADO (0). Existe como alavanca, não como mecânica em uso.
     * ================================================================
     *  Foi criado pra alongar a partida de 30 jogadores, e o dono do projeto
     *  vetou o caminho com razão: alongar a partida com recuo artificial
     *  MASCARA um TTK baixo em vez de consertá-lo. O conserto certo foi o
     *  rebalanceamento de vida (100 → 900).
     *
     *  Fica implementado e em zero. Se um dia o modo arena precisar de bots
     *  com instinto de sobrevivência — que é realista, um humano recua — basta
     *  subir daqui. Mas não como substituto de balanceamento.                */
    retreatBelowHealth: 0,      // fração da vida abaixo da qual tenta sair
    retreatUntilHealth: 0.75,   // e volta a lutar quando chegar aqui
    retreatChance: 0.8,         // nem sempre — um pouco de teimosia é humano
    retreatSpeedMul: 1.0,

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
  ['bt3.records.0x21.pushHit',    5, 120, 1,   'Smash frente cheio: empurrão (m/s)'],
  ['bt3.records.0x1D.pushHit',    5, 90,  1,   'Smash cima cheio: empurrão (m/s)'],
  ['bt3.records.0x1E.pushHit',    5, 90,  1,   'Smash baixo cheio: empurrão (m/s)'],
  ['bt3.records.0x21.damage',     5, 60,  1,   'Smash frente cheio: dano'],
  ['bt3.blowaway.0.frames',      10, 120, 1,   'Blowaway tipo 1: duração (f)'],
  ['bt3.blowaway.0.speed',       50, 600, 5,   'Blowaway tipo 1: velocidade (m/s)'],
  ['bt3.knockback.speed',        50, 400, 5,   'Knockback: velocidade (m/s)'],

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

  ['__group', 'Ki / Gauges'],
  ['ki.chargeRatePerSec',           5, 120, 1,   'Velocidade de carregar ki'],
  ['ki.passiveRegenPerSec',         0, 20,  0.2, 'Regen passivo'],
  ['bt3.gauges.kiRegenRate',        0, 1,   0.01,'Ki: regen por frame'],
  ['bt3.gauges.blastGain',          0, 5,   0.1, 'Blast gauge: ganho por acerto'],
  ['bt3.vanish.stepKi',             0, 60,  1,   'Vanish step: custo de ki'],
  ['bt3.vanish.behindKi',           0, 60,  1,   'Vanish behind: custo de ki'],

  ['__group', 'Guarda / Turnos'],
  ['defense.guard.damageReduction', 0, 1,   0.05,'Guarda: redução de dano'],
  ['defense.guard.knockbackReduction', 0, 1, 0.05, 'Guarda: redução de empurrão'],
  ['defense.guard.deflectWindowFrames', 0, 20, 1, 'Janela de rebater blast'],
  ['bt3.guardResults.0.stopLen',    0, 30,  1,   'Guarda: hit-stop aparado (f)'],
  ['bt3.guardResults.8.stopLen',    0, 40,  1,   'Contador: hit-stop (f)'],
  ['bt3.gauges.guardKiDrainPerFrame', 0, 5, 0.05,'Guarda: dreno de ki /frame'],
  ['bt3.gauges.guardKiMax',         10, 200, 5,  'Guarda: reservatório de ki máx.'],

  ['__group', 'Smash carregável'],
  ['bt3.chargeSmash.fullFrames',   30, 180, 1,   'Carga cheia (f)'],
  ['bt3.chargeSmash.minFrames',    10, 90,  1,   'Carga mínima (f)'],
  ['maxPower.enterHoldFrames',      1, 120, 1,   'Sparking: frames segurando'],
  ['maxPower.damageMul',            1, 2.5, 0.05,'Sparking: multiplicador de dano'],
  ['maxPower.kiCostMul',          0.1, 1,   0.05,'Sparking: custo de ki ×'],
  ['bt3.gauges.maxPowerDrainPerFrame', 0.02, 1, 0.01, 'Sparking: dreno de ki /frame'],

  ['__group', 'Grab / Throw'],
  ['defense.grab.range',           1, 6,   0.1, 'Alcance da pegada'],
  ['defense.grab.holdFrames',      4, 60,  1,   'Tempo segurando até arremessar'],
  ['defense.grab.escapeWindow',    0, 40,  1,   'Janela de escape (f)'],
  ['defense.grab.escapeAttackerStunFrames', 0, 90, 1, 'Punição por ser escapado'],
  ['defense.grab.cooldownFrames',  0, 120, 1,   'Recarga do grab'],
  ['bt3.records.0x55.pushHit',     5, 90,  1,   'Arremesso: empurrão (m/s)'],
  ['bt3.records.0x55.damage',      0, 40,  1,   'Arremesso: dano'],
  ['ai.grabChance',                0, 1,   0.02,'IA: chance de agarrar quem bloqueia'],

  ['__group', 'Clash / Prioridade'],
  ['bt3.clash.sameStop',           0, 30,  1,   'Clash mesmo tipo: hit-stop (f)'],
  ['bt3.clash.mixedStop',          0, 30,  1,   'Clash tipos mistos: hit-stop (f)'],
  ['bt3.stunTiers.1',              0, 90,  1,   'Stun tier médio (f)'],

  ['__group', 'Hitstop por categoria'],
  ['juice.hitstopProfiles.normal',   0, 30, 1,   'Hitstop: rush'],
  ['juice.hitstopProfiles.heavy',    0, 40, 1,   'Hitstop: smash'],
  ['juice.hitstopProfiles.launch',   0, 50, 1,   'Hitstop: lançamento'],
  ['juice.hitstopProfiles.counter',  0, 50, 1,   'Hitstop: counter / trade'],
  ['juice.hitstopProfiles.perfect',  0, 60, 1,   'Hitstop: Perfect Smash'],
  ['juice.hitstopProfiles.guard',    0, 30, 1,   'Hitstop: aparado'],

  ['__group', 'Vanish / Defesa'],
  ['defense.recover.kiCost',        0, 30,  1,   'Recuperação aérea: custo de ki'],
  ['defense.recover.windowAfterFrames', 0, 40, 1, 'Recuperação: espera mínima (f)'],
  ['defense.step.distance',       0.5, 10,  0.2, 'Distância do step'],
  ['defense.step.cooldownFrames',    0, 60,  1,   'Step: recarga (f)'],
  ['ai.punishChance',               0, 1,   0.02,'IA: chance de punir recovery'],
  ['ai.anticipateGuardChance',      0, 1,   0.02,'IA: guarda por antecipação'],

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
