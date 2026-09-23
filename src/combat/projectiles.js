/* =============================================================================
 *  projectiles.js  —  Ki blasts e o feixe do ultimate
 * =============================================================================
 *
 *  Duas coisas diferentes moram aqui:
 *
 *  BLASTS são esferas com leve perseguição. A perseguição não é pra dificultar
 *  a vida de quem apanha — é pra PERDOAR quem atira. Num jogo aéreo, acertar um
 *  projétil reto num alvo que voa em 3D é quase impossível com mouse, e o
 *  jogador culpa o jogo. Com `homingStrength` baixo, o tiro curva o suficiente
 *  pra parecer competência.
 *
 *  O FEIXE do ultimate não é projétil: é um volume que cresce à frente do
 *  lançador e causa dano em pulsos enquanto encosta em alguém. Por isso ele
 *  atravessa, empurra e é telegrafado por 40 frames — é uma pergunta ("você vai
 *  desviar?"), não um tiro.
 *
 *  Tudo é POOL de tamanho fixo: nada é criado durante a luta.
 * ========================================================================== */

import * as THREE from 'three';
import { TUNING } from '../tuning.js';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _toTarget = new THREE.Vector3();

/* ==========================================================================
 *  Blasts
 * ========================================================================== */
export class ProjectileSystem {
  constructor(scene, vfx) {
    this.scene = scene;
    this.vfx = vfx;
    this.items = [];

    const MAX = 40;
    const geo = new THREE.SphereGeometry(1, 16, 12);

    for (let i = 0; i < MAX; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0x66ddff,
        transparent: true,
        opacity: 0.95,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.visible = false;
      mesh.frustumCulled = false;
      scene.add(mesh);

      // Casca externa: dá volume e faz o bloom pegar melhor.
      const shellMat = new THREE.MeshBasicMaterial({
        color: 0xbff0ff, transparent: true, opacity: 0.28,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.BackSide,
      });
      const shell = new THREE.Mesh(geo, shellMat);
      shell.scale.setScalar(1.8);
      mesh.add(shell);

      this.items.push({
        mesh, mat, shellMat,
        active: false,
        pos: new THREE.Vector3(),
        vel: new THREE.Vector3(),
        owner: null, target: null,
        life: 0, spec: null, damage: 0, radius: 0,
        knockback: 0, homing: 0, charged: false,
      });
    }
  }

  /**
   * @param {Fighter} owner
   * @param {object}  spec   TUNING.blasts.ki_blast ou .charged_blast
   * @param {number}  chargeT 0..1 (só pro carregado)
   */
  fire(owner, spec, chargeT = 0) {
    const p = this.items.find((x) => !x.active);
    if (!p) return null;                        // pool cheio: o tiro some. Aceitável.

    const charged = spec === TUNING.blasts.charged_blast;
    const radius = charged
      ? THREE.MathUtils.lerp(spec.radius, spec.radiusAtFull, chargeT)
      : spec.radius;
    const damage = charged
      ? THREE.MathUtils.lerp(spec.damage, spec.damageAtFull, chargeT)
      : spec.damage;
    const knockback = charged
      ? THREE.MathUtils.lerp(spec.knockback, spec.knockbackAtFull, chargeT)
      : spec.knockback;

    // Sai da mão, não do centro do corpo.
    const hand = owner.char.socket('hand_r');
    hand.getWorldPosition(p.pos);

    // Direção: pro alvo se houver, senão pra frente.
    if (owner.target && owner.target.alive) {
      owner.target.center(_v);
      p.vel.subVectors(_v, p.pos).normalize();
    } else {
      p.vel.set(Math.sin(owner.yaw), 0, Math.cos(owner.yaw));
    }
    p.vel.multiplyScalar(spec.speed);

    p.active = true;
    p.owner = owner;
    p.target = owner.target;
    p.life = spec.lifetimeSec;
    p.spec = spec;
    p.damage = damage;
    p.radius = radius;
    p.knockback = knockback;
    p.homing = spec.homingStrength;
    p.charged = charged;

    p.mesh.position.copy(p.pos);
    p.mesh.scale.setScalar(radius);
    p.mesh.visible = true;
    p.mat.color.setHex(spec.color);
    p.mat.opacity = 0.95;

    this.vfx?.burst(p.pos, { count: charged ? 18 : 8, color: spec.color, speed: 4, life: 0.25 });
    return p;
  }

