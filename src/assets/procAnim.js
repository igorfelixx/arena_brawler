/* =============================================================================
 *  procAnim.js  —  Animações procedurais (placeholder)
 * =============================================================================
 *
 *  Toda pose aqui é escrita contra a T-POSE DO MIXAMO, em graus, osso por osso.
 *  Isso tem uma consequência importante: estas animações NÃO são descartáveis do
 *  mesmo jeito que o resto do código. Elas rodam em qualquer personagem Mixamo.
 *
 *  Convenção de eixos na T-pose (decorre do rig):
 *     braço ESQUERDO repousa em +X     braço DIREITO repousa em -X
 *     pernas em -Y                     coluna em +Y                 frente = +Z
 *
 *     braço esq. pra BAIXO  → Z:-90      braço dir. pra BAIXO  → Z:+90
 *     braço esq. pra FRENTE → Y:-90      braço dir. pra FRENTE → Y:+90
 *     cotovelo esq. dobra   → Y negativo cotovelo dir. dobra   → Y positivo
 *     coluna inclina à frente → X positivo
 *     quadril levanta joelho  → X negativo
 *     joelho dobra            → X positivo
 *
 *  Só há tracks de ROTAÇÃO (fora o Hips). É a mesma convenção do Mixamo e é o
 *  que faz retarget funcionar: posição de osso é do esqueleto, não da animação.
 *
 *  NOTA: quando você apontar um .fbx/.glb real em assets.config.js, este arquivo
 *  inteiro deixa de ser usado para aquele clipe. É placeholder, não é dívida.
 * ========================================================================== */

import * as THREE from 'three';

const D = Math.PI / 180;

/* ==========================================================================
 *  POSES
 *  Cada entrada: 'osso': [rotX, rotY, rotZ] em GRAUS.
 *  Ossos omitidos ficam na T-pose (identidade).
 * ========================================================================== */

/* Pose neutra de voo: ombros pra frente, cotovelos dobrados, pernas soltas.
 * Serve de base pra quase todo o resto — evita pose "boneco de varal". */
const P_BASE = {
  'mixamorig:Spine':        [ -3,   0,  0],
  'mixamorig:Spine1':       [ -2,   0,  0],
  'mixamorig:Spine2':       [  1,   0,  0],
  'mixamorig:Neck':         [  2,   0,  0],
  'mixamorig:Head':         [ -1,   0,  0],

  'mixamorig:LeftShoulder': [  0,  -8,  2],
  'mixamorig:LeftArm':      [  0, -26,-64],
  'mixamorig:LeftForeArm':  [  0, -58,  0],
  'mixamorig:LeftHand':     [  0, -10,  0],

  'mixamorig:RightShoulder':[  0,   8, -2],
  'mixamorig:RightArm':     [  0,  26, 64],
  'mixamorig:RightForeArm': [  0,  58,  0],
  'mixamorig:RightHand':    [  0,  10,  0],

  'mixamorig:LeftUpLeg':    [ -6,   0, -4],
  'mixamorig:LeftLeg':      [ 14,   0,  0],
  'mixamorig:LeftFoot':     [ 18,   0,  0],
  'mixamorig:RightUpLeg':   [ -6,   0,  4],
  'mixamorig:RightLeg':     [ 14,   0,  0],
  'mixamorig:RightFoot':    [ 18,   0,  0],
};

/* Helper: mescla poses (direita sobrescreve). */
const mix = (...poses) => Object.assign({}, ...poses);

/* --- guarda de combate: punhos altos, corpo de lado --- */
const P_GUARD_READY = mix(P_BASE, {
  'mixamorig:Spine1':       [  4,  14,  0],
  'mixamorig:Spine2':       [  2,   8,  0],
  'mixamorig:LeftArm':      [  0, -54,-40],
  'mixamorig:LeftForeArm':  [  0, -96,  0],
  'mixamorig:RightArm':     [  0,  48, 46],
  'mixamorig:RightForeArm': [  0,  92,  0],
});

/* --- respiração (variação sutil da base) --- */
const P_BREATHE_IN = mix(P_GUARD_READY, {
  'mixamorig:Spine':        [ -5,   0,  0],
  'mixamorig:Spine1':       [  2,  14,  0],
  'mixamorig:LeftArm':      [  0, -54,-43],
  'mixamorig:RightArm':     [  0,  48, 49],
});

/* --- voo pra frente: inclina, braços atrás, pernas esticadas --- */
const P_FLY = mix(P_BASE, {
  'mixamorig:Spine':        [ 16,   0,  0],
  'mixamorig:Spine1':       [ 12,   0,  0],
  'mixamorig:Spine2':       [  8,   0,  0],
  'mixamorig:Neck':         [-12,   0,  0],
  'mixamorig:Head':         [-14,   0,  0],
  'mixamorig:LeftArm':      [  0,  34,-76],
  'mixamorig:LeftForeArm':  [  0, -22,  0],
  'mixamorig:RightArm':     [  0, -34, 76],
  'mixamorig:RightForeArm': [  0,  22,  0],
  'mixamorig:LeftUpLeg':    [ 16,   0, -3],
  'mixamorig:LeftLeg':      [ 20,   0,  0],
  'mixamorig:LeftFoot':     [ 28,   0,  0],
  'mixamorig:RightUpLeg':   [ 16,   0,  3],
  'mixamorig:RightLeg':     [ 20,   0,  0],
  'mixamorig:RightFoot':    [ 28,   0,  0],
});

