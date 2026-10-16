# BT3-REFACTOR — blueprint do refactor completo para mecânica idêntica ao Tenkaichi 3

> **Por que este documento existe.** A tentativa anterior (toggle opt-in
> `TUNING.bt3Mode`) foi rejeitada: o pedido é remover TODA a mecânica escrita
> até aqui no branch e substituir por código único, idêntico ao BT3 real.
> Este arquivo é o contrato de decisão para essa substituição — o que sai, o
> que entra, o que não pode mudar —, extraído do decompilado
> `/tmp/opencode/tenkaichi3decomp` (z3xox/Tenkaichi3Decomp) por quatro
> explorações dedicadas (combate, dados do Goku, animação, áudio). É lido
> por agentes de implementação; cada afirmação traz `arquivo:linha` da fonte
> para conferência. Onde o decomp não responde, está marcado
> **[AUTORADO]** — número nosso, calibrado por playtest, como sempre fez o
> `tuning.js`.

---

## 1. Decisões fundadoras (lidas primeiro)

1. **Um caminho só.** Nenhum `if (bt3Mode)`. Os blocos antigos foram
   removidos da árvore (`git checkout` dos 6 arquivos + `tools/bt3.js`
   apagado; diff salvo em `/tmp/opencode/bt3mode-obsolete.diff` como
   memória, não como código).
2. **A mecânica vem do decomp; os números vêm do tuning.** O decomp entrega
   mecanismo (máquina de estados, ordem de resolução, janelas, custos
   estruturais); startup/active/recovery por golpe **não são extraíveis**
   (janela de hit é evento do arquivo de animação binário, `bobj_a.h`,
   `combat.md:319-330`) e os campos do attack record vêm de AFS ilegível
   sem a ISO (`files_and_assets.md:25`). Logo: tabelas por golpe em
   `src/tuning.js` seguem sendo **[AUTORADO]** com shape BT3 — exatamente o
   papel que o arquivo já tem por construção.
3. **Personagem único: Goku.** Kit completo (rush, smashes, grab/throw, ki
   blasts, técnicas, vanish, guarda, contador). Sem transformação/members
   (cortado como o MVP antigo, decisão idêntica). `match.opponents` segue
   em 1.
4. **Unidades** (convenção do projeto, preservada):
   - tempo: **frames @60fps** (parâmetros BT3 em “segundos” ×30
     (`btl_tech_b.h:29`) → converter para segundos → ×60);
   - ki: BT3 `0..100000` → tuning `0..100` (**÷1000**);
   - velocidade: km/h ÷ **3.6** → m/s;
   - retenção de identidade: comentários e docs em **português**.
5. **Âmbito do pedido**: mecânica/animação/sonorização. Camada de PARTIDA
   (arena encolhendo, ring-out, modos, detecção de alvo, HUD por camadas,
   bench de treino, perfis de IA) **fica como está** — é o envelope do
   jogo, não a regra de luta.
6. **ISO opcional, não bloqueante.** Se o usuário depois fornecer o caminho
   da ISO, `python3 port/tools/extract_disc.py <iso> gamedata/` permite
   extrair números reais (`gamedata/pzs3us1/%05d.bin`, índice `7+C*2+S`,
   Goku provavelmente char 0). Até lá, valores autorados e marcados.

## 2. Camadas — o que sai, o que entra, o que fica

| camada | destino | conteúdo |
|---|---|---|
| **SUBSTITUIR** | mecânica BT3 | máquina de estados por ação, cadeia de rush, smashes, guarda (9 resultados), contador, vanish, ki/gauges, grab/throw, reações/hitstun/knockback, trades/armor/prioridade, ordem de resolução de hit, blast 13-record, técnicas SoA, taxonomia de áudio, janelas de hit por evento de motion |
| **REMOVER** | invenções sem equivalente BT3 | `combo.rushChain`/`rushChainAir` (cadeia de 5+3 → 10 elos BT3), Perfect Smash (janela 18-26f → 3 níveis de carga BT3), Sonic Sway, Z-Counter como botão, vanish battle com escala 40% e teto 4 trocas, exaustão (→ fim de sparking), `pursuit` 75f (→ homing/rush do BT3), poise (→ armor/counter levels), `defenseMatrix` (→ guard results), `launch.type` (→ reaction table), air string, `chainResetFrames` |
| **FICA** | envelope do jogo + contrato | `main.js` loop fixo, câmera lock-on, arena/modos/bench/perfis, targeting/detecção, HUD (com leitura de estados derivados), `juice.*` (hitstop/tremor são apresentação — os números vêm dos mecanismos novos), `procAnim.js` (visual) + mapeador novo de motions, `assets.config.js`, `emptyCommand`/Command, `PROTO.simular`, profilers, `killProof`/regen do treino |
| **ADAPTA** | pontes | `moves.js` (loader de attack records + motions), `resolve.js` (pipeline BT3), `audio.js` (motor Web Audio fica; API vira fila por banco), `DEBUG_SLIDERS` (paths novos), `bot.js`/`hud.js` (só onde lerem campos renomeados) |