  update(dt, fighters, ctx) {
    for (const p of this.items) {
      if (!p.active) continue;

      p.life -= dt;
      if (p.life <= 0) { this._kill(p); continue; }

      // --- perseguição suave ---
      if (p.target && p.target.alive && p.homing > 0) {
        p.target.center(_toTarget);
        _toTarget.sub(p.pos);
        const d = _toTarget.length();
        if (d > 0.01) {
          _toTarget.divideScalar(d);
          const speed = p.vel.length();
          _v2.copy(p.vel).divideScalar(speed || 1);
          _v2.lerp(_toTarget, 1 - Math.exp(-p.homing * 6 * dt)).normalize();
          p.vel.copy(_v2).multiplyScalar(speed);
        }
      }

      p.pos.addScaledVector(p.vel, dt);
      p.mesh.position.copy(p.pos);

      // rastro
      if (p.charged) {
        this.vfx?.auraTick(p.pos, { intensity: 0.8, color: p.spec.color, count: 2 });
      }

      // --- colisão ---
      for (const f of fighters) {
        if (!f.alive || f === p.owner) continue;
        if (f.invulnerable) continue;

        f.center(_v);
        const reach = p.radius + TUNING.fighter.radius * 1.2;
        if (p.pos.distanceToSquared(_v) > reach * reach) continue;

        // Guarda rebate blast fraco em vez de só absorver — recompensa timing.
        _v2.subVectors(_v, p.pos).setY(0).normalize();
        const fwd = _v.set(Math.sin(f.yaw), 0, Math.cos(f.yaw));
        const facing = fwd.dot(_v2) < -0.15;

        /* REBATER exige TIMING, não só estar de guarda.
         *
         * `deflectWindowFrames` existia no tuning e não era consultado: o
         * projétil voltava por SÓ estar bloqueando. Como a guarda já absorve
         * 80% do dano, rebater era um bônus grátis e a perícia era zero.
         * Agora: segurar guarda ABSORVE (o comportamento normal, logo abaixo);
         * apertar guarda perto do impacto REBATE. */
        const noTiming = f.guardPressFrame <= TUNING.defense.guard.deflectWindowFrames;

        if (p.spec.deflectable && f.guarding && facing && noTiming) {
          p.vel.negate().multiplyScalar(TUNING.defense.guard.deflectSpeedMul);
          p.owner = f;
          p.target = f.target;
          ctx.juice?.impact({ hitstop: 4, shake: 0.12 });
          this.vfx?.burst(p.pos, { count: 10, color: 0xffffff, speed: 6, life: 0.25 });
          continue;
        }

        const move = {
          damage: p.damage,
          poiseDamage: p.charged ? 40 : 6,
          knockback: p.knockback,
          knockup: p.charged ? 6 : 1,
          hitstun: p.spec.hitstun,
          blockstun: 12,
          chipDamage: p.damage * 0.2,
          causesBlowaway: !!p.spec.causesBlowaway,
          guardBreak: false,
          hitstop: p.spec.hitstop,
          shake: p.spec.shake,
        };

        _v2.subVectors(f.position, p.owner ? p.owner.position : p.pos).setY(0).normalize();
        const guarded = f.guarding && facing;
        const result = f.applyHit({ move, attacker: p.owner, direction: _v2, guarded, ctx });

        ctx.onHit?.({ attacker: p.owner, victim: f, move, result, point: p.pos.clone(), projectile: true });
        this._kill(p, true);
        break;
      }
    }
  }

  _kill(p, impact = false) {
    if (impact) {
      this.vfx?.burst(p.pos, {
        count: p.charged ? 44 : 16,
        color: p.spec.color, speed: p.charged ? 14 : 7,
        life: p.charged ? 0.55 : 0.3,
      });
      this.vfx?.ring(p.pos, { billboard: true, color: p.spec.color, from: 0.4, to: p.charged ? 9 : 3.5, life: 0.35 });
    }
    p.active = false;
    p.mesh.visible = false;
    p.owner = null;
    p.target = null;
  }

  reset() {
    for (const p of this.items) { p.active = false; p.mesh.visible = false; }
  }
}

/* ==========================================================================
 *  Feixe do ultimate
 * ========================================================================== */
