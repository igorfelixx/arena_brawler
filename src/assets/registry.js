/* =============================================================================
 *  registry.js  —  A FRONTEIRA DE ASSET
 * =============================================================================
 *
 *  Todo o resto do jogo fala com um objeto `Character` com esta cara:
 *
 *      character.root                 Object3D pra pendurar na cena
 *      character.bones['mixamorig:RightHand']
 *      character.socket('hand_r')     → Object3D do osso, resolvido pelo config
 *      character.play('attack_heavy', { fade, speed, loop })
 *      character.update(dt)
 *      character.height
 *
 *  Se por trás disso está o mannequin procedural ou um Paladin de $40 do Fab,
 *  o jogo não sabe e não se importa. É ISSO que faz a troca ser uma linha.
 *
 *  Responsabilidades desta camada — as coisas chatas que quebram na prática:
 *    - normalizar ESCALA (Mixamo FBX vem em cm, GLB vem em m)
 *    - normalizar ORIENTAÇÃO (nem todo asset nasce olhando pro +Z)
 *    - resolver NOMES DE OSSO (com/sem prefixo `mixamorig:`, ou boneMap manual)
 *    - reescrever as tracks das animações pros nomes de osso reais do modelo
 *    - cair no procedural quando não há arquivo
 * ========================================================================== */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';

import { resolveCharacter, ASSETS } from '../../assets.config.js';
import { buildPlaceholderRig } from './placeholderRig.js';
import { getProceduralClips } from './procAnim.js';
import { sanitizeBone } from './boneNames.js';

const gltfLoader = new GLTFLoader();
const fbxLoader = new FBXLoader();
const fileCache = new Map();

/* ==========================================================================
 *  Carregamento bruto de arquivo (com cache por caminho)
 * ========================================================================== */
function loadFile(path) {
  if (fileCache.has(path)) return fileCache.get(path);

  const ext = path.split('.').pop().toLowerCase();
  let p;

  if (ext === 'glb' || ext === 'gltf') {
    p = gltfLoader.loadAsync(path).then((g) => ({
      scene: g.scene,
      animations: g.animations || [],
    }));
  } else if (ext === 'fbx') {
    p = fbxLoader.loadAsync(path).then((obj) => ({
      scene: obj,
      animations: obj.animations || [],
    }));
  } else {
    p = Promise.reject(new Error(`[registry] extensão não suportada: .${ext} (${path})`));
  }

  p = p.catch((err) => {
    console.error(`[registry] falhou ao carregar "${path}".`, err);
    console.warn('[registry] caindo no placeholder procedural para este asset.');
    return null;
  });

  fileCache.set(path, p);
  return p;
}

/* ==========================================================================
 *  Resolução de nome de osso
 * ========================================================================== */
/**
 * Descobre como os ossos deste modelo se chamam de verdade e devolve uma função
 * que traduz nome lógico Mixamo → nome real.
 *
 * Cobre os três casos que aparecem na vida real:
 *   1. o asset JÁ é Mixamo                    → identidade
 *   2. o asset é Mixamo sem o prefixo         → tira "mixamorig:"
 *   3. o asset tem rig próprio                → usa o boneMap do config
 */
