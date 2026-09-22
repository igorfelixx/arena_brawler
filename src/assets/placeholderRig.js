/* =============================================================================
 *  placeholderRig.js  —  Mannequin procedural com esqueleto MIXAMO
 * =============================================================================
 *
 *  Por que não é uma cápsula:
 *
 *  Se o placeholder fosse uma cápsula, o caminho de troca de asset nunca seria
 *  exercitado, e no dia em que você comprasse o personagem nada funcionaria.
 *  Este boneco tem osso de verdade, com os nomes EXATOS do Mixamo
 *  (mixamorig:Hips, mixamorig:RightHand, ...). Consequência prática:
 *
 *    - As animações procedurais daqui rodam num personagem Mixamo de verdade.
 *    - As animações do Mixamo rodam neste boneco.
 *    - Trocar asset é trocar uma linha em assets.config.js, como prometido.
 *
 *  O visual é um mannequin de madeira articulado. Não é bonito, mas é honesto:
 *  tem proporção humana, articulação real e peso. Dá pra julgar o COMBATE.
 * ========================================================================== */

import * as THREE from 'three';
import { sanitizeBone } from './boneNames.js';

/* Hierarquia Mixamo. offset = posição local em metros, na T-pose.
 * Personagem de referência: 1.80 m. */
const SKELETON = [
  // [nome, pai, offset]
  ['mixamorig:Hips',          null,                      [0, 0.98, 0]],

  ['mixamorig:Spine',         'mixamorig:Hips',          [0, 0.10, 0]],
  ['mixamorig:Spine1',        'mixamorig:Spine',         [0, 0.12, 0]],
  ['mixamorig:Spine2',        'mixamorig:Spine1',        [0, 0.12, 0]],
  ['mixamorig:Neck',          'mixamorig:Spine2',        [0, 0.17, 0]],
  ['mixamorig:Head',          'mixamorig:Neck',          [0, 0.09, 0]],
  ['mixamorig:HeadTop_End',   'mixamorig:Head',          [0, 0.19, 0]],

  ['mixamorig:LeftShoulder',  'mixamorig:Spine2',        [ 0.055, 0.11, 0]],
  ['mixamorig:LeftArm',       'mixamorig:LeftShoulder',  [ 0.13, 0, 0]],
  ['mixamorig:LeftForeArm',   'mixamorig:LeftArm',       [ 0.27, 0, 0]],
  ['mixamorig:LeftHand',      'mixamorig:LeftForeArm',   [ 0.25, 0, 0]],

  ['mixamorig:RightShoulder', 'mixamorig:Spine2',        [-0.055, 0.11, 0]],
  ['mixamorig:RightArm',      'mixamorig:RightShoulder', [-0.13, 0, 0]],
  ['mixamorig:RightForeArm',  'mixamorig:RightArm',      [-0.27, 0, 0]],
  ['mixamorig:RightHand',     'mixamorig:RightForeArm',  [-0.25, 0, 0]],

  ['mixamorig:LeftUpLeg',     'mixamorig:Hips',          [ 0.09, -0.05, 0]],
  ['mixamorig:LeftLeg',       'mixamorig:LeftUpLeg',     [0, -0.42, 0]],
  ['mixamorig:LeftFoot',      'mixamorig:LeftLeg',       [0, -0.41, 0]],
  ['mixamorig:LeftToeBase',   'mixamorig:LeftFoot',      [0, -0.07, 0.13]],
  ['mixamorig:LeftToe_End',   'mixamorig:LeftToeBase',   [0, 0, 0.08]],

  ['mixamorig:RightUpLeg',    'mixamorig:Hips',          [-0.09, -0.05, 0]],
  ['mixamorig:RightLeg',      'mixamorig:RightUpLeg',    [0, -0.42, 0]],
  ['mixamorig:RightFoot',     'mixamorig:RightLeg',      [0, -0.41, 0]],
  ['mixamorig:RightToeBase',  'mixamorig:RightFoot',     [0, -0.07, 0.13]],
  ['mixamorig:RightToe_End',  'mixamorig:RightToeBase',  [0, 0, 0.08]],
];

/* Geometria pendurada em cada osso.
 * [ossoPai, ossoFilho(direção), raio, tipo]  — tipo: 'limb' | 'torso' | 'head' */
const BODY = [
  ['mixamorig:Hips',          'mixamorig:Spine1',        0.135, 'torso'],
  ['mixamorig:Spine1',        'mixamorig:Neck',          0.155, 'torso'],
  ['mixamorig:Neck',          'mixamorig:Head',          0.055, 'limb'],
  ['mixamorig:Head',          'mixamorig:HeadTop_End',   0.105, 'head'],

  ['mixamorig:LeftArm',       'mixamorig:LeftForeArm',   0.062, 'limb'],
  ['mixamorig:LeftForeArm',   'mixamorig:LeftHand',      0.052, 'limb'],
  ['mixamorig:RightArm',      'mixamorig:RightForeArm',  0.062, 'limb'],
  ['mixamorig:RightForeArm',  'mixamorig:RightHand',     0.052, 'limb'],

  ['mixamorig:LeftUpLeg',     'mixamorig:LeftLeg',       0.085, 'limb'],
  ['mixamorig:LeftLeg',       'mixamorig:LeftFoot',      0.072, 'limb'],
  ['mixamorig:RightUpLeg',    'mixamorig:RightLeg',      0.085, 'limb'],
  ['mixamorig:RightLeg',      'mixamorig:RightFoot',     0.072, 'limb'],
];

