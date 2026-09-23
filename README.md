# Arena Proto

Protótipo jogável de combate aéreo estilo **Budokai Tenkaichi 3**, com arena que
encolhe e vitória por **ring-out**. Roda no navegador, sem instalar nada e sem
comprar nenhum asset.

> 📄 **Vai portar pra Unreal? Ou voltou ao projeto depois de um tempo?**
> Leia **[`PORTAR-PARA-UNREAL.md`](./PORTAR-PARA-UNREAL.md)** — é o documento de
> passagem, com o design completo do combate, o porquê de cada decisão, as
> armadilhas já descobertas e o plano de porte passo a passo.

---

## Rodar

```bash
./serve.sh          # http://localhost:8123
```

Abrir o `index.html` direto (`file://`) **não funciona** — módulos ES e
carregamento de modelo são bloqueados por CORS. Precisa do servidor.

Nada de `npm install`: o three.js está em `vendor/`, então funciona offline.

> O servidor manda `Cache-Control: no-store` de propósito. Sem isso, o navegador
> reaproveita o módulo já compilado: você edita `src/tuning.js`, recarrega, e o
> jogo continua com os números antigos — parecendo bug de código. Com este
> servidor, F5 sempre traz o arquivo do disco.

---

## Pra que este projeto existe

Pra você **sentir o combate antes de gastar dinheiro**, e pra descobrir os
números certos antes de escrever uma linha de Unreal.

O que ele responde:

- O ring-out com arena encolhendo é divertido ou vira sorteio?
- O smash manda longe o bastante pra ameaçar sem virar roleta?
- O vanish transforma troca de socos em leitura, como no Tenkaichi?
- Quanto de hitstop e tremor é "peso" e a partir de quanto vira incômodo?
- Voar em 360° com lock-on fica legível, ou o jogador se perde?

O que ele **não** responde: como o jogo vai parecer no final. O visual aqui é um
mannequin procedural. Isso é proposital — ver "Sobre o placeholder".

---

## Controles

| Tecla | Ação |
|---|---|
| `WASD` | voar / orbitar o alvo |
| `Espaço` / `C` | subir / descer |
| `Shift` | Dragon Dash (segurar) — custa ki |
| `Shift` + direção | dash **na direção apontada** — fugir, contornar, esquivar |
| `J` / botão esq. | Rush — repita pro combo de 4 |
| `K` / botão dir. | Smash — finaliza o combo e lança |
| `Espaço`+`K` / `C`+`K` | smash pra cima / cravado no chão |
| `L` | ki blast (segurar = carregado) |
| `F` | guarda · `F` + direção = step |
| `V` | **Vanish** — some e reaparece atrás de quem te bate |
| `R` | carregar ki (segurar) — parado e vulnerável |
| `X` | ultimate (precisa de 70 de ki) |
| `Q` | trocar de alvo |
| `E` (ou `Tab`) | soltar / retomar o lock-on |
| `T` | **modo treino** — parado / guarda / normal |
| `P` (ou o botão ⚙) | painel de tuning |
| `Backspace` | reiniciar a luta |

### Modo treino (`T`)

Para praticar combo sem o boneco fugindo. Cicla três estados:

| Modo | O boneco |
|---|---|
| **NORMAL** | luta de verdade |
| **PARADO** | não age, mas **continua reagindo** (hitstun, knockback, voa longe) |
| **GUARDA** | fica bloqueando — é onde se aprende que só o smash abre a defesa |

Nos modos de treino o boneco **não morre**: a vida volta ao cheio depois de um
tempo sem apanhar (dá pra ler quanto o combo inteiro tirou antes de recomeçar),
e se você mandar ele pra fora com um smash, ele volta sozinho. A arena também
para de encolher, pra não sumir o chão no meio do exercício.

### Golpes direcionais

A direção que você segura escolhe o golpe — não há ordem fixa, você compõe:

| Entrada | Golpe |
|---|---|
| `J` | soco de direita |
| `J` + esquerda | soco de esquerda |
| `J` + cima | gancho — levanta o alvo |
| `J` + baixo | chute descendente — crava |

Qualquer elo emenda em qualquer outro (se o anterior encostou), até 6 elos.
Depois disso só resta o smash.

### Lock-on: travado vs. livre

Com **lock-on** (padrão) você orbita o alvo, o personagem sempre o encara e os
golpes têm *homing* — puxam até ele. É o modo de brigar.

Com **`Q`** você solta. A câmera vira orbital livre no mouse, o personagem
encara pra onde voa, e **os golpes perdem o homing**. É o modo de reposicionar,
fugir, olhar em volta ou escolher outro alvo. A perda do homing é o preço — é o
que mantém o lock valendo a pena.

O indicador embaixo da tela mostra em qual modo você está, e os colchetes cianos
marcam o alvo travado.

Gamepad funciona (mapeamento de Xbox), é só conectar.

**O loop central:** rush pra encurralar → smash pra empurrar pra borda. Quem
apanha tem duas saídas: **vanish** (caro, reaparece atrás) ou **recuperação
aérea** (`F` no meio do voo). Tudo gasta da mesma barra de ki, e carregar ki te
deixa parado. É esse aperto que faz a luta.

---

## Ajustar o combate — comece por aqui

Aperte **`P`**, arraste os sliders enquanto joga, sinta.

Quando achar bom, clique em **"Copiar valores alterados"**: vai pro clipboard só
o que você mudou, no formato

```
moves.smash_forward.knockback: 62
juice.hitstopScale: 1.4
```

