/* =============================================================================
 *  vfx.js  —  Faíscas, aura de ki, afterimages, speed lines, rastros, ondas
 * =============================================================================
 *
 *  Por que este arquivo existe e por que ele é grande:
 *
 *  A identidade visual do Tenkaichi é quase toda LUZ — aura, rastro, clarão,
 *  onda de choque, imagem residual. Nada disso é asset comprado: é geometria
 *  gerada e shader. Ou seja, é a parte do visual que dá pra fazer bem SEM
 *  depender de modelagem e animação, que é justamente onde o placeholder é
 *  fraco. É por isso que um protótipo assim consegue "parecer jogo" antes de
 *  existir um único personagem pago no projeto.
 *
 *  Tudo aqui é POOL de tamanho fixo, alocado na inicialização. Criar e destruir
 *  objeto no meio da luta gera pausa de garbage collector — e pausa no frame do
 *  impacto é exatamente onde ela é mais visível.
 * ========================================================================== */

import * as THREE from 'three';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import { TUNING } from '../tuning.js';
import { getTexture } from '../assets/registry.js';

/* ==========================================================================
 *  Shader de partícula
 * ========================================================================== */
const PARTICLE_VERT = `
  attribute float aSize;
  attribute float aAlpha;
  attribute vec3  aColor;
  varying float vAlpha;
  varying vec3  vColor;
  void main() {
    vAlpha = aAlpha;
    vColor = aColor;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    // O clamp não é detalhe: sem ele, uma faísca que nasce a 20 cm da câmera
    // recebe gl_PointSize na casa dos milhares e vira uma bola branca cobrindo
    // meia tela — e como o bloom pega depois, o quadro inteiro estoura.
    gl_PointSize = clamp(aSize * (320.0 / max(-mv.z, 0.001)), 1.0, 110.0);
    gl_Position = projectionMatrix * mv;
  }
`;

const PARTICLE_FRAG = `
  uniform sampler2D uMap;
  varying float vAlpha;
  varying vec3  vColor;
  void main() {
    vec4 t = texture2D(uMap, gl_PointCoord);
    if (t.a * vAlpha < 0.01) discard;
    gl_FragColor = vec4(vColor * t.rgb, t.a * vAlpha);
  }
`;

/* Pool genérico de partículas em espaço de mundo. */
class ParticlePool {
  constructor(scene, { count = 900, texture, blending = THREE.AdditiveBlending }) {
    this.count = count;
    this.pos = new Float32Array(count * 3);
    this.vel = new Float32Array(count * 3);
    this.size = new Float32Array(count);
    this.alpha = new Float32Array(count);
    this.color = new Float32Array(count * 3);
    this.life = new Float32Array(count);
    this.maxLife = new Float32Array(count);
    this.drag = new Float32Array(count);
    this.gravity = new Float32Array(count);
    this.cursor = 0;

    // Fora da tela até serem usadas.
    this.pos.fill(99999);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1));
    geo.setAttribute('aColor', new THREE.BufferAttribute(this.color, 3));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

    this.mat = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: texture } },
      vertexShader: PARTICLE_VERT,
      fragmentShader: PARTICLE_FRAG,
      transparent: true,
      depthWrite: false,
      blending,
    });

    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
    this.geo = geo;
  }

  emit({ position, velocity, size, life, color, drag = 1.5, gravity = 0 }) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.count;

    const i3 = i * 3;
    this.pos[i3] = position.x; this.pos[i3 + 1] = position.y; this.pos[i3 + 2] = position.z;
    this.vel[i3] = velocity.x; this.vel[i3 + 1] = velocity.y; this.vel[i3 + 2] = velocity.z;
    this.color[i3] = color.r; this.color[i3 + 1] = color.g; this.color[i3 + 2] = color.b;

    this.size[i] = size;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.alpha[i] = 1;
    this.drag[i] = drag;
    this.gravity[i] = gravity;
  }

  update(dt) {
    const { pos, vel, life, maxLife, alpha, drag, gravity, count } = this;
    for (let i = 0; i < count; i++) {
      if (life[i] <= 0) { if (alpha[i] !== 0) alpha[i] = 0; continue; }

      life[i] -= dt;
      const i3 = i * 3;

      if (life[i] <= 0) {
        alpha[i] = 0;
        pos[i3] = 99999;
        continue;
      }

      const d = Math.exp(-drag[i] * dt);
      vel[i3] *= d;
      vel[i3 + 1] = vel[i3 + 1] * d - gravity[i] * dt;
      vel[i3 + 2] *= d;

      pos[i3] += vel[i3] * dt;
      pos[i3 + 1] += vel[i3 + 1] * dt;
      pos[i3 + 2] += vel[i3 + 2] * dt;

      // Fade com curva quadrática: some rápido no fim, não linearmente.
      const k = life[i] / maxLife[i];
      alpha[i] = k * k;
    }

    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aAlpha.needsUpdate = true;
    this.geo.attributes.aSize.needsUpdate = true;
    this.geo.attributes.aColor.needsUpdate = true;
  }
}