/* Extremidades: esferas/caixas soltas (mãos e pés). */
const EXTREMITIES = [
  ['mixamorig:LeftHand',  0.068, [ 0.05, 0, 0]],
  ['mixamorig:RightHand', 0.068, [-0.05, 0, 0]],
  ['mixamorig:LeftFoot',  0.070, [0, -0.045, 0.055]],
  ['mixamorig:RightFoot', 0.070, [0, -0.045, 0.055]],
];

const UP = new THREE.Vector3(0, 1, 0);

/**
 * Constrói o mannequin.
 * @param {object} opts
 * @param {number} opts.tint  cor base
 * @returns {{ root, bones, meshes, materials, height }}
 */
export function buildPlaceholderRig({ tint = 0xb98a5a } = {}) {
  const bones = {};
  const root = new THREE.Group();
  root.name = 'PlaceholderRig';

  // --- esqueleto ---
  // `bones` é indexado pelo nome LÓGICO (com dois-pontos) porque é assim que as
  // listas BODY/EXTREMITIES abaixo se referem aos ossos. Já o `name` do objeto
  // na cena recebe o nome REAL (sanitizado) — o mesmo que um asset do Mixamo
  // teria depois de passar pelo loader. Ver src/assets/boneNames.js.
  for (const [name, parent, offset] of SKELETON) {
    const bone = new THREE.Bone();
    bone.name = sanitizeBone(name);
    bone.position.fromArray(offset);
    bones[name] = bone;
    if (parent) bones[parent].add(bone);
    else root.add(bone);
  }

  // --- materiais ---
  const base = new THREE.Color(tint);
  const matBody = new THREE.MeshStandardMaterial({
    color: base,
    roughness: 0.62,
    metalness: 0.06,
  });
  const matJoint = new THREE.MeshStandardMaterial({
    color: base.clone().multiplyScalar(0.72),
    roughness: 0.5,
    metalness: 0.12,
  });
  const matHead = new THREE.MeshStandardMaterial({
    color: base.clone().lerp(new THREE.Color(0xffffff), 0.12),
    roughness: 0.55,
    metalness: 0.06,
  });

  const meshes = [];
  const addMesh = (bone, geo, mat) => {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = true;
    m.receiveShadow = true;
    bone.add(m);
    meshes.push(m);
    return m;
  };

  // --- corpo: um segmento por par (osso → filho) ---
  for (const [fromName, toName, radius, kind] of BODY) {
    const from = bones[fromName];
    const to = bones[toName];
    if (!from || !to) continue;

    // Direção e comprimento no espaço LOCAL do osso pai. Como `to` pode ser
    // neto (ex.: Hips → Spine1), acumulamos os offsets da cadeia.
    const dir = localOffsetBetween(bones, fromName, toName);
    const len = dir.length();
    if (len < 1e-5) continue;

    let geo;
    if (kind === 'torso') {
      // Torso: caixa levemente arredondada fica mais legível que cápsula.
      geo = new THREE.BoxGeometry(radius * 2.05, len, radius * 1.35, 2, 2, 2);
      geo.translate(0, len / 2, 0);
    } else if (kind === 'head') {
      geo = new THREE.SphereGeometry(radius, 20, 16);
      geo.scale(0.92, 1.12, 1.0);
      geo.translate(0, len * 0.46, 0);
    } else {
      geo = new THREE.CapsuleGeometry(radius, Math.max(len - radius * 2, 0.02), 4, 12);
      geo.translate(0, len / 2, 0);
    }

    const mesh = addMesh(from, geo, kind === 'head' ? matHead : matBody);
    mesh.quaternion.setFromUnitVectors(UP, dir.clone().normalize());
  }

  // --- extremidades ---
  for (const [boneName, radius, offset] of EXTREMITIES) {
    const bone = bones[boneName];
    if (!bone) continue;
    const geo = new THREE.SphereGeometry(radius, 14, 12);
    geo.translate(...offset);
    addMesh(bone, geo, matJoint);
  }

  // --- articulações: esferinhas nos ombros/quadris/joelhos/cotovelos ---
  for (const jn of [
    'mixamorig:LeftArm', 'mixamorig:RightArm',
    'mixamorig:LeftForeArm', 'mixamorig:RightForeArm',
    'mixamorig:LeftUpLeg', 'mixamorig:RightUpLeg',
    'mixamorig:LeftLeg', 'mixamorig:RightLeg',
  ]) {
    const bone = bones[jn];
    if (!bone) continue;
    const r = jn.includes('UpLeg') ? 0.092 : jn.includes('Leg') ? 0.076 : jn.includes('ForeArm') ? 0.056 : 0.068;
    addMesh(bone, new THREE.SphereGeometry(r, 14, 12), matJoint);
  }

  // Reindexa pelo nome REAL: é assim que o registry consulta os ossos, tanto
  // aqui quanto num asset carregado. Uma chave só pro resto do jogo.
  const bonesByRealName = {};
  for (const [logical, bone] of Object.entries(bones)) {
    bonesByRealName[sanitizeBone(logical)] = bone;
  }

  return {
    root,
    bones: bonesByRealName,
    meshes,
    materials: { body: matBody, joint: matJoint, head: matHead },
    height: 1.8,
    isPlaceholder: true,
  };
}

/* Soma os offsets da cadeia `from` → `to` (to deve ser descendente de from). */
function localOffsetBetween(bones, fromName, toName) {
  const out = new THREE.Vector3();
  let cur = bones[toName];
  const stop = bones[fromName];
  const guard = 32;
  let i = 0;
  while (cur && cur !== stop && i++ < guard) {
    out.add(cur.position);
    cur = cur.parent;
  }
  return out;
}

/* Nomes de osso que o resto do código pode pedir. Exportado pra validação. */
export const MIXAMO_BONES = SKELETON.map(([n]) => n);
