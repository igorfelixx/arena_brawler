/* =============================================================================
 *  hud.js  —  Interface (DOM sobre o canvas)
 * =============================================================================
 *
 *  HUD em DOM, não em canvas/sprite: num protótipo isso é sempre a escolha
 *  certa. Texto fica nítido em qualquer resolução, estilizar é CSS, e nada
 *  disso vai pra Unreal de qualquer jeito — é descartável por construção.
 *
 *  A barra de vida usa a técnica de DUAS CAMADAS: uma vermelha que cai na hora
 *  e uma branca atrás que persegue com atraso. O rastro branco é o que deixa o
 *  dano LEGÍVEL — sem ele, um combo de 5 hits parece um hit só.
 * ========================================================================== */

import { TUNING } from '../tuning.js';
import { KEYMAP_HELP } from '../core/input.js';

export class HUD {
  constructor(container) {
    this.el = document.createElement('div');
    this.el.className = 'hud';
    container.appendChild(this.el);

    this.el.innerHTML = `
      <div class="hud-top">
        <div class="bar-block left">
          <div class="bar-name" id="p1name">VOCÊ</div>
          <div class="bar hp"><div class="bar-ghost" id="p1hpGhost"></div><div class="bar-fill" id="p1hp"></div></div>
          <div class="bar ki"><div class="bar-fill" id="p1ki"></div></div>
        </div>

        <div class="hud-center">
          <div class="timer" id="timer">0:00</div>
          <div class="arena-state" id="arenaState">ARENA ESTÁVEL</div>
          <div class="alive" id="alive"></div>
          <div class="training" id="training"></div>
        </div>

        <div class="bar-block right">
          <div class="bar-name" id="p2name">ALVO</div>
          <div class="bar hp"><div class="bar-ghost" id="p2hpGhost"></div><div class="bar-fill" id="p2hp"></div></div>
          <div class="bar ki"><div class="bar-fill" id="p2ki"></div></div>
        </div>
      </div>

      <div class="combo" id="combo"></div>
      <div class="banner" id="banner"></div>
      <div class="edge-warn" id="edgeWarn"></div>

      <div class="lock-reticle" id="lockReticle">
        <span></span><span></span><span></span><span></span>
      </div>
      <div class="lock-state" id="lockState"></div>

      <div class="telemetry" id="telemetry"></div>

      <div class="hud-bottom">
        <div class="help" id="help"></div>
        <div class="stats" id="stats"></div>
      </div>
    `;

    const $ = (id) => this.el.querySelector('#' + id);
    this.p1hp = $('p1hp'); this.p1hpGhost = $('p1hpGhost'); this.p1ki = $('p1ki');
    this.p2hp = $('p2hp'); this.p2hpGhost = $('p2hpGhost'); this.p2ki = $('p2ki');
    this.timer = $('timer');
    this.arenaState = $('arenaState');
    this.combo = $('combo');
    this.banner = $('banner');
    this.edgeWarn = $('edgeWarn');
    this.stats = $('stats');
    this.lockReticle = $('lockReticle');
    this.lockState = $('lockState');
    this.aliveEl = $('alive');
    this.trainingEl = $('training');
    this.p2name = $('p2name');
    this.telemetry = $('telemetry');

    // Telemetria começa DESLIGADA: o §23 pede a ferramenta, não um Excel voador.
    this.debug = false;
    this.telemetry.style.display = 'none';

    $('help').innerHTML = KEYMAP_HELP
      .map(([k, d]) => `<div><kbd>${k}</kbd><span>${d}</span></div>`).join('');

    this._ghost = { p1: 1, p2: 1 };
    this._comboCount = 0;
    this._comboTimer = 0;
    this._bannerTimer = 0;
  }

  /* ---------------------------------------------------------------- */
  showBanner(text, ms = 2200, cls = '') {
    this.banner.textContent = text;
    this.banner.className = 'banner show ' + cls;
    this._bannerTimer = ms / 1000;
  }

