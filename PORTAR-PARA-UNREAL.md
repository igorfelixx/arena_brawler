# Portar para Unreal — documento de passagem

> **Para quem está lendo isto sem ter participado da criação do projeto**
> (outra sessão de IA, outro dev, ou eu mesmo daqui a seis meses):
>
> Este arquivo é a memória do projeto. O código em `src/` é **descartável por
> construção** — ele existe pra descobrir coisas, não pra virar o jogo. O que
> tem valor permanente são três coisas, nesta ordem:
>
> 1. **`src/tuning.js`** — os números do combate
> 2. **As decisões de design e o porquê de cada uma** — seção 3 e 4 daqui
> 3. **As armadilhas já pagas** — seção 8. Cada item ali custou tempo real.
>
> Se você só tem 5 minutos: leia a seção 2, a seção 5 e a seção 8.

---

## Índice

1. [Contexto do projeto](#1-contexto-do-projeto)
2. [Estado atual e o que foi verificado](#2-estado-atual-e-o-que-foi-verificado)
3. [O modelo de combate — a especificação](#3-o-modelo-de-combate--a-especificação)
4. [Decisões de design e o porquê](#4-decisões-de-design-e-o-porquê)
5. [O que porta e o que não porta](#5-o-que-porta-e-o-que-não-porta)
6. [Mapa de tradução three.js → Unreal](#6-mapa-de-tradução-threejs--unreal)
7. [Plano de porte, passo a passo](#7-plano-de-porte-passo-a-passo)
8. [Armadilhas já descobertas](#8-armadilhas-já-descobertas)
9. [Pipeline de asset](#9-pipeline-de-asset)
10. [Rede — o que já está preparado](#10-rede--o-que-já-está-preparado)
11. [O que ainda NÃO foi validado](#11-o-que-ainda-não-foi-validado)
12. [Perguntas em aberto](#12-perguntas-em-aberto)

---

## 1. Contexto do projeto

### O jogo que se quer fazer

Arena competitiva estilo **brawler aéreo**, com:

- **20–30 jogadores** no objetivo final (MVP: 2 → 4 → 8 → 16 → 20–30)
- Vitória por **eliminar** ou **jogar o inimigo para fora da arena** (ring-out)
- **Arena que encolhe** com o tempo
- Modos solo / dupla / trio / squad, **sem precisar de mapas diferentes**
- Inspiração de estrutura: **Torneio do Poder** (Dragon Ball Super)
- Inspiração de mecânica: **Dragon Ball Budokai Tenkaichi 3 (Sparking! Meteor)**
- Uma arena, 1–2 personagens no início

### Restrições do dono do projeto

Isto muda o que é uma boa recomendação, então está registrado:

- **Pouca experiência com programação e 3D.** A estratégia precisa evitar
  reinventar a roda; a ideia sempre foi achar uma base pronta e adaptar.
- **Não quer criar o sistema de combate do zero.**
- **Tem orçamento para assets**, mas não queria gastar antes de ver o combate
  funcionando. Foi por isso que este protótipo existe.
- No momento da criação deste protótipo, **não tinha Unreal instalado** e não
  podia instalar na máquina em uso.

### Por que o protótipo é em three.js e não em Unreal

Porque o objetivo declarado era *ver antes de gastar*, e não havia Unreal
disponível. Escrever C++ de Unreal sem poder compilar produziria milhares de
linhas nunca executadas — e metade do trabalho em Unreal é fiação no editor, que
não se faz por texto.

**Esta escolha foi consciente e o código foi tratado como descartável desde o
primeiro arquivo.** Não é dívida técnica; é um protótipo cumprindo o papel dele.

### Referência comercial mais próxima

**Rumbleverse** (Iron Galaxy, 2022): 30 jogadores, melee battle royale. Provou
que o conceito é construível — e fechou em ~6 meses, o que é um dado sobre o
mercado, não sobre a viabilidade técnica. Vale estudar o que eles fizeram de
netcode. **Naraka: Bladepoint** é a outra referência (60 jogadores, melee).

---

## 2. Estado atual e o que foi verificado

### Funcionando, testado rodando no navegador

| Sistema | Verificação |
|---|---|
| Combo de 4 elos com cancel | `rush_1→2→3→4→smash`, HP 100→96→91→85→69 |
| Homing no startup | fecha 2.32 m → 1.45 m durante o startup |
| Smash / blowaway | lança a 46.1 m/s, arrasto leva a 24 → 22 |
| Vanish | 0 de dano, −20 de ki, reaparece atrás, `chain=1` |
| Ring-out | elimina ao sair do raio por 50 frames |
| Arena encolhendo | raio e teto, com aviso |
| IA | aproxima, comba, bloqueia, vanisha, empurra pra borda |
| Performance | 60 fps estáveis |

Também implementados e funcionais: guarda direcional, guard break, step com
i-frames, recuperação aérea, ki blast normal e carregado, feixe do ultimate,
Dragon Dash com clash, hitstop, tremor, punch zoom, câmera lenta, aura, rastro,
afterimages, speed lines, HUD, painel de tuning ao vivo.

### Não implementado

- **Áudio.** Os slots existem em `assets.config.js` mas não há arquivo. Decisão
  consciente: beep sintético soa pior que silêncio.
- **Mais de 2 lutadores.** A arquitetura já é uma lista de `fighters` e a
  resolução de acerto é N-para-N, mas **câmera, HUD e seleção de alvo assumem
  1v1**. É a maior lacuna entre o protótipo e o jogo.
- **Rede.** Nada. Ver seção 10 para o que foi preparado.

---

## 3. O modelo de combate — a especificação

Esta seção é a mais importante do documento. **É o design do jogo, independente
de engine.** Se tudo o mais se perder, isto basta pra reconstruir.

### 3.1 Princípios

O combate é aéreo, em 360°, com **lock-on como estado padrão** (mas soltável —
ver 3.4). Não há chão relevante: o chão existe como referência visual e para o
*ground slam*.

**O loop central:**

```
     rush combo  →  smash  →  adversário voa  →  ring-out?
         ↑                         ↓
         └──── vanish / recuperação aérea ────┘
                        ↓
                  gasta KI  →  precisa carregar  →  fica vulnerável
```

Tudo bebe de **uma única barra de ki**: dash, vanish, blast, ultimate, guarda.
Carregar ki exige ficar **parado e vulnerável**. Esse é o aperto que gera as
decisões. Sem recurso escasso, o vanish viraria botão de "não tomar dano" e o
combate morreria.

### 3.2 Anatomia de um golpe

```
   |<- startup ->|<- active ->|<----- recovery ----->|
   0             4            7                      16
                 ^^^^^^^^^^^^
                 hitbox ligada
                 |<--- vanishWindow --->|
                 a vítima pode sumir aqui
   |<-------- cancelWindow -------->|
        dá pra emendar no próximo golpe
```

Todo tempo em **frames a 60 fps**. Isto é deliberado: é a unidade que engine de
jogo de luta usa, e converte pra Unreal sem reinterpretação.

### 3.3 Os golpes

**Rush combo** (4 elos, `J` repetido) — rápido, dano baixo, encurrala.
Cada elo cancela no seguinte dentro da `cancelWindow`. O elo 3 e o 4 também
cancelam em **smash**.

**Smash** (`K`, com direção) — o finalizador. Lento, telegrafado, quebra guarda,
e manda o adversário voando. **Três direções:**

- `smash_forward` — manda reto pra longe → é o golpe de ring-out
- `smash_up` — manda pra cima → prepara perseguição aérea
- `smash_down` — crava no chão → slam com cratera

**Blasts** — `ki_blast` (barato, spam, rebatível pela guarda), `charged_blast`
(segurar pra carregar), `ultimate` (70 de ki, 40 frames de startup, feixe).

**Dragon Dash** (`Shift`) — 62 m/s, curva devagar (o compromisso), cancela em
ataque. Tem **três usos**, e a direção depende do direcional:

| Entrada | Comportamento | Para quê |
|---|---|---|
| só `Shift` + lock | persegue o alvo | atacar |
| `Shift` + direção | vai pra onde aponta | fugir, contornar, esquivar |
| `Shift` sem lock | vai pra frente / pra onde aponta | reposicionar |

Ao alcançar o adversário, o dash **para** e dá um toque de dano quase simbólico
(4). Não atravessa. Isso é o que faz dele uma abertura de combo — você chega já
na distância certa — em vez de só locomoção. Dano baixo é deliberado: o dash é
ferramenta de POSIÇÃO; se machucasse, spammar seria melhor que combar.

Dash contra dash = **clash** (os dois ricocheteiam).

### 3.4 Lock-on — travado e solto

O Tenkaichi original tem **lock permanente**. Este projeto se afasta disso de
propósito, e a razão importa para o porte.

| | Travado (padrão) | Solto (`Q`) |
|---|---|---|
| Câmera | orbita o alvo, enquadra os dois | orbital livre no mouse |
| Corpo | sempre encara o alvo | encara a direção do voo |
| Golpes | **com homing** | **sem homing** |
| Para quê | brigar | reposicionar, fugir, olhar em volta |

**Por que soltar precisa existir:** lock permanente prende. Não dá pra fugir,
reposicionar, nem olhar em volta. Em 1v1 isso é só um incômodo — **com 20–30
jogadores vira bloqueio**, porque escolher o próximo adversário exige poder
olhar pra ele.

**Por que soltar precisa custar caro:** perder o homing. Sem esse custo, o modo
livre seria estritamente melhor (mais informação, mesma capacidade ofensiva) e
o lock viraria decoração.

**Detalhe de implementação que evita enjoo:** ao trocar de modo, a câmera livre
nasce apontando exatamente pra onde a travada estava. Sem isso, soltar o lock
gira a tela violentamente. No Unreal, o equivalente é fazer a transição entre
os dois modos de `USpringArmComponent` por interpolação, não por troca seca.

**Ainda não resolvido:** com mais de um adversário, falta a troca de alvo
(ciclar entre inimigos). O protótipo é 1v1, então `Q` só liga/desliga.

### 3.5 As defesas — e por que são três

Três ferramentas com custos diferentes, de propósito:

| Ferramenta | Custo | O que faz | Quando usar |
|---|---|---|---|
| **Guarda** (`F`) | ki por hit | reduz 80% do dano | pressão contínua |
| **Step** (`F`+direção) | grátis | i-frames curtos | reposicionar |
| **Vanish** (`V`) | 20 ki, escalando | some, reaparece **atrás** | leitura, contra smash |
| **Recuperação aérea** (`F` voando) | 10 ki | para o blowaway | não morrer |

**A guarda é DIRECIONAL.** Só funciona de frente pro atacante (`dot < -0.15`).
Isto não é detalhe: é o que dá sentido ao vanish reaparecer pelas costas. Guarda
omnidirecional tornaria a mecânica assinatura inútil.

### 3.6 Vanish — a mecânica que define o jogo

É o coração do Tenkaichi e a coisa mais importante de acertar.

**Regra:** se a vítima apertou vanish dentro da `vanishWindow` do golpe que está
chegando, ela some e reaparece **atrás do atacante**, sem tomar dano.

- Custa ki, e **cada vanish seguido custa 40% a mais** (`chainKiMultiplier`)
- Limite de `maxChain: 4` — impede guerra de vanish infinita
- **Levar dano zera a cadeia**
- Dispara câmera lenta e afterimages — o momento de leitura precisa ser visível

A recompensa é **posicional**, não de dano: você sai atrás do adversário, que
ainda está em recovery. É isso que faz valer o ki.

### 3.7 Blowaway — o estado pós-smash

Corpo voando sem controle. Arrasto `1.35`, gravidade parcial (45% — corpo voa
quase reto e vai cedendo; gravidade cheia faria um arco curto e sem graça, zero
faria sair pelo horizonte).

Sai do estado ao desacelerar abaixo de `minSpeedToExit`, ou por **recuperação
aérea**. Bate no chão → quica, causa dano, abre cratera, pode virar knockdown.

### 3.8 A arena

Cúpula que encolhe em **raio E teto**. Encolher só o raio não aperta nada num
jogo aéreo — o jogador sobe.

**O dimensionamento é derivado, não escolhido:**

```
knockback do smash = 46 m/s
arrasto do blowaway = 1.35
→ distância percorrida ≈ 46 / 1.35 ≈ 34 m

raio da arena = 48 m
→ smash no CENTRO não mata
→ smash na metade externa mata
```

**Isto é a regra de balanceamento mais importante do jogo.** É o que transforma
posicionamento em jogo: você luta tentando empurrar o outro pra fora antes que
ele te empurre. Se mudar `knockback` ou `drag`, **recalcule o raio**.

Ring-out: fora do raio por `outOfBoundsFrames` (50) → eliminado. A carência dá
tempo de voltar voando, que é o que torna o smash ameaçador mas não instantâneo.

---

## 4. Decisões de design e o porquê

Cada uma destas foi uma escolha entre alternativas. Registrando o *porquê* pra
que ninguém as desfaça por engano.

### Por que Tenkaichi e não brawler de chão

Foi pedido pelo dono do projeto. Mas descobriu-se que **favorece as restrições
do projeto**, e isso deve pesar se a decisão for revista:

- Personagem voando fica em **pose**, não em locomoção com passada. Animação de
  caminhada ruim salta aos olhos; pose de voo com aura, não.
- A identidade visual é quase toda **luz** (aura, rastro, clarão, onda de
  choque) — que é procedural, não asset comprado.

Ou seja: reduz a dependência do ponto fraco (animação de personagem) e concentra
no ponto forte (VFX e game feel, que são código).

### Por que passo fixo de 60 Hz

Todo o frame data depende disso. Com delta variável, `startup: 13` significaria
coisas diferentes em máquinas diferentes e o combate seria impossível de
balancear. **Ver a seção 8 para o que isso implica no Unreal — é a maior
armadilha do porte.**

### Por que o Fighter não lê o teclado

Ele consome um objeto `Command`. Quem produz é o controlador (jogador ou IA).

```
   Input ─┐
          ├─→ Command ──→ Fighter.update()
   IA    ─┘
```

Motivo: é o que trafega em rede. Alguns bytes por frame. É o mesmo modelo de
rollback/prediction que jogos de luta usam. Se o Fighter lesse input direto,
essa porta estaria fechada.

### Por que homing nos golpes

Num jogo aéreo os dois lutadores nunca estão na distância exata do soco. Sem
homing, a maioria dos golpes passa perto sem tocar e **o jogador culpa o
controle**. O homing puxa o atacante durante o startup, fechando ~80% da
distância. No Unreal isto tem nome: **Motion Warping**.

### Por que a poise existe

Impede stunlock infinito. Acumula dano de poise; ao quebrar, a vítima entra em
blowaway e se liberta. Sem isso, um combo travaria o adversário até a morte.

### Por que hitstop é inegociável

No frame do impacto os dois congelam por alguns frames. O cérebro lê isso como
massa. **Sem hitstop, um golpe de 22 de dano tem a mesma sensação de um de 4.**

Detalhe que quase todo mundo erra: durante o congelamento o mundo **não fica
100% parado** — há micro-vibração. Parar de verdade parece travamento, não impacto.

### Por que a IA não trapaceia

Ela consome o mesmo `Command`, gasta o mesmo ki, tem as mesmas regras. O que ela
tem é **tempo de reação artificial** (`reactionFrames`). Motivo: se ela ganhasse
trapaceando, seria impossível julgar o balanceamento — que é a única coisa que o
protótipo existe pra testar.

---

## 5. O que porta e o que não porta

### ✅ Porta — leve isto para o Unreal

| O quê | Onde está | Vira o quê no Unreal |
|---|---|---|
| **Frame data completo** | `src/tuning.js` | `UDataTable` com struct própria |
| **Modelo de combate** | seção 3 deste doc | design, GAS abilities |
| **Formato `Command`** | `src/combat/fighter.js` | struct replicada de input |
| **Dimensionamento da arena** | seção 3.8 | fórmula, não número mágico |
| **Comportamento da IA em camadas** | `src/ai/bot.js` | Behavior Tree |
| **Armadilhas da seção 8** | este doc | tempo economizado |

### ❌ Não porta — descarte sem dó

- Todo o código de renderização, shader, VFX, partícula
- A câmera (o *comportamento* porta; o código não)
- O rig placeholder e as animações procedurais
- O HUD
- O loop de passo fixo (o Unreal resolve diferente — ver seção 8.1)

### ⚠️ Porta como conceito, não como código

- **Máquina de estados do lutador** — a *lista de estados e as transições* é
  design válido. A implementação vira GAS ou state machine própria.
- **Detecção de acerto** — a *ordem de resolução* (seção "resolve.js") é a
  lógica correta e deve ser preservada. O código, não.

---

## 6. Mapa de tradução three.js → Unreal

| Conceito no protótipo | Equivalente no Unreal 5 |
|---|---|
| `src/tuning.js` | `UDataTable` + `FTableRowBase`, ou Primary Data Asset |
| `Fighter` state machine | **GAS** (`UGameplayAbility` por golpe) ou state machine própria |
| `Command` | struct replicada + **Enhanced Input** |
| `startup / active / recovery` | `AnimNotifyState` no `UAnimMontage` (ver 8.2) |
| Hitbox no socket | `GetSocketLocation` + `SphereOverlapActors` |
| `homing` | **Motion Warping plugin** (`MotionWarpingComponent`) |
| Voo | `UCharacterMovementComponent` em `MOVE_Flying` |
| `blowaway` | Custom Movement Mode, ou `LaunchCharacter` + estado |
| Hitstop | `AActor::CustomTimeDilation = 0.01` nos dois atores |
| Câmera lenta | `UGameplayStatics::SetGlobalTimeDilation` |
| Tremor de câmera | `UCameraShakeBase` |
| Punch zoom | curva de FOV no `UCameraComponent` |
| Câmera de lock-on | `USpringArmComponent` + lógica própria |
| Aura, faísca, rastro | **Niagara** |
| Afterimage | Niagara mesh renderer, ou `FPoseSnapshot` |
| Dano / vida / ki | `UAttributeSet` + `UGameplayEffect` (GAS) |
| Estados (guarda, invencível) | `FGameplayTag` |
| VFX de impacto | `UGameplayCueNotify` |
| IA | Behavior Tree + Blackboard |
| Arena encolhendo | `AActor` simples com tick |
| Ring-out | overlap de volume ou checagem de distância |

### Sobre usar GAS

**Vale a pena?** Para um jogo com 20–30 jogadores em rede, sim — GAS já resolve
predição, replicação de atributos, efeitos com duração, tags de estado e cues
visuais. Reescrever isso na mão é o projeto inteiro.

**O custo:** GAS é notoriamente íngreme. Para alguém com pouca experiência de
programação, é a parte mais difícil do porte.

**Recomendação:** partir do **Lyra Starter Game** da Epic, que já vem com GAS
montado e funcionando em rede, e substituir o combate de tiro pelo de melee. É
muito mais fácil do que montar GAS do zero.

---

## 7. Plano de porte, passo a passo

> **Pré-requisito que não é negociável:** só comece o porte depois de
> **playtestar o protótipo e atualizar `src/tuning.js`** com os números que
> ficaram bons. Portar números não validados é portar um palpite. Ver seção 11.

### Fase 0 — antes de abrir o Unreal

1. Jogar o protótipo até o combate parecer bom
2. Usar o painel (`P`) e gravar os valores finais em `src/tuning.js`
3. Confirmar que o ring-out é divertido. **Se não for, o conceito muda e o porte
   é prematuro.**

### Fase 1 — fundação

1. Unreal 5.x + **Lyra Starter Game** como base (traz GAS e rede prontos)
2. Baixar o **GASP** (Game Animation Sample Project) da Epic — locomoção com
   motion matching, de graça, com qualidade AAA
3. Ativar os plugins: **Motion Warping**, **Niagara**, **Enhanced Input**
4. Criar a `UDataTable` de golpes a partir de `src/tuning.js`

### Fase 2 — movimento aéreo

5. `UCharacterMovementComponent` em `MOVE_Flying`, com os valores de
   `TUNING.flight`
6. Câmera de lock-on com `USpringArmComponent`, **com os dois modos** — travado
   e solto (comportamento nas seções 3.1 e 3.4, e em `src/world/camera.js`)
7. **Validação:** voar em volta de um alvo é confortável e legível?

### Fase 3 — combate básico

8. Uma `UGameplayAbility` por golpe, lendo o frame data da DataTable
9. Montages com `AnimNotifyState` para a janela ativa
10. Hitbox por socket + overlap
11. Hitstop (`CustomTimeDilation`), tremor, punch zoom
12. **Validação:** o soco tem peso? Compare com o protótipo lado a lado.

### Fase 4 — o que faz ser Tenkaichi

13. Smash com as três direções + blowaway
14. **Vanish** (a mais importante — seção 3.6)
15. Recuperação aérea, guarda direcional, step
16. Ki como `UAttributeSet`
17. **Validação:** a troca vanish/smash gera leitura, ou vira spam?

### Fase 5 — arena e vitória

18. Arena com cúpula encolhendo
19. Ring-out
20. **Recalcular o raio** pela fórmula da seção 3.8 com os valores finais

### Fase 6 — escala (é aqui que fica difícil)

21. 2 jogadores em rede (dedicated server)
22. Seleção de alvo com múltiplos adversários — **não existe no protótipo**
23. Câmera e HUD para N adversários — **não existe no protótipo**
24. 4 → 8 → 16 → 30

> **Aviso sobre a escada do MVP:** os degraus **não são "menos jogadores"**, são
> problemas diferentes. 1v1 é *feel*. 8 jogadores é *netcode*. 30 é *arquitetura
> de servidor e custo*. Não trate como a mesma escada.

---

## 8. Armadilhas já descobertas

Cada item aqui custou tempo real de depuração. Leia antes de repetir.

### 8.1 ⚠️ O Unreal não tem passo fixo — e o frame data depende disso

**A maior armadilha do porte.**

Todo o frame data está em frames a 60 fps. O Unreal roda com delta variável. Se
você converter `startup: 13` para "13 ticks", o golpe terá duração diferente em
cada máquina, e o jogo fica impossível de balancear.

**Três saídas, em ordem de recomendação:**

1. **Converter frames → segundos** (`13 / 60 = 0.2167s`) e usar tempo de
   montage/timer. Simples, funciona, é o que a maioria dos jogos de ação faz.
   Perde determinismo exato, o que só importa se você quiser rollback.
2. **Acumulador de passo fixo** dentro do sistema de combate, como no protótipo.
   Mais trabalho, mantém determinismo.
3. **Travar o tick** (`t.MaxFPS`) — não faça. Não sobrevive a rede.

**Decisão a tomar cedo**, porque muda a arquitetura: *este jogo vai precisar de
rollback netcode?* Para melee com 30 jogadores, provavelmente não — rollback é
para 1v1. Então a opção 1 basta.

### 8.2 ⚠️ Frame data na DataTable vs. AnimNotify no montage

No Unreal é tentador marcar a janela ativa com `AnimNotifyState` direto no
montage. É o jeito nativo e é confortável.

**O problema:** isso acopla o balanceamento à animação. Mudar `startup` vira
editar montage, e você perde a tabela única de balanceamento que este protótipo
inteiro existe pra produzir.

**Recomendação:** manter a **DataTable como fonte da verdade** dos números
(dano, knockback, startup, active, recovery) e usar o notify apenas como
disparador, ajustando o `PlayRate` do montage pra bater com a tabela. Dá um
pouco mais de trabalho e preserva a capacidade de balancear numa planilha.

### 8.3 Nomes de osso do Mixamo quebram em three.js — e o análogo existe no Unreal

No three.js, `:` é separador em nome de track de animação. `mixamorig:LeftArm`
nunca liga em osso nenhum e **o personagem carrega em T-pose, parado, sem erro
visível**. Os loaders resolvem sanitizando os nomes.

**No Unreal o sintoma equivalente** é retarget mal configurado: o personagem
importa, aparece, e não anima ou anima torto. A causa costuma ser cadeia de
ossos não mapeada no **IK Retargeter**. Sintoma parecido, causa parecida, e a
primeira suspeita deve ser sempre nome/mapeamento de osso.

### 8.4 Sem homing, o combo erra e o jogador culpa o controle

Descoberto testando: com homing fraco, **os dois primeiros socos do combo
erravam** a 2.4 m. Errar o primeiro golpe é o erro mais caro que um jogo de luta
pode cometer — o jogador conclui que o controle não responde.

No Unreal: **Motion Warping**. É exatamente pra isso.

### 8.5 Um smash não pode matar de qualquer lugar

Primeira versão: raio 40 m, smash percorrendo 42 m. Um único smash matava de
qualquer posição da arena. Virou roleta, não duelo.

Corrigido com a fórmula da seção 3.8. **Refaça essa conta sempre que mexer em
`knockback` ou `drag`.**

### 8.6 Num céu vazio, velocidade é invisível

Voar a 60 m/s num vazio é visualmente idêntico a estar parado — não há nada
passando pra dar referência. O protótipo tem um **campo de pedras flutuantes**
só pra isso. Sem elas, "o Dragon Dash não funciona" e a causa real não é óbvia.

No Unreal: mesmo princípio. A arena precisa de detritos, nuvens ou estruturas na
periferia.

### 8.7 Bloom alto engana em screenshot e cega em movimento

Fica bonito parado e ilegível jogando. Use **threshold alto** pra que só o que é
de fato brilhante (ki, faísca, aura) floresça. No protótipo: `strength 0.55`,
`threshold 0.86`.

### 8.8 Aura opaca tapa a pose do golpe

A primeira versão da aura era uma cápsula com shader fresnel — o fresnel
desenhava o contorno da geometria e o personagem parecia estar dentro de um
comprimido. Além disso ficava opaca demais e escondia o corpo.

**Regra:** a aura envolve, não tapa. A pose do golpe é a informação mais
importante da tela num jogo de luta.

### 8.9 Yaw NÃO descreve direção num jogo aéreo

A ultimate saía sempre na horizontal porque a direção era montada como
`(sin(yaw), 0, cos(yaw))` — com `y` fixo em zero. Com o adversário acima ou
abaixo, o golpe mais caro do jogo passava longe, e o sintoma parecia ser falha
do lock-on, não da mira.

**A regra:** num jogo com voo livre, qualquer direção de golpe, projétil ou
feixe tem que sair de um vetor 3D (`alvo - origem`), nunca do yaw. Yaw só serve
para orientar o corpo.

No Unreal o erro equivalente é usar `GetActorForwardVector()` de um Character
cujo `bUseControllerRotationPitch` está desligado — o forward volta achatado no
plano. Vale conferir isso em toda ability que mire.

### 8.10 Colisão em alta velocidade precisa de margem (tunneling)

O Dragon Dash corre a 62 m/s. A 60 fps, isso é **~1 metro por frame**. Um teste
de sobreposição por distância simplesmente pula por cima do adversário entre
dois frames, e o dash atravessa sem encostar.

A correção aqui foi uma margem de colisão (`impactReachBonus: 1.4`), que é um
paliativo barato e suficiente para o protótipo. **No Unreal, faça direito:** use
*sweep* (`SweepSingleByChannel` / `bSweepCollision` no movimento), que testa o
caminho inteiro percorrido no frame, não só a posição final. Physics Sub-Stepping
também ajuda.

### 8.11 Sair de um estado por TEMPO em vez de por CONDIÇÃO

O blowaway encerrava em `maxFrames` (2,5 s) e devolvia o controle **com o corpo
ainda voando a ~8 m/s**. O resultado era um estado meio-termo horrível: a
inércia comia o input (parecia que não dava pra se mover), mas o ataque já
estava liberado. O jogador descreveu exatamente assim — *"não consigo me mover,
mas ainda consigo dar golpes, eu deveria estar desmaiado"*.

**A regra:** estado de perda de controle sai pela CONDIÇÃO que o define (aqui,
velocidade baixa). Temporizador serve para apertar o freio ou como rede de
segurança — nunca para devolver o controle sozinho.

Isso vale para qualquer *knockback*, *stagger* ou *stun* no Unreal.

### 8.12 Botão segurado re-dispara a ação

Assim que o dash passou a parar no adversário, segurar o botão passou a
encadear tromba atrás de tromba: **28 de dano em meio segundo, sem combo
nenhum** — spammar dash virou melhor que lutar.

**A regra:** ação com impacto precisa de *release-gate* (exigir soltar o botão)
**e** cooldown. Só o cooldown não basta se o botão fica pressionado.

No Unreal, `UGameplayAbility` com `InstancingPolicy` e uma tag de bloqueio
(`AbilityTagsToBlock`) resolve isso de forma nativa.

### 8.13 Velocidade residual não é intenção

O Dragon Dash tomava a direção da **velocidade atual** como ponto de partida e
só ia curvando rumo à intenção a uma taxa lenta. Isso gerou dois bugs opostos
com a mesma raiz:

- **perseguindo:** com o inimigo acima ou abaixo, a componente vertical demorava
  tanto a ser adquirida que o dash chegava atrasado e ultrapassava — distância
  mínima de 5,2 m, nunca encostava. O jogador descreveu como *"passo reto toda
  hora"*.
- **fugindo:** uma deriva de **0,6 m/s** definia o rumo de um dash de **62 m/s**,
  e recuar raspava no inimigo a 1,7 m antes de conseguir virar.

**A regra:** ao iniciar um movimento comprometido (dash, investida, salto
direcionado), trave a direção pela INTENÇÃO no primeiro frame. Interpolação
lenta serve para *mudar de ideia no meio*, nunca para *acertar a mira inicial*.

**Corolário de código:** a direção inicial e a correção por frame têm que sair
da MESMA função. Enquanto foram duas lógicas separadas, o dash entrava numa
direção e corrigia para outra — foi daí que os dois bugs nasceram.

No Unreal isso aparece igual ao usar `GetVelocity().GetSafeNormal()` como base
de um Motion Warping ou de um `LaunchCharacter`. Use o vetor para o alvo, ou o
input do jogador — não a velocidade.

### 8.14 Cache de módulo ES engana durante o ajuste

Editar `src/tuning.js`, recarregar, e o jogo continuar com os números antigos —
porque o navegador reaproveita o módulo já compilado. O sintoma imita um bug de
código ("mudei o valor e não mudou nada") e faz perder tempo no lugar errado.

Resolvido com `serve.py`, que manda `Cache-Control: no-store` em tudo.
Equivalente no Unreal: lembrar que DataTable editada **em PIE** não persiste, e
que alterar a asset com o jogo rodando pode não recarregar. Salve e reinicie o
PIE antes de concluir que o número não fez efeito.

### 8.15 Leitura de time: frio vs. quente

Com os dois lutadores em tons de azul no meio de VFX ciano, era impossível dizer
num relance quem era quem. **Jogador = cor fria, oponente = cor quente.** Não é
estética, é leitura. Com 30 jogadores isso fica ainda mais crítico.

---

## 9. Pipeline de asset

### Decisão tomada: padronizar o esqueleto

**No protótipo:** esqueleto **Mixamo**. O mannequin procedural usa os nomes de
osso do Mixamo exatamente, então trocar asset é uma linha em
`assets.config.js`.

**No Unreal, a decisão muda:** o padrão de fato é o **UE5 Mannequin**
(`SK_Mannequin`), porque é o que o GASP, o Lyra e a maioria dos assets do Fab
usam. Mixamo → UE5 Mannequin é um retarget conhecido, feito com o **IK
Retargeter**.

**Recomendação para o porte:** adotar o **UE5 Mannequin** como padrão e
retargetar o que vier do Mixamo. Motivo: dá acesso ao GASP e à biblioteca do
Fab sem fricção.

### Onde comprar

- **Fab** (ex-Unreal Marketplace) — personagens e sistemas de combate melee
- **Mixamo** — grátis, ótimo pra prototipar
- **GASP** (Game Animation Sample Project) — grátis, da Epic, locomoção AAA

### O que NÃO comprar antes de validar

Não compre personagem antes do combate estar bom. A ordem certa é: combate →
validação → asset. Foi por isso que este protótipo existe.

---

## 10. Rede — o que já está preparado

### O que já está certo

O `Fighter` consome um `Command`, não input. Isso significa que a camada de rede
tem um ponto de entrada natural e pequeno.

```js
// src/combat/fighter.js
{
  moveX, moveY, vertical,
  rush, smash, smashDir, blast, blastHeld,
  guard, vanish, dash, charge, ultimate
}
```

São ~12 booleanos e 3 floats por frame. É o que se replica.

### O problema difícil, registrado com honestidade

**Melee em rede com 20–30 jogadores é o maior risco técnico do projeto** — não o
combate.

Motivo: hit detection de melee é *frame-perfect*. Shooter esconde latência com
lag compensation porque o tiro é instantâneo e pontual; melee não, porque a
hitbox existe no espaço por vários frames e os dois corpos estão se movendo.

O que isso implica:

- Autoridade do servidor com reconciliação, ou
- Autoridade do cliente no acerto (mais responsivo, mais vulnerável a cheat), ou
- Um híbrido — que é o que a maioria faz

**GAS ajuda** (tem predição embutida para abilities), mas não resolve sozinho.
Estudar como Rumbleverse e Naraka resolveram é trabalho de pesquisa a fazer.

### Recomendação de ordem

Não deixe rede pro fim. **Faça 1v1 em dedicated server antes de ir para 4.**
Descobrir que a arquitetura de combate não replica bem no degrau de 16 jogadores
é uma reescrita.

---

## 11. O que ainda NÃO foi validado

**Esta seção é a mais importante para não portar um erro.**

Os números em `src/tuning.js` são **palpites informados do autor do protótipo,
não valores validados por playtest.** Eles foram calibrados para serem
coerentes entre si (a fórmula da arena, o ritmo do combo), mas ninguém ainda
jogou o suficiente para dizer que o combate é *bom*.

Especificamente não validado:

- [ ] O smash tem peso suficiente?
- [ ] O ring-out é divertido ou frustrante?
- [ ] A janela de vanish (7–14 frames) é justa?
- [ ] O custo de ki do vanish (20) cria a pressão certa?
- [ ] O combo de 4 elos é longo demais? Curto demais?
- [ ] A arena encolhendo muda a luta, ou é só um relógio?
- [ ] Carregar ki é um risco interessante ou uma pausa chata?
- [ ] A IA é um oponente ou um saco de pancada?

**Antes do porte:** jogar, ajustar no painel (`P`), gravar os valores em
`src/tuning.js`, e atualizar esta seção marcando o que foi validado.

Também não validado por razão estrutural: **como tudo isso se comporta com 30
jogadores.** Todo o design foi pensado e testado em 1v1. Com 30, questões novas
aparecem — seleção de alvo, quem a câmera segue, o que acontece quando três
pessoas te combam ao mesmo tempo.

---

## 12. Perguntas em aberto

Decisões que ainda não foram tomadas e que mudam a arquitetura:

1. **Rollback netcode ou não?** Decide se o combate precisa de passo fixo
   determinístico. Para 30 jogadores, provavelmente não. (Ver 8.1)
2. **GAS ou state machine própria?** GAS é o caminho certo para rede, e é íngreme.
   Partir do Lyra reduz muito o custo. (Ver seção 6)
3. **Quantos personagens no lançamento?** O protótipo assume 1 kit de golpes.
   Personagens com kits diferentes multiplicam o trabalho de balanceamento.
4. **A arena encolhe ou tem outro mecanismo de pressão?** Encolher é o padrão de
   battle royale. Vale testar alternativas (relógio, zona de dano, plataformas
   caindo) antes de assumir.
5. **Ring-out é a única vitória, ou vida zerada também elimina?** No protótipo,
   ambos. Vale decidir se vida deve existir mesmo, ou se o jogo é puramente
   sobre posicionamento.
6. **Modo squad:** como funciona o lock-on com aliados na tela?

---

## Apêndice — arquivos que importam

```
PORTAR-PARA-UNREAL.md   ← este arquivo
README.md               ← como rodar e como trocar asset
assets.config.js        ← fronteira de asset (uma linha troca o personagem)
src/tuning.js           ← ★ O PRODUTO REAL DO PROTÓTIPO ★

src/combat/fighter.js   ← máquina de estados + formato Command (design válido)
src/combat/resolve.js   ← ordem de resolução de acerto (design válido)
src/ai/bot.js           ← IA em camadas (design válido)
src/world/camera.js     ← comportamento da câmera de lock-on (design válido)

src/world/vfx.js        ← descartável
src/assets/*            ← descartável
src/ui/*                ← descartável
src/core/*              ← descartável
```

Todos os arquivos têm cabeçalho explicando o *porquê* das decisões, não só o
*o quê*. Se algo aqui parecer arbitrário, o cabeçalho do arquivo correspondente
provavelmente explica.
