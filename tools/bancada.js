/* =============================================================================
 *  tools/bancada.js  —  BANCADA DE MEDIÇÃO DO MOVIMENTO
 * =============================================================================
 *
 *  Responde à pergunta "melhorou?" sem depender de impressão. Antes de mexer em
 *  dash, câmera ou animação, roda-se isto e guarda-se o número. Depois, roda de
 *  novo e compara. Sem isto, "ficou mais responsivo" é opinião — e o projeto tem
 *  histórico de diagnóstico errado feito por leitura de código (CLAUDE.md).
 *
 *  ---------------------------------------------------------------------------
 *  COMO RODA
 *  ---------------------------------------------------------------------------
 *      1. ./serve.sh  →  http://localhost:8123/?modo=duelo
 *      2. console do navegador:
 *             await BANCADA.baseline()
 *      3. (ou cenário isolado)  await BANCADA.dash()
 *
 *  ---------------------------------------------------------------------------
 *  POR QUE ELA NÃO MEXE NO CÓDIGO DO JOGO
 *  ---------------------------------------------------------------------------
 *  O harness só substitui `player.update` por um que injeta um Command roteirizado
 *  e devolve a chamada pro método original. Nenhum arquivo de src/ é alterado, e
 *  ao final o método volta pro lugar. Consequência: o que se mede é o MESMO
 *  caminho de código que o jogador percorre — não uma simulação paralela que
 *  pode mentir (armadilha 8.30 do doc de passagem).
 *
 *  A IA fica desligada durante a medição (`TUNING.ai.enabled = false`): com o
 *  bot ativo, o adversário se move e a distância medida é ruído, não número.
 * ========================================================================== */

