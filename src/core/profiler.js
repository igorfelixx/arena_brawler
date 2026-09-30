/* =============================================================================
 *  profiler.js  —  QUANTO CUSTA CADA SISTEMA, POR FRAME
 * =============================================================================
 *
 *  Existe por causa da pendência nº 1 do projeto: "o teto real de lutadores na
 *  máquina dele é DESCONHECIDO, e a escala de 20–30 é o maior risco".
 *
 *  ---------------------------------------------------------------------------
 *  A DISTINÇÃO QUE FAZ ESTE ARQUIVO VALER ALGUMA COISA
 *  ---------------------------------------------------------------------------
 *  SIMULAÇÃO e RENDER são medidos separados, e não é organização — é a única
 *  forma de a medição significar alguma coisa fora desta máquina.
 *
 *    SIMULAÇÃO  é CPU pura: máquinas de estado, IA, resolução de acerto, física.
 *               O custo é essencialmente o mesmo em qualquer máquina moderna, e
 *               é ELE que decide se 30 lutadores são viáveis. Também é o único
 *               pedaço que PORTA: no Unreal esse trabalho continua existindo,
 *               com outro nome.
 *
 *    RENDER     é GPU: draw calls, shaders, partículas, bloom. Depende
 *               inteiramente da placa. Medido num navegador headless (que
 *               rasteriza por software) o número é LIXO — não serve nem como
 *               estimativa.
 *
 *  Ou seja: os números de simulação daqui você pode levar a sério. Os de render,
 *  só medidos na máquina de quem vai jogar. Misturar os dois num "FPS" único é
 *  como o projeto já errou antes: um número que parece resposta e não é.
 *
 *  ---------------------------------------------------------------------------
 *  Custo do próprio medidor
 *  ---------------------------------------------------------------------------
 *  Desligado, `begin`/`end` retornam na primeira linha — o overhead é uma
 *  comparação de booleano por chamada. Ligado, são ~20 `performance.now()` por
 *  frame, o que é ruído perto de qualquer sistema que valha medir.
 *
 *  Guardamos um ANEL dos últimos N frames em vez de só a média, porque média
 *  esconde exatamente o que importa: o frame ruim. 60 fps de média com um pico
 *  de 40 ms é um engasgo visível, e a média não conta isso. Daí p50/p95/max.
 * ========================================================================== */

const RING = 240;            // 4 segundos a 60fps

export class Profiler {
  constructor() {
    this.enabled = false;
    /** nome → { ring: Float32Array, i, n, aberto } */
    this._m = new Map();
    this._frames = 0;
  }

  _slot(nome) {
    let s = this._m.get(nome);
    if (!s) {
      s = { ring: new Float32Array(RING), i: 0, n: 0, aberto: 0, acc: 0 };
      this._m.set(nome, s);
    }
    return s;
  }

  begin(nome) {
    if (!this.enabled) return;
    this._slot(nome).aberto = performance.now();
  }

  /** Acumula no frame atual. Pode ser chamado várias vezes por frame. */
  end(nome) {
    if (!this.enabled) return;
    const s = this._slot(nome);
    s.acc += performance.now() - s.aberto;
  }

  /** Açúcar: mede uma chamada inteira. */
  time(nome, fn) {
    if (!this.enabled) return fn();
    this.begin(nome);
    const r = fn();
    this.end(nome);
    return r;
  }

  /**
   * Fecha o frame: joga o acumulado de cada sistema no anel e zera.
   * Tem que ser chamado UMA vez por frame, senão os acumuladores somam entre
   * frames e todo sistema parece caríssimo.
   */
  frame() {
    if (!this.enabled) return;
    this._frames++;
    for (const s of this._m.values()) {
      s.ring[s.i] = s.acc;
      s.i = (s.i + 1) % RING;
      if (s.n < RING) s.n++;
      s.acc = 0;
    }
  }

  reset() {
    for (const s of this._m.values()) { s.i = 0; s.n = 0; s.acc = 0; }
    this._frames = 0;
  }

  /** @returns {object} nome → { media, p50, p95, max } em MILISSEGUNDOS */
  report() {
    const out = {};
    for (const [nome, s] of this._m) {
      if (s.n === 0) continue;
      const v = Array.from(s.ring.slice(0, s.n)).sort((a, b) => a - b);
      const soma = v.reduce((a, b) => a + b, 0);
      out[nome] = {
        media: +(soma / v.length).toFixed(3),
        p50: +v[Math.floor(v.length * 0.50)].toFixed(3),
        p95: +v[Math.floor(v.length * 0.95)].toFixed(3),
        max: +v[v.length - 1].toFixed(3),
      };
    }
    return out;
  }

  get frames() { return this._frames; }
}

/** Instância única do jogo. Exposta em PROTO.prof pra instrumentação. */
export const prof = new Profiler();