/* --- Dragon Dash: superman, tudo alinhado ao vetor de movimento --- */
const P_DASH = mix(P_BASE, {
  'mixamorig:Spine':        [ 34,   0,  0],
  'mixamorig:Spine1':       [ 22,   0,  0],
  'mixamorig:Spine2':       [ 14,   0,  0],
  'mixamorig:Neck':         [-26,   0,  0],
  'mixamorig:Head':         [-30,   0,  0],
  'mixamorig:LeftArm':      [  0,  52,-84],
  'mixamorig:LeftForeArm':  [  0, -10,  0],
  'mixamorig:RightArm':     [  0, -52, 84],
  'mixamorig:RightForeArm': [  0,  10,  0],
  'mixamorig:LeftUpLeg':    [ 26,   0, -2],
  'mixamorig:LeftLeg':      [  8,   0,  0],
  'mixamorig:LeftFoot':     [ 38,   0,  0],
  'mixamorig:RightUpLeg':   [ 26,   0,  2],
  'mixamorig:RightLeg':     [  8,   0,  0],
  'mixamorig:RightFoot':    [ 38,   0,  0],
});

/* --- carregar ki: arqueado pra trás, punhos cerrados junto ao quadril --- */
const P_CHARGE = mix(P_BASE, {
  'mixamorig:Spine':        [-14,   0,  0],
  'mixamorig:Spine1':       [-11,   0,  0],
  'mixamorig:Spine2':       [ -6,   0,  0],
  'mixamorig:Neck':         [-16,   0,  0],
  'mixamorig:Head':         [-22,   0,  0],
  'mixamorig:LeftArm':      [  0,  16,-48],
  'mixamorig:LeftForeArm':  [  0, -64,  0],
  'mixamorig:LeftHand':     [  0, -24,  0],
  'mixamorig:RightArm':     [  0, -16, 48],
  'mixamorig:RightForeArm': [  0,  64,  0],
  'mixamorig:RightHand':    [  0,  24,  0],
  'mixamorig:LeftUpLeg':    [ -4,   0,-14],
  'mixamorig:LeftLeg':      [ 26,   0,  0],
  'mixamorig:RightUpLeg':   [ -4,   0, 14],
  'mixamorig:RightLeg':     [ 26,   0,  0],
});

const P_CHARGE_PEAK = mix(P_CHARGE, {
  'mixamorig:Spine':        [-18,   0,  0],
  'mixamorig:Spine1':       [-14,   0,  0],
  'mixamorig:Head':         [-27,   0,  0],
  'mixamorig:LeftArm':      [  0,  20,-44],
  'mixamorig:RightArm':     [  0, -20, 44],
});

/* --- socos --------------------------------------------------------------- */

/* preparação do direto de direita: cotovelo recuado, tronco torcido */
const P_PUNCH_R_WIND = mix(P_GUARD_READY, {
  'mixamorig:Spine1':       [  2,  26,  0],
  'mixamorig:Spine2':       [  0,  16,  0],
  'mixamorig:RightArm':     [  0,  34, 58],
  'mixamorig:RightForeArm': [  0, 118,  0],
});

/* direto de direita estendido */
const P_PUNCH_R_HIT = mix(P_GUARD_READY, {
  'mixamorig:Spine1':       [  4, -26,  0],
  'mixamorig:Spine2':       [  2, -16,  0],
  'mixamorig:RightShoulder':[  0,  16, -6],
  'mixamorig:RightArm':     [  0,  92, 70],
  'mixamorig:RightForeArm': [  0,   6,  0],
  'mixamorig:RightHand':    [  0,   0,  0],
  'mixamorig:LeftArm':      [  0, -44,-46],
  'mixamorig:LeftForeArm':  [  0,-104,  0],
});

/* gancho de esquerda preparado */
const P_PUNCH_L_WIND = mix(P_GUARD_READY, {
  'mixamorig:Spine1':       [  2, -24,  0],
  'mixamorig:LeftArm':      [  0, -34,-56],
  'mixamorig:LeftForeArm':  [  0,-116,  0],
});

/* gancho de esquerda conectado */
const P_PUNCH_L_HIT = mix(P_GUARD_READY, {
  'mixamorig:Spine1':       [  4,  28,  0],
  'mixamorig:Spine2':       [  2,  16,  0],
  'mixamorig:LeftShoulder': [  0, -16,  6],
  'mixamorig:LeftArm':      [-18, -88,-58],
  'mixamorig:LeftForeArm':  [  0, -34,  0],
  'mixamorig:RightArm':     [  0,  44, 48],
  'mixamorig:RightForeArm': [  0, 104,  0],
});

/* --- gancho (J + cima): sobe o punho, levanta o alvo --------------------- */
const P_UPPER_WIND = mix(P_GUARD_READY, {
  'mixamorig:Spine':        [ 10,   0,  0],
  'mixamorig:Spine1':       [  8,  26,  0],
  'mixamorig:Head':         [  6, -12,  0],
  'mixamorig:RightArm':     [  0,  22, 82],
  'mixamorig:RightForeArm': [  0,  86,  0],
  'mixamorig:RightUpLeg':   [-14,   0,  8],
  'mixamorig:RightLeg':     [ 32,   0,  0],
});

