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

## Estado

Funcionando e verificado rodando: combo com cancels, smash/blowaway, vanish,
ring-out, arena encolhendo, IA, 60fps. Ver seção 2 do documento de passagem.

Não implementado: áudio, mais de 2 lutadores, rede.

**Não validado por playtest:** os números de `src/tuning.js` são palpites
coerentes, não valores testados. Ver seção 11 do documento de passagem antes de
tratá-los como verdade.

## Convenções

- Comentários e documentação em **português**
- Todo arquivo tem cabeçalho explicando o *porquê* das decisões, não só o *o quê*.
  Mantenha esse padrão — é o que faz o projeto sobreviver à troca de sessão.
- Tempo de combate sempre em **frames @60fps**, nunca em segundos
