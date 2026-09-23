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
- **vários lutadores** (`match.opponents`): IAs brigam entre si, não só com você
- **modo treino** (`T`): NORMAL / PARADO / GUARDA, boneco que reage e não morre
- IA com punição de recovery baseada em frame data real

Não implementado: **áudio**, **rede**, troca de alvo por gamepad no ciclo.

### Pendências conhecidas — pergunte ao dono antes de assumir

1. **Escala.** `match.opponents` está em 2 (3 lutadores) porque foi o que deu pra
   verificar: o navegador headless usado nos testes renderiza por software e
   travou com 5. O teto real na máquina dele é **desconhecido** — é informação
   valiosa, porque a escala de 20–30 é o maior risco do projeto.
2. **Balanceamento casual vs competitivo.** Martelar um botão já foi corrigido
   uma vez (`combo.cancelOnlyOnContact` derrubou o saldo de +109 para +10), mas
   se o ponto está bom PARA HUMANO segue sem resposta. Bot roteirizado não mede
   profundidade — só playtest.
3. **As rotas direcionais** (gancho/chute) nunca foram julgadas por humano: não
   se sabe se levantam/cravam o tanto certo.

**Não validado por playtest:** a maior parte dos números de `src/tuning.js`.
Ver seção 11 do documento de passagem antes de tratá-los como verdade.

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