const P_UPPER_HIT = mix(P_GUARD_READY, {
  'mixamorig:Spine':        [-16,   0,  0],
  'mixamorig:Spine1':       [-12, -22,  0],
  'mixamorig:Spine2':       [ -6, -12,  0],
  'mixamorig:Neck':         [-10,   0,  0],
  'mixamorig:Head':         [-16,  10,  0],
  'mixamorig:RightShoulder':[  0,  10,-14],
  'mixamorig:RightArm':     [ 34,  46,-52],
  'mixamorig:RightForeArm': [  0,  14,  0],
  'mixamorig:LeftArm':      [  0, -36,-52],
  'mixamorig:LeftForeArm':  [  0, -90,  0],
  'mixamorig:RightUpLeg':   [  4,   0,  6],
  'mixamorig:RightLeg':     [ 10,   0,  0],
});

/* --- chute descendente (J + baixo): crava o alvo pra baixo ---------------- */
const P_AXE_WIND = mix(P_GUARD_READY, {
  'mixamorig:Spine':        [  6,   0,  0],
  'mixamorig:Spine1':       [  4, -14,  0],
  'mixamorig:RightUpLeg':   [-112,  6, 14],
  'mixamorig:RightLeg':     [ 46,   0,  0],
  'mixamorig:RightFoot':    [ 12,   0,  0],
  'mixamorig:LeftUpLeg':    [ -2,   0, -4],
  'mixamorig:LeftLeg':      [ 18,   0,  0],
  'mixamorig:LeftArm':      [  0, -40,-58],
  'mixamorig:RightArm':     [  0,  40, 58],
});

const P_AXE_HIT = mix(P_GUARD_READY, {
  'mixamorig:Spine':        [ 30,   0,  0],
  'mixamorig:Spine1':       [ 16,  -8,  0],
  'mixamorig:Neck':         [-18,   0,  0],
  'mixamorig:Head':         [-22,   0,  0],
  'mixamorig:RightUpLeg':   [-18,   4, 10],
  'mixamorig:RightLeg':     [  6,   0,  0],
  'mixamorig:RightFoot':    [ 34,   0,  0],
  'mixamorig:LeftUpLeg':    [ 14,   0, -6],
  'mixamorig:LeftLeg':      [ 26,   0,  0],
  'mixamorig:LeftArm':      [  0,  30,-74],
  'mixamorig:RightArm':     [  0, -24, 70],
});

/* --- chute circular de direita ------------------------------------------- */
const P_KICK_R_WIND = mix(P_GUARD_READY, {
  'mixamorig:Spine1':       [  6,  18,  0],
  'mixamorig:RightUpLeg':   [-32,   0, 18],
  'mixamorig:RightLeg':     [ 78,   0,  0],
  'mixamorig:LeftUpLeg':    [ -4,   0,  0],
  'mixamorig:LeftLeg':      [ 16,   0,  0],
});

const P_KICK_R_HIT = mix(P_GUARD_READY, {
  'mixamorig:Spine':        [  6,   0,  0],
  'mixamorig:Spine1':       [  8, -30,  0],
  'mixamorig:Spine2':       [  4, -14,  0],
  'mixamorig:RightUpLeg':   [-74,  26, 10],
  'mixamorig:RightLeg':     [ 12,   0,  0],
  'mixamorig:RightFoot':    [ 14,   0,  0],
  'mixamorig:LeftUpLeg':    [  4,   0, -6],
  'mixamorig:LeftLeg':      [ 20,   0,  0],
  'mixamorig:LeftArm':      [  0, -30,-72],
  'mixamorig:LeftForeArm':  [  0, -40,  0],
  'mixamorig:RightArm':     [  0,  40, 56],
});

/* --- SMASH: preparação enorme + descarga ---------------------------------- */
const P_SMASH_WIND = mix(P_GUARD_READY, {
  'mixamorig:Spine':        [-12,   0,  0],
  'mixamorig:Spine1':       [ -8,  40,  0],
  'mixamorig:Spine2':       [ -4,  24,  0],
  'mixamorig:Head':         [  0, -22,  0],
  'mixamorig:RightShoulder':[  0,  -8,  8],
  'mixamorig:RightArm':     [  0, -16, 96],
  'mixamorig:RightForeArm': [  0,  96,  0],
  'mixamorig:LeftArm':      [  0, -62,-34],
  'mixamorig:LeftForeArm':  [  0,-102,  0],
  'mixamorig:LeftUpLeg':    [-14,   0, -8],
  'mixamorig:LeftLeg':      [ 30,   0,  0],
  'mixamorig:RightUpLeg':   [  8,   0, 10],
  'mixamorig:RightLeg':     [ 18,   0,  0],
});

const P_SMASH_HIT = mix(P_GUARD_READY, {
  'mixamorig:Spine':        [ 18,   0,  0],
  'mixamorig:Spine1':       [ 12, -40,  0],
  'mixamorig:Spine2':       [  6, -22,  0],
  'mixamorig:Head':         [ -6,  16,  0],
  'mixamorig:RightShoulder':[  0,  22, -8],
  'mixamorig:RightArm':     [-10, 100, 62],
  'mixamorig:RightForeArm': [  0,   4,  0],
  'mixamorig:LeftArm':      [  0, -30,-78],
  'mixamorig:LeftForeArm':  [  0, -56,  0],
  'mixamorig:LeftUpLeg':    [ 20,   0, -6],
  'mixamorig:LeftLeg':      [ 14,   0,  0],
  'mixamorig:RightUpLeg':   [-18,   0,  8],
  'mixamorig:RightLeg':     [ 40,   0,  0],
});

