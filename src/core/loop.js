/* =============================================================================
 *  loop.js  —  Game loop de PASSO FIXO
 * =============================================================================
 *
 *  Por que passo fixo importa aqui:
 *
 *  Todo o frame data de tuning.js está em frames a 60fps. Se a simulação rodasse
 *  no delta real do navegador, "startup: 13" significaria uma coisa no seu PC e
 *  outra num notebook fraco — e o combate seria impossível de balancear.
 *
 *  Então: a SIMULAÇÃO anda sempre em passos de 1/60s. A RENDERIZAÇÃO acontece na
 *  taxa que o monitor der, interpolando entre o último estado e o atual (alpha).
 *  É o modelo clássico do "Fix Your Timestep" e é o mesmo que a Unreal usa pra
 *  física. Quando isso for pra Unreal, os números vão junto sem reajuste.
 * ========================================================================== */

export class FixedLoop {
  /**
   * @param {object} opts
   * @param {number} opts.fps            passos de simulação por segundo
   * @param {number} opts.maxCatchUp     teto de passos por quadro (anti espiral da morte)
   * @param {(dt:number)=>void} opts.step      simulação (dt sempre = 1/fps)
   * @param {(alpha:number, dtReal:number)=>void} opts.render
   */
  constructor({ fps = 60, maxCatchUp = 5, step, render }) {
    this.fps = fps;
    this.dt = 1 / fps;
    this.maxCatchUp = maxCatchUp;
    this.stepFn = step;
    this.renderFn = render;

    this._acc = 0;
    this._last = 0;
    this._raf = null;
    this.running = false;

    // telemetria
    this.frame = 0;
    this.fpsReal = 0;
    this._fpsAcc = 0;
    this._fpsCount = 0;

    // escala de tempo global (câmera lenta do vanish / ultimate)
    this.timeScale = 1;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this._last = performance.now();
    this._acc = 0;
    this._tick(this._last);
  }

  stop() {
    this.running = false;
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = null;
  }

  _tick = (now) => {
    if (!this.running) return;
    this._raf = requestAnimationFrame(this._tick);

    let real = (now - this._last) / 1000;
    this._last = now;

    // Aba em segundo plano ou travada: descarta o buraco em vez de tentar
    // recuperar 300 passos de uma vez.
    if (real > 0.25) real = this.dt;

    // telemetria de fps real
    this._fpsAcc += real;
    this._fpsCount++;
    if (this._fpsAcc >= 0.5) {
      this.fpsReal = this._fpsCount / this._fpsAcc;
      this._fpsAcc = 0;
      this._fpsCount = 0;
    }

    this._acc += real * this.timeScale;

    let steps = 0;
    while (this._acc >= this.dt && steps < this.maxCatchUp) {
      this.stepFn(this.dt);
      this._acc -= this.dt;
      this.frame++;
      steps++;
    }

    // Se estourou o teto, joga fora o resto: melhor perder tempo do que
    // entrar em espiral de recuperação.
    if (steps >= this.maxCatchUp) this._acc = 0;

    const alpha = this._acc / this.dt;
    this.renderFn(alpha, real);
  };
}
