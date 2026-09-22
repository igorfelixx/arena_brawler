/* =============================================================================
 *  arena.js  —  Plataforma, cúpula que encolhe e ring-out
 * =============================================================================
 *
 *  A arena encolhe como uma CÚPULA: raio e teto ao mesmo tempo. Num jogo aéreo,
 *  encolher só o raio não aperta nada — o jogador simplesmente sobe.
 *
 *  Detalhe de projeto que parece decoração mas não é: o campo de PEDRAS
 *  FLUTUANTES. Num céu vazio, voar a 60 m/s é visualmente idêntico a estar
 *  parado — não há nada passando pra dar referência. As pedras existem pra que
 *  a velocidade seja perceptível. Sem elas o Dragon Dash "não funciona", e a
 *  causa real não é óbvia.
 * ========================================================================== */

import * as THREE from 'three';
import { TUNING } from '../tuning.js';

/* --- shader da cúpula: hexágonos de energia, mais forte perto da borda --- */
const DOME_VERT = `
  varying vec3 vPos;
  varying vec2 vUv;
  void main() {
    vPos = position;
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

/* A primeira versão disto era uma grade hexagonal cheia, e o resultado foi uma
 * parede azul brilhante ocupando o fundo inteiro: os lutadores sumiam e tudo
 * parecia um aquário. A lição vale pra qualquer limite de arena — ele precisa
 * ser LEGÍVEL, não VISÍVEL. Então: barras verticais esparsas, alfa baixíssimo, e
 * o brilho concentrado na linha onde a cúpula encontra o chão, que é a única
 * parte que o jogador realmente precisa ler. O vermelho só entra no aviso. */
const DOME_FRAG = `
  uniform float uTime;
  uniform float uDanger;    // 0..1 — pisca quando vai encolher
  uniform vec3  uColor;
  uniform vec3  uDangerColor;
  varying vec3 vPos;
  varying vec2 vUv;

  void main() {
    // barras verticais finas e espaçadas
    float bars = smoothstep(0.986, 1.0, abs(sin(vUv.x * 3.14159 * 48.0)));

    // desbota com a altura: forte no chão, quase nada no topo
    float vfade = pow(1.0 - vUv.y, 2.6);

    // linha de base — a "marca d'água" do limite
    float baseLine = smoothstep(0.045, 0.0, vUv.y) * 0.85;

    float dangerPulse = 0.5 + 0.5 * sin(uTime * 13.0);
    vec3 col = mix(uColor, uDangerColor, uDanger * dangerPulse);

    float a = bars * vfade * 0.30
            + baseLine * (0.22 + uDanger * 0.5)
            + uDanger * dangerPulse * vfade * 0.14;

    if (a < 0.004) discard;
    gl_FragColor = vec4(col * (1.0 + uDanger * 0.8), a);
  }
