/* =============================================================================
 *  tools/diversao.js  —  O JOGO É DIVERTIDO COM 20–30 NA ARENA?
 * =============================================================================
 *
 *      await DIVERSAO.partida()          // acompanha uma partida inteira
 *      await DIVERSAO.janela(60)         // só 60 s, arena sempre cheia
 *
 *  Isto NÃO mede performance. Performance de three.js não diz nada sobre
 *  Unreal — são engines diferentes, e o dono do projeto já cortou essa
 *  pergunta. Aqui só se mede DESIGN.
 *
 *  ---------------------------------------------------------------------------
 *  O QUE DECIDE SE UM FFA É DIVERTIDO
 *  ---------------------------------------------------------------------------
 *  A pergunta do idea.txt é explícita: "se o 1v1 não tiver profundidade, 30
 *  jogadores não vão magicamente criar profundidade — vão criar 30 pessoas
 *  fazendo bagunça ao mesmo tempo". Então o que se mede é exatamente o que
 *  separa "briga" de "bagunça":
 *
 *  1. TERCEIRO INTERROMPENDO  — o assassino do gênero. Você lê o adversário,
 *     acerta o combo, e um estranho te acerta no meio. Não há perícia que
 *     proteja disso, e é a reclamação nº 1 de todo brawler FFA.
 *
 *  2. MORRER PRA QUEM VOCÊ NÃO ESTAVA LUTANDO — a versão terminal do mesmo
 *     problema. Perder pro cara que te leu é justo; perder pro cara que passou
 *     voando não é.
 *
 *  3. DURAÇÃO DE DUELO LIMPO — quanto tempo você consegue disputar UMA
 *     interação sem interferência. É a janela em que a profundidade do 1×1
 *     (vanish, Z-Counter, perfect smash) tem chance de existir.
 *
 *  4. TEMPO OCIOSO — o oposto. Arena grande demais e você voa sozinho.
 *
 *  5. RING-OUT vs NOCAUTE — a IDENTIDADE. Se quase todo mundo morre de HP, o
 *     jogo é um arena fighter comum com uma borda decorativa.
 *
 *  6. O ARCO — 30 → 10 → 3. Se as três fases parecem a mesma coisa, a
 *     contagem de jogadores é só um número. Se a fase final vira duelo de
 *     verdade, o formato funciona.
 *
 *  7. GOLPE QUE VOCÊ NÃO PODIA VER — levar dano de quem está fora do campo de
 *     visão. Um pouco é tempero; muito é injustiça.
 *
 *  ---------------------------------------------------------------------------
 *  Limite honesto: o "jogador" aqui é uma IA. Ela engaja e comba, então serve
 *  pra medir INTERFERÊNCIA (que independe de perícia), mas não mede o teto de
 *  leitura de um humano. Ver seção 11 do doc de passagem.
 * ========================================================================== */