function makeBoneResolver(root, boneMap) {
  const actual = new Map();
  root.traverse((o) => {
    if (o.isBone || o.type === 'Bone') actual.set(o.name, o);
  });

  // Nenhum osso: modelo estático (ex.: cenário). Resolver vira no-op.
  if (actual.size === 0) return { resolve: (n) => n, bones: {}, hasSkeleton: false };

  const has = (n) => actual.has(n);
  let strategy;

  if (boneMap) {
    // Rig próprio, mapeado à mão no config. Sanitiza o destino porque o nome
    // que o usuário digita pode ter caracteres reservados.
    strategy = (logical) => {
      const mapped = boneMap[logical];
      return mapped ? (actual.has(mapped) ? mapped : sanitizeBone(mapped)) : sanitizeBone(logical);
    };
  } else if (has(sanitizeBone('mixamorig:Hips'))) {
    // CAMINHO NORMAL. Vale tanto pro mannequin procedural quanto pra qualquer
    // personagem do Mixamo: os loaders do three.js sanitizam os nomes, então
    // 'mixamorig:LeftArm' vira 'mixamorigLeftArm' nos dois casos.
    strategy = sanitizeBone;
  } else if (has('mixamorig:Hips')) {
    // Rig montado à mão que manteve os dois-pontos.
    strategy = (logical) => logical;
  } else if (has('Hips') || has('hips')) {
    // Mixamo re-exportado sem o namespace (comum ao passar pelo Blender).
    strategy = (logical) => {
      const short = logical.replace(/^mixamorig:/, '');
      return actual.has(short) ? short : short.toLowerCase();
    };
  } else {
    /* Último recurso: casar pelo SUFIXO. Normalizamos os dois lados (tira
     * namespace, pontuação e caixa) porque cada exportador inventa um padrão:
     * 'mixamorig1:LeftArm', 'Armature_LeftArm', 'upperarm_l'... */
    const norm = (s) => s.split(/[:|]/).pop().replace(/[^a-z0-9]/gi, '').toLowerCase();
    const byNorm = new Map();
    for (const name of actual.keys()) {
      const k = norm(name);
      if (!byNorm.has(k)) byNorm.set(k, name);
    }
    strategy = (logical) => byNorm.get(norm(logical)) || sanitizeBone(logical);

    console.warn(
      '[registry] Rig não reconhecido como Mixamo. Usando casamento por sufixo.\n' +
      '           Se as animações ficarem tortas ou o personagem ficar em T-pose,\n' +
      '           preencha `boneMap` em assets.config.js.\n' +
      '           Ossos encontrados:', [...actual.keys()].slice(0, 16),
    );
  }

  const bones = {};
  for (const [name, bone] of actual) bones[name] = bone;

  return { resolve: strategy, bones, hasSkeleton: true, actual };
}

/* ==========================================================================
 *  Reescrita de tracks para os nomes de osso reais
 * ========================================================================== */
/**
 * Um AnimationClip aponta pra ossos por nome ("mixamorig:LeftArm.quaternion").
 * Se o modelo chama diferente, a track não acha nada e o osso fica parado —
 * é a causa nº 1 de "troquei o asset e o personagem ficou em T-pose".
 *
 * @param {number} posScale  escala a aplicar em tracks de POSIÇÃO. Mixamo FBX
 *                           vem em centímetros; sem isto o quadril voa longe.
 */
function retargetClip(clip, resolve, posScale = 1) {
  const out = clip.clone();
  out.tracks = out.tracks
    .map((track) => {
      const dot = track.name.lastIndexOf('.');
      const nodeName = track.name.slice(0, dot);
      const prop = track.name.slice(dot + 1);

      const t = track.clone();
      t.name = `${resolve(nodeName)}.${prop}`;

      if (prop === 'position' && posScale !== 1) {
        const v = t.values.slice();
        for (let i = 0; i < v.length; i++) v[i] *= posScale;
        t.values = v;
      }
      return t;
    })
    // Descartamos tracks de escala: nenhum uso legítimo aqui e elas
    // frequentemente vêm corrompidas de exports de FBX.
    .filter((t) => !t.name.endsWith('.scale'));

  return out;
}

/* ==========================================================================
 *  Normalização de escala e orientação
 * ========================================================================== */