  addCombo() {
    this._comboCount++;
    this._comboTimer = 1.1;
    this.combo.textContent = `${this._comboCount} HIT${this._comboCount > 1 ? 'S' : ''}`;
    this.combo.className = 'combo show';
    // Re-dispara a animação de "pop" a cada hit.
    this.combo.style.animation = 'none';
    void this.combo.offsetWidth;
    this.combo.style.animation = '';
  }

  resetCombo() { this._comboCount = 0; this.combo.className = 'combo'; }

  /**
   * Marcador sobre o alvo travado.
   * @param {boolean} locked
   * @param {{x:number,y:number,onScreen:boolean}|null} screen  projeção do alvo
   */
  setLock(locked, screen) {
    this.lockState.textContent = locked ? 'LOCK-ON' : 'LIVRE  ·  Q trava';
    this.lockState.className = 'lock-state' + (locked ? '' : ' free');

    // Fora da tela o marcador não ajuda — e ainda aparece grudado numa borda
    // em posição errada, porque a projeção atrás da câmera espelha o ponto.
    if (!locked || !screen || !screen.onScreen) {
      this.lockReticle.style.opacity = 0;
      return;
    }
    this.lockReticle.style.opacity = 1;
    this.lockReticle.style.transform = `translate(${screen.x}px, ${screen.y}px) translate(-50%, -50%)`;
  }

  /* ================================================================== */
  /*  TELEMETRIA  (tecla H)                                             */
  /* ================================================================== */
  /*  O que um jogo de luta precisa mostrar pra ser AFINÁVEL, e que só se
   *  descobre errado medindo: em que frame do golpe você está, se a janela de
   *  cancelamento está aberta, quanto blockstun o outro comeu, e sobretudo a
   *  VANTAGEM em frames — quem sai primeiro depois de uma troca.
   *
   *  A vantagem é o número que decide se "bloquear devolve o turno" é verdade
   *  ou é só um comentário no tuning.js. Aqui ela fica na tela.
   *
   *  Desligada por padrão: instrumento não pode virar interface.            */
  toggleDebug() {
    this.debug = !this.debug;
    this.telemetry.style.display = this.debug ? '' : 'none';
    return this.debug;
  }

  /** Quantos frames faltam pro lutador poder agir de novo. */
  static _framesAteAgir(f) {
    if (!f) return 0;
    if (f.blockstunFrames > 0) return f.blockstunFrames;
    if (f.state === 'hitstun') return Math.max(0, (f._stunFrames || 0) - f.stateFrame);
    if (f.state === 'attack' && f.move) {
      const total = f.move.startup + f.move.active + f.move.recovery;
      return Math.max(0, total - f.stateFrame);
    }
    if (f.state === 'blowaway' || f.state === 'knockdown' || f.state === 'getup') return 999;
    return 0;
  }