## 3. Contratos de integração que NÃO mudam

Consumidores: `src/main.js` (1765 l), `src/ai/bot.js`, `src/ui/hud.js`,
`src/core/debugPanel.js`.

```js
// fighter.js — exports e formato preservados
export const S = { IDLE:'idle', MOVE:'move', ... };   // enum de STRINGS vira
                                                     // VISÃO DERIVADA do id
                                                     // da ação BT3 (tabela
                                                     // em fighter.js); valores
                                                     // usados por bot/hud
                                                     // permanecem válidos
export function emptyCommand() { /* shape EXATO, ver README */ }
export class Fighter { constructor({ character, spawn, auraColor, name }) }

// campos lidos por bot.js hoje — expor sempre (derivados se preciso):
//   f.ki, f.state, f.target, f.health, f.move,
//   f.comboCount, f.comboCeiling, f.blockstunFrames
//   comboCount   := rush step (unkD60) + 1
//   comboCeiling := 10 (BT3: dois blocos de 5)

// resolve.js — nomes/assinaturas preservados (main.js:44-50, 1496, 1705)
resolveMelee(fighters, ctx); resolveTrade(fighters, ctx);
resolveDashImpact(fighters, ctx); resolveDashClash(fighters, ctx);
resolveOverlap(fighters);

// moves.js — nomes preservados, semântica mapeada para record/motion
initMoves(); hitstopFor(...); moveCharge(...);
// + funções novas: recordOf(atkId), motionOf(motionId), eventos da janela

// projectiles.js: ProjectileSystem, BeamSystem (reescritos por dentro)
// targeting.js: NÃO tocar (é camada de envelope)
```

`bot.js` segue lendo `emptyCommand` + `S` e preenchendo os campos
atuais (`moveX/moveY/vertical/rush/smash/blast/blastHeld/guard/vanish/dash/
charge/ultimate/smashHeld/grab/smashDir`). Se algum estado interno que a IA
leia cair em desuso (`APPROACH`, `PURSUIT`), o `bot.js` é atualizado no
pacote de integração — nunca o contrário.

## 4. Arquitetura do combate BT3 (fonte: relatório de combate)

### 4.1 Máquina de estados — protocolo exato

- **Um slot** `act.current` (id 0..0x13B, subconjunto implementado — ver
  4.6), `act.request` (troca **sempre defasada 1 frame**), fases
  **0 enter / 1 run / 2 decide / 3 leave**
  (`include/battle/btl_char_action.h:11-18`).
- Frame order (`btl_char_action.c:1164-1212`):
  `decide( atual ) → CheckForced → (se request: leave→troca→reset→enter)
   → run(novo) → UpdateGauges → UpdateTimers`.
- **`CheckForced` É a prioridade** (`btl_char_action.c:696-791`), na ordem:
  nasce `0xB` → evasões flags 0x74/75/76 → 0x6D→`0xC9` / 0x6F→`0xCA`
  (recuperação aérea) → timed guards 0x68/69/6A→`0x38` → **0x7B→`0x39`
  (contador)** → 0x6B→rebate → **`QueueReaction(unkFB0)` (hit vence quase
  tudo)** → carry/clash/transformações.
- Consequência de porte: **um hit não interrompe o atacante**; ele muda o
  DEFENSOR via reação enfileirada. Atacante só muda pelo próprio decide.

### 4.2 Rush (ação `0x44`) — sem direção no meio

- Elo `unkD60` 0..9 (**% 10**), animação `unkD60 + 0x37` (10 motions
  `0x37..0x40`); enter puxa ao oponente (`BeginRiseToOpponent`), run avança
  com blend 0.3 e levanta flag 0x40 (hit ativo); passo a **100 km/h**
  (`btl_act_a.c:323-441`, `:389`).
- Decide mask **`0x201073`**: tap (0x1) = próximo elo; **segurar rush com
  direção** (0x2) = smash carregável; 0x10/0x20 = finishers; 0x40 = grab;
  0x200000 = combo finisher.