/* --- poses intermediárias dos golpes (LEAD / OVER) --------------------------
 * Todo golpe de ataque tem duas âncoras de contato: wind → hit. Medido na
 * bancada de animação ANTES desta seção: o percurso entre elas era
 * perfeitamente linear — velCV = 0, dragFrames = 0 — o braço chegava exatamente
 * no impacto e parava. Parado no impacto não é soco, é robô.
 *
 * Um soco de verdade quebra a velocidade duas vezes:
 *
 *   LEAD (meio do arco wind→hit, antes do impacto):
 *     o TRONCO já terminou a torção (pLeadTronco ≈ 1) e o membro vai atrás
 *     (pLeadMembro ≈ 0,5). O corpo antece, o braço arrasta — é a antecipação.
 *   OVER (depois do impacto): o membro PASSA do hit (~10% do arco) e volta —
 *     é o snap; sem ele o impacto não "ressoa" no final do golpe.
 *
 * `entre(wind, hit, padrao, graus)` interpola os EULER por osso (não quat: as
 * poses são âncoras do frame data e ler grau a grau ajuda a auditar o que
 * mudou). `graus` sobrepõe o PARÂMETRO de interpolação POR OSSO — não é
 * multiplicador de graus: em LEAD o tronco usa 1 (chega inteiro no impacto) e
 * o membro cai no `padrao` = 0,5; em OVER o tronco usa 1,04 e o membro 1,10. */
const OSSOS_TRONCO = [
  'mixamorig:Spine', 'mixamorig:Spine1', 'mixamorig:Spine2',
  'mixamorig:Neck', 'mixamorig:Head',
];

/* Rede de segurança: com p > 1 a extrapolação poderia dobrar cotovelo/joelho
 * PARA TRÁS do limite anatômico. Hoje nenhum uso passa p>1 nesses ossos
 * (`graus` só carrega tronco + ombro/quadril), mas fica pronto pro dia em que
 * alguém estourar o overshoot de um cotovelo. Convenção de eixos (cabeçalho
 * do arquivo): joelho dobra +X nos dois lados, cotovelo dir. +Y e esq. −Y. */
const _CAP_ARTICULACOES = {
  'mixamorig:RightForeArm': (v) => { if (v[1] < 0) v[1] = 0; },
  'mixamorig:LeftForeArm':  (v) => { if (v[1] > 0) v[1] = 0; },
  'mixamorig:RightLeg':     (v) => { if (v[0] < 0) v[0] = 0; },
  'mixamorig:LeftLeg':      (v) => { if (v[0] < 0) v[0] = 0; },
};

function entre(wind, hit, padrao, graus = {}) {
  const out = {};
  // wind/hit nascem de mix(P_GUARD_READY, ...) e herdam todos os ossos; a
  // cadeia de fallback cobre poses futuras mais enxutas sem quebrar.
  const ossos = new Set([...Object.keys(wind), ...Object.keys(hit)]);
  for (const b of ossos) {
    const w = wind[b] || hit[b] || P_GUARD_READY[b] || [0, 0, 0];
    const h = hit[b] || wind[b] || P_GUARD_READY[b] || [0, 0, 0];
    const p = (b in graus) ? graus[b] : padrao;
    const v = [
      w[0] + (h[0] - w[0]) * p,
      w[1] + (h[1] - w[1]) * p,
      w[2] + (h[2] - w[2]) * p,
    ];
    if (p > 1 && _CAP_ARTICULACOES[b]) _CAP_ARTICULACOES[b](v);
    out[b] = v;
  }
  return out;
}

const _tronco = (p) => Object.fromEntries(OSSOS_TRONCO.map((b) => [b, p]));

/* Os 12 intermediários (6 golpes × LEAD/OVER). O `membro` de cada golpe é o
 * osso que carrega o overshoot — o membro que ataca: ombro nos socos, gancho
 * e smash; quadril nos dois chutes. */
const P_PUNCH_R_LEAD = entre(P_PUNCH_R_WIND, P_PUNCH_R_HIT, 0.5, _tronco(1));
const P_PUNCH_R_OVER  = entre(P_PUNCH_R_WIND, P_PUNCH_R_HIT, 1, { ..._tronco(1.04), 'mixamorig:RightArm': 1.10 });

const P_PUNCH_L_LEAD = entre(P_PUNCH_L_WIND, P_PUNCH_L_HIT, 0.5, _tronco(1));
const P_PUNCH_L_OVER  = entre(P_PUNCH_L_WIND, P_PUNCH_L_HIT, 1, { ..._tronco(1.04), 'mixamorig:LeftArm': 1.10 });

const P_KICK_R_LEAD = entre(P_KICK_R_WIND, P_KICK_R_HIT, 0.5, _tronco(1));
const P_KICK_R_OVER  = entre(P_KICK_R_WIND, P_KICK_R_HIT, 1, { ..._tronco(1.04), 'mixamorig:RightUpLeg': 1.10 });

const P_UPPER_LEAD = entre(P_UPPER_WIND, P_UPPER_HIT, 0.5, _tronco(1));
const P_UPPER_OVER  = entre(P_UPPER_WIND, P_UPPER_HIT, 1, { ..._tronco(1.04), 'mixamorig:RightArm': 1.10 });

const P_AXE_LEAD = entre(P_AXE_WIND, P_AXE_HIT, 0.5, _tronco(1));
const P_AXE_OVER  = entre(P_AXE_WIND, P_AXE_HIT, 1, { ..._tronco(1.04), 'mixamorig:RightUpLeg': 1.10 });

const P_SMASH_LEAD = entre(P_SMASH_WIND, P_SMASH_HIT, 0.5, _tronco(1));
const P_SMASH_OVER  = entre(P_SMASH_WIND, P_SMASH_HIT, 1, { ..._tronco(1.04), 'mixamorig:RightArm': 1.10 });

