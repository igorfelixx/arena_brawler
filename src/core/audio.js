/* =============================================================================
 *  audio.js  —  Som de combate SINTETIZADO (Web Audio, zero arquivos)
 * =============================================================================
 *
 *  Por que sintetizar em vez de baixar pacote de sons:
 *
 *    1. O som existe pra VALIDAR LEITURA, não pra ser bonito. A pergunta que
 *       este protótipo responde é "o jogador percebe o Perfect Smash / o
 *       Z-Counter / a guarda quebrando pelo ouvido?". Isso se responde com
 *       timbres distintos, não com gravação boa.
 *    2. Nenhum asset, nenhuma licença, nenhum CORS. No Unreal isto é jogado
 *       fora e trocado por MetaSounds / pacote do Marketplace — o que porta é
 *       a TABELA de "que evento tem som e com que peso" (ver PORTAR §8.38).
 *
 *  As três regras, todas aprendidas com o hitstop global (armadilha 8.31):
 *
 *    • DISTÂNCIA. Com 30 lutadores, sempre tem alguém batendo em alguém. Som
 *      que não cai com a distância vira chiado constante e afoga o seu golpe.
 *      Quem está envolvido no evento (você bateu / apanhou) toca cheio; o resto
 *      cai com a distância e some além de `audio.maxDistance`.
 *    • TETO DE VOZES. Mesmo dentro do alcance, um limite duro de sons
 *      simultâneos, e um intervalo mínimo por tipo de som. Senão o rush (4
 *      golpes em 0,3 s × várias brigas) satura o mixer.
 *    • SIMULAÇÃO NÃO TOCA. `PROTO.simular()` roda 25 min em segundos; se cada
 *      golpe disparasse um som, o navegador travaria. `mudo` liga ali.
 *
 *  O navegador só deixa tocar som depois de um gesto do usuário (clique ou
 *  tecla). Até lá o AudioContext fica suspenso e TODA chamada é no-op barata —
 *  é o que mantém `tools/escala.js` e `tools/diversao.js` funcionando.
 * ========================================================================== */

import { TUNING } from '../tuning.js';

const rnd = (a, b) => a + Math.random() * (b - a);

export class Audio {
  constructor() {
    this.ctx = null;
    this.mudo = false;          // ligado pelo PROTO.simular
    this.listener = null;       // Vector3 — de onde se ouve (o jogador)
    this._vozes = 0;
    this._ultimo = new Map();   // tipo → timestamp, p/ intervalo mínimo
    this._combo = new Map();    // atacante → { n, t }, p/ subir o tom do rush
    this._carga = null;         // loop do carregar ki
    this._smashCarga = null;    // loop do segurar smash

    const destravar = () => this._iniciar();
    window.addEventListener('pointerdown', destravar, { once: false });
    window.addEventListener('keydown', destravar, { once: false });
  }

  _iniciar() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();

    /* Compressor no master: dez golpes no mesmo frame não podem estourar. É
     * o "limiter" que todo jogo tem no fim da cadeia. */
    this.comp = this.ctx.createDynamicsCompressor();
    this.comp.threshold.value = -14;
    this.comp.knee.value = 8;
    this.comp.ratio.value = 6;
    this.comp.attack.value = 0.002;
    this.comp.release.value = 0.12;
    this.master = this.ctx.createGain();
    this.master.gain.value = TUNING.audio.volume;
    this.master.connect(this.comp).connect(this.ctx.destination);

    // Ruído branco pré-gerado: base de todo impacto, whoosh e explosão.
    const len = this.ctx.sampleRate * 1.5;
    this.ruido = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.ruido.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  get ativo() {
    return !!this.ctx && this.ctx.state === 'running' && !this.mudo
      && TUNING.audio.enabled;
  }

  alternarMudo() {
    TUNING.audio.enabled = !TUNING.audio.enabled;
    if (!TUNING.audio.enabled) { this._pararLoop('_carga'); this._pararLoop('_smashCarga'); }
    return TUNING.audio.enabled;
  }