- Cancel: só no elo final com hit registrado (flag 0x5B, progresso >0.4 →
  follow-up aéreo); flag 0x86 (vindo de follow-up) força bloco 2
  (`unkD60 >= 5`).

### 4.3 Smash — 6 direções, 3 níveis

- Carregável `0x47..0x4C`: inputs 0x35..0x38 = cima/baixo/esq/dir; **0x39
  sem direção é contextual: `0x4B` se `unkD60 < 5`, senão `0x4C`**
  (`btl_act_h_b.c:2387-2412`).
- Smash cheio `0x4D..0x52`, dash smash `0x53..0x57`.
- Carga: aproxima do alvo no startup, **cheia em 1.5 s, mínimo 0.75 s**
  (90 f / 45 f @60), flag 0x84 = lunge final (`btl_act_a.c:194-197`).
- **3 níveis por direção** = attack ids `0x13..0x21` (5 dir × fraco
  <0.3 / médio <0.99 / cheio) — substitui o Perfect Smash (`combat.md:618-643`).
  A janela de liberação passa a ser *quantidade de carga*, não frame.

### 4.4 Kit defensivo — os 9 resultados da guarda

`BtlHit_CheckGuard` (`btl_char_hit.c:665+`) exige lutador livre; golpe por
costas **não é guardado** (exceto kind 6). `BtlHit_ApplyGuard` (`:187-241`,
`tabela em btl_char_hit.h:27-36`):

| # | resultado | efeito |
|---|---|---|
| 0 | PLAIN | guarda comum |
| 1 | FLAG40 | só contra golpes id < 0xB |
| 2–4 | TIMED_A/B/C | janelas de timed guard (flags 0x68–0x6A; exigem atk flag 0x10) |
| 5 | KI | guarda que consome/gasta ki (`unkD80`, teto 100000); ki no fim → colapso (`0xEA`) |
| 6 | PUSH | empurra atacante + meio stock de blast |
| 7 | PUSH_STOP | PUSH + hit-stop + voz 0x12 |
| 8 | COUNTER | contador por nível → flag 0x7B → ação `0x39`, **sem chip** |

- **Contador** (`btl_act_c.c:909`): golpe escolhido por
  `(nível def + nível atk) % 3` → 0x89/0x8A/0x8B (`btl_act_j.c:1196-1209`)
  — determinístico, o lado não escolhe.
- **Vanishing step** `0x20..0x23` (`btl_act_e.c:468`): **7 frames**,
  invulnerável (flags 0x42–0x46), 4 direções; custo **10 ki**
  (`10000/1000`); vanish behind `0x24` custa **20 ki**; variants de strike
  `0x2B..0x2E`. Ability 0x23 corta custo pela metade, 0x24 zera.
- **Grab/throw** `0xB4..0xBC` (`btl_act_h.c:48+`): dash de grab com hit
  confirm (flag 0x5B) ou falha (0x7A); guarda **não responde a grab**
  (`btl_char_hit.c:346+`); escape via nível (`CheckThrowBreak :759`).
  Durante o rush, bit 0x40 da mask permite grab emendado.

### 4.5 Ki, reações, knockback, trades

- **Gauges** (`btl_char_action.c:804-956`): bloqueados por hit-stop/fora de
  luta; ki carrega com motion flag 0x10000 (regen abaixo de
  `KiRegenLimit`; charge sustentado ×4); blast gauge com flag 0x20000;
  **sparking** entra com ki cheio + blast 100000 (anim 0x36) e **drena por
  frame até esvaziar** — é o fim em si, sem estado de exaustão à parte.
- **Reações** (`btl_act_j.c:719-726`): tabela reação→ação; stun tiers
  **15/30/45 frames** (0xD3 em pé, 0xE0 aéreo); hit repetido (count ≥ 2 em
  reações 5–13…) vira reação 0x10 (gira na direção do hit); morto → 0xF.
- **Knockback/lançamento** (velocidades reais, ÷3.6 no tuning):
  - `0xD4` knockback: **700 km/h**, duração `unkFC8×15` f, deflete na
    borda da stage (`btl_act_a.c:3056+`);
  - `0xCE` lançado: sobe **1200 km/h**, cai 1000 km/h, recuperação a
    partir do **frame 9** (`:2828+`);
  - blowaway `0xD5/0xD6/0xDF`: **50/15/32 frames** a **1000/2000/2000
    km/h**; mash-out = **4 + 12×(fraqueza)** apertadas (`:~2940-3055`).