(() => {
  const P = window.PROTO;
  if (!P) { console.error('[diversao] PROTO não existe.'); return; }
  const dorme = (ms) => new Promise((r) => setTimeout(r, ms));

  const D = {
    async _preparar({ imortal }) {
      // O jogador precisa LUTAR, senão ele é um poste e nada disso significa nada.
      if (!this._bot) {
        this._bot = new P.BotController(P.player, 0xD1E7A5, 'EQUILIBRADO');
        const orig = P.player.update.bind(P.player);
        P.player.update = (dt, cmd, ctx) => orig(dt, this._bot.update(dt, ctx), ctx);
      }
      if (imortal && !this._imortal) {
        this._imortal = true;
        for (const f of P.fighters) {
          f.immortal = true;
          f.eliminate = () => {};
          const oi = f._integrate.bind(f);
          f._integrate = (dt, ctx) => {
            oi(dt, ctx);
            if (P.arena.isOutOfBounds(f.position) || P.arena.isRingOut(f.position)) {
              f.position.multiplyScalar(0.25);
              f.position.y = Math.max(8, Math.min(f.position.y, P.arena.ceiling - 4));
              f.velocity.multiplyScalar(-0.2);
              f.outOfBoundsFrames = 0;
            }
          };
        }
      }
    },

    /** Instala os ganchos e devolve o acumulador. */
    _observar() {
      const eu = P.player;
      const S = {
        t0: performance.now(),
        frames: 0,
        // 1. interrupção
        combosIniciados: 0, combosInterrompidosPorTerceiro: 0, combosConcluidos: 0,
        // 2. mortes
        mortes: [], minhasMortes: 0, minhasMortesPorTerceiro: 0,
        // 3. duelo limpo
        dueloAtual: 0, duelos: [],
        // 4. ocioso
        framesOcioso: 0,
        // 5. identidade
        ringOut: 0, nocaute: 0,
        // 6. arco
        arco: [],
        // 7. visão
        golpesRecebidos: 0, golpesPelasCostas: 0,
        atacantesDistintos60s: new Set(),
        ativo: true,
      };

      /* --- quem bateu em quem: envolve TODOS, não só o jogador --- */
      const origHit = P.fighters.map((f) => f.applyHit.bind(f));
      P.fighters.forEach((f, i) => {
        f.applyHit = (args) => {
          const r = origHit[i](args);
          if (!S.ativo) return r;
          const { attacker, direction } = args;

          if (f === eu && r !== 'guard' && r !== 'armor') {
            S.golpesRecebidos++;
            S.atacantesDistintos60s.add(attacker?.name);
            // Quem deu o ÚLTIMO golpe: é o que decide se a morte foi de terceiro.
            S._ultimoAtacante = attacker;

            /* PELAS COSTAS: o golpe veio de trás do seu campo de visão.
             * `direction` aponta do atacante pra você; comparando com a sua
             * frente dá pra saber se dava pra ver aquilo chegando. */
            if (direction) {
              const frente = { x: Math.sin(eu.yaw), z: Math.cos(eu.yaw) };
              const dot = frente.x * direction.x + frente.z * direction.z;
              if (dot > 0.25) S.golpesPelasCostas++;
            }

            /* INTERRUPÇÃO POR TERCEIRO — o número que mais importa.
             * Você estava numa rota (comboCount > 0) e quem te acertou não é
             * o seu alvo. Não há leitura que proteja disso. */
            const emCombo = eu.comboCount > 0 || eu.state === 'attack';
            const terceiro = attacker && attacker !== eu.target;
            if (emCombo && terceiro) S.combosInterrompidosPorTerceiro++;

            // o duelo limpo acabou
            if (terceiro && S.dueloAtual > 20) S.duelos.push(S.dueloAtual / 60);
            if (terceiro) S.dueloAtual = 0;
          }
          return r;
        };
      });

      /* --- eliminações ---
       *
       * `origElim[i]` está BINDADO de propósito. A primeira versão guardava
       * `const anterior = f.eliminate` (sem bind) e chamava `anterior(causa)`:
       * `this` vinha undefined, o método lançava, e aí veio a cascata —
       * ninguém era de fato eliminado, `checkRingOut` recontava a mesma morte
       * todo frame, e o relatório dizia "2484 mortes suas" com 30 vivos no fim.
       * 189 exceções no console que eu só vi porque o número estava absurdo. */
      const origElim = P.fighters.map((f) => f.eliminate.bind(f));
      P.fighters.forEach((f, i) => {
        f.eliminate = (causa) => {
          /* No modo imortal `eliminate` é um no-op, mas a vida ainda zera e o
           * `checkRingOut` rechama isto TODO FRAME. Contar aqui produziria
           * "419 mortes com 30 lutadores" — que foi exatamente o que a trava de
           * sanidade pegou. Morte só se conta quando morrer é possível. */
          if (S.ativo && !D._imortal && !f.eliminated) {
            const t = +((performance.now() - S.t0) / 1000).toFixed(1);
            S.mortes.push({ quem: f.name, causa, t });
            if (causa === 'nocaute') S.nocaute++; else S.ringOut++;
            if (f === eu) {
              S.minhasMortes++;
              // matou-me quem eu NÃO estava enfrentando?
              if (S._ultimoAtacante && S._ultimoAtacante !== eu.target) S.minhasMortesPorTerceiro++;
            }
          }
          return origElim[i](causa);
        };
      });

      /* --- amostragem por frame --- */
      let alvoAnterior = eu.target;
      const tick = () => {
        if (!S.ativo) return;
        S.frames++;

        const vivos = P.fighters.filter((x) => x.alive).length;
        if (S.frames % 30 === 0) {
          S.arco.push({ t: +((performance.now() - S.t0) / 1000).toFixed(0), vivos });
        }

        // rota iniciada / concluída
        if (eu.comboCount === 1 && S._rotaAnterior === 0) S.combosIniciados++;
        if (S._rotaAnterior > 0 && eu.comboCount === 0 && eu.alive) S.combosConcluidos++;
        S._rotaAnterior = eu.comboCount;

        // duelo limpo com o mesmo alvo
        if (eu.target === alvoAnterior && eu.target?.alive) S.dueloAtual++;
        else { if (S.dueloAtual > 20) S.duelos.push(S.dueloAtual / 60); S.dueloAtual = 0; }
        alvoAnterior = eu.target;

        // ocioso: ninguém pra brigar por perto
        let perto = false;
        for (const f of P.fighters) {
          if (f === eu || !f.alive) continue;
          if (eu.position.distanceTo(f.position) < 12) { perto = true; break; }
        }
        if (!perto) S.framesOcioso++;

        requestAnimationFrame(tick);
      };
      S._rotaAnterior = 0;
      requestAnimationFrame(tick);
      return S;
    },

    _relatar(S, N) {
      const med = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
      const seg = (performance.now() - S.t0) / 1000;
      const dur = seg || 1;

      /* SANIDADE — o relatório tem que GRITAR quando está quebrado.
       *
       * A primeira versão deste harness reportou "2484 mortes suas" numa arena
       * com 30 vivos no fim, e eu só percebi porque o número era absurdo. Um
       * número absurdo que passa despercebido vira conclusão errada no doc.
       * Mais mortes que lutadores é impossível: acusa e para. */
      const mortesTotais = S.ringOut + S.nocaute;
      const suspeito = [];
      if (mortesTotais > N) suspeito.push(`${mortesTotais} mortes com ${N} lutadores`);
      if (S.minhasMortes > 1) suspeito.push(`jogador morreu ${S.minhasMortes}x numa partida`);

      return {
        lutadores: N,
        duracao_s: +seg.toFixed(0),
        vivosAoFim: P.fighters.filter((f) => f.alive).length,
        MEDICAO_SUSPEITA: suspeito.length ? suspeito : false,

        /* ---- 1 e 2: INTERFERÊNCIA. É aqui que um FFA morre. ---- */
        interferencia: {
          combosSeusIniciados: S.combosIniciados,
          interrompidosPorTerceiro: S.combosInterrompidosPorTerceiro,
          pctInterrompidos: S.combosIniciados
            ? +(S.combosInterrompidosPorTerceiro / S.combosIniciados * 100).toFixed(0) : 0,
          interrupcoesPorMinuto: +(S.combosInterrompidosPorTerceiro / dur * 60).toFixed(1),
          suasMortes: S.minhasMortes,
          suasMortesPorQuemNaoEraSeuAlvo: S.minhasMortesPorTerceiro,
        },

        /* ---- 3 e 4: você chega a DUELAR, ou só flutua? ---- */
        ritmo: {
          duelosLimpos: S.duelos.length,
          duracaoMediaDeDuelo_s: +med(S.duelos).toFixed(1),
          duracaoMaxDeDuelo_s: +Math.max(0, ...S.duelos).toFixed(1),
          pctTempoOcioso: +(S.framesOcioso / Math.max(1, S.frames) * 100).toFixed(1),
        },

        /* ---- 5: a IDENTIDADE do jogo ---- */
        identidade: {
          ringOut: S.ringOut,
          nocaute: S.nocaute,
          pctRingOut: (S.ringOut + S.nocaute)
            ? +(S.ringOut / (S.ringOut + S.nocaute) * 100).toFixed(0) : 0,
        },

        /* ---- 6: o ARCO da partida ---- */
        arco: S.arco.filter((_, i) => i % 4 === 0),

        /* ---- 7: dava pra ver? ---- */
        visao: {
          golpesRecebidos: S.golpesRecebidos,
          pelasCostas: S.golpesPelasCostas,
          pctPelasCostas: S.golpesRecebidos
            ? +(S.golpesPelasCostas / S.golpesRecebidos * 100).toFixed(0) : 0,
          atacantesDistintos: S.atacantesDistintos60s.size,
        },
      };
    },

    /** Janela fixa com a arena sempre cheia — mede o COMEÇO de uma partida de N. */
    async janela(segundos = 60) {
      await this._preparar({ imortal: true });
      await dorme(2500);
      const S = this._observar();
      await dorme(segundos * 1000);
      S.ativo = false;
      return this._relatar(S, P.fighters.length);
    },

    /** Partida inteira, até sobrar um (ou o teto de tempo). */
    async partida({ tetoSegundos = 180 } = {}) {
      await this._preparar({ imortal: false });
      const N = P.fighters.length;
      const S = this._observar();
      const t0 = performance.now();
      while (P.fighters.filter((f) => f.alive).length > 1
             && (performance.now() - t0) / 1000 < tetoSegundos) {
        await dorme(1000);
      }
      S.ativo = false;
      return this._relatar(S, N);
    },
  };

  window.DIVERSAO = D;
  console.info('[diversao] pronto: await DIVERSAO.partida() | await DIVERSAO.janela(60)');
})();