/* --- guarda --------------------------------------------------------------- */
const P_BLOCK = mix(P_BASE, {
  'mixamorig:Spine':        [ 10,   0,  0],
  'mixamorig:Spine1':       [  6,   0,  0],
  'mixamorig:Head':         [  8,   0,  0],
  'mixamorig:LeftArm':      [-14, -74,-26],
  'mixamorig:LeftForeArm':  [  0,-102,  0],
  'mixamorig:RightArm':     [-14,  74, 26],
  'mixamorig:RightForeArm': [  0, 102,  0],
  'mixamorig:LeftUpLeg':    [-10,   0, -6],
  'mixamorig:LeftLeg':      [ 24,   0,  0],
  'mixamorig:RightUpLeg':   [-10,   0,  6],
  'mixamorig:RightLeg':     [ 24,   0,  0],
});

const P_BLOCK_IMPACT = mix(P_BLOCK, {
  'mixamorig:Spine':        [ -6,   0,  0],
  'mixamorig:LeftArm':      [-22, -62,-32],
  'mixamorig:RightArm':     [-22,  62, 32],
  'mixamorig:LeftForeArm':  [  0, -86,  0],
  'mixamorig:RightForeArm': [  0,  86,  0],
});

/* --- levar dano ----------------------------------------------------------- */
const P_HIT = mix(P_BASE, {
  'mixamorig:Spine':        [-20,   0,  0],
  'mixamorig:Spine1':       [-16,  12,  0],
  'mixamorig:Spine2':       [ -8,   8,  0],
  'mixamorig:Neck':         [-18,   0,  0],
  'mixamorig:Head':         [-24,  10,  0],
  'mixamorig:LeftArm':      [  0, -12,-40],
  'mixamorig:LeftForeArm':  [  0, -52,  0],
  'mixamorig:RightArm':     [  0,  12, 40],
  'mixamorig:RightForeArm': [  0,  52,  0],
  'mixamorig:LeftUpLeg':    [-16,   0, -8],
  'mixamorig:LeftLeg':      [ 28,   0,  0],
  'mixamorig:RightUpLeg':   [-16,   0,  8],
  'mixamorig:RightLeg':     [ 28,   0,  0],
});

/* --- blowaway: corpo mole voando (o estado pós-smash) --------------------- */
const P_BLOWAWAY_A = mix(P_BASE, {
  'mixamorig:Spine':        [-26,   0,  6],
  'mixamorig:Spine1':       [-18,  10, -4],
  'mixamorig:Neck':         [-20,   0,  0],
  'mixamorig:Head':         [-26,   6,  0],
  'mixamorig:LeftArm':      [  0,  46,-88],
  'mixamorig:LeftForeArm':  [  0, -30,  0],
  'mixamorig:RightArm':     [  0, -52, 92],
  'mixamorig:RightForeArm': [  0,  24,  0],
  'mixamorig:LeftUpLeg':    [-12,   0,-10],
  'mixamorig:LeftLeg':      [ 34,   0,  0],
  'mixamorig:RightUpLeg':   [  6,   0, 12],
  'mixamorig:RightLeg':     [ 18,   0,  0],
});

const P_BLOWAWAY_B = mix(P_BLOWAWAY_A, {
  'mixamorig:Spine':        [-20,   0, -8],
  'mixamorig:Spine1':       [-14, -12,  6],
  'mixamorig:Head':         [-20,  -8,  0],
  'mixamorig:LeftArm':      [  0,  30,-94],
  'mixamorig:RightArm':     [  0, -38, 86],
  'mixamorig:LeftUpLeg':    [  4,   0, -8],
  'mixamorig:RightUpLeg':   [-14,   0, 10],
  'mixamorig:RightLeg':     [ 38,   0,  0],
});

/* --- caído / levantar ------------------------------------------------------ */
const P_DOWN = mix(P_BASE, {
  'mixamorig:Spine':        [ 12,   0,  0],
  'mixamorig:Spine1':       [  8,   0,  0],
  'mixamorig:Neck':         [-14,   0,  0],
  'mixamorig:Head':         [-18,   0,  0],
  'mixamorig:LeftArm':      [  0,  28,-86],
  'mixamorig:LeftForeArm':  [  0, -46,  0],
  'mixamorig:RightArm':     [  0, -28, 86],
  'mixamorig:RightForeArm': [  0,  46,  0],
  'mixamorig:LeftUpLeg':    [-18,   0,-12],
  'mixamorig:LeftLeg':      [ 34,   0,  0],
  'mixamorig:RightUpLeg':   [-10,   0, 10],
  'mixamorig:RightLeg':     [ 26,   0,  0],
});

const P_GETUP_CROUCH = mix(P_BASE, {
  'mixamorig:Spine':        [ 34,   0,  0],
  'mixamorig:Spine1':       [ 20,   0,  0],
  'mixamorig:Neck':         [-26,   0,  0],
  'mixamorig:Head':         [-30,   0,  0],
  'mixamorig:LeftArm':      [  0, -44,-56],
  'mixamorig:LeftForeArm':  [  0, -76,  0],
  'mixamorig:RightArm':     [  0,  44, 56],
  'mixamorig:RightForeArm': [  0,  76,  0],
  'mixamorig:LeftUpLeg':    [-52,   0, -8],
  'mixamorig:LeftLeg':      [ 86,   0,  0],
  'mixamorig:RightUpLeg':   [-46,   0,  8],
  'mixamorig:RightLeg':     [ 80,   0,  0],
});