function normalizeModel(scene, cfg) {
  const container = new THREE.Group();

  // --- escala ---
  let scale = 1;
  if (cfg.scale === 'auto') {
    const box = new THREE.Box3().setFromObject(scene);
    const size = new THREE.Vector3();
    box.getSize(size);
    const h = size.y || 1;
    scale = (cfg.targetHeight || 1.8) / h;
    if (!isFinite(scale) || scale <= 0) scale = 1;
  } else if (typeof cfg.scale === 'number') {
    scale = cfg.scale;
  }
  scene.scale.setScalar(scale);

  // --- apoiar no "chão" local (pés em y=0) ---
  const box2 = new THREE.Box3().setFromObject(scene);
  scene.position.y -= box2.min.y;

  // --- orientação: girar até o asset olhar pro +Z ---
  const yawByForward = { '+z': 0, '-z': Math.PI, '+x': -Math.PI / 2, '-x': Math.PI / 2 };
  const yaw = (yawByForward[cfg.forward] ?? 0) + (cfg.yawOffsetDeg || 0) * Math.PI / 180;

  const pivot = new THREE.Group();
  pivot.rotation.y = yaw;
  pivot.add(scene);
  container.add(pivot);

  scene.traverse((o) => {
    if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; }
  });

  return { container, scale };
}

/* ==========================================================================
 *  Classe Character — a interface única
 * ========================================================================== */
class Character {
  constructor({ root, bones, resolve, mixer, clips, sockets, height, isPlaceholder, materials }) {
    this.root = root;
    this.bones = bones;
    this._resolve = resolve;
    this.mixer = mixer;
    this.clips = clips;               // nome lógico → AnimationClip (já retargetado)
    this._socketCfg = sockets;
    this.height = height;
    this.isPlaceholder = isPlaceholder;
    this.materials = materials || {};

    this._actions = new Map();
    this._current = null;
    this._currentName = null;
    this._socketCache = new Map();
  }

  /** Object3D do osso apontado por um socket lógico ('hand_r'). */
  socket(name) {
    if (this._socketCache.has(name)) return this._socketCache.get(name);
    const logical = this._socketCfg?.[name];
    let obj = null;
    if (logical) obj = this.bones[this._resolve(logical)] || this.bones[logical] || null;
    if (!obj) {
      console.warn(`[registry] socket "${name}" não resolveu (osso "${logical}"). Usando a raiz.`);
      obj = this.root;
    }
    this._socketCache.set(name, obj);
    return obj;
  }

  _action(name) {
    if (this._actions.has(name)) return this._actions.get(name);
    const clip = this.clips[name];
    if (!clip) return null;
    const action = this.mixer.clipAction(clip);
    this._actions.set(name, action);
    return action;
  }

