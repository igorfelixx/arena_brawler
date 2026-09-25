/* =============================================================================
 *  input.js  —  Entrada por AÇÃO (teclado, mouse e gamepad)
 * =============================================================================
 *
 *  O jogo nunca pergunta "a tecla J está apertada?". Ele pergunta
 *  "a ação RUSH está apertada?". Remapear é mexer só no BINDINGS aqui embaixo.
 *
 *  Três consultas, e a diferença entre elas importa muito num jogo de luta:
 *     input.down('rush')      → está segurando agora
 *     input.pressed('rush')   → APERTOU NESTE FRAME (edge) ← use pra atacar
 *     input.released('rush')  → soltou neste frame
 *
 *  Há um BUFFER de input (bufferFrames): se você apertar poucos frames antes da
 *  ação ficar disponível, o comando não se perde. Sem isso o combo falha e o
 *  jogador culpa o jogo — com razão.
 * ========================================================================== */

const BINDINGS = {
  // movimento
  fwd:        { keys: ['KeyW', 'ArrowUp'] },
  back:       { keys: ['KeyS', 'ArrowDown'] },
  left:       { keys: ['KeyA', 'ArrowLeft'] },
  right:      { keys: ['KeyD', 'ArrowRight'] },
  ascend:     { keys: ['Space'], pad: [7] },              // RT
  descend:    { keys: ['KeyC', 'ControlLeft'], pad: [6] },// LT

  // combate
  rush:       { keys: ['KeyJ'], mouse: [0], pad: [2] },   // X / quadrado
  smash:      { keys: ['KeyK'], mouse: [2], pad: [3] },   // Y / triângulo
  blast:      { keys: ['KeyL'], pad: [1] },               // B / círculo
  guard:      { keys: ['KeyF', 'ShiftRight'], mouse: [1], pad: [5] }, // RB
  vanish:     { keys: ['KeyV'], pad: [4] },               // LB
  dash:       { keys: ['ShiftLeft'], pad: [0] },          // A / X
  chargeKi:   { keys: ['KeyR'], pad: [10] },              // L3
  ultimate:   { keys: ['KeyX'], pad: [9] },

  // meta
  lockCycle:  { keys: ['KeyQ'], pad: [8] },          // troca de alvo
  lockToggle: { keys: ['KeyE', 'Tab'], pad: [11] },  // solta/retoma o lock-on
  training:   { keys: ['KeyT'] },                   // cicla o modo treino
  trainReset: { keys: ['KeyG'] },                   // recoloca os bonecos
  botProfile: { keys: ['KeyB'] },                   // cicla o estilo da IA
  debugHud:   { keys: ['KeyH'] },                   // telemetria de frame data
  debugPanel: { keys: ['KeyP'] },
  reset:      { keys: ['Backspace'] },
};

/* Ações que continuam funcionando mesmo com o foco dentro de um campo do painel
 * de debug. Sem isto, depois de encostar num slider a tecla P para de responder
 * e parece que o painel travou. */
const ALWAYS_ALLOWED = new Set(['debugPanel']);

const AXIS_DEADZONE = 0.22;

export class Input {
  constructor(domElement, { bufferFrames = 8 } = {}) {
    this.dom = domElement;
    this.bufferFrames = bufferFrames;

    this._down = new Set();       // ações seguradas
    this._pressedAt = new Map();  // ação → frame em que foi apertada
    this._released = new Set();
    this._frame = 0;

    this._keys = new Set();
    this._mouse = new Set();
    this._padIndex = null;
    this._padPrev = [];

    this.mouseDX = 0;
    this.mouseDY = 0;
    this.pointerLocked = false;

    // eixo analógico do stick esquerdo (preenchido por gamepad)
    this.padAxisX = 0;
    this.padAxisY = 0;

    this._bind();
  }