/* --- step / esquiva -------------------------------------------------------- */
const P_STEP = mix(P_GUARD_READY, {
  'mixamorig:Spine':        [  8,   0, 14],
  'mixamorig:Spine1':       [  6,   0, 10],
  'mixamorig:LeftUpLeg':    [-20,   0,-16],
  'mixamorig:LeftLeg':      [ 44,   0,  0],
  'mixamorig:RightUpLeg':   [ 14,   0, 10],
  'mixamorig:RightLeg':     [ 22,   0,  0],
});

/* --- blast: palma estendida ------------------------------------------------ */
const P_BLAST = mix(P_GUARD_READY, {
  'mixamorig:Spine1':       [  2, -20,  0],
  'mixamorig:RightShoulder':[  0,  14, -4],
  'mixamorig:RightArm':     [  0,  88, 64],
  'mixamorig:RightForeArm': [  0,  10,  0],
  'mixamorig:RightHand':    [  0, -18,  0],
  'mixamorig:LeftArm':      [  0, -40,-48],
  'mixamorig:LeftForeArm':  [  0, -98,  0],
});

/* --- ultimate: mãos em concha ao lado do corpo (pose Kamehameha) ---------- */
const P_ULT_CHARGE = mix(P_BASE, {
  'mixamorig:Spine':        [  4,  28,  0],
  'mixamorig:Spine1':       [  2,  20,  0],
  'mixamorig:Spine2':       [  0,  12,  0],
  'mixamorig:Head':         [ -4, -28,  0],
  'mixamorig:LeftArm':      [ 14, -18,-34],
  'mixamorig:LeftForeArm':  [  0,-118,  0],
  'mixamorig:LeftHand':     [  0, -20, 10],
  'mixamorig:RightArm':     [ 14,  18, 34],
  'mixamorig:RightForeArm': [  0, 118,  0],
  'mixamorig:RightHand':    [  0,  20,-10],
  'mixamorig:LeftUpLeg':    [-14,   0,-14],
  'mixamorig:LeftLeg':      [ 34,   0,  0],
  'mixamorig:RightUpLeg':   [ -6,   0, 16],
  'mixamorig:RightLeg':     [ 26,   0,  0],
});

const P_ULT_FIRE = mix(P_BASE, {
  'mixamorig:Spine':        [  6, -18,  0],
  'mixamorig:Spine1':       [  4, -14,  0],
  'mixamorig:Head':         [ -6,  14,  0],
  'mixamorig:LeftArm':      [  0, -84,-56],
  'mixamorig:LeftForeArm':  [  0, -12,  0],
  'mixamorig:LeftHand':     [  0,   0, 14],
  'mixamorig:RightArm':     [  0,  84, 56],
  'mixamorig:RightForeArm': [  0,  12,  0],
  'mixamorig:RightHand':    [  0,   0,-14],
  'mixamorig:LeftUpLeg':    [-20,   0,-12],
  'mixamorig:LeftLeg':      [ 40,   0,  0],
  'mixamorig:RightUpLeg':   [ 14,   0, 12],
  'mixamorig:RightLeg':     [ 20,   0,  0],
});

/* ==========================================================================
 *  DEFINIÇÃO DOS CLIPES
 *  { base, loop, keys: [ [tempoSegundos, pose, ease?], ... ] }
 *  `ease` opcional ('in' | 'out' | 'inout') curva o segmento que TERMINA
 *  naquela key. Sem tag = linear (comportamento de sempre).
 * ========================================================================== */
