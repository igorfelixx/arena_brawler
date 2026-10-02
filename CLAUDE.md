# arena-proto — leia isto antes de qualquer coisa

Protótipo jogável de combate aéreo estilo **Budokai Tenkaichi 3**, em three.js,
com arena que encolhe e vitória por ring-out.

## ⚠️ Contexto obrigatório

**Antes de responder qualquer pergunta sobre este projeto, leia
[`PORTAR-PARA-UNREAL.md`](./PORTAR-PARA-UNREAL.md).**

Ele é o documento de passagem: contém o design completo do combate, as decisões
tomadas e o *porquê* de cada uma, as armadilhas já pagas, e o plano de porte.
O projeto foi construído numa sessão anterior e esse arquivo existe justamente
para que o contexto não se perca.

Sem ler esse arquivo você vai sugerir coisas que já foram consideradas e
descartadas por motivo.

## O essencial em 30 segundos

- **O código three.js é DESCARTÁVEL por construção.** Não é dívida técnica.
  O protótipo existe para descobrir os números do combate antes de portar pra
  Unreal, e para o dono do projeto sentir o jogo antes de comprar assets.
- **`src/tuning.js` é o produto real.** Todo o frame data em frames @60fps.
  É o que vira `UDataTable` no Unreal. Trate esse arquivo com cuidado.
- **`assets.config.js` é a fronteira de asset.** Trocar o personagem placeholder
  por um do Mixamo é mudar uma linha. Não quebre isso.
- Rodar: `./serve.sh` → http://localhost:8123 (não abra o `index.html` direto —
  CORS bloqueia módulos ES).

## Contexto sobre o dono do projeto

Tem pouca experiência com programação e 3D. Prefira soluções que evitem
reinventar a roda (assets prontos, samples da Epic, frameworks existentes) e
explique o *porquê* das recomendações, não só o *o quê*.

Ele não tinha Unreal instalado quando o protótipo foi feito — confirme antes de
assumir que tem.

## Estado atual

Tudo abaixo foi verificado rodando no navegador (ver seção 2 do doc de passagem
para os números):

- voo 360°, Dragon Dash (perseguir / fugir / contornar, com tromba que para)
- **rush direcional**: `J`+direção escolhe o golpe (direita / esquerda / gancho
  pra cima / chute pra baixo). Qualquer elo emenda em qualquer outro, teto de 6
- smash nas 3 direções, blowaway, ring-out
- vanish, guarda direcional, guard break, step, recuperação aérea
- ki blasts, feixe de ultimate
- **mira por direção** (`src/combat/targeting.js`): com lock solto, cada golpe
  escolhe alvo pela direção apontada — dá pra trocar de vítima no meio do combo.
  `Q` cicla alvo, `E` solta/retoma o lock
- **vários lutadores** (`match.opponents`): IAs brigam entre si, não só com você.
  **Está em 1 de propósito** — o MVP a validar é o duelo; subir é uma linha
- **bancada de treino** (`T` cicla, `G` recoloca): NORMAL / PARADO / GUARDA /
  SEM REAÇÃO / KNOCKBACK / RECUPERAÇÃO. Boneco reage, não morre e volta sozinho
- **perseguição** (`Shift` na janela): lançou → 75 frames pra decidir ir atrás.
  Cancela o recovery do smash, custa ki, e alcançar dá **rota nova**
- **perfis de IA** (`B` cicla): EQUILIBRADO / PRESSÃO / DEFESA / BORDA /
  AGRESSIVO / EVASIVO — servem pra testar o sistema contra estilos diferentes
- **telemetria ao vivo** (`H`): frame do golpe, janela de cancelamento,
  blockstun, estamina de guarda, distância à borda e **vantagem em frames**
- IA com punição de recovery baseada em frame data real

### Passada BT3-like (branch `combate-bt3-like`)

Tudo abaixo foi medido no navegador com `window.PROTO` (números na seção 13 do
doc de passagem):

- **smash carregável + PERFECT SMASH**: segurar `K` congela o golpe no startup;
  soltar na janela (18–26f de carga) dá ×1,55 de dano e ×1,45 de empurrão.
  Fora da janela o golpe é **exatamente** o smash normal — segurar não paga
  dano, paga *controle do tempo do impacto*
- **três tipos de perseguição**: `Shift` direta (barata, dá rota nova, pode
  errar) · `Shift+V` vanish (caríssima, infalível, sem rota) · `Shift+K` alta
  velocidade (spike automático que re-lança; recovery de 26f se errar)
