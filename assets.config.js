/* =============================================================================
 *  assets.config.js  —  O ÚNICO ARQUIVO QUE VOCÊ PRECISA EDITAR PARA TROCAR ASSET
 * =============================================================================
 *
 *  O código do jogo NUNCA cita caminho de arquivo. Ele pede por nome lógico
 *  ("player", "attack_light_1", "hit_spark") e este arquivo resolve o que isso é.
 *
 *  ---------------------------------------------------------------------------
 *  COMO TROCAR O PERSONAGEM PLACEHOLDER POR UM ASSET DE VERDADE
 *  ---------------------------------------------------------------------------
 *
 *  1. Baixe um personagem em https://mixamo.com  (grátis, precisa de conta Adobe)
 *     - Formato: FBX Binary  OU  exporte como .glb
 *     - Marque "With Skin"
 *  2. Jogue o arquivo em  ./assets/models/
 *  3. Mude UMA linha abaixo:   source: null   →   source: './assets/models/seu.fbx'
 *  4. Recarregue o navegador. Pronto.
 *
 *  Baixe as animações do MESMO personagem (Without Skin) e aponte em `clips`.
 *
 *  ---------------------------------------------------------------------------
 *  PADRÃO DE ESQUELETO: MIXAMO   (mixamorig:Hips, mixamorig:Spine, ...)
 *  ---------------------------------------------------------------------------
 *  O boneco procedural placeholder usa EXATAMENTE os mesmos nomes de osso que o
 *  Mixamo. É por isso que a troca é uma linha: as animações já sabem onde bater.
 *  Se comprar um asset com outro rig, ou faz retarget pro Mixamo, ou preenche
 *  `boneMap` abaixo (de → para).
 * ========================================================================== */

export const ASSETS = {

  /* ------------------------------------------------------------------ */
  /*  PERSONAGENS                                                        */
  /* ------------------------------------------------------------------ */
  characters: {

    fighter_default: {
      // ↓↓↓ TROQUE AQUI. null = usa o boneco procedural (mannequin de madeira).
      source: null,
      // Exemplo real:
      // source: './assets/models/paladin.fbx',

      // Mixamo FBX vem em centímetros (~180 unidades). GLB costuma vir em metros.
      // Se o boneco aparecer gigante, use 0.01. Se aparecer minúsculo, use 100.
      scale: 'auto',            // 'auto' = normaliza pela altura alvo abaixo
      targetHeight: 1.8,        // metros — altura desejada do personagem
      yawOffsetDeg: 0,          // gire se o asset nascer olhando pro lado errado
      forward: '+z',            // eixo "pra frente" do asset ('+z' | '-z' | '+x' | '-x')

      // Mapeamento de osso, só se o rig NÃO for Mixamo. Chave = nome lógico.
      boneMap: null,
      // boneMap: { 'mixamorig:Hips': 'pelvis', 'mixamorig:RightHand': 'hand_r', ... }

      // Sockets: de qual osso sai a hitbox de cada tipo de golpe.
      sockets: {
        hand_r: 'mixamorig:RightHand',
        hand_l: 'mixamorig:LeftHand',
        foot_r: 'mixamorig:RightFoot',
        foot_l: 'mixamorig:LeftFoot',
        head:   'mixamorig:Head',
        chest:  'mixamorig:Spine2',
      },

      /* ANIMAÇÕES — nome lógico → arquivo (ou null para usar a procedural).
       *
       * Com arquivos do Mixamo "Without Skin", cada download é um FBX com UMA
       * animação dentro. Aponte direto:
       *     idle: { file: './assets/anims/idle.fbx' }
       *
       * Se o asset vier com todas as animações num GLB só, use `clip` pra
       * escolher pelo nome interno:
       *     idle: { file: './assets/models/hero.glb', clip: 'Armature|Idle' }
       *
       * `speed` e `loop` valem para os dois casos.
       */
      clips: {
        idle:           { file: null, clip: null, loop: true,  speed: 1.0 },
        walk:           { file: null, clip: null, loop: true,  speed: 1.0 },
        run:            { file: null, clip: null, loop: true,  speed: 1.0 },

        attack_light_1: { file: null, clip: null, loop: false, speed: 1.0 },
        attack_light_2: { file: null, clip: null, loop: false, speed: 1.0 },
        attack_light_3: { file: null, clip: null, loop: false, speed: 1.0 },
        attack_heavy:   { file: null, clip: null, loop: false, speed: 1.0 },

        block:          { file: null, clip: null, loop: true,  speed: 1.0 },
        block_impact:   { file: null, clip: null, loop: false, speed: 1.0 },
        dodge:          { file: null, clip: null, loop: false, speed: 1.0 },

        hit_react:      { file: null, clip: null, loop: false, speed: 1.0 },
        launched:       { file: null, clip: null, loop: true,  speed: 1.0 },
        knockdown:      { file: null, clip: null, loop: false, speed: 1.0 },
        getup:          { file: null, clip: null, loop: false, speed: 1.0 },
      },

      // Cor do mannequin procedural. Ignorado quando `source` aponta pra um asset.
      placeholderTint: 0xb98a5a,
    },

    /* O oponente reaproveita o mesmo asset, só muda a cor.
     * Quando tiver um segundo personagem, é só dar um `source` próprio a ele. */
    /* Cor QUENTE de propósito. No primeiro teste o oponente era azul-acinzentado
     * e, a 10 metros de distância no meio de VFX ciano, era impossível dizer
     * num relance quem era quem. Num jogo de luta isso não é estética, é leitura:
     * jogador = frio, oponente = quente. */
    fighter_opponent: {
      inherits: 'fighter_default',
      placeholderTint: 0xb8543f,
    },
  },

  /* ------------------------------------------------------------------ */
  /*  ARENA                                                              */
  /* ------------------------------------------------------------------ */
  arena: {
    // null = plataforma procedural (disco de pedra). Aponte pra um .glb pra trocar.
    source: null,
    scale: 'auto',
    // O raio JOGÁVEL vem de tuning.js (arena.startRadius), não do modelo.
    // O modelo é só visual: ele é escalado pra caber no raio.
    floorY: 0,
  },

  /* ------------------------------------------------------------------ */
  /*  TEXTURAS / VFX  —  null = gerado proceduralmente em canvas          */
  /* ------------------------------------------------------------------ */
  textures: {
    hit_spark:   { file: null },   // clarão do impacto
    dust:        { file: null },   // poeira do chão
    ring_shock:  { file: null },   // onda de choque do golpe pesado
    sky_gradient:{ file: null },
  },

  /* ------------------------------------------------------------------ */
  /*  ÁUDIO  —  null = silencioso (sem beep sintético, que soa amador)    */
  /* ------------------------------------------------------------------ */
  audio: {
    hit_light:  { file: null, volume: 0.8 },
    hit_heavy:  { file: null, volume: 1.0 },
    block:      { file: null, volume: 0.7 },
    whoosh:     { file: null, volume: 0.5 },
    ringout:    { file: null, volume: 1.0 },
    footstep:   { file: null, volume: 0.3 },
  },
};

/* =============================================================================
 *  Resolve herança (`inherits`) — não precisa mexer aqui.
 * ========================================================================== */
export function resolveCharacter(id) {
  const raw = ASSETS.characters[id];
  if (!raw) throw new Error(`[assets.config] personagem desconhecido: "${id}"`);
  if (!raw.inherits) return raw;

  const base = resolveCharacter(raw.inherits);
  return {
    ...base,
    ...raw,
    sockets: { ...base.sockets, ...(raw.sockets || {}) },
    clips: { ...base.clips, ...(raw.clips || {}) },
  };
}