export class BeamSystem {
  constructor(scene, vfx) {
    this.scene = scene;
    this.vfx = vfx;

    const U = TUNING.blasts.ultimate;

    // Cilindro deitado no +Z, com a base na origem: facilita esticar só o comprimento.
    const geo = new THREE.CylinderGeometry(1, 1, 1, 24, 1, true);
    geo.translate(0, 0.5, 0);
    geo.rotateX(Math.PI / 2);

    this.core = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.95,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    }));
    this.glow = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      color: U.color, transparent: true, opacity: 0.35,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    }));

    this.group = new THREE.Group();
    this.group.add(this.core, this.glow);
    this.group.visible = false;
    this.group.frustumCulled = false;
    scene.add(this.group);

    this.active = false;
    this.owner = null;
    this.frame = 0;
    this.dir = new THREE.Vector3();
    this.origin = new THREE.Vector3();
    this.hitCooldown = new Map();
  }

  /**
   * Trava a mira no momento do disparo.
   *
   * A primeira versão montava a direção só com o yaw
   * (`set(sin(yaw), 0, cos(yaw))`), o que deixava o feixe SEMPRE horizontal.
   * Num jogo aéreo isso é um bug grave e silencioso: com o adversário acima ou
   * abaixo, a ultimate — o golpe mais caro do jogo — passava longe e parecia
   * que o lock-on tinha falhado. Yaw sozinho não descreve direção em 3D.
   */
  start(owner) {
    this.active = true;
    this.owner = owner;
    this.frame = 0;
    this.group.visible = true;
    this.hitCooldown.clear();

    const chest = owner.char.socket('chest');
    chest.getWorldPosition(this.origin);

    if (owner.target && owner.target.alive) {
      owner.target.center(_v);
      this.dir.subVectors(_v, this.origin);
      if (this.dir.lengthSq() < 1e-6) this.dir.set(Math.sin(owner.yaw), 0, Math.cos(owner.yaw));
      this.dir.normalize();
    } else {
      this.dir.set(Math.sin(owner.yaw), 0, Math.cos(owner.yaw));
    }
  }

  stop() {
    this.active = false;
    this.owner = null;
    this.group.visible = false;
  }

  update(dt, fighters, ctx) {
    if (!this.active || !this.owner || !this.owner.alive) { if (this.active) this.stop(); return; }

    const U = TUNING.blasts.ultimate;
    this.frame++;

    if (this.frame > U.durationFrames) { this.stop(); return; }

    // Origem: entre as mãos, à frente do peito. A DIREÇÃO já foi travada em
    // start() — o feixe não persegue. Se perseguisse, desviar seria impossível
    // e o golpe mais caro do jogo viraria um acerto garantido.
    const chest = this.owner.char.socket('chest');
    chest.getWorldPosition(this.origin);

    const U0 = TUNING.blasts.ultimate;
    if (U0.aimTracking > 0 && this.owner.target && this.owner.target.alive) {
      this.owner.target.center(_v);
      _v2.subVectors(_v, this.origin).normalize();
      this.dir.lerp(_v2, 1 - Math.exp(-U0.aimTracking * 6 * dt)).normalize();
    }

    this.origin.addScaledVector(this.dir, 0.55);

    // Cresce rápido, mantém, e afina no fim.
    const k = this.frame / U.durationFrames;
    const grow = Math.min(1, this.frame / 8);
    const fade = k > 0.82 ? 1 - (k - 0.82) / 0.18 : 1;
    const length = U.beamLengthMax * grow;
    const radius = U.beamRadius * grow * fade;

    this.group.position.copy(this.origin);
    this.group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), this.dir);
    this.core.scale.set(radius * 0.55, radius * 0.55, length);
    this.glow.scale.set(radius, radius, length);
    this.core.material.opacity = 0.95 * fade;
    this.glow.material.opacity = 0.35 * fade;

    ctx.juice?.shake(0.05);

    // --- dano em pulsos ---
    if (this.frame % U.tickDamageFrames !== 0) return;

    for (const f of fighters) {
      if (!f.alive || f === this.owner || f.invulnerable) continue;

      f.center(_v);
      _v2.subVectors(_v, this.origin);
      const along = _v2.dot(this.dir);
      if (along < 0 || along > length) continue;

      // distância perpendicular ao eixo do feixe
      _v.copy(this.dir).multiplyScalar(along);
      const perp = _v2.sub(_v).length();
      if (perp > radius + TUNING.fighter.radius) continue;

      const move = {
        damage: U.damage / (U.durationFrames / U.tickDamageFrames),
        poiseDamage: 50,
        knockback: U.knockback * 0.12,
        knockup: 1.2,
        hitstun: U.hitstun,
        blockstun: 14,
        chipDamage: 1.2,
        causesBlowaway: true,
        guardBreak: false,
        hitstop: 2,
        shake: 0.1,
      };

      _v2.copy(this.dir);
      f.applyHit({ move, attacker: this.owner, direction: _v2, guarded: false, ctx });
      this.vfx?.burst(f.position, { count: 8, color: U.color, speed: 6, life: 0.25 });
    }
  }

  reset() { this.stop(); }
}