- **grab / arremesso** (`F+J`): passa pela guarda, perde pro escape (`F` na
  janela, exige TOQUE novo), perde de qualquer golpe (prioridade 0)
- **vanish battle**: quem é vanishado tem 12f pra contra-vanishar; custo escala
  40% por troca, teto de 4 trocas com punição no último
- **Max Power**: entra carregando ki acima de 78 por 26f; 7 s de ×1,20 de dano e
  ki 35% mais barato, e **termina em exaustão** — que é o counterplay
- **exaustão**: zerar o ki tranca *todas* as ferramentas de ki por 90f
- **launch system**: `launch.type` (`hitstun`/`blowaway`/`slam`) separado de
  "acerto"; só blowaway e slam abrem perseguição
- **prioridade e trades**: dois golpes ativos no mesmo frame — igual = clash,
  diferente = o mais comprometido atravessa
- **matriz de defesa em dados** (`TUNING.defenseMatrix`): é ela que faz a guarda
  não responder a grab, e permite golpe que fura Sonic Sway
- **hitstop por categoria** (guarda < normal < counter < pesado < lançamento <
  perfect), em vez de número solto por golpe

Não implementado: **áudio**, **rede**, troca de alvo por gamepad no ciclo,
**personagens/movesets múltiplos** (cortado do MVP de propósito — um lutador só).

### O loop de combate (reconstruído — leia antes de mexer no J)

O protótipo tinha uma ESTEIRA de combo. Agora tem uma ROTA com fim e uma
segunda disputa depois do lançamento:

```
NEUTRO → aproximar → ROTA (até 4 elos) → ENDER (smash) → LANÇAMENTO
                          │                                   ↓
                     esgotou? só                    ╔═ PERSEGUIR (Shift) ═╗
                     ender/reposicionar             ║ custa ki · 75f      ║
                          ↓                         ╚═════════╤═══════════╝
                       NEUTRO                    alcançou → voa JUNTO 18f
                     (0,6 s sem J)                        → ROTA NOVA
```

Quatro regras que sustentam isso, e que **não podem ser desfeitas por engano**:

1. `combo.maxChain` vale **inclusive vindo da IDLE**. Antes só valia dentro do
   estado de ataque, e bastava deixar o golpe terminar pra recomeçar do zero.
2. A rota só zera por TEMPO (`chainResetFrames`) ou por um **ender acertado**.
3. Quebra de poise tem impulso PRÓPRIO (`poiseBreakKnockback`) — antes ela
   herdava os 1,8 m/s do rush e o blowaway acabava em 4 frames.
4. `homing.maxPull` limita o quanto um golpe te puxa. Antes puxava 3,1 m de
   uma vez: era o "boneco gruda".

### O kit defensivo — cinco ferramentas, cinco papéis

Nenhuma duplica a outra. Se uma parecer redundante, é sinal de que algum
número saiu do lugar:

| ferramenta | entrada | custo | timing | recompensa |
|---|---|---|---|---|
| Guarda | segurar F | estamina + ki/hit | nenhum | absorve; **+8 frames** |
| **Sonic Sway** | F+direção **antes** | grátis (cooldown) | antecipar | evade, devolve ki e **rota nova** |
| **Z-Counter** | **tocar** F no impacto | 12 ki | ~4 frames | **stun de 34f no atacante** |
| Vanish | V na janela | 20 ki, escalando | 9–14 frames | reaparece **atrás** |
| **Escape de grab** | **tocar** F agarrado | 6 ki | 12 frames | **stun de 30f no atacante** |

O botão `F` tem **quatro** significados conforme o timing, e isso é deliberado:
é profundidade sem tecla nova (§29). Segurar absorve; tocar no impacto
contra-ataca; tocar agarrado escapa; tocar perto de um blast rebate.

**Regra que vale pra todos os "tocar":** exige o EDGE, nunca o botão segurado.
O escape de grab nasceu errado nisso — com `cmd.guard` ele saía no primeiro
frame da pegada sempre que a vítima já estivesse de guarda, ou seja, quem fazia
turtle escapava de graça. Exatamente a pessoa contra quem o grab existe.

### O eixo anti-guarda — duas respostas, não uma

A medição que motivou o grab: contra quem martela, o perfil DEFESA passa 37% do
tempo em guarda e ainda leva 88 golpes limpos contra 32 aparados. O ataque tinha
UMA resposta à guarda — o smash, lento e telegrafado.

