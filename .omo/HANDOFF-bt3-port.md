HANDOFF CONTEXT
===============

USER REQUESTS (AS-IS)
---------------------
- "Analisa esse repo daqui: https://github.com/Melonshe/­Tenkaichi3Decomp... extrai a mecânica de combate de lá e tenta por aqui no projeto, mas adaptado pro pc..."
- "Só 2 ? tinha um monte de tarefa tu disse ? e não precisa ir abrindo o playwright não, isso vai atrasar mt, pode só fazer no escuro msm dexia que dps eu testo !!"
- "Opa, eu vou ter que desligar a maquina, faz oq tem que fazer para não perder contexto.."

(Nota: as três acima são pedidos de topo desta sessão de trabalho no BT3. A sessão
tem 598 mensagens desde 2026-10-08; os primeiros pedidos — corrigir serve.sh,
portar string aérea etc. — já estão concluídos e commitados. Se precisar deles
verbatim, refazer session_read com offset maior.)

GOAL
----
Preservar o estado do port BT3 antes do desligamento; ao voltar: revisar o diff da
branch bt3-port, recriar tools/bt3.js (harness cancelado), e deixar pronto para o
usuário testar no navegador.

WORK COMPLETED
--------------
- Criei a branch `bt3-port` a partir de `fbb16a1` (string aérea já commitada em origin/arena-obstaculos).
- Implementei o bloco `TUNING.bt3Mode` completo em `src/tuning.js` (~linhas 251-392): enabled:false (opt-in), comboScaling, behindDamageMul 1.2, hitstunTiers 30/60/90, impulseDecay 9.26 (2000 km/h/s convertido), guardDrainsKi + guardKiPerHit 2.5, vanishStep/vanishBehind, smashCharge 45f com 3 níveis, launchBaseSpeed/strength — tudo com citação de fonte (btl_char_hit.c, btl_act_e.c, btl_act_c.c, btl_tech_a.c, btl_tech_b.c).
- Adicionei `moveDefaults.strength: 0.5` em src/tuning.js.
- Deleguei 4 agents em paralelo, todos concluídos e outputs coletados:
  - bg_1fd8a3bb (deep-low, ses_ebec010c9ffehLw1OvY8o2gbgz): 8 branches do bt3Mode em src/combat/fighter.js (constructor impulse ~155/437, _releaseSmashCharge ~1340, _sGuard ~1428 guarda drena ki, doVanish ~1611, applyHit ~2488 scaling/com trás/hitstun tiers, _integrate ~2713 decay linear), src/combat/resolve.js (behind/facing ~121-133), src/combat/moves.js (normalizeMove preenche strength ~83).
  - bg_3258a92c (writing, ses_ebebf86ceffem5gPcuWlSDyRn2): seção "Modo BT3" (~125 linhas) em PORTAR-PARA-UNREAL.md, encaixe após §10.9 antes de §11.
  - bg_c7dbece4 (unspecified-low, ses_ebebbbeb8ffeapn3Vx711N25Kj): grupo "Modo BT3" no array DEBUG_SLIDERS de src/tuning.js.
  - bg_d1befbb8 (writing, ses_ebeba9653ffejuF8vuayQv5Rb9): entrada de 13 linhas em CLAUDE.md marcando bt3Mode como não validado por playtest humano.
- Validei `node --check` (via cópia .mjs em /tmp/opencode/) nos 4 arquivos .js modificados: OK.

CURRENT STATE
-------------
- Branch: `bt3-port` (local). Base: fbb16a1. NADA commitado, NADA pushado.
- git status --porcelain:
    M CLAUDE.md
    M PORTAR-PARA-UNREAL.md
    M src/combat/fighter.js
    M src/combat/moves.js
    M src/combat/resolve.js
    M src/tuning.js
    ?? .omo/
- Diff total: +480/-30 (CLI: `git diff --stat`).
- Validação sintática: PASS em todos os .js alterados. Sem validação de navegador (usuário proibiu Playwright nesta tarefa).
- tools/bt3.js NÃO existe: o harness bg_f933416f foi cancelado faltando ~10min de execução (sessão ses_ebebae357ffe34PPXsfeFvvt44, último tool: bash).

