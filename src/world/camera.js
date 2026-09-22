/* =============================================================================
 *  camera.js  —  Câmera de lock-on estilo Tenkaichi
 * =============================================================================
 *
 *  A câmera do Tenkaichi é uma decisão de DESIGN, não de tecnologia, e é o que
 *  faz aquele combate ser legível. Três regras:
 *
 *   1. Ela fica ATRÁS do jogador, olhando NA DIREÇÃO do alvo. O jogador aparece
 *      de costas em primeiro plano; o alvo, à frente. Os dois sempre na tela.
 *   2. Ela é deslocada pro lado (offset de ombro). Se o alvo ficar exatamente no
 *      centro, o jogador o tapa — e é justamente na hora do soco que você
 *      precisa enxergar.
 *   3. Ela AFASTA conforme os dois se separam. É o que permite ler um smash que
 *      manda o inimigo a 40 metros sem perder ele de vista.
 *
 *  A suavização usa `1 - exp(-k*dt)` em vez de `lerp(a, b, k)`. A diferença
 *  importa: o segundo depende do framerate, e a câmera ficaria mais lenta em
 *  30fps do que em 144fps. Com exp, o comportamento é idêntico em qualquer taxa.
 * ========================================================================== */

import * as THREE from 'three';
import { TUNING } from '../tuning.js';

const UP = new THREE.Vector3(0, 1, 0);

export class CombatCamera {
  constructor(camera) {
    this.cam = camera;

    this.pos = new THREE.Vector3(0, 5, -12);
    this.look = new THREE.Vector3(0, 2, 0);

    // ajuste manual do jogador (mouse / stick direito), somado ao lock
    this.yawOffset = 0;
    this.pitchOffset = 0;

    /* LOCK-ON LIGADO  → a câmera orbita o alvo; o mouse só desvia um pouco e
     *                   o desvio volta sozinho pro alvo.
     * LOCK-ON SOLTO   → a câmera é um orbital livre atrás do jogador, tocada
     *                   inteiramente pelo mouse. É o modo de reposicionar,
     *                   procurar outro adversário ou só olhar em volta.
     *
     * Os dois modos precisam de estado SEPARADO. Reaproveitar `yawOffset` pro
     * modo livre faria a câmera saltar toda vez que você soltasse o lock,
     * porque aquele valor relaxa de volta a zero por conta própria. */
    this.locked = true;
    this.freeYaw = 0;
    this.freePitch = 0.12;

    this._desiredPos = new THREE.Vector3();
    this._desiredLook = new THREE.Vector3();
    this._dir = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._tmp = new THREE.Vector3();
    this._fov = TUNING.camera.fov;
  }

  /** Aplica o movimento de mouse/stick. */
  addLookInput(dx, dy) {
    const C = TUNING.camera;

    if (!this.locked) {
      // Modo livre: o mouse É a câmera. Nada relaxa de volta.
      this.freeYaw -= dx * C.mouseSensitivity;
      this.freePitch = THREE.MathUtils.clamp(
        this.freePitch - dy * C.mouseSensitivity,
        C.manualPitchMin, C.manualPitchMax,
      );
      return;
    }

    this.yawOffset -= dx * C.mouseSensitivity;
    this.pitchOffset -= dy * C.mouseSensitivity;
    this.pitchOffset = THREE.MathUtils.clamp(this.pitchOffset, C.manualPitchMin, C.manualPitchMax);

    // O yaw manual volta devagar pro lock — senão o jogador "perde" o alvo
    // e nunca mais acha o enquadramento certo sozinho.
    this.yawOffset = THREE.MathUtils.clamp(this.yawOffset, -Math.PI * 0.75, Math.PI * 0.75);
  }

  /**
   * Liga/desliga o lock-on sem solavanco.
   * Ao SOLTAR, a câmera livre nasce apontando pra onde a travada já estava —
   * sem isso, soltar o lock gira a tela violentamente e desorienta.
   */
  setLocked(locked, player, target) {
    if (locked === this.locked) return;

    if (!locked) {
      this._dir.subVectors(target ? target.position : this.look, player.position);
      this._dir.y = 0;
      if (this._dir.lengthSq() < 1e-6) this._dir.set(0, 0, 1);
      this._dir.normalize();
      this.freeYaw = Math.atan2(this._dir.x, this._dir.z);
      this.freePitch = THREE.MathUtils.clamp(this.pitchOffset, TUNING.camera.manualPitchMin, TUNING.camera.manualPitchMax);
    } else {
      // Ao retomar, zera o desvio manual: o alvo volta pro enquadramento limpo.
      this.yawOffset = 0;
      this.pitchOffset = 0;
    }

    this.locked = locked;
  }