- **Ordem de resolução por frame** (`btl_char_hit.h:8-18`):
  `BeginFrame → CheckClash → CheckRush → CheckProximityAll → TestHit
   → ResolveTrades → ApplyHit`.
  - TestHit: janela aberta por **evento do motion** + teste geométrico por
    frame + facing 90° (`btl_char_hit.c:1029+`).
  - **Trades** (`:1072-1106`): prioridade maior atravessa; igual, **ambos
    cancelam** (fx 0x22, shake 2.0/0.3).
  - **Armor** (`:641`): flag 0x200 de anim + atk flag 2 → ignorado;
    `armorIgnore` no record apaga níveis.
  - Dano de costas: **+20%** (`dmg + dmg/5`, `:1366-1370`).
  - **Hit-stop**: canais `stopLen/stopDelay` (`btl_char_hit.h:152-153`) —
    clash mesmo tipo **6 f**, misto **2 f**; guard results 7/8;
    flags 0x125 (nível 2) / 0x126 (nível 1) para técnicas
    (`btl_act_f.c:188+`). Congelado pula TODAS as fases, inclusive input.
- **Ki blasts** (`btl_act_c.c:1312+`): 13 records (`btl_tech_b.h:42-49`),
  kinds 0/4/8 = sem carga, 1–3/5–7/9–11 = 3 níveis de carga, 12 = volley;
  timer de **30 f** entre rajadas; mira ±36° com lock.
- **Técnicas**: pose `0x105` com hit-stop nível 2; ações `0x106..0x11A`
  (beam etc.); dados SoA `BtlSuperData` (`btl_tech_b.h:110-163`).

### 4.6 Subconjunto de ações a implementar (MVP Goku)

Do universo `0..0x13B`, o port implementa o kit que o protótipo já
oferecia + os equivalentes BT3 acima:

`0xB` idle chão · `0x26` idle voo · `0x14/0x16` voo · passos/dash
(`0x17..0x1F` conforme `btl_act_e.c`) · `0x44` rush · `0x47..0x4C`
smash carregável · `0x4D..0x52` smash cheio · `0x53..0x57` dash smash ·
`0x20..0x23` vanish step · `0x24` vanish behind · `0x2B..0x2E` vanish
strike · `0x38` guarda · `0x39` contador · `0x3B/0x3D` rebate ·
`0x37` carga ki/sparking · `0xAE/0xAF` ki blast · `0x95` volley ·
`0xB4..0xBC` grab/throw · `0xC9/0xCA` recuperação aérea · `0xD3` stun ·
`0xD4` knockback · `0xD5/0xD6/0xDF` blowaway · `0xCE` lançado ·
`0xE0` stun aéreo · `0xE6` recuperação de voo · `0x105` pose de técnica ·
`0x106..0x11A` feixes (subconjunto do kit Goku) · `0x130..0x132` clash.
Fora do subconjunto: members/troca, fusão, transformações, story.

## 5. Shape dos dados em `src/tuning.js`

Seções novas (substituem `moves`/`combo`/`defenseMatrix`/`launch`/
`smashCharge`/`pursuit`/`homing`/`rushApproach`; preservam todas as outras
seções: `sim, flight, dragonDash, ki, maxPower, physics, fighter, ai,
arena, match, camera, juice, audio, healthBar, …`):