(() => {
  const P = window.PROTO;
  if (!P) { console.error('[bancada] PROTO não existe — o jogo não bootou.'); return; }

  const FPS = P.TUNING.sim.fps;

  const BANCADA = {
    _frame: 0,
    _serie: [],
    _desfazer: null,

    /* --------------------------------------------------------------------
     *  CENÁRIO: posiciona, roteiriza, coleta e restaura.
     *
     *  `script(frame, cmd)` devolve o trecho de Command daquele frame. Devolver
     *  `null` deixa o comando como está (neutro). Coleta APLICAR o update, nunca
     *  antes: medir o estado anterior ao passo é a forma clássica de o número
     *  sair bonito e errado.
     * ------------------------------------------------------------------ */
    async _rodar({ frames, dist = 40, altura = 4, script, noOp = null }) {
      const A = P.TUNING.ai;
      const iaAntes = A.enabled;
      A.enabled = false;

      P.resetRound();

      const alvo = P.player;
      const outro = P.opponent || P.fighters[1];

      alvo.position.set(0, altura, 0);
      alvo.velocity.set(0, 0, 0);
      outro.position.set(0, altura, dist);
      outro.velocity.set(0, 0, 0);

      alvo.target = outro;
      alvo.lockOn = true;
      alvo.ki = P.TUNING.ki.max;

      this._frame = 0;
      this._serie = [];

      /* Trava o inimigo no lugar: sem isto ele anda sozinho (hover/AI desligada
       * ainda deixa física de residência) e a distância deixa de ser controlada. */
      const travar = noOp ? null : () => {
        outro.velocity.set(0, 0, 0);
        outro.position.set(0, altura, dist);
      };

      const original = alvo.hasOwnProperty('update') ? alvo.update : null;
      const method = original || Object.getPrototypeOf(alvo).update;

      alvo.update = (dt, cmd, ctx) => {
        const parcial = script(this._frame, cmd);
        if (parcial) Object.assign(cmd, parcial);
        const r = method.call(alvo, dt, cmd, ctx);
        travar?.();
        this._coletar(this._frame, alvo, outro);
        this._frame++;
        return r;
      };

      this._desfazer = () => {
        if (original) alvo.update = original;
        else delete alvo.update;
        A.enabled = iaAntes;
      };

      try {
        await new Promise((res) => setTimeout(res, 60));
        P.simular(frames / FPS);
      } finally {
        this._desfazer();
        this._desfazer = null;
      }

      return this._serie;
    },

    _coletar(frame, alvo, outro) {
      this._serie.push({
        f: frame,
        estado: alvo.state,
        vel: +alvo.velocity.length().toFixed(2),
        dist: +alvo.position.distanceTo(outro.position).toFixed(2),
        y: +alvo.position.y.toFixed(2),
        z: +alvo.position.z.toFixed(2),
        ki: Math.round(alvo.ki),
        vidaAdversario: Math.round(outro.health),
        estadosAdversario: outro.state,
      });
    },

    /* ==================================================================
     *  1. DASH  —  existe anticipation? a velocidade é degrau ou curva?
     * ==================================================================
     *  DOIS CENÁRIOS, porque um só mente:
     *
     *   fugir (padrão)  dirige pra TRÁS, nunca tromba. É o único jeito de medir
     *                   aceleração e frenagem limpas — no cenário antigo o dash
     *                   batia no adversário no frame 38, `dashImpact()` fazia
     *                   `velocity *= 0.12` e `_enter(S.IDLE)`, e a "frenagem"
     *                   que eu lia era o rescaldo de um dash que já tinha acabado.
     *                   Medir frenagem em cima de colisão é medir duas coisas
     *                   e reportar uma.
     *
     *   perseguir       dirige pro alvo e colide de propósito: daí saem
     *                   alcance, frame do encontro e se passa reto.
     *
     *  O que se mede nos dois: windup (frames até sair do zero — hoje 0, que é
     *  a prova de que `dragonDash.startupFrames` está morto), aceleração até
     *  90%, e a velocidade em +1/+3/+6/+12/+24 frames depois de soltar.
     * ================================================================== */
    async dash({ dist = 40, segurar = 40, frames = 240, perseguir = false } = {}) {
      const serie = await this._rodar({
        frames, dist,
        script: (f) => (f < segurar
          ? { dash: true, moveY: perseguir ? 0 : -1 }
          : { dash: false, moveY: 0 }),
      });
      const m = this._metricasDash(serie, segurar);
      m.cenario = perseguir ? 'dash perseguindo (colide)' : 'dash fugindo (sem colisão)';
      return m;
    },

    _metricasDash(serie, soltar) {
      const v = serie.map((s) => s.vel);
      const vmax = Math.max(...v);
      const acha = (pred) => v.findIndex(pred);
      const aposSoltar = v.slice(soltar);

      const pico = v.indexOf(vmax);
      const minDist = Math.min(...serie.map((s) => s.dist));
      const iMinDist = serie.findIndex((s) => s.dist === minDist);

      return {
        cenario: 'dash segurado e solto',
        vmax: +vmax.toFixed(1),
        framesAteSairDoZero: acha((x) => x > 5),
        framesAte90pct: acha((x) => x >= vmax * 0.9),
        picoNoFrame: pico,
        soltarNoFrame: soltar,
        frenagemAposSoltar: {
          '+1f': aposSoltar[1] ?? null,
          '+3f': aposSoltar[3] ?? null,
          '+6f': aposSoltar[6] ?? null,
          '+12f': aposSoltar[12] ?? null,
          '+24f': aposSoltar[24] ?? null,
        },
        distanciaInicial: serie[0]?.dist,
        distanciaMinima: minDist,
        alcancouAlvo: minDist <= 1.6,
        chegouNoFrame: minDist <= 1.6 ? iMinDist : null,
        passouReto: iMinDist > 0 && serie.slice(iMinDist).some((s) => s.dist > minDist + 3),
        distPercorridaZ: +(Math.abs((serie.at(-1)?.z ?? 0) - (serie[0]?.z ?? 0))).toFixed(1),
        serieResumida: serie.filter((_, i) => i % 6 === 0).map((s) => [s.f, s.vel, s.dist]),
      };
    },

    /* ==================================================================
     *  2. VOO NORMAL  —  o degrau entre parado e dash
     * ================================================================== */
    async voo({ dist = 40, frames = 300 } = {}) {
      const serie = await this._rodar({
        frames, dist,
        script: () => ({ moveY: 1 }),
      });
      const v = serie.map((s) => s.vel);
      const vmax = Math.max(...v);
      return {
        cenario: 'voo pra frente segurado',
        velocidadeCruzeiro: +vmax.toFixed(1),
        framesAteCruzeiro: v.findIndex((x) => x >= vmax * 0.95),
        distPercorrida: +(Math.abs((serie.at(-1)?.z ?? 0) - (serie[0]?.z ?? 0))).toFixed(1),
        frames: serie.length,
        serieResumida: serie.filter((_, i) => i % 12 === 0).map((s) => [s.f, s.vel, s.dist]),
      };
    },

    /* Duração real de cada trecho em estado `attack`, em frames.
     *
     * Comparar contra `startup + active + recovery` do tuning.js: se o número
     * real divergir do escrito, o frame data e a animação estão dessincronizados
     * — e é o tipo de coisa que só aparece medindo. */
    _duracoes(linha) {
      const saidas = [];
      for (let i = 0; i < linha.length; i++) {
        if (linha[i].estado !== 'attack') continue;
        const fim = linha.slice(i + 1).find((x) => x.estado !== 'attack');
        saidas.push({
          comecaNoFrame: linha[i].frame,
          duracao: (fim ? fim.frame : linha.at(-1).frame) - linha[i].frame,
        });
      }
      return saidas;
    },

    /* ==================================================================
     *  3. ENGAJE  —  do botão ao dano: a linha do tempo real dos estados
     * ==================================================================
     *  Dash até encostar, solta, e martela rush. O que sai daqui é a sequência
     *  de estados com o frame em que cada um começou — é contra isto que se
     *  compara o `startup` escrito em tuning.js.
     * ================================================================== */
    async engajamento({ dist = 18, frames = 360 } = {}) {
      const soltarDash = 40;
      const primeiraTocada = soltarDash + 60;

      const serie = await this._rodar({
        frames, dist,
        script: (f) => {
          if (f < soltarDash) return { dash: true };
          if (f === primeiraTocada || f === primeiraTocada + 26 || f === primeiraTocada + 52) {
            return { rush: true };
          }
          return { rush: false, dash: false };
        },
      });

      const linha = [];
      let anterior = null;
      for (const s of serie) {
        if (s.estado !== anterior) {
          linha.push({ frame: s.f, estado: s.estado });
          anterior = s.estado;
        }
      }

      const vida0 = serie[0]?.vidaAdversario ?? 0;
      const vidaFim = serie.at(-1)?.vidaAdversario ?? 0;
      /* O primeiro dano de VERDADE é o do rush, não o da tromba do dash — a
       * tromba machuca de propósito (4 de dano) e acontece no frame 16, antes
       * de qualquer soco. Medir contra a vida INICIAL dava "o soco acertou no
       * mesmo frame do botão", que é impossível e, pior, parecia consistente.
       * O marco tem que ser a vida NO MOMENTO em que o rush é apertado. */
      const aposRush = serie.slice(primeiraTocada);
      const vidaAntesDoRush = aposRush[0]?.vidaAdversario ?? vida0;
      const primeiroDano = aposRush.find((s) => s.vidaAdversario < vidaAntesDoRush);
      const danoTromba = vida0 - vidaAntesDoRush;

      return {
        cenario: 'dash → soltar → rush x3',
        linhaDoTempoEstados: linha,
        danoTotal: vida0 - vidaFim,
        danoDaTrombaDeDash: danoTromba,
        primeiroDanoNoFrame: primeiroDano ? primeiroDano.f : null,
        framesAtePrimeiroDano: primeiroDano ? primeiroDano.f - primeiraTocada : null,
        framesCadaAtaque: this._duracoes(linha),
        distanciaFinal: serie.at(-1)?.dist,
      };
    },

    async baseline() {
      const out = {
        medidoEm: new Date().toISOString(),
        fps: FPS,
        dashFugindo: await this.dash(),
        dashPerseguindo: await this.dash({ perseguir: true, segurar: 90 }),
        voo: await this.voo(),
        engajamento: await this.engajamento(),
      };
      const d = out.dashFugindo;
      console.table({
        dash_fugir_windup_frames: d.framesAteSairDoZero,
        dash_fugir_accel_frames: d.framesAte90pct,
        dash_fugir_frenagem_1f: d.frenagemAposSoltar['+1f'],
        dash_fugir_frenagem_6f: d.frenagemAposSoltar['+6f'],
        dash_fugir_frenagem_24f: d.frenagemAposSoltar['+24f'],
        dash_perseguir_chegou_frame: out.dashPerseguindo.chegouNoFrame,
        dash_perseguir_passouReto: out.dashPerseguindo.passouReto,
        voo_cruzeiro: out.voo.velocidadeCruzeiro,
        engaj_dano: out.engajamento.danoTotal,
        engaj_frames_ate_dano: out.engajamento.framesAtePrimeiroDano,
      });
      console.log('[bancada] baseline:', JSON.stringify(out, null, 2));
      return out;
    },
  };

  window.BANCADA = BANCADA;
  console.info('[bancada] pronta. use: await BANCADA.baseline()');
})();