  /**
   * @param {number} dt        delta real (render), não o fixo
   * @param {object} player    { position, velocity }
   * @param {object|null} target
   * @param {Juice} juice
   */
  update(dt, player, target, juice) {
    const C = TUNING.camera;

    const engaged = this.locked && target && target.alive;

    // --- direção base ---
    let separation;
    if (engaged) {
      this._dir.subVectors(target.position, player.position);
      separation = this._dir.length();
      if (separation < 0.001) this._dir.set(0, 0, 1);
      this._dir.normalize();

      // yaw manual gira o eixo em torno do jogador...
      if (this.yawOffset !== 0) this._dir.applyAxisAngle(UP, this.yawOffset);
      // ...e relaxa de volta pro alvo sozinho.
      this.yawOffset *= Math.exp(-2.2 * dt);
      if (Math.abs(this.yawOffset) < 1e-4) this.yawOffset = 0;
    } else {
      // Modo livre: direção vem só do mouse.
      this._dir.set(Math.sin(this.freeYaw), 0, Math.cos(this.freeYaw));
      separation = target ? player.position.distanceTo(target.position) : 8;
    }

    // --- distância: base + abertura pela separação + abertura pela velocidade ---
    const speed = player.velocity ? player.velocity.length() : 0;
    let dist = C.distance
      // Só afasta pra manter os DOIS na tela quando há lock. Solto, não há
      // "os dois" — afastar só faria a câmera recuar sem motivo.
      + (engaged ? Math.max(0, separation - 6) * C.widenPerMeter : 0)
      + speed * C.speedDistancePerUnit;
    dist = Math.min(dist, C.maxDistance);

    // --- posição desejada ---
    this._right.crossVectors(this._dir, UP).normalize();

    this._desiredPos.copy(player.position)
      .addScaledVector(this._dir, -dist)
      .addScaledVector(UP, C.height)
      .addScaledVector(this._right, C.shoulderOffset);

    // pitch sobe/desce a câmera em arco ao redor do jogador
    const pitch = engaged ? this.pitchOffset : this.freePitch;
    if (pitch !== 0) {
      this._tmp.subVectors(this._desiredPos, player.position);
      this._tmp.applyAxisAngle(this._right, pitch);
      this._desiredPos.copy(player.position).add(this._tmp);
    }

    // Não deixa a câmera enterrar no chão.
    const floorMin = TUNING.arena.floorY + 0.8;
    if (this._desiredPos.y < floorMin) this._desiredPos.y = floorMin;

    // --- ponto de mira ---
    if (engaged) {
      // Entre os dois, puxado pro alvo: mantém ambos enquadrados.
      this._desiredLook.copy(player.position).lerp(target.position, 0.55);
      this._desiredLook.y += 0.9;
    } else {
      // Solto: olha à frente do jogador, na direção da câmera.
      this._desiredLook.copy(player.position)
        .addScaledVector(this._dir, 7)
        .addScaledVector(UP, 1.1 + this.freePitch * 4);
    }

    // --- suavização independente de framerate ---
    const kPos = 1 - Math.exp(-C.followLag * dt);
    const kLook = 1 - Math.exp(-C.rotateLag * dt);
    this.pos.lerp(this._desiredPos, kPos);
    this.look.lerp(this._desiredLook, kLook);

    // --- aplica na câmera, somando o tremor ---
    const s = juice ? juice.shakeOffset : { x: 0, y: 0, z: 0 };
    this.cam.position.set(this.pos.x + s.x, this.pos.y + s.y, this.pos.z + s.z);
    this.cam.lookAt(this.look);

    // --- FOV: base + velocidade + punch zoom ---
    const speedFov = Math.min(speed * C.speedFovPerUnit, C.speedFovMax);
    const targetFov = C.fov + speedFov + (juice ? juice.punchZoom : 0);
    // O FOV também precisa de suavização, senão pulsa a cada mudança de velocidade.
    this._fov += (targetFov - this._fov) * (1 - Math.exp(-9 * dt));

    if (Math.abs(this.cam.fov - this._fov) > 0.01) {
      this.cam.fov = this._fov;
      this.cam.updateProjectionMatrix();
    }
  }

  /** Base horizontal pro movimento relativo à câmera. */
  getMoveBasis(out = { forward: new THREE.Vector3(), right: new THREE.Vector3() }) {
    this.cam.getWorldDirection(out.forward);
    out.forward.y = 0;
    if (out.forward.lengthSq() < 1e-6) out.forward.set(0, 0, 1);
    out.forward.normalize();
    out.right.crossVectors(out.forward, UP).normalize().negate();
    return out;
  }

  snapTo(player, target) {
    this.update(1, player, target, null);
    this.pos.copy(this._desiredPos);
    this.look.copy(this._desiredLook);
    this.cam.position.copy(this.pos);
    this.cam.lookAt(this.look);
  }

  reset() {
    this.yawOffset = 0;
    this.pitchOffset = 0;
    this._fov = TUNING.camera.fov;
  }
}