  /**
   * Toca um clipe lógico.
   * @param {string} name
   * @param {object} opts { fade, speed, loop, restart, clampWhenFinished }
   */
  play(name, opts = {}) {
    const { fade = 0.12, speed = 1, loop = null, restart = false } = opts;

    const action = this._action(name);
    if (!action) {
      if (!this._warned?.has(name)) {
        (this._warned ||= new Set()).add(name);
        console.warn(`[registry] clipe "${name}" não existe. Mantendo a animação atual.`);
      }
      return null;
    }

    if (this._currentName === name && !restart) {
      action.timeScale = speed;
      return action;
    }

    const clip = this.clips[name];
    const shouldLoop = loop !== null ? loop : !!clip.userData?.loop;

    action.reset();
    action.timeScale = speed;
    action.setLoop(shouldLoop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
    action.clampWhenFinished = !shouldLoop;
    action.enabled = true;

    if (this._current && this._current !== action) {
      action.crossFadeFrom(this._current, fade, false);
    }
    action.play();

    this._current = action;
    this._currentName = name;
    return action;
  }

  get currentClip() { return this._currentName; }

  /** Progresso 0..1 do clipe atual (útil pra sincronizar VFX com a animação). */
  get clipProgress() {
    if (!this._current) return 0;
    const d = this._current.getClip().duration;
    return d > 0 ? (this._current.time % d) / d : 0;
  }

  setTint(color) {
    const c = new THREE.Color(color);
    if (this.materials.body) this.materials.body.color.copy(c);
    if (this.materials.joint) this.materials.joint.color.copy(c.clone().multiplyScalar(0.72));
    if (this.materials.head) this.materials.head.color.copy(c.clone().lerp(new THREE.Color(0xffffff), 0.12));
  }

  /** Aplica um clarão branco no corpo inteiro (impacto). 0..1 */
  setFlash(amount) {
    const e = new THREE.Color(0xffffff).multiplyScalar(amount);
    for (const mat of Object.values(this.materials)) {
      if (mat?.emissive) mat.emissive.copy(e);
    }
  }

  update(dt) { this.mixer.update(dt); }

  dispose() { this.mixer.stopAllAction(); }
}

/* ==========================================================================
 *  Carregamento de personagem
 * ========================================================================== */
/**
 * @param {string} id  chave em ASSETS.characters
 * @returns {Promise<Character>}
 */
export async function loadCharacter(id) {
  const cfg = resolveCharacter(id);
  const procClips = getProceduralClips();

  let root, bones, resolve, height, isPlaceholder, materials, modelScale = 1;

  /* ---------- 1. modelo ---------- */
  let loaded = cfg.source ? await loadFile(cfg.source) : null;

  if (loaded?.scene) {
    const src = cfg.source.toLowerCase();
    const { container, scale } = normalizeModel(src.endsWith('.fbx')
      ? loaded.scene
      : loaded.scene, cfg);

    root = container;
    modelScale = scale;
    height = cfg.targetHeight || 1.8;
    isPlaceholder = false;

    const r = makeBoneResolver(root, cfg.boneMap);
    bones = r.bones;
    resolve = r.resolve;

    if (!r.hasSkeleton) {
      console.warn(`[registry] "${cfg.source}" não tem esqueleto. As animações não vão rodar.\n` +
                   '           No Mixamo, exporte com "With Skin".');
    }

    materials = collectMaterials(root);
  } else {
    const rig = buildPlaceholderRig({ tint: cfg.placeholderTint });
    root = rig.root;
    bones = rig.bones;
    // Mesma tradução de um asset de verdade — é o que mantém o caminho de
    // troca exercitado mesmo sem nenhum arquivo no projeto.
    resolve = sanitizeBone;
    height = rig.height;
    isPlaceholder = true;
    materials = rig.materials;
  }

  /* ---------- 2. animações ---------- */
  const mixer = new THREE.AnimationMixer(root);
  const clips = {};

  // Animações embutidas no próprio arquivo do modelo, indexadas por nome.
  const embedded = new Map();
  for (const a of loaded?.animations || []) embedded.set(a.name, a);

  for (const [logical, spec] of Object.entries(cfg.clips || {})) {
    let clip = null;

    if (spec?.file) {
      // Arquivo dedicado (padrão Mixamo "Without Skin": 1 animação por arquivo).
      const data = await loadFile(spec.file);
      if (data?.animations?.length) {
        clip = spec.clip
          ? data.animations.find((a) => a.name === spec.clip) || data.animations[0]
          : data.animations[0];
        if (spec.clip && !data.animations.some((a) => a.name === spec.clip)) {
          console.warn(`[registry] clipe "${spec.clip}" não achado em ${spec.file}. ` +
                       `Disponíveis: ${data.animations.map((a) => a.name).join(', ')}`);
        }
      }
    } else if (spec?.clip && embedded.size) {
      clip = embedded.get(spec.clip) || null;
      if (!clip) {
        console.warn(`[registry] clipe "${spec.clip}" não achado no modelo. ` +
                     `Disponíveis: ${[...embedded.keys()].join(', ')}`);
      }
    }

    if (clip) {
      clip = retargetClip(clip, resolve, isPlaceholder ? 1 : modelScale);
      clip.userData = { ...(clip.userData || {}), loop: spec.loop ?? true };
    } else {
      // Fallback procedural. Passa pelo retarget SEMPRE — inclusive no
      // placeholder — porque os clipes procedurais são escritos com nomes
      // lógicos ('mixamorig:LeftArm') e precisam virar nomes reais.
      const proc = procClips[logical];
      if (proc) {
        clip = retargetClip(proc, resolve, 1);
        clip.userData = { ...(proc.userData || {}), loop: spec?.loop ?? proc.userData?.loop };
      }
    }

    if (clip) clips[logical] = clip;
  }

  // Clipes procedurais extras que o config não lista (blast, dash, charge, ...).
  for (const [name, proc] of Object.entries(procClips)) {
    if (clips[name]) continue;
    clips[name] = retargetClip(proc, resolve, 1);
  }

  const character = new Character({
    root, bones, resolve, mixer, clips,
    sockets: cfg.sockets, height, isPlaceholder, materials,
  });

  character.play('idle', { fade: 0 });
  return character;
}

function collectMaterials(root) {
  const out = {};
  let i = 0;
  root.traverse((o) => {
    if (o.isMesh && o.material) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) out[`mat_${i++}`] = m;
    }
  });
  return out;
}