| contra a guarda | como abre | preço de errar |
|---|---|---|
| Smash | quebra na hora (ring-out) | recovery 24f |
| **Perfect Smash** | fura mesmo sem `guardBreak` | janela de 9f pra acertar |
| **Grab** | a guarda não responde | recovery 26f + escape devolve 30f de stun |

Propriedade que emerge do frame data e que vale preservar: contra um rush
(startup 4) o Z-Counter é **antecipação**; contra um smash (startup 13) dá
tempo de **reagir**. Não foi desenhado — saiu da tabela, e é o que faz o golpe
lento ser arriscado de verdade.

**O Z-Counter só sai de pé** (`canAct`, sem blockstun). Escapar de um combo em
andamento é trabalho do vanish, que custa ki e escala. Medido: martelando F sob
pressão contínua por 10 s, saem 3 contras — e todos nas brechas entre rotas.

### O eixo ataque ↔ defesa (revisto e medido)

Três resultados distintos de um golpe, e é a distinção que cria turnos:

| resultado | emenda o combo? | consequência |
|---|---|---|
| acertou | sim | o combo flui — piso baixo |
| **bloqueou** | **não** (`combo.cancelOnBlock: false`) | atacante come o recovery; **defensor fica +8 frames** |
| errou | não | recovery inteiro, punição |

Defender tem relógio: `guardStamina` drena por tempo e por golpe aparado.
Existem **duas quebras de guarda, com papéis diferentes** — por SMASH manda pra
fora (ring-out), por EXAUSTÃO deixa exposto em pé (pressão). Medido no
navegador: 7 golpes aparados esgotam a guarda; **1 smash abre na hora**.

### Pendências conhecidas — pergunte ao dono antes de assumir

1. ~~**Escala.**~~ **MEDIDA.** `?n=2|4|8|16` na URL; harness em `tools/escala.js`,
   medidor em `src/core/profiler.js` (separa SIMULAÇÃO de RENDER — só a primeira
   é comparável entre máquinas). Resultado: a simulação escala **linear**, não
   quadrática — 16 lutadores custam **1,31 ms** de média (p95 4,5 = 27% do
   orçamento de um frame). Os laços N² são irrelevantes (`melee` 0,05 ms).
   32 lutadores devem caber. **O gargalo não é a CPU da simulação.**

   O que ERA o gargalo: o **hitstop global**. Com 16, o jogo passava 77% do tempo
   congelado e rodava 0,2 passo de simulação por frame — parado, não lento.
   Corrigido com `juice.hitstopScope` (padrão `player`): os dois corpos da troca
   congelam sempre, a tela só congela se você for um deles. Em 1×1 é idêntico ao
   comportamento validado. Ver armadilha 8.31 do doc de passagem.

   **Ainda desconhecido:** o teto de RENDER na máquina dele. Aqui é rasterizado
   por software e o número não vale. É a única medição de escala que falta, e só
   ele pode fazer.
2. **Martelar botão AINDA GANHA — e a causa medida não é a que se supunha.**
   `combo.cancelOnBlock: false` foi implementado e faz o que promete (o
   defensor sai +8 frames), mas medindo o saldo de martelar por 45 s contra
   cada perfil, ele quase não mudou:

   | perfil | martelando, antes → agora |
   |---|---|
   | EQUILIBRADO | +278 → +283 |
   | **PRESSÃO** | **+283 → −272** |
   | DEFESA | +253 → +232 |
   | AGRESSIVO | +294 → +184 |
   | EVASIVO | +282 → +255 |

   O que a medição mostra: a regra do bloqueio é **inerte porque o bot mal
   bloqueia**. Contra quem martela, o perfil DEFESA passa 37% do tempo em
   guarda e mesmo assim leva **88 golpes limpos contra 32 aparados**. O único
   perfil que pune martelada é o PRESSÃO — que não se defende, **revida**.

   Hipótese a testar (NÃO implementada de propósito — ver seção 8.16 do doc de
   passagem, onde duas tentativas de consertar isso mexendo na IA pioraram):
   o gargalo é `ai.guardHoldFrames`, quanto tempo a IA SUSTENTA a decisão de
   bloquear. Está no painel (`P`). **Mas bot roteirizado não mede profundidade
   — isto precisa de playtest humano antes de virar mudança.**
3. **As rotas direcionais** (gancho/chute) nunca foram julgadas por humano: não
   se sabe se levantam/cravam o tanto certo.

