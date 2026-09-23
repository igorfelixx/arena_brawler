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
    this.p2name = $('p2name');

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
    this.combo.textContent = `${this._comboCount} HITS`;
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

  /* ---------------------------------------------------------------- */
  update(dt, { player, opponent, arena, loop, fighters }) {
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