Me manda isso e eu gravo em `src/tuning.js`.

**Por onde começar, na ordem:**

1. `Smash frente: empurrão` — é o número que define se o jogo é sobre ring-out
2. `Hitstop` — é o que dá peso ao soco. Suba até parecer travamento, depois volte
3. `Blowaway: freio no ar` — controla o quão longe um corpo lançado viaja
4. `Janela de vanish` — quanto tempo pra reagir. Curto = brutal, longo = mole

---

## Trocar o placeholder por um personagem de verdade

1. Baixe um personagem no [mixamo.com](https://mixamo.com) (grátis) — **FBX
   Binary, "With Skin"**
2. Jogue o arquivo em `assets/models/`
3. Em **`assets.config.js`**, mude **uma linha**:

```js
source: null,
// vira:
source: './assets/models/seu-arquivo.fbx',
```

4. Recarregue.

Pra animações reais, baixe os clipes do **mesmo personagem** ("Without Skin") e
aponte cada um em `clips` no mesmo arquivo.

### Por que isso é mesmo uma linha

Porque o mannequin procedural tem um **esqueleto Mixamo de verdade**, com os
mesmos nomes de osso. Não é uma cápsula. Consequência: o caminho de troca de
asset já está sendo exercitado agora, com o projeto vazio — ele não vai quebrar
no dia em que você colocar o arquivo.

> Uma pegadinha que já está resolvida aqui: o three.js trata `:` como separador
> em nome de track de animação, então `mixamorig:LeftArm` nunca liga em nada e o
> personagem carrega em T-pose parado. Os loaders resolvem sanitizando os nomes,
> e este projeto faz o mesmo nos dois lados. Se você já tinha tentado importar
> Mixamo em three.js e o boneco ficou de braços abertos sem animar — era isso.

Se comprar um asset com rig próprio (não-Mixamo), preencha `boneMap` no mesmo
arquivo. O registry avisa no console quando não reconhece o rig.

---

## Sobre o placeholder (leia antes de julgar o visual)

O boneco é um mannequin de madeira articulado. Ele **não é** o visual do jogo.

O que é honesto dizer:

- **modelagem e animação de personagem não são meu forte.** As poses aqui foram
  escritas à mão, osso por osso, em graus. Servem pra ler o que o golpe está
  fazendo — não pra impressionar.
- **luz, VFX, câmera e game feel são código**, e é aí que este protótipo investe:
  aura, rastro, afterimage, hitstop, tremor, punch zoom, onda de choque. Num jogo
  estilo Dragon Ball isso é metade da identidade visual, e é a metade que dá pra
  fazer bem sem comprar nada.

Por isso o estilo Tenkaichi te favorece: personagem voando fica em POSE, não em
locomoção com passada. Animação de caminhada ruim salta aos olhos; pose de voo
com aura, não.

---

## Main Character
Kael Vorn: The Conductor Concept Sheet


<img width="1024" height="1536" alt="ChatGPT Image Sep 23, 2026, 04_35_17 PM" src="https://github.com/user-attachments/assets/34bc5204-73c0-4cc6-9c78-3f11572e0c74" />

---

## Second Character
Zara Vex: The Radiant Character Sheet

<img width="1024" height="1536" alt="ChatGPT Image Sep 23, 2026, 04_44_17 PM" src="https://github.com/user-attachments/assets/34be7064-1bf8-4f79-9520-343b4fc15121" />


---

## Estrutura

```
assets.config.js       ← VOCÊ MEXE AQUI pra trocar asset
src/tuning.js          ← VOCÊ MEXE AQUI pra ajustar o combate (ou use o painel P)

src/core/     loop de passo fixo, input, juice (hitstop/tremor), painel de debug
src/assets/   fronteira de asset: rig placeholder, animações procedurais, registry
src/combat/   máquina de estados do lutador, detecção de acerto, projéteis
src/world/    arena, câmera de lock-on, VFX
src/ai/       controlador do oponente
src/ui/       HUD
vendor/       three.js (pra funcionar offline)
```

### O que sobrevive quando isto virar Unreal

- **`src/tuning.js`** — todo frame data em frames @60fps. Vira uma Data Table
  direto. Este arquivo é o produto real do protótipo.
- **as decisões de design** que você validar jogando.
- **o formato `Command`** (`src/combat/fighter.js`): o lutador nunca lê o
  teclado, consome um Command. É o mesmo modelo que rollback netcode usa — a
  porta pra rede fica aberta de graça.

O resto do código three.js é descartável. Isso é esperado, não é dívida.

---

## Estado atual — verificado rodando

Funcionando e testado no navegador:

- combo de 4 elos encadeando por cancel, com homing
- smash lançando a 46 m/s, blowaway com arrasto, ring-out por sair do raio
- vanish consumindo ki, reaparecendo atrás, zerando o dano
- guarda direcional, guard break, step com i-frames, recuperação aérea
- ki blasts (normal e carregado), feixe do ultimate
- arena encolhendo em raio e teto, com aviso
- IA que aproxima, comba, bloqueia, some e tenta te empurrar pra borda
- 60 fps estáveis

Não implementado (fora do escopo deste passo):

- áudio — `assets.config.js` já tem os slots, mas sem arquivo não toca nada.
  Beep sintético foi decisão consciente de não fazer: soa pior que silêncio.
- mais de 2 lutadores. A arquitetura já é uma lista de `fighters`, mas a câmera,
  o HUD e a seleção de alvo assumem 1v1.
- rede.