  _linhasTelemetria(player, opponent, arena, extra) {
    const L = [];
    const nf = (v, d = 1) => (v === undefined || v === null ? '--' : v.toFixed(d));

    // --- golpe atual ---
    const m = player.move;
    if (m && player.state === 'attack') {
      const total = m.startup + m.active + m.recovery;
      const cw = m.cancelWindow;
      const naJanela = cw && player.stateFrame >= cw[0] && player.stateFrame <= cw[1];
      L.push(`golpe   ${player.moveKey}  f ${player.stateFrame}/${total}  [${player.attackPhase}]`
           + `  prio ${m.priority}${m.armor ? `  armor ${m.armor}` : ''}`);
      L.push(`        startup ${m.startup} · active ${m.active} · recovery ${m.recovery}`
           + `   launch ${m.launch?.type ?? '--'}`);
      L.push(`cancel  ${cw ? `${cw[0]}–${cw[1]}` : 'nenhum'}   ${naJanela ? '◄ ABERTA' : 'fechada'}`
           + `   emenda: ${player.contactAllowsChain ? 'LIBERADA' : 'travada'}`);
      L.push(`combo   elo ${player.comboCount}/${extra.maxChain}   vanishWindow ${m.vanishWindow ?? '--'}`);
    } else {
      L.push(`estado  ${player.state}  f ${player.stateFrame}`);
    }

    /* ================================================================
     *  CARGA DO SMASH E JANELA PERFEITA  (§8, §28)
     * ================================================================
     *  A linha mais importante desta passada. O Perfect Smash é uma janela de
     *  9 frames: sem ver o contador subindo e a janela abrir e FECHAR, não há
     *  como afinar o número — e "acertei ou não?" fica sendo palpite. É
     *  exatamente o que o §28 pede a ferramenta pra resolver.               */
    if (player.smashHolding && extra.charge) {
      const [ini, fim] = extra.charge.perfectWindow;
      const h = player.smashChargeFrames;
      const dentro = h >= ini && h <= fim;
      const barra = '█'.repeat(Math.min(28, Math.round(h / 2)));
      L.push(`CARGA   ${h}f  janela ${ini}–${fim}`
           + (dentro ? '   ◄◄ SOLTE AGORA (PERFECT)' : h < ini ? `   faltam ${ini - h}f` : '   passou'));
      L.push(`        ${barra}`);
    } else if (player.smashPerfect) {
      L.push(`CARGA   último smash: PERFECT`);
    }

    /* MAX POWER e EXAUSTÃO: mudam o que o jogador PODE fazer, então precisam de
     * linha própria — ki na barra não diz que nada sai. */
    if (player.inMaxPower) {
      L.push(`MAX POWER ${player.maxPowerFrames}f   dano ×${extra.mpDamageMul}`
           + `  ki ×${extra.mpKiMul}   (acaba em exaustão)`);
    } else if (player.exhausted) {
      L.push(`EXAUSTO ${player.exhaustFrames}f   ◄ sem dash, vanish, blast nem perseguição`);
    } else if (player._maxPowerCharge > 0) {
      L.push(`MAX POWER  carregando ${player._maxPowerCharge}/${extra.mpHold}f — continue segurando R`);
    }

    /* ROTA e PERSEGUIÇÃO são os dois conceitos novos do combate, e os dois
     * são invisíveis sem isto: o jogador precisa ver que a rota esgotou (e
     * por isso J parou de sair) e que existe uma janela pra perseguir. */
    const rotaCheia = player.comboCount >= extra.maxChain;
    L.push(`rota    ${player.comboCount}/${extra.maxChain}`
         + `  reset em ${player.chainResetTimer}f`
         + (rotaCheia ? '   ◄ ESGOTADA: só ender / reposicionar' : ''));
    /* A janela de perseguição agora tem TRÊS respostas, e cada uma com custo e
     * janela próprios. Mostrar qual está disponível é o que transforma "aperto
     * Shift" numa escolha — sem isto o jogador nunca descobre os modificadores. */
    if (player.pursuitFrames > 0) {
      const ki = player.ki;
      const t = TUNING.pursuit.types;
      const dir = ki >= player.kiCost(TUNING.pursuit.kiCost);
      const van = ki >= player.kiCost(t.vanish.kiCost)
               && player.pursuitElapsed <= t.vanish.windowFrames;
      const alt = ki >= player.kiCost(t.highSpeed.kiCost);
      L.push(`PERSEGUIR ${player.pursuitFrames}f`
           + `   Shift:${dir ? 'DIRETA' : '--'}`
           + `  +V:${van ? 'VANISH' : '--'}`
           + `  +K:${alt ? 'ALTA VEL.' : '--'}`);
    }
    if (player.state === 'pursuit') {
      L.push(`        perseguindo [${player.pursuitType}]`
           + `  carry ${player._pursuitCarry}f`);
    }

    /* VANISH BATTLE: a janela tem 12 frames. Precisa estar na tela pra ser
     * afinável — e é o número que decide se a mecânica é jogável ou decorativa. */
    if (player.counterVanishFrames > 0) {
      L.push(`VANISH BATTLE  responda em ${player.counterVanishFrames}f`
           + `   troca ${player.vanishExchange}/${extra.vbMax}`
           + `   custo ${player.vanishCost().toFixed(0)} ki`);
    }

    // GRAB: os dois lados da interação, porque os dois têm relógio.
    if (player.state === 'grab') {
      L.push(`AGARROU  arremessa em ${player.grabHold}f`);
    } else if (player.state === 'grabbed') {
      const jan = TUNING.defense.grab.escapeWindow;
      const resta = jan - player.stateFrame;
      L.push(`AGARRADO  escape ${resta > 0 ? `${resta}f ◄ APERTE F` : 'PERDIDO'}`);
    }
    if (player.grabCooldown > 0) L.push(`grab    recarga ${player.grabCooldown}f`);

    // --- vantagem de frames: o número que decide o jogo de turnos ---
    const meu = HUD._framesAteAgir(player);
    const dele = HUD._framesAteAgir(opponent);
    if (opponent && meu < 999 && dele < 999) {
      const adv = dele - meu;
      const sinal = adv > 0 ? '+' : '';
      L.push(`VANTAGEM ${sinal}${adv} frames  ${adv > 0 ? '(seu turno)' : adv < 0 ? '(turno dele)' : '(neutro)'}`);
    }

    // --- recursos e estados defensivos ---
    L.push(`ki ${nf(player.ki, 0)}  poise ${nf(player.poise, 0)}  guarda ${nf(player.guardStamina, 0)}`
         + `  blockstun ${player.blockstunFrames}`);
    L.push(`contra  armado ${player.counterArm > 900 ? '--' : player.counterArm}f`
         + `  (janela ${extra.zWindow}f)  recarga ${player.counterCooldown}f`
         + (player.counterArm <= extra.zWindow ? '   ◄ Z-COUNTER PRONTO' : ''));
    L.push(`vanish  cadeia ${player.vanishChain}/${extra.vanishMaxChain}`
         + `  pressF ${player.vanishPressFrame > 900 ? '--' : player.vanishPressFrame}`
         + `  cooldown ${player.vanishCooldown}`);

    // --- espaço: é onde o ring-out vive ---
    const dBorda = arena.radius - arena.distanceFromCenter(player.position);
    const dTeto = arena.ceiling - player.position.y;
    L.push(`borda   ${nf(dBorda)} m   teto ${nf(dTeto)} m   alt ${nf(player.position.y)} m`);
    L.push(`vel     ${nf(player.velocity.length())} m/s   fora ${player.outOfBoundsFrames}f`);

    // --- alvo ---
    if (opponent) {
      const om = opponent.move;
      L.push(`ALVO    ${opponent.name}  ${opponent.state} f ${opponent.stateFrame}`
           + (om && opponent.state === 'attack' ? ` (${opponent.moveKey})` : ''));
      L.push(`        dist ${nf(player.position.distanceTo(opponent.position))} m`
           + `   |v| ${nf(opponent.velocity.length())} m/s`
           + `   borda ${nf(arena.radius - arena.distanceFromCenter(opponent.position))} m`);
      L.push(`        hp ${nf(opponent.health, 0)}  ki ${nf(opponent.ki, 0)}`
           + `  guarda ${nf(opponent.guardStamina, 0)}  blockstun ${opponent.blockstunFrames}`);
    }

    // --- juice ---
    L.push(`hitstop ${extra.hitstop}f   slowmo ${extra.slowMo}f   IA: ${extra.perfil}`);

    return L;
  }

