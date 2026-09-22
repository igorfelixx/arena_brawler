/* =============================================================================
 *  debugPanel.js  —  Tuning ao vivo (tecla P)
 * =============================================================================
 *
 *  Este painel é a peça mais importante do protótipo pro seu fluxo de trabalho.
 *
 *  Eu não sinto o jogo. Você sente. Se cada ajuste de "o smash tá fraco" exigir
 *  me pedir, eu editar tuning.js e você recarregar, o ciclo leva minutos e você
 *  desiste antes de achar o número certo. Com o painel, você arrasta o slider
 *  até ficar bom, anota, e só então me diz o valor final.
 *
 *  Os campos vêm de DEBUG_SLIDERS em tuning.js — para expor mais um número,
 *  adicione uma linha lá, não aqui.
 *
 *  "Copiar valores" põe no clipboard só o que você MUDOU, já em formato de
 *  caminho (`moves.smash_forward.knockback: 62`). É isso que você me manda.
 * ========================================================================== */

import { TUNING, DEBUG_SLIDERS, getTuning, setTuning } from '../tuning.js';

export class DebugPanel {
  /**
   * @param {HTMLElement} container
   * @param {Input} [input]  usado pra soltar o mouse enquanto o painel está aberto
   */
  constructor(container, input = null) {
    this.visible = false;
    this.input = input;
    this._initial = new Map();

    // Botão sempre visível. A tecla P continua funcionando, mas depender só
    // dela é frágil: basta o foco estar em outro lugar, ou o mouse estar
    // capturado pelo pointer lock, pra parecer que o painel "não abre".
    this.button = document.createElement('button');
    this.button.className = 'dbg-toggle';
    this.button.innerHTML = '<span>⚙</span> TUNING <kbd>P</kbd>';
    this.button.addEventListener('click', () => this.toggle());
    container.appendChild(this.button);

    this.el = document.createElement('div');
    this.el.className = 'debug-panel';
    container.appendChild(this.el);

    const head = document.createElement('div');
    head.className = 'dbg-head';
    head.innerHTML = `
      <strong>TUNING AO VIVO</strong>
      <span class="dbg-hint">P fecha · arraste e sinta</span>
    `;
    this.el.appendChild(head);

    const body = document.createElement('div');
    body.className = 'dbg-body';
    this.el.appendChild(body);

    this.rows = [];

    for (const entry of DEBUG_SLIDERS) {
      if (entry[0] === '__group') {
        const g = document.createElement('div');
        g.className = 'dbg-group';
        g.textContent = entry[1];
        body.appendChild(g);
        continue;
      }

      const [path, min, max, step, label] = entry;
      const value = getTuning(path);

      if (value === undefined) {
        console.warn(`[debugPanel] caminho inexistente em TUNING: "${path}"`);
        continue;
      }
      this._initial.set(path, value);

      const row = document.createElement('div');
      row.className = 'dbg-row';

      const lab = document.createElement('label');
      lab.textContent = label;

      const val = document.createElement('span');
      val.className = 'dbg-val';
      val.textContent = fmt(value);

      const input = document.createElement('input');
      input.type = 'range';
      input.min = min; input.max = max; input.step = step;
      input.value = value;

      input.addEventListener('input', () => {
        const v = parseFloat(input.value);
        setTuning(path, v);
        val.textContent = fmt(v);
        row.classList.toggle('changed', v !== this._initial.get(path));
      });

      row.append(lab, val, input);
      body.appendChild(row);
      this.rows.push({ path, input, val, row });
    }

    const foot = document.createElement('div');
    foot.className = 'dbg-foot';

    const copyBtn = document.createElement('button');
    copyBtn.textContent = 'Copiar valores alterados';
    copyBtn.addEventListener('click', () => this.copyChanged(copyBtn));

    const resetBtn = document.createElement('button');
    resetBtn.textContent = 'Voltar ao original';
    resetBtn.addEventListener('click', () => this.resetAll());

    foot.append(copyBtn, resetBtn);
    this.el.appendChild(foot);

    this.hide();
  }

  toggle() { this.visible ? this.hide() : this.show(); }

  show() {
    this.visible = true;
    this.el.classList.add('open');
    this.button.classList.add('active');

    // Solta o mouse. Sem isto o cursor fica invisível e preso ao canvas, e não
    // há como arrastar um slider — o painel abre e parece quebrado.
    if (this.input) this.input.suppressPointerLock = true;
    if (document.pointerLockElement) document.exitPointerLock?.();
  }

  hide() {
    this.visible = false;
    this.el.classList.remove('open');
    this.button.classList.remove('active');

    // Tira o foco de qualquer slider: senão o próximo WASD vai pro input
    // em vez de ir pro jogo.
    if (document.activeElement instanceof HTMLInputElement) document.activeElement.blur();
    if (this.input) this.input.suppressPointerLock = false;
  }

  copyChanged(btn) {
    const lines = [];
    for (const { path, input } of this.rows) {
      const v = parseFloat(input.value);
      if (v !== this._initial.get(path)) lines.push(`${path}: ${v}`);
    }

    const text = lines.length
      ? lines.join('\n')
      : '(nenhum valor alterado)';

    navigator.clipboard?.writeText(text).then(
      () => { btn.textContent = `Copiado (${lines.length})`; setTimeout(() => { btn.textContent = 'Copiar valores alterados'; }, 1400); },
      () => { console.log('[debugPanel] valores alterados:\n' + text); btn.textContent = 'Veja o console'; },
    );
  }

  resetAll() {
    for (const { path, input, val, row } of this.rows) {
      const v = this._initial.get(path);
      setTuning(path, v);
      input.value = v;
      val.textContent = fmt(v);
      row.classList.remove('changed');
    }
  }
}

function fmt(v) {
  if (Number.isInteger(v)) return String(v);
  return v.toFixed(Math.abs(v) < 1 ? 2 : 1);
}
