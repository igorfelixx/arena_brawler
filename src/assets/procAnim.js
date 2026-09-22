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
 *  { base, loop, keys: [ [tempoSegundos, pose], ... ] }
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

  /* Socos. Os tempos batem com o frame data de tuning.js:
   * key 0 = neutro, key 1 = fim do startup (impacto), key 2 = recovery. */
  attack_light_1: {
    base: P_GUARD_READY, loop: false,
    keys: [[0, P_GUARD_READY], [0.045, P_PUNCH_R_WIND], [0.105, P_PUNCH_R_HIT], [0.25, P_GUARD_READY]],
  },
  attack_light_2: {
    base: P_GUARD_READY, loop: false,
    keys: [[0, P_GUARD_READY], [0.045, P_PUNCH_L_WIND], [0.105, P_PUNCH_L_HIT], [0.25, P_GUARD_READY]],
  },
  attack_light_3: {
    base: P_GUARD_READY, loop: false,
    keys: [[0, P_GUARD_READY], [0.05, P_KICK_R_WIND], [0.115, P_KICK_R_HIT], [0.28, P_GUARD_READY]],
  },
  attack_heavy: {
    base: P_GUARD_READY, loop: false,
    keys: [[0, P_GUARD_READY], [0.14, P_SMASH_WIND], [0.235, P_SMASH_HIT], [0.30, P_SMASH_HIT], [0.62, P_GUARD_READY]],
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

const _euler = new THREE.Euler();
const _quat = new THREE.Quaternion();

function poseToQuat(deg) {
  _euler.set(deg[0] * D, deg[1] * D, deg[2] * D, 'XYZ');
  return _quat.setFromEuler(_euler);
}

/**
 * Monta um THREE.AnimationClip a partir de uma definição de clipe.
 * Só gera tracks de rotação — igual ao padrão do Mixamo.
 */
function buildClip(name, def) {
  const { base, keys } = def;

  // União de todos os ossos citados (base + keyframes).
  const boneNames = new Set(Object.keys(base));
  for (const [, pose] of keys) for (const b of Object.keys(pose)) boneNames.add(b);

  const times = keys.map(([t]) => t);
  const tracks = [];

  for (const bone of boneNames) {
    const values = [];
    let varies = false;
    let first = null;

    for (const [, pose] of keys) {
      const deg = pose[bone] || base[bone] || [0, 0, 0];
      const q = poseToQuat(deg);
      values.push(q.x, q.y, q.z, q.w);
      if (first === null) first = [q.x, q.y, q.z, q.w];
      else if (!varies) {
        const n = values.length;
        varies = Math.abs(values[n - 4] - first[0]) > 1e-6
              || Math.abs(values[n - 3] - first[1]) > 1e-6
              || Math.abs(values[n - 2] - first[2]) > 1e-6
              || Math.abs(values[n - 1] - first[3]) > 1e-6;
      }
    }

    // Mesmo ossos "parados" precisam de track: é o que segura a pose
    // quando outro clipe termina. Só descartamos se for idêntico à T-pose.
    if (!varies && first && Math.abs(first[3] - 1) < 1e-6
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