const CLIPS = {
  idle: {
    base: P_GUARD_READY, loop: true,
    keys: [[0, P_GUARD_READY], [1.15, P_BREATHE_IN], [2.3, P_GUARD_READY]],
  },

  walk: {   // "voo lento" — hover com leve inclinação
    base: P_BASE, loop: true,
    keys: [
      [0,    mix(P_BASE, { 'mixamorig:Spine': [6, 0, 2], 'mixamorig:LeftUpLeg': [2, 0, -4] })],
      [0.6,  mix(P_BASE, { 'mixamorig:Spine': [9, 0, -2], 'mixamorig:RightUpLeg': [2, 0, 4] })],
      [1.2,  mix(P_BASE, { 'mixamorig:Spine': [6, 0, 2], 'mixamorig:LeftUpLeg': [2, 0, -4] })],
    ],
  },

  run: {    // voo com boost
    base: P_FLY, loop: true,
    keys: [
      [0,   P_FLY],
      [0.45, mix(P_FLY, {
        'mixamorig:Spine':      [19, 0, -3],
        'mixamorig:LeftUpLeg':  [12, 0, -3],
        'mixamorig:RightUpLeg': [20, 0,  3],
      })],
      [0.9, P_FLY],
    ],
  },

  dash: { base: P_DASH, loop: true, keys: [[0, P_DASH], [0.5, mix(P_DASH, { 'mixamorig:Spine': [37, 0, 2] })], [1.0, P_DASH]] },

  charge: {
    base: P_CHARGE, loop: true,
    keys: [[0, P_CHARGE], [0.22, P_CHARGE_PEAK], [0.44, P_CHARGE]],
  },

  /* Socos. Os tempos batem com o frame data de tuning.js: o impacto é a key
   * em `hit` e NUNCA sai de lá (ancora a grade inteira). Entre wind e hit
   * entra a LEAD (meio do arco, antecipação) e depois do hit a OVER (passa
   * do alvo e volta = snap). Cadeia de ease: wind 'out' (sai rápido do
   * neutro), LEAD 'in' (acelera pro impacto), hit 'out' (frena no contato),
   * OVER 'in' (arranca do contato), guarda 'out' (volta e assenta). */
  attack_light_1: {
    base: P_GUARD_READY, loop: false,
    keys: [[0, P_GUARD_READY], [0.045, P_PUNCH_R_WIND, 'out'], [0.075, P_PUNCH_R_LEAD, 'in'],
      [0.105, P_PUNCH_R_HIT, 'out'], [0.14, P_PUNCH_R_OVER, 'in'], [0.25, P_GUARD_READY, 'out']],
  },
  attack_light_2: {
    base: P_GUARD_READY, loop: false,
    keys: [[0, P_GUARD_READY], [0.045, P_PUNCH_L_WIND, 'out'], [0.075, P_PUNCH_L_LEAD, 'in'],
      [0.105, P_PUNCH_L_HIT, 'out'], [0.14, P_PUNCH_L_OVER, 'in'], [0.25, P_GUARD_READY, 'out']],
  },
  attack_light_3: {
    base: P_GUARD_READY, loop: false,
    keys: [[0, P_GUARD_READY], [0.05, P_KICK_R_WIND, 'out'], [0.082, P_KICK_R_LEAD, 'in'],
      [0.115, P_KICK_R_HIT, 'out'], [0.15, P_KICK_R_OVER, 'in'], [0.28, P_GUARD_READY, 'out']],
  },
  attack_up: {
    base: P_GUARD_READY, loop: false,
    keys: [[0, P_GUARD_READY], [0.06, P_UPPER_WIND, 'out'], [0.095, P_UPPER_LEAD, 'in'],
      [0.13, P_UPPER_HIT, 'out'], [0.165, P_UPPER_OVER, 'in'], [0.34, P_GUARD_READY, 'out']],
  },
  attack_down: {
    base: P_GUARD_READY, loop: false,
    keys: [[0, P_GUARD_READY], [0.065, P_AXE_WIND, 'out'], [0.10, P_AXE_LEAD, 'in'],
      [0.135, P_AXE_HIT, 'out'], [0.17, P_AXE_OVER, 'in'], [0.36, P_GUARD_READY, 'out']],
  },

  /* Smash: tem uma key parada no hit (0.235→0.30) porque o frame data segura
   * o contato — a LEAD/OVER do smash é em volta dessa pausa: LEAD antes do
   * hit, OVER saindo dele e voltando. 'inout' na volta pro neutro: é a
   * recuperação longa (24f), curva suave evita chicote no fim. */
  attack_heavy: {
    base: P_GUARD_READY, loop: false,
    keys: [[0, P_GUARD_READY], [0.14, P_SMASH_WIND, 'out'], [0.187, P_SMASH_LEAD, 'in'],
      [0.235, P_SMASH_HIT, 'out'], [0.27, P_SMASH_OVER, 'in'], [0.30, P_SMASH_HIT, 'out'],
      [0.62, P_GUARD_READY, 'inout']],
  },

  block:        { base: P_BLOCK, loop: true,  keys: [[0, P_BLOCK], [1.4, mix(P_BLOCK, { 'mixamorig:Spine': [12, 0, 0] })], [2.8, P_BLOCK]] },
  block_impact: { base: P_BLOCK, loop: false, keys: [[0, P_BLOCK], [0.05, P_BLOCK_IMPACT], [0.22, P_BLOCK]] },

  dodge: { base: P_GUARD_READY, loop: false, keys: [[0, P_GUARD_READY], [0.08, P_STEP], [0.33, P_GUARD_READY]] },

  hit_react: { base: P_HIT, loop: false, keys: [[0, P_GUARD_READY], [0.055, P_HIT], [0.30, P_GUARD_READY]] },

  launched: {   // blowaway — tumbling contínuo
    base: P_BLOWAWAY_A, loop: true,
    keys: [[0, P_BLOWAWAY_A], [0.42, P_BLOWAWAY_B], [0.84, P_BLOWAWAY_A]],
  },

  knockdown: { base: P_DOWN, loop: false, keys: [[0, P_BLOWAWAY_A], [0.14, P_DOWN], [0.6, P_DOWN]] },
  getup:     { base: P_GUARD_READY, loop: false, keys: [[0, P_DOWN], [0.16, P_GETUP_CROUCH], [0.37, P_GUARD_READY]] },

  blast:     { base: P_BLAST, loop: false, keys: [[0, P_GUARD_READY], [0.09, P_BLAST], [0.34, P_GUARD_READY]] },

  ultimate:  {
    base: P_ULT_CHARGE, loop: false,
    keys: [[0, P_GUARD_READY], [0.3, P_ULT_CHARGE], [0.66, P_ULT_CHARGE], [0.78, P_ULT_FIRE], [1.9, P_ULT_FIRE], [2.4, P_GUARD_READY]],
  },
};

/* Aliases: nomes lógicos que o combate pede e que reaproveitam clipes. */
const ALIASES = {
  fly: 'run',
  hover: 'idle',
  vanish: 'dodge',
  recover: 'dodge',
  charged_blast: 'blast',
};

/* ==========================================================================
 *  CONSTRUÇÃO DOS AnimationClip
 * ========================================================================== */

/* Easings por segmento. A tag mora na key de DESTINO: curva entre a pose
 * anterior e a dela. Quadráticas de propósito — o overshoot NÃO vem da curva
 * (quadrática não passa de 1), vem das poses LEAD/OVER, que exageram a
 * articulação além do alvo. A curva só decide se o movimento acelera no
 * início (in), desacelera no fim (out) ou faz as duas (inout). */