  /* ---------------------------------------------------------------- */
  update(dt, { player, opponent, arena, loop, fighters, treino, debug }) {
    if (this.debug) {
      this.telemetry.textContent =
        this._linhasTelemetria(player, opponent, arena, debug || {}).join('\n');
    }

    // Modo treino tem que ser VISÍVEL o tempo todo: descobrir depois de dois
    // minutos que os bonecos estavam parados é frustrante.
    if (treino && treino !== 'NORMAL') {
      this.trainingEl.textContent = `TREINO · ${treino}  ·  T muda`;
      this.trainingEl.style.display = '';
    } else {
      this.trainingEl.style.display = 'none';
    }

    // Com N lutadores a barra da direita é do ALVO ATUAL, não de "o oponente".
    if (opponent && this.p2name.textContent !== opponent.name) {
      this.p2name.textContent = opponent.name;
      this._ghost.p2 = 1;          // sem isto o rastro branco herda o alvo anterior
    }
    if (fighters) {
      const vivos = fighters.filter((f) => f.alive).length;
      this.aliveEl.textContent = vivos > 2 ? `${vivos} EM PÉ` : '';
    }

    const max = TUNING.fighter.maxHealth;
    const kiMax = TUNING.ki.max;

    const p1 = Math.max(0, player.health / max);
    const p2 = opponent ? Math.max(0, opponent.health / max) : 0;

    // rastro branco perseguindo com atraso
    this._ghost.p1 += (p1 - this._ghost.p1) * (1 - Math.exp(-3.5 * dt));
    this._ghost.p2 += (p2 - this._ghost.p2) * (1 - Math.exp(-3.5 * dt));
    if (this._ghost.p1 < p1) this._ghost.p1 = p1;
    if (this._ghost.p2 < p2) this._ghost.p2 = p2;

    this.p1hp.style.width = (p1 * 100) + '%';
    this.p2hp.style.width = (p2 * 100) + '%';
    this.p1hpGhost.style.width = (this._ghost.p1 * 100) + '%';
    this.p2hpGhost.style.width = (this._ghost.p2 * 100) + '%';

    this.p1ki.style.width = (player.ki / kiMax * 100) + '%';
    this.p2ki.style.width = ((opponent ? opponent.ki : 0) / kiMax * 100) + '%';

    // Ki cheio o bastante pro ultimate: a barra avisa.
    this.p1ki.classList.toggle('full', player.ki >= TUNING.blasts.ultimate.kiCost);
    this.p2ki.classList.toggle('full', !!opponent && opponent.ki >= TUNING.blasts.ultimate.kiCost);

    /* Ki BAIXO precisa ser legível sem olhar número. `ki.lowKiThreshold`
     * existia no tuning e nunca era consultado — e é justamente o momento mais
     * importante do recurso: abaixo dele você não tem mais vanish nem dash, ou
     * seja, perdeu as ferramentas de escape. Isso é informação de sobrevivência
     * e tem que gritar, não ficar escondida numa barra. */
    this.p1ki.classList.toggle('low', player.ki < TUNING.ki.lowKiThreshold);
    this.p2ki.classList.toggle('low', !!opponent && opponent.ki < TUNING.ki.lowKiThreshold);

    // --- tempo e estado da arena ---
    const t = arena.elapsed;
    this.timer.textContent = `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

    if (arena.warning) {
      this.arenaState.textContent = 'A ARENA VAI ENCOLHER';
      this.arenaState.className = 'arena-state warn';
    } else if (arena.shrinking) {
      this.arenaState.textContent = `ENCOLHENDO · raio ${arena.radius.toFixed(0)}m`;
      this.arenaState.className = 'arena-state shrink';
    } else {
      this.arenaState.textContent = `ARENA ESTÁVEL · raio ${arena.radius.toFixed(0)}m`;
      this.arenaState.className = 'arena-state';
    }

    // --- aviso de borda (vinheta vermelha) ---
    const edge = arena.edgeProximity(player.position);
    const high = player.position.y > arena.ceiling * 0.9;
    const danger = Math.max(edge, high ? 0.8 : 0);
    this.edgeWarn.style.opacity = danger > 0.05 ? (danger * 0.55).toFixed(3) : 0;

    // --- combo ---
    if (this._comboTimer > 0) {
      this._comboTimer -= dt;
      if (this._comboTimer <= 0) this.resetCombo();
    }

    if (this._bannerTimer > 0) {
      this._bannerTimer -= dt;
      if (this._bannerTimer <= 0) this.banner.className = 'banner';
    }

    // --- telemetria ---
    this.stats.innerHTML =
      `<span>${loop.fpsReal.toFixed(0)} fps</span>` +
      `<span>${player.state}</span>` +
      `<span>ki ${player.ki.toFixed(0)}</span>` +
      `<span>alt ${player.position.y.toFixed(1)}m</span>` +
      `<span>dist ${opponent ? player.position.distanceTo(opponent.position).toFixed(1) : '--'}m</span>`;
  }

  reset() {
    this._ghost.p1 = this._ghost.p2 = 1;
    this.resetCombo();
    this.banner.className = 'banner';
    this._bannerTimer = 0;
  }
}