  _bind() {
    const kd = (e) => {
      // Com o foco num slider do painel, o jogo não deve receber WASD — senão o
      // personagem sai voando enquanto você ajusta um número. Mas as teclas de
      // ALWAYS_ALLOWED passam, pra que dê pra FECHAR o painel de lá de dentro.
      if (e.target instanceof HTMLInputElement) {
        const allowed = [...ALWAYS_ALLOWED].some((a) => (BINDINGS[a].keys || []).includes(e.code));
        if (!allowed) return;
      }
      if (e.code === 'Tab') e.preventDefault();
      if (e.code === 'Space') e.preventDefault();
      this._keys.add(e.code);
    };
    const ku = (e) => this._keys.delete(e.code);

    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', ku);
    window.addEventListener('blur', () => { this._keys.clear(); this._mouse.clear(); });

    // Enquanto o painel de tuning está aberto, NÃO capturamos o mouse. Com
    // pointer lock ativo o cursor some, e aí é impossível arrastar um slider —
    // o painel abre e parece quebrado. Ver DebugPanel.show().
    this.suppressPointerLock = false;

    this.dom.addEventListener('mousedown', (e) => {
      this._mouse.add(e.button);
      if (!this.pointerLocked && !this.suppressPointerLock) this.dom.requestPointerLock?.();
    });
    window.addEventListener('mouseup', (e) => this._mouse.delete(e.button));
    this.dom.addEventListener('contextmenu', (e) => e.preventDefault());

    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === this.dom;
    });

    window.addEventListener('mousemove', (e) => {
      if (!this.pointerLocked) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });

    window.addEventListener('gamepadconnected', (e) => {
      this._padIndex = e.gamepad.index;
      console.info(`[input] gamepad conectado: ${e.gamepad.id}`);
    });
    window.addEventListener('gamepaddisconnected', () => { this._padIndex = null; });
  }

  _pad() {
    if (this._padIndex === null) return null;
    const pads = navigator.getGamepads?.() || [];
    return pads[this._padIndex] || null;
  }

  /** Chame UMA vez por frame de simulação, antes de ler as ações. */
  update() {
    this._frame++;
    this._released.clear();

    const pad = this._pad();
    const padButtons = pad ? pad.buttons.map((b) => b.pressed) : [];

    if (pad) {
      const ax = pad.axes[0] || 0;
      const ay = pad.axes[1] || 0;
      this.padAxisX = Math.abs(ax) > AXIS_DEADZONE ? ax : 0;
      this.padAxisY = Math.abs(ay) > AXIS_DEADZONE ? ay : 0;

      // Stick direito move a câmera, como num console.
      const rx = pad.axes[2] || 0;
      const ry = pad.axes[3] || 0;
      if (Math.abs(rx) > AXIS_DEADZONE) this.mouseDX += rx * 18;
      if (Math.abs(ry) > AXIS_DEADZONE) this.mouseDY += ry * 18;
    } else {
      this.padAxisX = this.padAxisY = 0;
    }

    for (const [action, b] of Object.entries(BINDINGS)) {
      const isDown =
        (b.keys || []).some((k) => this._keys.has(k)) ||
        (b.mouse || []).some((m) => this._mouse.has(m)) ||
        (b.pad || []).some((i) => padButtons[i]);

      const wasDown = this._down.has(action);

      if (isDown && !wasDown) {
        this._down.add(action);
        this._pressedAt.set(action, this._frame);
      } else if (!isDown && wasDown) {
        this._down.delete(action);
        this._released.add(action);
      }
    }

    this._padPrev = padButtons;
  }

  /** Está segurando. */
  down(action) { return this._down.has(action); }

  /** Apertou neste frame exato (sem buffer). */
  pressed(action) { return this._pressedAt.get(action) === this._frame; }

  /** Soltou neste frame. */
  released(action) { return this._released.has(action); }

  /**
   * Apertou dentro da janela de buffer e ainda não foi consumido.
   * É esta que o combate deve usar: perdoa o jogador por alguns frames.
   */
  buffered(action, frames = this.bufferFrames) {
    const at = this._pressedAt.get(action);
    return at !== undefined && this._frame - at <= frames;
  }

  /** Gasta o buffer — chame ao executar a ação, senão ela dispara duas vezes. */
  consume(action) { this._pressedAt.delete(action); }

  /** Vetor de movimento bruto, já com gamepad somado. x = direita, y = frente. */
  moveVector() {
    let x = 0, y = 0;
    if (this.down('right')) x += 1;
    if (this.down('left')) x -= 1;
    if (this.down('fwd')) y += 1;
    if (this.down('back')) y -= 1;

    if (this.padAxisX || this.padAxisY) {
      x += this.padAxisX;
      y -= this.padAxisY;
    }

    const len = Math.hypot(x, y);
    if (len > 1) { x /= len; y /= len; }
    return { x, y, magnitude: Math.min(len, 1) };
  }

  /** Consome o delta do mouse acumulado desde a última chamada. */
  takeMouseDelta() {
    const d = { x: this.mouseDX, y: this.mouseDY };
    this.mouseDX = this.mouseDY = 0;
    return d;
  }

  get hasGamepad() { return this._padIndex !== null; }
}

export const KEYMAP_HELP = [
  ['WASD',            'Voar / orbitar o alvo'],
  ['Espaço / C',      'Subir / descer'],
  ['Shift',           'Dragon Dash (segure)'],
  // Um TOQUE = um elo. Segurar não emenda: a direção escolhe o golpe, então a
  // decisão tem que estar em algum lugar, e ela está no toque.
  ['J  ou  Botão esq.','Rush — 1 toque = 1 elo · a direção escolhe o golpe'],
  ['K  ou  Botão dir.','Smash — SEGURE pra carregar · solte na janela = PERFECT'],
  ['L',               'Ki blast (segure = carregado)'],
  ['F',               'Guarda (segure) · TOQUE no impacto = Z-Counter'],
  ['F + direção',     'Step · no tempo certo vira Sonic Sway'],
  ['F + J',           'Grab — passa pela guarda · F na hora = escape'],
  ['V',               'Vanish — some atrás de quem te bate (errar custa ki)'],
  ['Shift (lançou)',  'Perseguir · +V = vanish · +K = alta velocidade'],
  ['R (ki cheio)',    'Carregar até o fim = MAX POWER'],
  ['X',               'Ultimate'],
  ['Q',               'Trocar de alvo'],
  ['E',               'Soltar / retomar o lock-on'],
  ['T',               'Modo treino (6 modos)  ·  G recoloca o boneco'],
  ['B',               'Estilo da IA: pressão / defesa / borda / …'],
  ['H',               'Telemetria (frame data ao vivo)'],
  ['P',               'Painel de tuning'],
  ['Backspace',       'Reiniciar a luta'],
];