3b. **Tudo da passada BT3-like funciona MECANICAMENTE e nada foi jogado por
   humano.** A distinção importa neste projeto: `cancelOnBlock` já fez
   exatamente o que prometia e ficou inerte. Ver seção 11 do doc de passagem
   para a lista completa; os três maiores riscos:

   - a **direta** pode dominar as outras duas perseguições (é a única que dá
     rota nova)
   - o **grab** pode ser opressivo contra quem não sabe que o escape existe
   - o **Max Power** pode simplesmente não compensar (22 de ki + ficar parado +
     exaustão no fim, por 7 s de ×1,20)

3c. **`armor` está implementado e em ZERO em todos os golpes.** É alavanca
   disponível, não mecânica em uso — não foi testada. Idem os **trades**:
   funcionam, mas só quando os dois golpes ficam ativos no MESMO frame
   (janela de ~1 frame), então são raros por construção.

3d. **A IA quase não acende o Max Power** e **nunca exercitou grab nem vanish
   battle** contra o jogador (o grab exige o adversário de guarda; a vanish
   battle exige que ele vanishe). Ver armadilha 8.29.
4. **Os números novos da guarda** (`staminaPerHit: 13`, `breakStunFrames: 42`,
   `blockstun` agora vivo) nunca foram jogados por humano. 7 golpes pra esgotar
   é um palpite coerente, não um valor validado.

5. **Com 16 lutadores NÃO vira bagunça** (medido, arena cheia 30 s): alvo a
   1,9 m de mediana, 705 px na tela, 2,4 outros lutadores num raio de 30 m, e
   apenas **0,5% do tempo com dois atacantes em cima de você** (nunca três). O
   medo registrado na seção 11 — "o que acontece quando três pessoas te combam
   ao mesmo tempo" — não se materializou com a IA atual. Com humanos, aberto.

   Sinal de balanceamento a olhar: numa partida de 16, **4 eliminações por
   ring-out contra 8 por nocaute**. Pra um jogo cuja identidade é o ring-out,
   a proporção está invertida.

**Não validado por playtest:** a maior parte dos números de `src/tuning.js`.
Ver seção 11 do documento de passagem antes de tratá-los como verdade.

## Modos de partida (branch `modo-arena-partida-longa`)

Abrir a raiz (`http://localhost:8123/`) mostra um **menu** com os dois modos.
Com `?modo=` na URL o menu é pulado e o jogo entra direto — é isso que mantém
`tools/escala.js` e `tools/diversao.js` funcionando sem saber que há menu.

- `?modo=duelo` (padrão) — 1×1. **Não sobrescreve nenhum número.** É o MVP
  validado e a única base de comparação do projeto.
- `?modo=arena&n=30` — 20–30 jogadores, cronograma de fases (INÍCIO → MEIO →
  CONFRONTO → FINAL → CLÍMAX). Regeneração e recuo da IA existem mas estão em ZERO.
- `PROTO.simular(1500, { ateSobrar: 1 })` — roda a simulação sem render. Uma
  partida de 30 min leva segundos. É o que torna ajustar ritmo viável.

**Combate rebalanceado (vida 100 → 900).** O 1×1 durava 14,5 s; agora dura
~2 min. O dano NÃO foi tocado — só a razão vida/dano importa, e manter o dano
intacto preserva o significado de cada número. Junto vieram: 4 s fora da arena
antes de eliminar (era 0,8 s) e recuperação aérea barata (ki 10 → 4), que foi o
maior salto isolado de duração.

Preservado e verificado: poise, guarda (7 golpes), knockback (46,1), frame data.
Custo registrado: uma rota inteira tira só 4% da barra — se o golpe "não sentir"
no playtest, o conserto é a BARRA mostrar melhor o dano, não baixar a vida.

Efeito desejado: ring-out virou caminho de vitória de igual peso (era 0/8, agora
~5/10). Com 30 jogadores a partida passou de 1,2 min para **~5 min**, e isso
EMERGIU do combate — regeneração de vida e recuo da IA estão em ZERO (eram
curativo que mascarava o TTK baixo, e foram vetados com razão).

### Fugir da briga — limite de detecção (`targeting.detectionRange`)

Medido: os lutadores passavam **74–77% do tempo em combate, e esse número não se
movia** — testado com 30 e 84 pessoas, em arenas de raio 70 a 245 (12× mais área
por cabeça). Aumentar a arena só destruía o ring-out (29% → 9%).

A causa era não haver limite de INFORMAÇÃO: `nearestEnemy` varria a lista
inteira, então todo mundo sempre sabia onde estava o mais próximo e ia atrás.
Dava pra correr, não dava pra SUMIR.

