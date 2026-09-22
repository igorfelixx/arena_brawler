/* =============================================================================
 *  juice.js  —  Hitstop, tremor, punch zoom, câmera lenta
 * =============================================================================
 *
 *  Este arquivo é pequeno e é responsável por uma fatia grande da diferença
 *  entre "parece jogo de verdade" e "parece joguinho de navegador".
 *
 *  HITSTOP é o mais importante e o mais ignorado. No frame do impacto, os DOIS
 *  lutadores congelam por alguns frames. O cérebro lê esse congelamento como
 *  massa: sem ele, um soco de 22 de dano tem a mesma sensação de um de 4.
 *  Detalhe que quase todo mundo erra: durante o congelamento, o mundo não fica
 *  100% parado — há uma micro-vibração. Parar tudo de verdade parece bug.
 *
 *  TREMOR usa modelo de "trauma": acumula um valor 0..1 que decai, e o
 *  deslocamento é trauma² (não linear). Isso evita o tremor constante e chato,
 *  e faz golpe forte tremer desproporcionalmente mais — que é o que se quer.
 *
 *  PUNCH ZOOM é um empurrão rápido de FOV no impacto. Vende peso quase de graça.
 *
 *  CÂMERA LENTA entra no vanish e no ultimate: são os momentos de leitura, e
 *  desacelerar o tempo é como o Tenkaichi diz "olha o que acabou de acontecer".
 * ========================================================================== */

import { TUNING } from '../tuning.js';

export class Juice {
  constructor() {
    this.hitstopFrames = 0;
    this.trauma = 0;
    this.punchZoom = 0;         // graus de FOV somados
    this._punchZoomTarget = 0;
    this._punchZoomFrames = 0;

    this.slowMoFrames = 0;
    this.slowMoScale = 1;

    this._t = 0;                // relógio próprio p/ ruído do tremor
    this.shakeOffset = { x: 0, y: 0, z: 0 };
  }

  /* ---------------------------------------------------------------- */
  /*  Disparos                                                         */
  /* ---------------------------------------------------------------- */

  /** Congela a simulação por N frames (escalado por juice.hitstopScale). */
  hitstop(frames) {
    if (!TUNING.juice.hitstopEnabled) return;
    const f = Math.round(frames * TUNING.juice.hitstopScale);
    // Não somamos: pegamos o maior. Somar faz combos rápidos travarem o jogo.
    this.hitstopFrames = Math.max(this.hitstopFrames, f);
  }

  /** Adiciona trauma de tremor. `amount` ~0.1 (leve) a ~1.5 (ultimate). */
  shake(amount) {
    if (!TUNING.juice.shakeEnabled) return;
    this.trauma = Math.min(1.5, this.trauma + amount * TUNING.juice.shakeScale);
  }

  /** Empurrão de FOV. `scale` 0..1 relativo a juice.punchZoomAmount. */
  zoom(scale = 1) {
    if (!TUNING.juice.punchZoomEnabled) return;
    this._punchZoomTarget = TUNING.juice.punchZoomAmount * scale;
    this._punchZoomFrames = TUNING.juice.punchZoomFrames;
    this.punchZoom = this._punchZoomTarget;
  }

  /** Câmera lenta por N frames, com escala de tempo (0.25 = 4x mais lento). */
  slowMo(frames, scale) {
    if (frames > this.slowMoFrames) {
      this.slowMoFrames = frames;
      this.slowMoScale = scale;
    }
  }

  /** Atalho: o pacote completo de um impacto. */
  impact({ hitstop = 0, shake = 0, zoom = 0 } = {}) {
    if (hitstop) this.hitstop(hitstop);
    if (shake) this.shake(shake);
    if (zoom) this.zoom(zoom);
  }

  /* ---------------------------------------------------------------- */
  /*  Estado                                                           */
  /* ---------------------------------------------------------------- */

  /** True enquanto a simulação de gameplay deve ficar congelada. */
  get frozen() { return this.hitstopFrames > 0; }

  /** Escala de tempo global pro loop (câmera lenta). */
  get timeScale() { return this.slowMoFrames > 0 ? this.slowMoScale : 1; }

  /* ---------------------------------------------------------------- */
  /*  Atualização                                                      */
  /* ---------------------------------------------------------------- */

  /**
   * Roda TODO frame de simulação — inclusive durante o hitstop.
   * É o que mantém a vibração viva enquanto o gameplay está parado.
   */
  update(dt) {
    this._t += dt;

    if (this.hitstopFrames > 0) this.hitstopFrames--;
    if (this.slowMoFrames > 0) {
      this.slowMoFrames--;
      if (this.slowMoFrames === 0) this.slowMoScale = 1;
    }

    // --- trauma decai ---
    this.trauma = Math.max(0, this.trauma - TUNING.juice.shakeDecay * dt);

    // --- deslocamento do tremor ---
    const j = TUNING.juice;
    let amp = this.trauma * this.trauma * j.shakeMaxOffset;

    // Micro-vibração durante o congelamento: sem isto o hitstop parece travamento.
    if (this.frozen) amp = Math.max(amp, j.hitstopShakeAmp);

    if (amp > 1e-5) {
      const f = j.shakeFrequency;
      const t = this._t;
      this.shakeOffset.x = noise(t * f, 0.0) * amp;
      this.shakeOffset.y = noise(t * f, 11.3) * amp * 0.85;
      this.shakeOffset.z = noise(t * f, 27.7) * amp * 0.45;
    } else {
      this.shakeOffset.x = this.shakeOffset.y = this.shakeOffset.z = 0;
    }

    // --- punch zoom volta ao normal ---
    if (this._punchZoomFrames > 0) {
      this._punchZoomFrames--;
      const k = this._punchZoomFrames / TUNING.juice.punchZoomFrames;
      // easeOutCubic — sai rápido do pico e assenta devagar
      this.punchZoom = this._punchZoomTarget * (1 - Math.pow(1 - k, 3));
    } else {
      this.punchZoom = 0;
    }
  }

  reset() {
    this.hitstopFrames = 0;
    this.trauma = 0;
    this.punchZoom = 0;
    this._punchZoomFrames = 0;
    this.slowMoFrames = 0;
    this.slowMoScale = 1;
    this.shakeOffset.x = this.shakeOffset.y = this.shakeOffset.z = 0;
  }
}

/* Ruído 1D suave e determinístico (sem Math.random — tremor precisa ser estável
 * entre frames, senão vira chiado em vez de sacudida). */
function noise(x, seed) {
  const s = Math.sin(x * 1.0 + seed) * 43758.5453;
  const a = s - Math.floor(s);
  const s2 = Math.sin(x * 0.37 + seed * 1.7) * 12345.6789;
  const b = s2 - Math.floor(s2);
  return (a + b) - 1; // ~ -1..1
}