`;

export class Arena {
  constructor(scene) {
    this.scene = scene;
    this.radius = TUNING.arena.startRadius;
    this.ceiling = TUNING.arena.startCeiling;
    this.elapsed = 0;
    this.shrinking = false;
    this.warning = false;

    this.group = new THREE.Group();
    scene.add(this.group);

    this._buildFloor();
    this._buildDome();
    this._buildDebris();

    this._tmp = new THREE.Vector3();
  }

  /* ------------------------------------------------------------------ */
  _buildFloor() {
    const R = TUNING.arena.startRadius;

    // Disco principal. O material escuro e fosco faz os personagens e o
    // bloom das auras se destacarem — piso claro "come" o efeito.
    const geo = new THREE.CircleGeometry(R, 96);
    geo.rotateX(-Math.PI / 2);
    // Tom levemente quente e mais claro que o céu: é o contraste que faz as
    // auras (ciano e laranja) saltarem. Piso escuro demais engole o bloom.
    const mat = new THREE.MeshStandardMaterial({
      color: 0x565049,
      roughness: 0.96,
      metalness: 0.03,
      // DoubleSide porque num jogo aéreo a câmera PASSA por baixo da arena.
      // Com face única, o chão some visto de baixo e aparece um buraco com o
      // formato da plataforma — que foi exatamente o que aconteceu no teste.
      side: THREE.DoubleSide,
    });
    this.floor = new THREE.Mesh(geo, mat);
    this.floor.position.y = TUNING.arena.floorY;
    this.floor.receiveShadow = true;
    this.group.add(this.floor);

    // Anéis concêntricos: dão leitura de distância e de escala.
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x9fb4cc, transparent: true, opacity: 0.22, side: THREE.DoubleSide,
    });
    for (let i = 1; i <= 5; i++) {
      const r = (R / 5) * i;
      const rg = new THREE.RingGeometry(r - 0.22, r, 96);
      rg.rotateX(-Math.PI / 2);
      const ring = new THREE.Mesh(rg, ringMat);
      ring.position.y = TUNING.arena.floorY + 0.012;
      this.group.add(ring);
    }

    // Borda ativa — marca o raio JOGÁVEL atual e encolhe com ele.
    const eg = new THREE.RingGeometry(R - 0.35, R, 128);
    eg.rotateX(-Math.PI / 2);
    this.edgeMat = new THREE.MeshBasicMaterial({
      color: 0x59d2ff, transparent: true, opacity: 0.85, side: THREE.DoubleSide,
    });
    this.edgeRing = new THREE.Mesh(eg, this.edgeMat);
    this.edgeRing.position.y = TUNING.arena.floorY + 0.03;
    this.group.add(this.edgeRing);

    this._floorBaseRadius = R;
    this._edgeBaseRadius = R;
  }

  _buildDome() {
    const R = TUNING.arena.startRadius;
    const H = TUNING.arena.startCeiling;

    const geo = new THREE.CylinderGeometry(R, R, H, 96, 24, true);
    this.domeMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uDanger: { value: 0 },
        uColor: { value: new THREE.Color(0x4fb8ff) },
        uDangerColor: { value: new THREE.Color(0xff4d4d) },
      },
      vertexShader: DOME_VERT,
      fragmentShader: DOME_FRAG,
      transparent: true,
      side: THREE.BackSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.dome = new THREE.Mesh(geo, this.domeMat);
    this.dome.position.y = TUNING.arena.floorY + H / 2;
    this.group.add(this.dome);

    this._domeBaseRadius = R;
    this._domeBaseHeight = H;

    // Tampa do teto: sem ela, "subir demais" não tem leitura visual.
    const capGeo = new THREE.CircleGeometry(R, 96);
    capGeo.rotateX(Math.PI / 2);
    this.capMat = new THREE.MeshBasicMaterial({
      color: 0x4fb8ff, transparent: true, opacity: 0.018,
      side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.cap = new THREE.Mesh(capGeo, this.capMat);
    this.cap.position.y = TUNING.arena.floorY + H;
    this.group.add(this.cap);
  }

  /* Pedras flutuantes — a referência visual de velocidade. Ver cabeçalho. */
  _buildDebris() {
    const R = TUNING.arena.startRadius;
    const H = TUNING.arena.startCeiling;
    const COUNT = 90;

    const geo = new THREE.IcosahedronGeometry(1, 0);
    // A primeira versão era cinza-escuro e as pedras viraram silhuetas pretas —
    // buracos no céu, não rochas. Precisam de cor clara o bastante pra pegar a
    // luz do sol E um `emissive` mínimo pra não sumirem contra o fundo escuro.
    const mat = new THREE.MeshStandardMaterial({
      color: 0x8a8378,
      emissive: 0x2a2f3d,
      emissiveIntensity: 0.6,
      roughness: 0.92,
      metalness: 0.04,
      flatShading: true,
    });

    this.debris = new THREE.InstancedMesh(geo, mat, COUNT);
    this.debris.castShadow = true;
    this.debris.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

    this._debrisData = [];
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();

    for (let i = 0; i < COUNT; i++) {
      // Distribuição uniforme em disco (sqrt evita aglomerar no centro).
      const a = (i * 2.399963) % (Math.PI * 2);        // ângulo áureo
      const rad = Math.sqrt((i + 0.5) / COUNT) * R * 1.35;
      const y = 3 + ((i * 7.13) % 1) * (H * 0.82);
      const scale = 0.35 + ((i * 3.77) % 1) * 1.5;

      const d = {
        base: new THREE.Vector3(Math.cos(a) * rad, y, Math.sin(a) * rad),
        scale,
        spin: new THREE.Vector3(
          ((i * 1.31) % 1 - 0.5) * 0.35,
          ((i * 2.17) % 1 - 0.5) * 0.35,
          ((i * 0.91) % 1 - 0.5) * 0.35,
        ),
        phase: (i * 0.618) % (Math.PI * 2),
        bob: 0.25 + ((i * 5.41) % 1) * 0.7,
        rot: new THREE.Euler((i * 1.7) % 6.28, (i * 2.3) % 6.28, (i * 0.7) % 6.28),
      };
      this._debrisData.push(d);

      p.copy(d.base);
      q.setFromEuler(d.rot);
      s.setScalar(scale);
      m.compose(p, q, s);
      this.debris.setMatrixAt(i, m);
    }
    this.debris.instanceMatrix.needsUpdate = true;
    this.group.add(this.debris);
  }

  /* ------------------------------------------------------------------ */
  /*  Simulação                                                          */
  /* ------------------------------------------------------------------ */
  update(dt) {
    this.elapsed += dt;
    const A = TUNING.arena;

    // --- encolhimento ---
    const t0 = A.shrinkStartSec;
    const t1 = A.shrinkStartSec + A.shrinkDurationSec;

    if (this.elapsed < t0) {
      this.radius = A.startRadius;
      this.ceiling = A.startCeiling;
      this.shrinking = false;
      this.warning = this.elapsed > t0 - A.warningSec;
    } else if (this.elapsed < t1) {
      const k = (this.elapsed - t0) / A.shrinkDurationSec;
      // easeInOut: começa e termina devagar. Encolhimento linear parece mecânico.
      const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      this.radius = A.startRadius + (A.minRadius - A.startRadius) * e;
      this.ceiling = A.startCeiling + (A.minCeiling - A.startCeiling) * e;
      this.shrinking = true;
      this.warning = false;
    } else {
      this.radius = A.minRadius;
      this.ceiling = A.minCeiling;
      this.shrinking = false;
      this.warning = false;
    }
  }

  /** Atualização visual — pode rodar em taxa de render, não precisa ser fixa. */
  render(dt, elapsed) {
    const rScale = this.radius / this._domeBaseRadius;
    const hScale = this.ceiling / this._domeBaseHeight;

    this.dome.scale.set(rScale, hScale, rScale);
    this.dome.position.y = TUNING.arena.floorY + this.ceiling / 2;

    this.cap.scale.set(rScale, 1, rScale);
    this.cap.position.y = TUNING.arena.floorY + this.ceiling;

    this.edgeRing.scale.set(rScale, 1, rScale);

    const danger = this.warning ? 1 : (this.shrinking ? 0.35 : 0);
    this.domeMat.uniforms.uTime.value = elapsed;
    this.domeMat.uniforms.uDanger.value = danger;
    this.capMat.opacity = 0.07 + danger * 0.06;

    this.edgeMat.color.setHex(this.warning ? 0xff4d4d : 0x59d2ff);
    this.edgeMat.opacity = this.warning ? 0.65 + 0.35 * Math.sin(elapsed * 14) : 0.85;

    // pedras: giro lento + flutuação
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();

    for (let i = 0; i < this._debrisData.length; i++) {
      const d = this._debrisData[i];
      e.set(
        d.rot.x + d.spin.x * elapsed,
        d.rot.y + d.spin.y * elapsed,
        d.rot.z + d.spin.z * elapsed,
      );
      q.setFromEuler(e);
      p.copy(d.base);
      p.y += Math.sin(elapsed * d.bob + d.phase) * 0.8;
      s.setScalar(d.scale);
      m.compose(p, q, s);
      this.debris.setMatrixAt(i, m);
    }
    this.debris.instanceMatrix.needsUpdate = true;
  }

  /* ------------------------------------------------------------------ */
  /*  Consultas                                                          */
  /* ------------------------------------------------------------------ */

  /** Distância horizontal do centro. */
  distanceFromCenter(pos) {
    return Math.hypot(pos.x, pos.z);
  }

  /** Fora dos limites (com a margem de tolerância do tuning). */
  isOutOfBounds(pos) {
    const A = TUNING.arena;
    const d = this.distanceFromCenter(pos);
    return d > this.radius + A.ringOutRadiusGrace
        || pos.y > this.ceiling
        || pos.y < A.ringOutY;
  }

  /** Eliminação imediata: caiu abaixo do fundo do mundo. */
  isRingOut(pos) {
    return pos.y < TUNING.arena.ringOutY;
  }

  /** 0..1 — quão perto da borda (1 = na borda). Usado pelo HUD e pela IA. */
  edgeProximity(pos) {
    const d = this.distanceFromCenter(pos);
    const band = TUNING.arena.edgeDangerBand;
    return THREE.MathUtils.clamp((d - (this.radius - band)) / band, 0, 1);
  }

  /** Vetor unitário apontando de volta pro centro (a IA usa pra não cair). */
  towardCenter(pos, out = new THREE.Vector3()) {
    return out.set(-pos.x, 0, -pos.z).normalize();
  }

  reset() {
    this.elapsed = 0;
    this.radius = TUNING.arena.startRadius;
    this.ceiling = TUNING.arena.startCeiling;
    this.shrinking = false;
    this.warning = false;
  }
}