PENDING TASKS
-------------
- (do pedido de desligamento) Handoff gravado: este arquivo .omo/HANDOFF-bt3-port.md — pronto.
- Revisar o diff completo dos 8 branches bt3Mode contra o código real (eu coletei os outputs, mas não fiz revisão fina linha-a-linha do diff).
- Recriar `tools/bt3.js` — harness comparativo bt3Mode on/off no padrão de tools/escala.js e tools/diversao.js (PROTO.simular() sem render). Retomar com task(task_id="ses_ebebae357ffe34PPXsfeFvvt44") ou reescrever do zero.
- Teste manual do usuário: ./serve.sh → http://localhost:8123/?modo=duelo, ativar via painel P (grupo "Modo BT3") ou `PROTO.TUNING.bt3Mode.enabled = true`.
- Commit na bt3-port SÓ quando o usuário pedir.

KEY FILES
---------
- src/tuning.js - bloco TUNING.bt3Mode (~251-392), moveDefaults.strength, DEBUG_SLIDERS (fim do arquivo)
- src/combat/fighter.js - 6 dos 8 branches: applyHit, _sGuard, doVanish, _releaseSmashCharge, _integrate, constructor
- src/combat/resolve.js - cálculo behind/facing repassado ao applyHit
- src/combat/moves.js - normalizeMove preenche strength
- PORTAR-PARA-UNREAL.md - nova seção "Modo BT3" (conversões, fontes, o que não portou)
- CLAUDE.md - entrada concisa do bt3Mode (não validado por playtest)
- tools/escala.js / tools/diversao.js - padrão a copiar no harness tools/bt3.js pendente
- /tmp/opencode/tenkaichi3decomp/docs/systems/combat.md + src/battle/btl_act_e.c etc. - fonte das mecânicas (repo clonado localmente)

IMPORTANT DECISIONS
-------------------
- Toggle opt-in `TUNING.bt3Mode.enabled:false` — valores medidos do protótipo ficam default; BT3 real é substituição completa por branch dentro do mesmo código (não fork de arquivos).
- Conversões obrigatórias: 30fps×2=@60fps; km/h÷3.6=m/s; impulse decay 2000 km/h/s=9.26 m/s/frame@60; ki 0-100000→0-100.
- 8 mecânicas do mesmo applyHit num agent só (bg_1fd8a3bb) para evitar conflito de merge; paralelizar só por arquivos disjuntos.
- Array de sliders é `DEBUG_SLIDERS` (src/tuning.js), consumido por src/core/debugPanel.js — não existe PANEL_SETTINGS.
- `node --check` exige cópia com sufixo .mjs em /tmp/opencode/ (falha em .js por import/export).
- Bot sem Playwright não mede sensação: tudo do bt3Mode está explicitamente marcado como mecânica não jogada por humano.

EXPLICIT CONSTRAINTS
--------------------
- "não precisa ir abrindo o playwright não, isso vai atrasar mt, pode só fazer no escuro msm dexia que dps eu testo !!"
- CLAUDE.md: "Comentários e documentação em português"; "Todo arquivo tem cabeçalho explicando o porquê das decisões"; "Tempo de combate sempre em frames @60fps, nunca em segundos"; "Meça antes de opinar"; commit/push só com pedido explícito do usuário.

CONTEXT FOR CONTINUATION
------------------------
- Trabalho tudo em disco, intocado. Primeiro passo ao voltar: `git diff --stat` + revisar src/combat/fighter.js.
- Sessão de 598 mensagens (ses_ee2f6d776ffeJ2YJRuOk5UL3AW); este arquivo resume só o arco BT3 atual.
- Hook de comentário do projeto exige justificar edições de comentário ("convenção obrigatória do projeto: cabeçalho explicando o porquê").
- Contextos anteriores ainda válidos: OMO ~/.omo/omo.jsonc (exige restart do opencode); decomp clonada em /tmp/opencode/tenkaichi3decomp (branch web-port); serve em ./serve.sh → http://localhost:8123.
- Número mágico para teste rápido: `PROTO.simular(1500)` roda partidas sem render; harness bt3 deve comparar bt3Mode ligado vs desligado.