Com detecção (24 m pra achar, 38 m pra perder) + arena maior, afastar-se passa a
encerrar a briga. `target` pode ser `null`, e isso é um estado legítimo: estar
fora de combate. A IA tem comportamento próprio pra ele (`_foraDeCombate`:
recompor ki, evitar a borda, derivar devagar).

⚠️ **Restrição obrigatória:** `2 × raio da última fase < loseTargetRange`.
Medido: com arena final de 25 m e visão de 38 m, dois sobreviventes se evitam
pra sempre — **mediana de 149 minutos sem vencedor**. Com 17 m, 5,8 min.
`matchMode.aplicar()` confere e avisa no console.

Resultado com a restrição satisfeita: ~6 min, 35% ring-out, **10% do tempo fora
de combate** (era 0%). O trade-off é explícito — mais folga tática exige arena
maior, e arena maior aproxima o risco de a partida não terminar.

### Duração: ~25 min (medido 25,0 / 25,7 / 24,8)

O cronograma de fases vai de **raio 300 m a 10 m em 26 minutos**. O arco não é
uma regra extra — cai da geometria, porque o nº de vizinhos dentro do alcance de
detecção é `N × (detecção/raio)²`:

| raio | vizinhos no alcance | |
|---|---|---|
| 300 m | 0,19 | quase sempre sozinho |
| 160 m | 0,68 | encontros intermitentes |
| 95 m | 1,9 | briga frequente |
| 10 m | todos | ninguém se evita |

**Ring-out NÃO é meta.** Medido nas três partidas: 21%, 34% e 48% — varia
sozinho, e isso é correto. É um recurso tático (ficar perto da borda com pouca
vida pra empurrar quem vier), não uma cota a bater.

⚠️ **Ainda não resolvido: o arco de ENGAJAMENTO é plano** (27/24/28/15/12% por
faixa de 5 min) e as mortes são concentradas no início (7/15/3/2/2). A duração e
a variância estão certas; "começa calmo e esquenta" ainda não.

### Barra de vida em camadas (`healthBar`)

Resolve o custo registrado da vida 900: uma rota inteira tira 4% da barra e some.

A barra mostra **uma camada por vez, cheia** (estilo Naruto Storm): a largura
total vale 180 de vida em vez de 900, então o mesmo rush move **2,8% em vez de
0,56%**. Quando a camada esvazia, a barra **enche de novo com outra cor** — é
nesse instante que o jogador sente que arrancou algo inteiro.

Os pontinhos abaixo da barra preservam a leitura do TOTAL; sem eles a primeira
camada e a última pareceriam iguais. Verificado: 81% de vida → barra em 5%;
80% → barra em 100% com cor nova e um pip a menos.

Puramente visual — nenhum número de combate muda.

### Sem câmera lenta · lock-on que solta sozinho

- **Câmera lenta desligada** (`juice.slowMoEnabled: false`): ela desacelera o
  MUNDO, então em multiplayer a briga dos outros travava a sua. Não existe em
  rede. Armadilha 8.36.
- **Lock-on sem alvo solta sozinho** (como apertar E), e E não religa sem
  ninguém no alcance. Antes a câmera ficava presa. Armadilha 8.37.
- **Detecção só no modo arena** (`targeting.detectionEnabled` 0 na base): o
  duelo herdava e começava com os dois sem se enxergar (nascem a 72 m).

## Como trabalhar aqui

- **Meça antes de opinar.** Este projeto tem um histórico de diagnósticos
  errados feitos por leitura de código. Vários bugs só apareceram rodando o jogo
  e instrumentando (`window.PROTO` expõe player, fighters, bots, arena, loop,
  câmera, tuning). Duas vezes uma "correção" piorou a situação e só o número
  mostrou.
- **Desconfie do próprio teste.** Bots roteirizados não modelam jogador
  habilidoso, e mais de uma conclusão aqui veio de harness mal montado
  (ex.: "a troca de alvo não funciona" era o `forward` da câmera apontando pro
  outro lado). Instrumente o estado real antes de concluir.
- **O git log é documentação.** Cada commit explica o *porquê*, o que foi medido
  antes/depois, e o que ficou sem validar. `git log` é um bom ponto de partida.

## Convenções

- Comentários e documentação em **português**
- Todo arquivo tem cabeçalho explicando o *porquê* das decisões, não só o *o quê*.
  Mantenha esse padrão — é o que faz o projeto sobreviver à troca de sessão.
- Tempo de combate sempre em **frames @60fps**, nunca em segundos