  /* ------------------------------------------------------------------ */
  /*  Volume por distância — a regra que faz 30 lutadores não virar ruído */
  /* ------------------------------------------------------------------ */

  /**
   * @param {object} o
   * @param {THREE.Vector3} [o.pos]   onde aconteceu
   * @param {boolean} [o.meu]         o jogador está envolvido → volume cheio
   * @returns {number} ganho 0..1; 0 = nem toca
   */
  _ganho({ pos = null, meu = false } = {}) {
    if (meu || !pos || !this.listener) return 1;
    const A = TUNING.audio;
    const d = pos.distanceTo(this.listener);
    if (d >= A.maxDistance) return 0;
    // Queda quadrática suave até `refDistance`, e o resto sob `othersGain`.
    const k = 1 / (1 + (Math.max(0, d - A.refDistance) / A.refDistance) ** 2);
    return k * A.othersGain;
  }

  /** Porteiro: teto de vozes + intervalo mínimo por tipo. */
  _pode(tipo, ganho) {
    if (!this.ativo || ganho < 0.02) return false;
    const A = TUNING.audio;
    if (this._vozes >= A.maxVoices) return false;
    const agora = this.ctx.currentTime;
    const ult = this._ultimo.get(tipo) ?? -1;
    if (agora - ult < A.minIntervalSec) return false;
    this._ultimo.set(tipo, agora);
    return true;
  }

  _voz(dur) {
    this._vozes++;
    setTimeout(() => { this._vozes--; }, dur * 1000 + 30);
  }

  /* ------------------------------------------------------------------ */
  /*  Primitivas                                                         */
  /* ------------------------------------------------------------------ */