```js
TUNING.bt3 = {
  records: {            // attack records — shape BtlAtkRecord 0x30 B
    // atkId: { flags, damage, guardDamage, guardKi, kiGain, pushHit,
    //   pushGuard, launchSpeed, launchA, launchB, shakePower, shakeTime,
    //   react, reactB/D/E/C, hitFx, hitSound, voice, priority,
    //   guardB/C/A/E, guardFlagSel, armorIgnore }
    // cobre: rush ids 0..10, smash 0x13..0x21, throws 0x55/0x56,
    // finishers, técnicas (via BtlSuperData equivalent)
    // TODOS os números [AUTORADO] até ISO; shape idêntico ao decomp
    // (btl_tech_a.h:59-96)
  },
  motions: {            // motionId → visual + eventos (substitui
                        // startup/active/recovery como fonte da janela)
    // 0x37: { clip: 'attack_light_1', durationFrames,
    //         events: [{frame, type:'hitBegin'}, {frame, type:'hitEnd'},
    //                  {frame, type:'swing'}, ...] }
    // event types espelham os canais do BT3: hitBegin/hitEnd (janela,
    // bobj_a.h), swing (whoosh, fx event 2), impactLight/impactHeavy
    // (0x100/0x80), kiFire (event 4), vibrate(45), shake(46)
  },
  guardResults: { /* 9 entradas com efeitos (stopLen, ki, flags) */ },
  reactions: { /* reactionId → { action, stunFrames? } — tabela
                  btl_act_j.c:719-726 aplicável */ },
  gauges: { kiRecoverRate, kiRegenRate, kiRegenLimit, blastGain,
            maxPowerDrainPerFrame, chargeRate, /* … */ },
  vanish: { stepFrames: 7, stepKi: 10, behindKi: 20 },
  chargeSmash: { fullFrames: 90, minFrames: 45 },   // 1.5s / 0.75s @60
  clash: { sameStop: 6, mixedStop: 2 },
  stunTiers: [15, 30, 45],
  blowaway: [ {frames:50, speed:277.8}, {frames:15, speed:555.6},
              {frames:32, speed:555.6} ],           // 1000/2000/2000 km/h
  knockback: { speed:194.4 },                       // 700 km/h
  launched: { up:333.3, down:277.8, recoverFromFrame:9 },
  mashOut: { base:4, perWeakness:12 },
  kiBlasts: { /* 13 records shape BtlKiBlastData 0x34 B */ },
  supers:  { /* SoA 3 slots shape BtlSuperData */ },
}
```

- `DEBUG_SLIDERS` reescrito para os paths novos (mesmo formato
  `[path, min, max, step, label]` + `__group`), preservando os grupos de
  UX que fazem sentido (smash/ring-out, impacto, guarda…).
- `getTuning/setTuning/F` permanecem (debugPanel depende).

### 5.1 Campos lidos pelo código que fica

`moves.*` antigo é substituído por `records`+`motions`; onde `main.js` ou
`juice` pedirem “hitstop do golpe”, `hitstopFor()` passa a derivar do
record (prioridade/guard/clash) + `juice.hitstopScale` continua sendo o
gain de apresentação.

## 6. Áudio — taxonomia BT3, motor sintetizado

Fonte: relatório de áudio (`btl_char_flag_snd.c`, `audio.md`). O motor Web
Audio (buses, `_tom`, `_ruido`, ganho posicional) **fica**; a API pública é
reorganizada para a fila BT3:

- **Fila por frame**: máx. **4 requests de lutador/frame** e **32 comandos
  de som/frame**; o resto descarta (`btl_char_flag_snd.c:91-109`,
  `snd.c:156-159`).
- **Bancos** (kind → grupo): comum (impacts/whoosh/steps), banco 8
  (objetos), **voz por lado** (grunhados, samples), stream SE (linhas
  longas), voz streamed (`kind ≥ 15`).
- **Hit kinds 0–4** (`btl_char_coll_b.c:342-382`): kind 0 = só voz; 1 = SE
  0x11/0x1B + voz 0; 2 = 0x47 + voz 1; 3 = 0x4A + voz 3; 4 = 0x12 + voz 3.
- **Whoosh**: evento 2 do motion → nível (`btl_char_fx.c:127-150`) →
  samples 0/1 (níveis 1–4), 6/7/8, 0x28/0x29/0x2A.
- **Impacto do motion**: `0x100` leve (SE 2/3, shake 5/0.1s), `0x80`
  pesado (SE 0x49, shake 10/0.2s) + **voz kind 1 da vítima**
  (`btl_char_fx_c.c:92-167`).
- **Guarda bloqueia o grunhado**: chamadas com `chr=NULL` → SE só;
  limpo = SE + voz. Essa é a diferença sonora entre aparou/aceitou.
- Outros gatilhos por id: carga 0x15 (start) / 0x16 (loop) / 0x17 (max
  power), dash 0x1C/0x1D, smash 0x2E/0x2F, step/vanish 0x1F/0x20/0x21,
  clash 0x4F+0x4B, throw 0x44, deflect 0xC/0xD/0x13/0x14 + voz 0xB.
- **Vozes**: 57 kinds, cooldown por kind (`interval×30` f), anti-repetição;
  kind < 15 = sample curto, ≥ 15 = linha streamed; flag 0x129 silencia.
- **Mix**: vol cai linear com near=200/far=1500, pan por seno do ângulo;
  4 one-shots + 4 loops rastreados **por lado**; loops precisam ser
  re-pedidos por frame e param sozinhos; **não há corte cruzado** entre
  whoosh/impacto/voz — todos do mesmo hit tocam juntos.
