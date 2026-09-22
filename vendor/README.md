# vendor/ — three.js

Código de terceiros, versionado de propósito.

- **Biblioteca:** [three.js](https://threejs.org) r164
- **Licença:** MIT — Copyright © 2010–2024 three.js authors
- **Origem:** https://unpkg.com/three@0.164.0/

## Por que está commitado em vez de vir de um `npm install` ou CDN

Para que `git clone` + `./serve.sh` baste para rodar o projeto — sem
dependência de rede, sem passo de build, sem `node_modules`. É um objetivo
declarado do protótipo: qualquer pessoa consegue abrir e jogar em dois comandos.

## Conteúdo

```
three.module.js              núcleo
jsm/loaders/                 GLTFLoader, FBXLoader (para trocar o asset placeholder)
jsm/postprocessing/          EffectComposer, UnrealBloomPass, OutputPass
jsm/shaders/                 shaders usados pelo pós-processamento
jsm/utils/                   BufferGeometryUtils, SkeletonUtils (afterimages)
jsm/curves/, jsm/libs/       dependências internas do FBXLoader
```

## Atualizar

Trocar a versão exige rebaixar as URLs e conferir se as importações internas
continuam resolvendo — os arquivos de `jsm/` importam uns aos outros por caminho
relativo, e o `importmap` no `index.html` mapeia apenas o especificador `three`.

```bash
V=0.164.0   # ajuste
curl -sS -o vendor/three.module.js https://unpkg.com/three@$V/build/three.module.js
# e cada arquivo de jsm/ preservando a estrutura de pastas
```

A licença MIT do three.js está em https://github.com/mrdoob/three.js/blob/dev/LICENSE