/* ==========================================================================
 *  Arena
 * ========================================================================== */
export async function loadArenaModel(radius) {
  const cfg = ASSETS.arena;
  if (!cfg.source) return null;

  const data = await loadFile(cfg.source);
  if (!data?.scene) return null;

  const scene = data.scene;
  const box = new THREE.Box3().setFromObject(scene);
  const size = new THREE.Vector3();
  box.getSize(size);

  // Escala o modelo pra caber no raio jogável definido em tuning.js.
  const modelRadius = Math.max(size.x, size.z) / 2 || 1;
  const scale = cfg.scale === 'auto' ? radius / modelRadius : (cfg.scale || 1);
  scene.scale.setScalar(scale);

  const box2 = new THREE.Box3().setFromObject(scene);
  scene.position.y += (cfg.floorY ?? 0) - box2.max.y;

  scene.traverse((o) => { if (o.isMesh) o.receiveShadow = true; });
  return scene;
}

/* ==========================================================================
 *  Texturas (null no config = gerada em canvas, sem arquivo)
 * ========================================================================== */
const texCache = new Map();

export function getTexture(name) {
  if (texCache.has(name)) return texCache.get(name);

  const cfg = ASSETS.textures[name];
  let tex;

  if (cfg?.file) {
    tex = new THREE.TextureLoader().load(cfg.file);
  } else {
    tex = makeProceduralTexture(name);
  }
  tex.colorSpace = THREE.SRGBColorSpace;
  texCache.set(name, tex);
  return tex;
}

/** Texturas geradas em canvas — evita depender de arquivo pra VFX. */
function makeProceduralTexture(name) {
  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d');

  if (name === 'ring_shock') {
    const g = ctx.createRadialGradient(S / 2, S / 2, S * 0.30, S / 2, S / 2, S * 0.5);
    g.addColorStop(0.00, 'rgba(255,255,255,0)');
    g.addColorStop(0.55, 'rgba(255,255,255,0.95)');
    g.addColorStop(0.80, 'rgba(160,220,255,0.45)');
    g.addColorStop(1.00, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
  } else if (name === 'dust') {
    const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    g.addColorStop(0.0, 'rgba(255,255,255,0.55)');
    g.addColorStop(0.5, 'rgba(210,200,185,0.28)');
    g.addColorStop(1.0, 'rgba(210,200,185,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
  } else {
    // hit_spark (padrão): núcleo branco com halo
    const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    g.addColorStop(0.00, 'rgba(255,255,255,1)');
    g.addColorStop(0.22, 'rgba(255,255,255,0.92)');
    g.addColorStop(0.45, 'rgba(180,235,255,0.42)');
    g.addColorStop(1.00, 'rgba(120,200,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
  }

  return new THREE.CanvasTexture(c);
}