/* ==========================================================================
 *  Rastro (ribbon) — segue um osso durante o smash
 * ========================================================================== */
class TrailRibbon {
  constructor(scene, { segments = 16, width = 0.30, color = 0x9fe8ff }) {
    this.segments = segments;
    this.width = width;
    this.history = [];
    this.active = false;

    const geo = new THREE.BufferGeometry();
    this.positions = new Float32Array(segments * 2 * 3);
    this.alphas = new Float32Array(segments * 2);
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alphas, 1));

    const idx = [];
    for (let i = 0; i < segments - 1; i++) {
      const a = i * 2, b = i * 2 + 1, c = (i + 1) * 2, d = (i + 1) * 2 + 1;
      idx.push(a, b, c, b, d, c);
    }
    geo.setIndex(idx);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

    this.mat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(color) } },
      vertexShader: `
        attribute float aAlpha;
        varying float vAlpha;
        void main() {
          vAlpha = aAlpha;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        uniform vec3 uColor;
        varying float vAlpha;
        void main() {
          if (vAlpha < 0.01) discard;
          gl_FragColor = vec4(uColor, vAlpha);
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });

    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    scene.add(this.mesh);
  }

  start() { this.active = true; this.history.length = 0; this.mesh.visible = true; }
  stop() { this.active = false; }

  update(worldPos, cameraPos) {
    if (this.active) {
      this.history.unshift(worldPos.clone());
      if (this.history.length > this.segments) this.history.pop();
    } else if (this.history.length) {
      this.history.pop();                    // esvazia suavemente em vez de sumir
      if (!this.history.length) { this.mesh.visible = false; return; }
    } else {
      return;
    }

    const n = this.history.length;
    const toCam = new THREE.Vector3();
    const dir = new THREE.Vector3();
    const side = new THREE.Vector3();

    for (let i = 0; i < this.segments; i++) {
      const p = this.history[Math.min(i, n - 1)];
      const pNext = this.history[Math.min(i + 1, n - 1)];

      dir.subVectors(pNext, p);
      if (dir.lengthSq() < 1e-8) dir.set(0, 1, 0);
      toCam.subVectors(cameraPos, p).normalize();
      side.crossVectors(dir, toCam).normalize();

      // Afina na ponta — rastro de largura constante parece fita de papel.
      const taper = 1 - i / this.segments;
      const w = this.width * taper;

      const o = i * 6;
      this.positions[o]     = p.x + side.x * w;
      this.positions[o + 1] = p.y + side.y * w;
      this.positions[o + 2] = p.z + side.z * w;
      this.positions[o + 3] = p.x - side.x * w;
      this.positions[o + 4] = p.y - side.y * w;
      this.positions[o + 5] = p.z - side.z * w;

      const a = i < n ? taper * taper : 0;
      this.alphas[i * 2] = a;
      this.alphas[i * 2 + 1] = a;
    }

    this.mesh.geometry.attributes.position.needsUpdate = true;
    this.mesh.geometry.attributes.aAlpha.needsUpdate = true;
  }
}

/* ==========================================================================
 *  Aura de ki — casca fresnel grudada no lutador
 * ========================================================================== */
/* A primeira versão era uma CÁPSULA com shader fresnel. O fresnel brilha nas
 * bordas da geometria — e como a geometria era uma cápsula, o que aparecia na
 * tela era o contorno nítido de uma cápsula em volta do personagem. Parecia que
 * ele estava dentro de um comprimido.
 *
 * A aura de Dragon Ball é uma CHAMA: larga embaixo, afunilando num bico acima da
 * cabeça, com estrias verticais que tremem. Então a geometria virou um cone
 * invertido e truncado, e o alfa é feito de listras verticais animadas — nunca
 * do contorno. Também some quase por completo em intensidade baixa: aura sempre
 * ligada vira ruído visual e o jogador para de ler quando ela significa algo. */
class AuraShell {
  constructor(parent, color) {
    // Perfil de chama: largo na base, bico no topo.
    const profile = [];
    const STEPS = 14;
    for (let i = 0; i <= STEPS; i++) {
      const t = i / STEPS;
      const y = -0.15 + t * 2.55;
      // largura: engorda um pouco no meio do corpo, depois afunila forte
      const w = Math.sin(Math.pow(t, 0.62) * Math.PI) * 0.78 * (1 - t * 0.55) + 0.04;
      profile.push(new THREE.Vector2(Math.max(w, 0.015), y));
    }
    const geo = new THREE.LatheGeometry(profile, 20);

    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(color) },
        uIntensity: { value: 0 },
        uTime: { value: 0 },
      },
      vertexShader: `
        varying vec2 vUv;
        varying vec3 vPos;
        void main() {
          vUv = uv;
          vPos = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        uniform vec3  uColor;
        uniform float uIntensity;
        uniform float uTime;
        varying vec2 vUv;
        varying vec3 vPos;

        float hash(float n) { return fract(sin(n) * 43758.5453); }

        void main() {
          // estrias verticais que sobem em velocidades diferentes
          float band = vUv.x * 20.0;
          float id   = floor(band);
          float seed = hash(id);
          float flow = vUv.y * 5.0 - uTime * (3.2 + seed * 3.4) - seed * 6.28;
          float streak = 0.5 + 0.5 * sin(flow);
          streak = pow(streak, 2.2);

          // a chama nasce nos pés e morre acima da cabeça
          float rise = smoothstep(0.0, 0.12, vUv.y) * pow(1.0 - vUv.y, 1.35);

          // 0.55 e não 0.85: a aura tem que envolver o personagem, não tapá-lo.
          // Quando ela fica opaca, você perde a pose do golpe — que é a
          // informação mais importante da tela num jogo de luta.
          float a = streak * rise * uIntensity * 0.55;
          if (a < 0.006) discard;

          // núcleo mais claro que as pontas — dá temperatura à chama
          vec3 col = mix(uColor, vec3(1.0), pow(streak, 3.0) * 0.55);
          gl_FragColor = vec4(col * (1.0 + uIntensity * 0.5), a);
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });

    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    parent.add(this.mesh);

    this.intensity = 0;
    this.target = 0;
  }

  set(target) { this.target = target; }

  update(dt, elapsed) {
    // Sobe rápido, desce devagar: aura acende na hora e some com preguiça.
    const k = this.target > this.intensity ? 14 : 4.5;
    this.intensity += (this.target - this.intensity) * (1 - Math.exp(-k * dt));

    const i = this.intensity * TUNING.juice.auraIntensity;
    this.mat.uniforms.uIntensity.value = i;
    this.mat.uniforms.uTime.value = elapsed;

    // A chama cresce com a intensidade — carregar ki tem que ser visível de longe.
    const s = 0.85 + Math.min(i, 3) * 0.22;
    this.mesh.scale.set(s, 0.9 + Math.min(i, 3) * 0.3, s);
    this.mesh.visible = i > 0.04;
  }
}