const EASES = {
  in:    (u) => u * u,
  out:   (u) => 1 - (1 - u) * (1 - u),
  inout: (u) => (u < 0.5 ? 2 * u * u : 1 - 2 * (1 - u) * (1 - u)),
};
const EASE_SUBDIV = 8; // passos por segmento com tag — curva lisa a 60 fps

const _euler = new THREE.Euler();
const _quat = new THREE.Quaternion();
const _qa = new THREE.Quaternion();
const _qb = new THREE.Quaternion();
const _qc = new THREE.Quaternion();

function poseToQuat(deg) {
  _euler.set(deg[0] * D, deg[1] * D, deg[2] * D, 'XYZ');
  return _quat.setFromEuler(_euler);
}

/**
 * Monta um THREE.AnimationClip a partir de uma definição de clipe.
 * Só gera tracks de rotação — igual ao padrão do Mixamo.
 *
 * Uma key pode carregar uma 3ª coluna com a tag de ease
 * (`[tempo, pose, ease]`). A subdivisão acontece na grade de TEMPOS,
 * compartilhada por todos os ossos (todos os tracks precisam dos mesmos
 * instantes). Segmento sem tag gera um único ponto = exatamente o clipe
 * linear antigo; tag desconhecida cai no mesmo caminho (silencioso).
 */
function buildClip(name, def) {
  const { base, keys } = def;

  // União de todos os ossos citados (base + keyframes).
  const boneNames = new Set(Object.keys(base));
  for (const [, pose] of keys) for (const b of Object.keys(pose)) boneNames.add(b);

  // Grade única: cada segmento [key i-1 → key i] vira n sub-passos.
  // `j === n` grava o tempo EXATO da key — a âncora de sincronia com o frame
  // data (impacto em t = hit) não pode derivar por arredondamento.
  const times = [keys[0][0]];
  const segN = [];
  for (let i = 1; i < keys.length; i++) {
    const t0 = keys[i - 1][0], t1 = keys[i][0];
    const n = EASES[keys[i][2]] ? EASE_SUBDIV : 1;
    segN.push(n);
    for (let j = 1; j <= n; j++) {
      times.push(j === n ? t1 : t0 + (t1 - t0) * (j / n));
    }
  }

  const tracks = [];

  for (const bone of boneNames) {
    const values = [];

    // Pose de partida do primeiro segmento (cópia: poseToQuat devolve um
    // temporário compartilhado — guardá-lo sem copiar corromperia os outros).
    _qa.copy(poseToQuat(keys[0][1][bone] || base[bone] || [0, 0, 0]));
    values.push(_qa.x, _qa.y, _qa.z, _qa.w);

    for (let i = 1; i < keys.length; i++) {
      _qb.copy(poseToQuat(keys[i][1][bone] || base[bone] || [0, 0, 0]));
      const n = segN[i - 1];
      const ease = EASES[keys[i][2]];
      for (let j = 1; j <= n; j++) {
        if (j === n) {
          // âncora exata da key (n === 1 ⇒ clipe sem tag, igual ao antigo)
          values.push(_qb.x, _qb.y, _qb.z, _qb.w);
        } else {
          _qc.slerpQuaternions(_qa, _qb, ease(j / n));
          values.push(_qc.x, _qc.y, _qc.z, _qc.w);
        }
      }
      _qa.copy(_qb);
    }

    // Variedade varrida DEPOIS da amostragem (a subdivisão mudou o tamanho do
    // array). Critério igual ao de antes: difere do primeiro valor em 1e-6.
    let varies = false;
    const first = [values[0], values[1], values[2], values[3]];
    for (let k = 4; k < values.length && !varies; k += 4) {
      varies = Math.abs(values[k] - first[0]) > 1e-6
            || Math.abs(values[k + 1] - first[1]) > 1e-6
            || Math.abs(values[k + 2] - first[2]) > 1e-6
            || Math.abs(values[k + 3] - first[3]) > 1e-6;
    }

    // Mesmo ossos "parados" precisam de track: é o que segura a pose
    // quando outro clipe termina. Só descartamos se for idêntico à T-pose.
    if (!varies && Math.abs(first[3] - 1) < 1e-6
        && Math.abs(first[0]) < 1e-6 && Math.abs(first[1]) < 1e-6 && Math.abs(first[2]) < 1e-6) {
      continue;
    }

    tracks.push(new THREE.QuaternionKeyframeTrack(`${bone}.quaternion`, times, values));
  }

  const duration = times[times.length - 1];
  const clip = new THREE.AnimationClip(name, duration, tracks);
  clip.userData = { loop: !!def.loop, procedural: true };
  return clip;
}

let _cache = null;

/** Retorna { nome: AnimationClip } com todos os clipes procedurais. */
export function getProceduralClips() {
  if (_cache) return _cache;
  _cache = {};
  for (const [name, def] of Object.entries(CLIPS)) {
    _cache[name] = buildClip(name, def);
  }
  for (const [alias, target] of Object.entries(ALIASES)) {
    if (_cache[target]) {
      const c = _cache[target].clone();
      c.name = alias;
      c.userData = { ..._cache[target].userData };
      _cache[alias] = c;
    }
  }
  return _cache;
}

export const PROCEDURAL_CLIP_NAMES = Object.keys(CLIPS).concat(Object.keys(ALIASES));
