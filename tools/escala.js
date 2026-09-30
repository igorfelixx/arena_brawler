/* =============================================================================
 *  tools/escala.js  —  HARNESS DA ESCADA DE ESCALA (2 → 4 → 8 → 16)
 * =============================================================================
 *
 *  Cole no console do navegador (ou injete via automação) e chame:
 *
 *      await ESCALA.medir({ segundos: 25 })
 *
 *  Responde a pendência nº 1 do projeto: o teto real de lutadores é desconhecido,
 *  e a escala de 20–30 é o maior risco antes de portar.
 *
 *  ---------------------------------------------------------------------------
 *  DUAS COISAS QUE ESTE HARNESS FAZ E QUE OS ANTERIORES ERRARAM
 *  ---------------------------------------------------------------------------
 *  1. PÕE UMA IA NO JOGADOR.
 *     Sem isso, um dos N lutadores fica parado e o teste de estresse mede N−1
 *     máquinas de estado e N−1 árvores de decisão — e, pior, o jogador vira um
 *     saco de pancada, o que contamina toda métrica de balanceamento.
 *
 *  2. SEPARA SIMULAÇÃO DE RENDER.
 *     Só a simulação é comparável entre máquinas (e é o único custo que porta
 *     pro Unreal). Ver o cabeçalho de src/core/profiler.js.
 *
 *  ---------------------------------------------------------------------------
 *  A sessão anterior teve o harness mentindo TRÊS vezes (armadilha 8.30 do doc
 *  de passagem). As proteções que sobraram daquilo, e que estão aqui:
 *    - eventos colhidos DEPOIS da resolução, nunca antes
 *    - descarta os primeiros frames (JIT esquentando, assets assentando)
 *    - reporta p95 e max, não só média: média esconde o engasgo
 * ========================================================================== */