- `sfx.*` legado em `main.js` (juice/sinais) mantém fachada, apontando
  para os métodos novos; call sites em `combat/` passam a emitir
  **eventos BT3** (kind/bank/id), não “acerto({peso})”.
- Timbres continuam sintetizados (placeholder consciente). **[OPCIONAL]**
  samples reais se vier a ISO (ADX: `0x8D4E + chara*100 + line`).

## 7. Animação — motion events + poses procedurais

- **Janela de hit vem do motion, não de `startup/active/recovery`.**
  O BT3 abre/fecha por evento (`bobj_a.h:13-37`; teste no intervalo
  `(prevFrame, frame]`, `bobj_a.c:594-709`) e TestHit roda o teste
  geométrico enquanto aberta. No port: `TUNING.bt3.motions[id].events`.
- `resolve.js` monta volumes a partir dos **sockets da pose atual**
  (`hand_r`, `foot_l`… que o `procAnim` já anima) durante a janela —
  igual `BtlObjHit_BuildVolumes` por matriz de nó (`bobj_a.c:1231+`).
- **Pose por motion**: mapear cada motion id do kit a um clip
  procedural existente ou novo (`procAnim.js` exports
  `getProceduralClips()/PROCEDURAL_CLIP_NAMES`; chamada via
  `char.play(clip, {fade})`). Tabela de mapeamento mora junto de
  `TUNING.bt3.motions` (design que sobrevive ao port: é dado, não código).
- Hitstop/slow-mo: mantém `juice.*` como camada de apresentação acima do
  `stopLen` de mecânica (o mundo congela por mecânica; a câmera/luz
  responde por juice). Câmera lenta segue DESLIGADA (`slowMoEnabled:false`)
  — restrição de rede já paga.

## 8. Pacotes de trabalho (ordem de delegação)

| # | pacote | arquivo(s) | depende de |
|---|---|---|---|
| WP1 | tabelas BT3 (records/motions/guard/reactions/gauges/blasts/supers + sliders) | `src/tuning.js` | — |
| WP2 | núcleo de combate: máquina de estados + pipeline de hit + loader de records | `src/combat/fighter.js`, `resolve.js`, `moves.js` | WP1 |
| WP3 | projéteis/técnicas no shape novo | `src/combat/projectiles.js` | WP1 |
| WP4 | áudio na taxonomia BT3 | `src/core/audio.js` | — (indep.) |
| WP5 | poses: mapeador motion→clip + poses novas | `src/assets/procAnim.js` (+ dados do motion) | WP1 |
| WP6 | integração: `main.js`, `bot.js`, `hud.js`, `debugPanel.js`, docs (`CLAUDE.md`/`PORTAR`) | esses | WP2–5 |
| WP7 | validação | — | WP6 |

WP1 primeiro (é o contrato). WP2/WP3/WP4/WP5 em paralelo. WP6 e WP7
sequenciais no fim.

## 9. Validação

1. `node --check` via cópias `.mjs` em `/tmp/opencode/bt3check/`
   (o projeto não tem `"type":"module"` no package.json).
2. Harness sem render: `PROTO.simular(…)` — luta resolve, sem NaN, bots
   brigam, guarda/rush/smash/vanish acontecem (instrumentar contadores).
3. **Teste manual no navegador pelo usuário** — sem Playwright (pedido
   explícito: “dps eu testo”). Checklist mínimo a entregar: rush de 10
   elos, smash em 4 direções + 3 níveis de carga, guarda com 9 saídas
   visíveis (inclusive contador), vanish 7f, ki blast, grab/throw,
   blowaway com mash-out, sparking sem exaustão à parte, sons de
   impacto/whoosh/voz no lugar certo.

## 10. Riscos e abertos

- **`unkD80` (guard ki)**: leitura do decomp sugere reservatório 0..100000
  que drena 400/f durante guarda e é reabastecido por resultados
  (`btl_char_action.c:902`, `btl_char_hit.c:234-238`) — confirmar no
  código do WP2 contra `btl_char_hit.h:128` antes de fechar a guarda;
  é o substituto da `guardStamina` atual.
- **Números do Goku autorados** até ISO: dano/duração serão primeiras
  hipóteses; marcar no tuning e no handoff.
- **Fighter.js é 3010 linhas de reescrita** — o risco real é regressão de
  integração (campos que bot/hud leem). Mitigação: contrato §3 + WP6
  dedicado + harness.
- O handoff antigo `.omo/HANDOFF-bt3-port.md` descreve a abordagem de
  toggle e está **superado por este documento**.
