/* =============================================================================
 *  boneNames.js  —  Vocabulário de nome de osso
 * =============================================================================
 *
 *  Uma pegadinha do three.js que custa horas se você não souber:
 *
 *  O nome canônico dos ossos do Mixamo tem dois-pontos — `mixamorig:LeftArm`.
 *  Mas o three.js trata `:` como SEPARADOR DE DIRETÓRIO dentro de nome de track
 *  de animação. Uma track chamada "mixamorig:LeftArm.quaternion" é interpretada
 *  como "no diretório mixamorig, o nó LeftArm" — e como nenhum objeto se chama
 *  só "LeftArm", a track não liga em nada. O resultado é o clássico:
 *
 *      THREE.PropertyBinding: No target node found for track: ...
 *      → o personagem carrega, aparece, e fica parado em T-pose.
 *
 *  Por isso o GLTFLoader e o FBXLoader passam TODO nome de nó por
 *  `PropertyBinding.sanitizeNodeName`, que remove os caracteres reservados.
 *  Na prática, um personagem do Mixamo carregado no three.js tem ossos
 *  chamados `mixamorigLeftArm`, sem os dois-pontos.
 *
 *  A regra deste projeto, então:
 *
 *      LÓGICO   'mixamorig:LeftArm'    ← é o que aparece em assets.config.js,
 *                                        no tuning e no código. É o que você lê
 *                                        na documentação do Mixamo.
 *      REAL     'mixamorigLeftArm'     ← é como o osso realmente se chama na
 *                                        cena, aqui e em qualquer asset carregado.
 *
 *  A tradução acontece em UM lugar só: o resolvedor de ossos do registry.
 * ========================================================================== */

import * as THREE from 'three';

/**
 * Converte nome lógico → nome real, exatamente como os loaders do three.js
 * fazem. Usar a função deles (e não um replace nosso) garante que o placeholder
 * e um asset importado cheguem no MESMO nome.
 */
export const sanitizeBone = (name) => THREE.PropertyBinding.sanitizeNodeName(name);

/** Nome lógico de referência, usado pra detectar "isto é um rig Mixamo?". */
export const MIXAMO_ROOT = 'mixamorig:Hips';