(() => {
  const P = window.PROTO;
  if (!P) { console.error('[escala] PROTO não existe — o jogo não bootou.'); return; }

  const dorme = (ms) => new Promise((r) => setTimeout(r, ms));

  const ESCALA = {
    /**
     * @param {object} opts
     * @param {number}  opts.segundos  tempo de coleta (após o aquecimento)
     * @param {number}  opts.aquecer   segundos descartados no começo
     * @param {boolean} opts.imortal   ninguém morre nem sai da arena
     *
     * ---------------------------------------------------------------------
     * POR QUE `imortal` EXISTE — e por que ignorá-lo invalida a medição
     * ---------------------------------------------------------------------
     * Medido com 4 lutadores mortais: a luta ACABOU em ~10 s dos 25, e o custo
     * de simulação MÉDIO caiu pra 0,136 ms — MENOR que o de 2 lutadores. Não
     * porque 4 é mais barato que 2, mas porque metade da janela mediu uma arena
     * com um sobrevivente e o `step()` saindo cedo pelo `roundOver`.
     *
     * Número que cai quando a carga sobe é sinal de instrumento quebrado, não
     * de otimização. As duas perguntas são incompatíveis na mesma passada:
     *
     *   ESTRESSE       exige N lutadores vivos o tempo TODO   → imortal: true
     *   BALANCEAMENTO  exige que gente morra pra contar mortes → imortal: false
     */
    async medir({ segundos = 25, aquecer = 3, imortal = false } = {}) {
      const N = P.fighters.length;

      /* ---- 1. todo mundo luta ---- */
      this._armarJogador();
      if (imortal) this._imortalizar();

      /* ---- 2. coletor de balanceamento ---- */
      const col = this._coletar();

      /* ---- 3. aquecimento: JIT e assets assentando ---- */
      P.prof.enabled = true;
      await dorme(aquecer * 1000);
      P.prof.reset();
      col.zerar();

      /* ---- 4. medição ---- */
      await dorme(segundos * 1000);

      const perf = P.prof.report();
      P.prof.enabled = false;
      const bal = col.fechar();

      return this._formatar(N, perf, bal, segundos, imortal);
    },

    /**
     * Ninguém morre e ninguém sai da arena — a arena fica CHEIA a medição
     * inteira, que é a única condição em que "custo com N lutadores" quer dizer
     * alguma coisa.
     *
     * `immortal` sozinho não basta: ele segura a vida em 1, mas o ring-out
     * elimina por POSIÇÃO e acabaria a luta do mesmo jeito. Por isso também
     * neutralizamos `eliminate` e trazemos de volta quem passar da borda.
     */
    _imortalizar() {
      if (this._jaImortal) return;
      this._jaImortal = true;
      for (const f of P.fighters) {
        f.immortal = true;
        f.eliminate = () => {};
        const origIntegrate = f._integrate.bind(f);
        f._integrate = (dt, ctx) => {
          origIntegrate(dt, ctx);
          // Passou da borda? volta pro centro, sem interromper a luta.
          if (P.arena.isOutOfBounds(f.position) || P.arena.isRingOut(f.position)) {
            f.position.multiplyScalar(0.25);
            f.position.y = Math.max(8, Math.min(f.position.y, P.arena.ceiling - 4));
            f.velocity.multiplyScalar(-0.2);
            f.outOfBoundsFrames = 0;
          }
        };
      }
    },

    /**
     * Põe uma IA no jogador. Sem isto o teste vale N−1 lutadores.
     * Guardamos o controlador pra não criar um por chamada.
     */
    _armarJogador() {
      if (this._botJogador) return;
      const p = P.player;
      this._botJogador = new P.BotController(p, 0xBEEF, 'EQUILIBRADO');
      // O loop do jogo lê `buildPlayerCommand()`; sobrepomos o update do
      // lutador pra injetar o comando da IA antes que ele rode.
      const orig = p.update.bind(p);
      p.update = (dt, cmd, ctx) => orig(dt, this._botJogador.update(dt, ctx), ctx);
    },

    /** Coletor de métricas de balanceamento e legibilidade. */
    _coletar() {
      const S = {
        frames: 0,
        atacantesSimultaneos: [],   // quantos miram no jogador e estão atacando
        distNN: [],                 // distância ao inimigo vivo mais próximo
        emPerigo: 0,                // frames com 2+ atacantes
        semAlvoEmAlcance: 0,
        eliminacoes: [],
        t0: performance.now(),
        primeiraElim: null,
        vivosAoLongo: [],
      };

      const alvo = P.player;
      const tick = () => {
        if (!S.ativo) return;
        S.frames++;

        const vivos = P.fighters.filter((f) => f.alive);
        S.vivosAoLongo.push(vivos.length);

        // quantos estão ATACANDO e mirando em mim agora
        let mirando = 0;
        let melhorD = Infinity;
        for (const f of P.fighters) {
          if (f === alvo || !f.alive) continue;
          const d = alvo.position.distanceTo(f.position);
          if (d < melhorD) melhorD = d;
          if (f.target === alvo && (f.state === 'attack' || f.state === 'approach') && d < 8) mirando++;
        }
        S.atacantesSimultaneos.push(mirando);
        if (mirando >= 2) S.emPerigo++;
        if (melhorD > 12) S.semAlvoEmAlcance++;
        S.distNN.push(melhorD);

        requestAnimationFrame(tick);
      };

      // Eliminações: escutamos o evento do próprio lutador.
      const origEliminate = P.fighters.map((f) => f.eliminate.bind(f));
      P.fighters.forEach((f, i) => {
        f.eliminate = (causa) => {
          if (!f.eliminated && S.ativo) {
            S.eliminacoes.push({ causa, t: +((performance.now() - S.t0) / 1000).toFixed(1) });
            if (S.primeiraElim === null) S.primeiraElim = (performance.now() - S.t0) / 1000;
          }
          return origEliminate[i](causa);
        };
      });

      S.ativo = true;
      requestAnimationFrame(tick);

      return {
        zerar() {
          S.frames = 0; S.atacantesSimultaneos.length = 0; S.distNN.length = 0;
          S.emPerigo = 0; S.semAlvoEmAlcance = 0; S.eliminacoes.length = 0;
          S.vivosAoLongo.length = 0;
          S.t0 = performance.now(); S.primeiraElim = null;
        },
        fechar() { S.ativo = false; return S; },
      };
    },

    _formatar(N, perf, bal, segundos, imortal) {
      const med = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
      const sim = perf['SIMULAÇÃO'] || {};
      const ring = bal.eliminacoes.filter((e) => e.causa !== 'nocaute').length;

      /* Quantos lutadores estavam vivos EM MÉDIA durante a medição. É o número
       * que valida a passada de estresse: se caiu abaixo de N, a arena esvaziou
       * no meio e o custo medido não é o custo de N. */
      const vivosMedio = +med(bal.vivosAoLongo).toFixed(2);

      return {
        lutadores: N,
        modo: imortal ? 'ESTRESSE (ninguém morre)' : 'BALANCEAMENTO (luta de verdade)',
        vivosEmMedia: vivosMedio,
        medicaoValida: imortal ? (vivosMedio >= N - 0.05) : true,
        segundosMedidos: segundos,
        framesMedidos: P.prof.frames,

        /* --- O NÚMERO QUE IMPORTA. 16,7 ms = orçamento inteiro de um frame
           a 60fps. Se a simulação sozinha passar disso, não há GPU que salve. */
        SIMULACAO_ms: sim,
        orcamento60fps_ms: 16.7,
        fracaoDoOrcamento: sim.p95 ? +(sim.p95 / 16.7 * 100).toFixed(1) + '%' : '--',

        porSistema_ms: Object.fromEntries(
          Object.entries(perf)
            .filter(([k]) => k !== 'SIMULAÇÃO')
            .sort((a, b) => b[1].media - a[1].media)),

        /* --- render: só pra contraste. NÃO é comparável fora desta máquina. */
        AVISO_render: 'RENDER(GPU) aqui é software rasterizer — número sem valor fora daqui',

        balanceamento: {
          atacantesSimultaneosMedia: +med(bal.atacantesSimultaneos).toFixed(2),
          atacantesSimultaneosMax: Math.max(0, ...bal.atacantesSimultaneos),
          pctTempoCom2OuMaisEmCima: +(bal.emPerigo / Math.max(1, bal.frames) * 100).toFixed(1),
          pctTempoSemNinguemPerto: +(bal.semAlvoEmAlcance / Math.max(1, bal.frames) * 100).toFixed(1),
          distanciaMedianaAoMaisProximo: +med(bal.distNN).toFixed(1),
          eliminacoes: bal.eliminacoes.length,
          porRingOut: ring,
          porNocaute: bal.eliminacoes.length - ring,
          segundosAtePrimeiraElim: bal.primeiraElim ? +bal.primeiraElim.toFixed(1) : null,
          vivosAoFim: P.fighters.filter((f) => f.alive).length,
        },
      };
    },
  };

  window.ESCALA = ESCALA;
  console.info('[escala] pronto. use: await ESCALA.medir({ segundos: 25 })');
})();