/* ==========================================================================
 *  Speed lines — anel de traços ao redor da câmera
 * ========================================================================== */
/* Cuidado com a escala aqui: estes traços são filhos da CÂMERA, então o tamanho
 * deles na tela depende da distância até ela. A primeira versão ficava a 2.4
 * unidades de distância com 2.4 de comprimento — ou seja, cada traço cobria
 * quase a altura inteira da tela, e o dash virava um borrão branco opaco.
 *
 * A regra: jogar longe (z ~ -18) e deixar o raio grande o bastante pra que os
 * traços fiquem na PERIFERIA. Speed line que passa no meio da tela atrapalha
 * exatamente no momento em que o jogador mais precisa enxergar o alvo. */
class SpeedLines {
  constructor(camera) {
    const COUNT = 44;
    const DIST = 18;

    const geo = new THREE.PlaneGeometry(0.05, 2.2);
    geo.translate(0, 1.1, 0);

    this.mat = new THREE.MeshBasicMaterial({
      color: 0xcfeaff, transparent: true, opacity: 0,
      depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });

    this.mesh = new THREE.InstancedMesh(geo, this.mat, COUNT);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 998;

    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const p = new THREE.Vector3();
    const s = new THREE.Vector3();

    for (let i = 0; i < COUNT; i++) {
      const ang = (i / COUNT) * Math.PI * 2 + ((i * 0.41) % 1) * 0.2;
      // Raio grande: mantém os traços fora do centro da tela.
      const rad = 5.2 + ((i * 0.37) % 1) * 4.2;
      p.set(Math.cos(ang) * rad, Math.sin(ang) * rad, -DIST - ((i * 0.53) % 1) * 5);
      e.set(0, 0, ang - Math.PI / 2);      // apontando pra fora, radialmente
      q.setFromEuler(e);
      s.set(1, 0.6 + ((i * 0.71) % 1) * 1.6, 1);
      m.compose(p, q, s);
      this.mesh.setMatrixAt(i, m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;

    // Filho da câmera: acompanha sozinha, sem recalcular nada por frame.
    camera.add(this.mesh);
    this._op = 0;
  }

  update(dt, speed) {
    if (!TUNING.juice.speedLinesEnabled) { this.mat.opacity = 0; return; }
    const th = TUNING.juice.speedLinesThreshold;
    const target = THREE.MathUtils.clamp((speed - th) / 34, 0, 1) * 0.30;
    this._op += (target - this._op) * (1 - Math.exp(-11 * dt));
    this.mat.opacity = this._op;
    this.mesh.visible = this._op > 0.004;
  }
}

/* ==========================================================================
 *  VFX — fachada única
 * ========================================================================== */
export class VFX {
  constructor(scene, camera) {
    this.scene = scene;
    this.camera = camera;
    this.elapsed = 0;

    this.sparks = new ParticlePool(scene, { count: 1200, texture: getTexture('hit_spark') });
    this.dustPool = new ParticlePool(scene, {
      count: 500, texture: getTexture('dust'), blending: THREE.NormalBlending,
    });
    this.auraPool = new ParticlePool(scene, { count: 900, texture: getTexture('hit_spark') });

    this.speedLines = new SpeedLines(camera);

    this._rings = this._makeRingPool(14);
    this._ghosts = this._makeGhostPool(10);

    this._v = new THREE.Vector3();
    this._c = new THREE.Color();
    this._rand = mulberry32(0x5eed);
  }

  /* ---------------- pools ---------------- */
  _makeRingPool(n) {
    const geo = new THREE.PlaneGeometry(1, 1);
    const tex = getTexture('ring_shock');
    const pool = [];
    for (let i = 0; i < n; i++) {
      const mat = new THREE.MeshBasicMaterial({
        map: tex, transparent: true, opacity: 0, depthWrite: false,
        blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.visible = false;
      mesh.frustumCulled = false;
      this.scene.add(mesh);
      pool.push({ mesh, mat, life: 0, maxLife: 1, from: 1, to: 6, billboard: false });
    }
    return { items: pool, cursor: 0 };
  }

  _makeGhostPool(n) {
    return { items: new Array(n).fill(null).map(() => ({ obj: null, life: 0, maxLife: 1, mats: [] })), cursor: 0 };
  }

  /* ---------------- API ---------------- */

  /** Explosão de faíscas no impacto. */
  burst(position, { count = null, color = 0xbfefff, speed = null, life = null, spread = 1 } = {}) {
    const J = TUNING.juice;
    const n = count ?? J.impactSparkCount;
    const sp = speed ?? J.impactSparkSpeed;
    const lf = life ?? J.impactSparkLife;
    this._c.set(color);

    for (let i = 0; i < n; i++) {
      // direção esférica uniforme
      const u = this._rand() * 2 - 1;
      const th = this._rand() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      const mag = sp * (0.35 + this._rand() * 0.95) * spread;

      this._v.set(r * Math.cos(th) * mag, u * mag + sp * 0.18, r * Math.sin(th) * mag);
      this.sparks.emit({
        position,
        velocity: this._v,
        size: 0.22 + this._rand() * 0.45,
        life: lf * (0.55 + this._rand() * 0.8),
        color: this._c,
        drag: 2.6,
        gravity: 1.5,
      });
    }
  }

  /** Onda de choque: anel que expande. `normal` define o plano. */
  ring(position, { normal = null, color = 0xaee6ff, from = 0.6, to = 7, life = 0.42, billboard = false } = {}) {
    const p = this._rings;
    const it = p.items[p.cursor];
    p.cursor = (p.cursor + 1) % p.items.length;

    it.mesh.position.copy(position);
    it.mesh.visible = true;
    it.mat.opacity = 1;
    it.mat.color.set(color);
    it.life = life;
    it.maxLife = life;
    it.from = from;
    it.to = to;
    it.billboard = billboard;

    if (!billboard) {
      if (normal) {
        it.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal.clone().normalize());
      } else {
        it.mesh.rotation.set(-Math.PI / 2, 0, 0);   // deitado no chão
      }
    }
    it.mesh.scale.setScalar(from);
  }

  /** Poeira (pouso, cratera). */
  dust(position, { count = 16, color = 0xd8d2c4, speed = 3.5, life = 0.9, radius = 0.6 } = {}) {
    this._c.set(color);
    for (let i = 0; i < count; i++) {
      const ang = this._rand() * Math.PI * 2;
      const mag = speed * (0.4 + this._rand() * 0.8);
      this._v.set(Math.cos(ang) * mag, 0.7 + this._rand() * 1.6, Math.sin(ang) * mag);
      const p = position.clone();
      p.x += Math.cos(ang) * radius * this._rand();
      p.z += Math.sin(ang) * radius * this._rand();
      this.dustPool.emit({
        position: p, velocity: this._v,
        size: 0.9 + this._rand() * 1.5,
        life: life * (0.6 + this._rand() * 0.8),
        color: this._c, drag: 1.9, gravity: 1.2,
      });
    }
  }

  /** Partículas de aura subindo (chame por frame enquanto a aura estiver ligada). */
  auraTick(position, { intensity = 1, color = 0x7fd8ff, count = 2 } = {}) {
    if (!TUNING.juice.auraEnabled || intensity <= 0.02) return;
    this._c.set(color);
    const n = Math.max(1, Math.round(count * intensity));
    for (let i = 0; i < n; i++) {
      const ang = this._rand() * Math.PI * 2;
      const rad = 0.28 + this._rand() * 0.42;
      const p = position.clone();
      p.x += Math.cos(ang) * rad;
      p.z += Math.sin(ang) * rad;
      p.y += 0.15 + this._rand() * 1.5;

      this._v.set(
        Math.cos(ang) * 0.35,
        TUNING.juice.auraRiseSpeed * (0.6 + this._rand() * 0.9) * intensity,
        Math.sin(ang) * 0.35,
      );
      this.auraPool.emit({
        position: p, velocity: this._v,
        size: 0.16 + this._rand() * 0.30,
        life: 0.30 + this._rand() * 0.35,
        color: this._c, drag: 1.1, gravity: -0.6,
      });
    }
  }

  /**
   * Imagem residual (afterimage). Congela a pose atual do personagem.
   *
   * NOTA: pro mannequin procedural, clonar é barato. Pra um SkinnedMesh de
   * verdade usamos SkeletonUtils.clone, que duplica o esqueleto — mais caro.
   * Por isso a frequência é limitada por `afterimageInterval` em tuning.js.
   */
  afterimage(character, color = 0x88ccff) {
    if (!TUNING.juice.afterimageEnabled) return;

    const p = this._ghosts;
    const slot = p.items[p.cursor];
    p.cursor = (p.cursor + 1) % p.items.length;

    if (slot.obj) { this.scene.remove(slot.obj); disposeGhost(slot); }

    let ghost;
    try {
      ghost = cloneSkeleton(character.root);
    } catch {
      ghost = character.root.clone(true);
    }

    const mats = [];
    const c = new THREE.Color(color);
    ghost.traverse((o) => {
      if (!o.isMesh) return;
      const m = new THREE.MeshBasicMaterial({
        color: c, transparent: true, opacity: 0.5,
        depthWrite: false, blending: THREE.AdditiveBlending,
      });
      o.material = m;
      o.castShadow = false;
      o.receiveShadow = false;
      mats.push(m);
    });

    character.root.getWorldPosition(ghost.position);
    character.root.getWorldQuaternion(ghost.quaternion);
    ghost.scale.copy(character.root.scale);

    this.scene.add(ghost);
    slot.obj = ghost;
    slot.mats = mats;
    slot.life = TUNING.juice.afterimageLifeSec;
    slot.maxLife = slot.life;
  }

  /** Cria um rastro dedicado (um por lutador). */
  createTrail(color = 0x9fe8ff) {
    return new TrailRibbon(this.scene, { segments: TUNING.juice.trailSegments, color });
  }

  /** Cria a casca de aura de um lutador. */
  createAura(parent, color = 0x7fd8ff) {
    return new AuraShell(parent, color);
  }

  /* ---------------- update ---------------- */
  update(dt, playerSpeed = 0) {
    this.elapsed += dt;

    this.sparks.update(dt);
    this.dustPool.update(dt);
    this.auraPool.update(dt);
    this.speedLines.update(dt, playerSpeed);

    // anéis
    for (const it of this._rings.items) {
      if (it.life <= 0) continue;
      it.life -= dt;
      if (it.life <= 0) { it.mesh.visible = false; it.mat.opacity = 0; continue; }

      const k = 1 - it.life / it.maxLife;
      // easeOutQuart: explode e desacelera
      const e = 1 - Math.pow(1 - k, 4);
      it.mesh.scale.setScalar(it.from + (it.to - it.from) * e);
      it.mat.opacity = (1 - k) * (1 - k);
      if (it.billboard) it.mesh.quaternion.copy(this.camera.quaternion);
    }

    // afterimages
    for (const slot of this._ghosts.items) {
      if (!slot.obj) continue;
      slot.life -= dt;
      if (slot.life <= 0) {
        this.scene.remove(slot.obj);
        disposeGhost(slot);
        continue;
      }
      const k = slot.life / slot.maxLife;
      const o = k * k * 0.55;
      for (const m of slot.mats) m.opacity = o;
    }
  }

  reset() {
    for (const it of this._rings.items) { it.life = 0; it.mesh.visible = false; }
    for (const slot of this._ghosts.items) {
      if (slot.obj) { this.scene.remove(slot.obj); disposeGhost(slot); }
    }
    for (const pool of [this.sparks, this.dustPool, this.auraPool]) {
      pool.life.fill(0);
      pool.alpha.fill(0);
      pool.pos.fill(99999);
    }
  }
}

function disposeGhost(slot) {
  for (const m of slot.mats) m.dispose();
  slot.mats = [];
  slot.obj = null;
}

/* PRNG determinístico — VFX reproduzível ajuda a comparar dois builds lado a lado. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