  /** Envelope: ataque curtíssimo e queda exponencial. É o formato de impacto. */
  _env(g, t, pico, ataque, dur) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, pico), t + ataque);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  }

  /** Oscilador com varredura de frequência (o "corpo" do golpe). */
  _tom({ tipo = 'sine', f0, f1 = f0, dur, vol, ataque = 0.004, atraso = 0, saida }) {
    const c = this.ctx, t = c.currentTime + atraso;
    const o = c.createOscillator(), g = c.createGain();
    o.type = tipo;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    this._env(g, t, vol, ataque, dur);
    o.connect(g).connect(saida);
    o.start(t); o.stop(t + dur + 0.02);
  }

  /** Ruído filtrado com varredura (o "estalo", o vento, a explosão). */
  _ruido({ filtro = 'bandpass', f0, f1 = f0, q = 1, dur, vol, ataque = 0.002, atraso = 0, saida }) {
    const c = this.ctx, t = c.currentTime + atraso;
    const s = c.createBufferSource(), fl = c.createBiquadFilter(), g = c.createGain();
    s.buffer = this.ruido;
    fl.type = filtro; fl.Q.value = q;
    fl.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) fl.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    this._env(g, t, vol, ataque, dur);
    s.connect(fl).connect(g).connect(saida);
    s.start(t, Math.random() * 0.8); s.stop(t + dur + 0.02);
  }

  /** Abre um barramento com o ganho de distância aplicado. */
  _bus(ganho) {
    const g = this.ctx.createGain();
    g.gain.value = ganho;
    g.connect(this.master);
    return g;
  }

  /* ------------------------------------------------------------------ */
  /*  Catálogo — um método por SIGNIFICADO, não por arquivo de som        */
  /* ------------------------------------------------------------------ */
  /*  A hierarquia sonora espelha a de hitstop (§22) e tem que ser
   *  respeitada pelo mesmo motivo: guarda < rush < counter < smash <
   *  lançamento < perfect. Se o rush soar tão gordo quanto o smash, o
   *  ouvido para de distinguir e o som deixa de ensinar.                  */

  /**
   * Golpe que ACERTOU.
   * @param {'leve'|'pesado'|'perfect'} peso
   * O rush sobe de tom a cada elo seguido do mesmo atacante — é o que faz a
   * rota "subir" pelo ouvido e o 4º elo soar como clímax, sem número na tela.
   */
  acerto({ peso = 'leve', pos, meu, atacante }) {
    const ganho = this._ganho({ pos, meu });
    if (!this._pode('acerto-' + peso + (meu ? 'm' : ''), ganho)) return;
    const b = this._bus(ganho);
    const agora = this.ctx.currentTime;

    let elo = 0;
    if (atacante) {
      const c = this._combo.get(atacante);
      elo = c && agora - c.t < 0.7 ? Math.min(c.n + 1, 6) : 0;
      this._combo.set(atacante, { n: elo, t: agora });
    }
    const subida = 1 + elo * 0.07;

    if (peso === 'leve') {
      this._voz(0.15);
      this._tom({ f0: 190 * subida * rnd(0.94, 1.06), f1: 70, dur: 0.09, vol: 0.9, saida: b });
      this._ruido({ f0: 2200 * subida, f1: 900, q: 1.4, dur: 0.07, vol: 0.55, saida: b });
      this._ruido({ filtro: 'highpass', f0: 5000, dur: 0.025, vol: 0.25, saida: b });
      return;
    }

    // pesado / perfect: baque grave + estalo + cauda
    this._voz(0.5);
    this._tom({ f0: 120 * rnd(0.95, 1.05), f1: 38, dur: 0.32, vol: 1.0, saida: b });
    this._tom({ tipo: 'triangle', f0: 260, f1: 90, dur: 0.14, vol: 0.5, saida: b });
    this._ruido({ filtro: 'lowpass', f0: 2600, f1: 300, dur: 0.3, vol: 0.85, saida: b });
    this._ruido({ filtro: 'highpass', f0: 3500, dur: 0.04, vol: 0.5, saida: b });

    /* PERFECT: o recibo. Um timbre que NENHUM outro golpe tem — o sino
     * brilhante — porque o jogador precisa saber, sem olhar, que acertou a
     * janela. É o som mais importante do catálogo. */
    if (peso === 'perfect') {
      this._voz(0.9);
      for (const [f, v] of [[880, 0.35], [1320, 0.28], [1760, 0.18]]) {
        this._tom({ tipo: 'triangle', f0: f, dur: 0.85, vol: v, atraso: 0.01, saida: b });
      }
      this._ruido({ filtro: 'lowpass', f0: 900, f1: 60, dur: 0.7, vol: 0.6, atraso: 0.02, saida: b });
    }
  }

  /** Aparado na guarda: metálico, seco, curto. Não pode soar como dano. */
  guarda({ pos, meu }) {
    const ganho = this._ganho({ pos, meu });
    if (!this._pode('guarda', ganho)) return;
    const b = this._bus(ganho);
    this._voz(0.15);
    this._tom({ tipo: 'square', f0: 640 * rnd(0.97, 1.03), f1: 560, dur: 0.06, vol: 0.18, saida: b });
    this._ruido({ f0: 3400, q: 6, dur: 0.07, vol: 0.5, saida: b });
    this._tom({ f0: 140, f1: 90, dur: 0.06, vol: 0.4, saida: b });
  }

  /** Guarda quebrou (por smash ou por exaustão): vidro estilhaçando. */
  quebraGuarda({ pos, meu }) {
    const ganho = this._ganho({ pos, meu });
    if (!this._pode('quebraGuarda', ganho)) return;
    const b = this._bus(ganho);
    this._voz(0.6);
    for (let i = 0; i < 6; i++) {
      this._tom({ tipo: 'sine', f0: rnd(2200, 5200), dur: rnd(0.15, 0.4), vol: 0.12,
        atraso: i * 0.018, saida: b });
    }
    this._ruido({ filtro: 'highpass', f0: 2500, dur: 0.35, vol: 0.5, saida: b });
    this._tom({ f0: 100, f1: 45, dur: 0.25, vol: 0.7, saida: b });
  }

  /** Deslocamento: dash, step, perseguição, recuperação aérea. */
  whoosh({ pos, meu, forte = 0.5, sobe = true }) {
    const ganho = this._ganho({ pos, meu }) * (0.4 + forte * 0.6);
    if (!this._pode('whoosh' + (meu ? 'm' : ''), ganho)) return;
    const b = this._bus(ganho);
    const dur = 0.16 + forte * 0.18;
    this._voz(dur);
    this._ruido({ f0: sobe ? 500 : 2200, f1: sobe ? 2400 : 500, q: 1.8, dur,
      vol: 0.45, ataque: dur * 0.35, saida: b });
  }

  /** Vanish: "zip" de teleporte. Reaparecer atrás tem que soar súbito. */
  vanish({ pos, meu }) {
    const ganho = this._ganho({ pos, meu });
    if (!this._pode('vanish', ganho)) return;
    const b = this._bus(ganho);
    this._voz(0.25);
    this._tom({ f0: 1500, f1: 180, dur: 0.12, vol: 0.35, saida: b });
    this._ruido({ filtro: 'highpass', f0: 4000, f1: 8000, dur: 0.1, vol: 0.4, saida: b });
    this._tom({ tipo: 'triangle', f0: 300, f1: 1400, dur: 0.1, vol: 0.2, atraso: 0.09, saida: b });
  }

  /** Z-Counter / contra-vanish: a reviravolta. "Ting" agudo + baque. */
  contra({ pos, meu }) {
    const ganho = this._ganho({ pos, meu });
    if (!this._pode('contra', ganho)) return;
    const b = this._bus(ganho);
    this._voz(0.6);
    this._tom({ tipo: 'triangle', f0: 2100, dur: 0.5, vol: 0.3, saida: b });
    this._tom({ tipo: 'triangle', f0: 3150, dur: 0.35, vol: 0.15, saida: b });
    this._tom({ f0: 150, f1: 50, dur: 0.22, vol: 0.8, atraso: 0.02, saida: b });
    this._ruido({ filtro: 'highpass', f0: 3000, dur: 0.05, vol: 0.4, saida: b });
  }

  /** Clash / trade empatado: dois metais desafinados — ninguém ganhou. */
  choque({ pos, meu }) {
    const ganho = this._ganho({ pos, meu });
    if (!this._pode('choque', ganho)) return;
    const b = this._bus(ganho);
    this._voz(0.7);
    this._tom({ tipo: 'sawtooth', f0: 420, f1: 380, dur: 0.5, vol: 0.12, saida: b });
    this._tom({ tipo: 'sawtooth', f0: 447, f1: 400, dur: 0.5, vol: 0.12, saida: b });
    this._ruido({ filtro: 'lowpass', f0: 3000, f1: 400, dur: 0.35, vol: 0.8, saida: b });
    this._tom({ f0: 110, f1: 40, dur: 0.3, vol: 0.8, saida: b });
  }

  /** Pegada: baque abafado, sem estalo — não é golpe, é contato. */
  agarrao({ pos, meu }) {
    const ganho = this._ganho({ pos, meu });
    if (!this._pode('agarrao', ganho)) return;
    const b = this._bus(ganho);
    this._voz(0.2);
    this._ruido({ filtro: 'lowpass', f0: 700, dur: 0.12, vol: 0.7, saida: b });
    this._tom({ f0: 90, f1: 60, dur: 0.12, vol: 0.6, saida: b });
  }

  /** Disparo de ki blast. */
  disparo({ pos, meu, carregado = false }) {
    const ganho = this._ganho({ pos, meu });
    if (!this._pode('disparo' + (meu ? 'm' : ''), ganho)) return;
    const b = this._bus(ganho);
    const k = carregado ? 1.8 : 1;
    this._voz(0.3 * k);
    this._tom({ tipo: 'sawtooth', f0: 900 / k, f1: 260 / k, dur: 0.16 * k, vol: 0.18, saida: b });
    this._ruido({ f0: 1800 / k, f1: 600, q: 2, dur: 0.14 * k, vol: 0.4, saida: b });
  }

  /** Explosão (blast acertando, chão, eliminação). `tamanho` 0..1.5 */
  explosao({ pos, meu, tamanho = 0.5 }) {
    const ganho = this._ganho({ pos, meu });
    if (!this._pode('explosao' + Math.round(tamanho * 2), ganho)) return;
    const b = this._bus(ganho);
    const dur = 0.25 + tamanho * 0.7;
    this._voz(dur);
    this._ruido({ filtro: 'lowpass', f0: 1800 + tamanho * 1200, f1: 50, dur, vol: 0.9, saida: b });
    this._tom({ f0: 90, f1: 28, dur: dur * 0.8, vol: 0.4 + tamanho * 0.5, saida: b });
  }

  /** Ultimate: subida longa (o aviso) e o feixe (o estrondo). */
  ultimateAviso({ pos, meu }) {
    const ganho = this._ganho({ pos, meu });
    if (!this._pode('ultAviso', ganho)) return;
    const b = this._bus(ganho);
    this._voz(1.2);
    this._tom({ tipo: 'sawtooth', f0: 110, f1: 660, dur: 1.1, vol: 0.12, ataque: 0.5, saida: b });
    this._tom({ tipo: 'sine', f0: 220, f1: 1320, dur: 1.1, vol: 0.15, ataque: 0.5, saida: b });
  }

  ultimateFeixe({ pos, meu }) {
    const ganho = this._ganho({ pos, meu });
    if (!this._pode('ultFeixe', ganho)) return;
    const b = this._bus(ganho);
    this._voz(1.6);
    this._ruido({ filtro: 'lowpass', f0: 1500, f1: 200, dur: 1.5, vol: 0.8, ataque: 0.03, saida: b });
    this._tom({ tipo: 'sawtooth', f0: 70, f1: 45, dur: 1.5, vol: 0.25, ataque: 0.03, saida: b });
  }

  /** Max Power: clarão de entrada — acorde que sobe. Exaustão: o contrário. */
  maxPower({ pos, meu }) {
    const ganho = this._ganho({ pos, meu });
    if (!this._pode('maxPower', ganho)) return;
    const b = this._bus(ganho);
    this._voz(1.0);
    this._tom({ f0: 100, f1: 35, dur: 0.6, vol: 0.9, saida: b });
    for (const [f, v] of [[330, 0.14], [415, 0.12], [495, 0.12], [660, 0.1]]) {
      this._tom({ tipo: 'sawtooth', f0: f * 0.5, f1: f, dur: 0.9, vol: v, ataque: 0.15, saida: b });
    }
  }

  exaustao({ pos, meu }) {
    const ganho = this._ganho({ pos, meu });
    if (!this._pode('exaustao', ganho)) return;
    const b = this._bus(ganho);
    this._voz(0.6);
    this._tom({ tipo: 'triangle', f0: 440, f1: 110, dur: 0.55, vol: 0.3, saida: b });
  }

  /**
   * Sinal curto de interface: janela aberta (perseguir, perfect, vanish
   * battle), aviso de borda, quebra de camada. Sempre do JOGADOR — sinal de
   * janela de outro lutador é informação que não te serve.
   */
  sinal(tipo) {
    if (!this._pode('sinal-' + tipo, 1)) return;
    const b = this._bus(1);
    this._voz(0.4);
    switch (tipo) {
      case 'perfect':      // a janela do Perfect abriu: "ding" inconfundível
        this._tom({ tipo: 'triangle', f0: 1760, dur: 0.22, vol: 0.4, saida: b });
        this._tom({ tipo: 'sine', f0: 2640, dur: 0.15, vol: 0.2, saida: b });
        break;
      case 'perseguir':
        this._tom({ tipo: 'square', f0: 660, f1: 990, dur: 0.08, vol: 0.08, saida: b });
        break;
      case 'responda':     // vanish battle: urgente
        this._tom({ tipo: 'square', f0: 1200, dur: 0.05, vol: 0.1, saida: b });
        this._tom({ tipo: 'square', f0: 1200, dur: 0.05, vol: 0.1, atraso: 0.08, saida: b });
        break;
      case 'borda':        // fora da arena: bipe de alarme
        this._tom({ tipo: 'square', f0: 520, dur: 0.09, vol: 0.09, saida: b });
        break;
      case 'camadaRival':  // arrancou uma camada de vida do outro
        this._tom({ tipo: 'triangle', f0: 990, f1: 1480, dur: 0.18, vol: 0.25, saida: b });
        this._ruido({ filtro: 'highpass', f0: 3000, dur: 0.12, vol: 0.25, saida: b });
        break;
      case 'camadaMinha':  // perdeu uma camada: grave, de alerta
        this._tom({ tipo: 'triangle', f0: 330, f1: 165, dur: 0.3, vol: 0.3, saida: b });
        break;
      case 'fase':         // a arena apertou: gongo
        this._tom({ tipo: 'sine', f0: 98, dur: 2.2, vol: 0.45, ataque: 0.01, saida: b });
        this._tom({ tipo: 'sine', f0: 147, dur: 1.8, vol: 0.2, saida: b });
        this._tom({ tipo: 'triangle', f0: 392, dur: 1.2, vol: 0.08, saida: b });
        break;
      case 'vitoria':
        [523, 659, 784, 1047].forEach((f, i) =>
          this._tom({ tipo: 'triangle', f0: f, dur: 0.6, vol: 0.25, atraso: i * 0.11, saida: b }));
        break;
      case 'derrota':
        [392, 330, 262].forEach((f, i) =>
          this._tom({ tipo: 'triangle', f0: f, dur: 0.7, vol: 0.25, atraso: i * 0.18, saida: b }));
        break;
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Loops contínuos — só do jogador                                    */
  /* ------------------------------------------------------------------ */
  /*  Carregar ki e segurar o smash são ESTADOS, não eventos: o som dura
   *  enquanto o estado dura. Só do jogador, porque 29 zumbidos de carga ao
   *  fundo é exatamente o chiado que a regra de distância existe pra evitar. */

  /**
   * Chamado todo frame com o estado atual do jogador.
   * @param {{carregandoKi:boolean, ki01:number, segurandoSmash:boolean, carga01:number}} s
   */
  atualizarLoops(s) {
    if (!this.ativo) { this._pararLoop('_carga'); this._pararLoop('_smashCarga'); return; }

    if (s.carregandoKi) {
      if (!this._carga) this._carga = this._abrirLoop('sawtooth', 70, 'lowpass', 500);
      const f = 70 + s.ki01 * 90;
      this._carga.o.frequency.setTargetAtTime(f, this.ctx.currentTime, 0.08);
      this._carga.fl.frequency.setTargetAtTime(400 + s.ki01 * 1400, this.ctx.currentTime, 0.08);
    } else this._pararLoop('_carga');

    if (s.segurandoSmash) {
      if (!this._smashCarga) this._smashCarga = this._abrirLoop('triangle', 200, 'bandpass', 900);
      this._smashCarga.o.frequency.setTargetAtTime(200 + s.carga01 * 500, this.ctx.currentTime, 0.03);
    } else this._pararLoop('_smashCarga');
  }

  _abrirLoop(tipo, f, filtro, ff) {
    const c = this.ctx;
    const o = c.createOscillator(), fl = c.createBiquadFilter(), g = c.createGain();
    o.type = tipo; o.frequency.value = f;
    fl.type = filtro; fl.frequency.value = ff; fl.Q.value = 2;
    // ruído junto: carga de ki é vento, não só zumbido
    const n = c.createBufferSource(); n.buffer = this.ruido; n.loop = true;
    const ng = c.createGain(); ng.gain.value = 0.35;
    n.connect(ng).connect(fl);
    o.connect(fl).connect(g).connect(this.master);
    g.gain.setValueAtTime(0.0001, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.16, c.currentTime + 0.15);
    o.start(); n.start();
    return { o, n, g, fl };
  }

  _pararLoop(nome) {
    const l = this[nome];
    if (!l) return;
    const t = this.ctx.currentTime;
    l.g.gain.cancelScheduledValues(t);
    l.g.gain.setTargetAtTime(0.0001, t, 0.05);
    l.o.stop(t + 0.3); l.n.stop(t + 0.3);
    this[nome] = null;
  }
}
