/* =============================================================================
 *  resolve.js  —  Detecção e resolução de acerto
 * =============================================================================
 *
 *  Uma passada por frame de simulação, na ordem:
 *
 *     1. golpe está na fase ACTIVE?
 *     2. a esfera do punho/pé encosta na cápsula da vítima?
 *     3. a vítima já foi atingida por ESTE golpe? (evita multi-hit)
 *     4. a vítima está invencível? (i-frames de step, getup, vanish)
 *     5. a vítima apertou VANISH na janela? → some, não toma dano
 *     6. a vítima está de guarda E de frente pro atacante? → bloqueia
 *     7. senão, acerto limpo
 *
 *  O passo 6 exige estar DE FRENTE de propósito: é o que dá sentido ao vanish
 *  reaparecer pelas costas. Guarda omnidirecional tornaria a mecânica inútil.
 * ========================================================================== */

import * as THREE from 'three';
import { TUNING } from '../tuning.js';

const _hitPos = new THREE.Vector3();
const _victimC = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _fwd = new THREE.Vector3();

/**
 * @param {Fighter[]} fighters
 * @param {object} ctx  { vfx, juice, arena, onHit }
 */
export function resolveMelee(fighters, ctx) {
  for (const attacker of fighters) {
    if (!attacker.alive) continue;
    if (attacker.attackPhase !== 'active') continue;

    const move = attacker.move;
    const socket = attacker.char.socket(move.socket);
    socket.getWorldPosition(_hitPos);

    for (const victim of fighters) {
      if (victim === attacker || !victim.alive) continue;
      if (attacker.hitThisMove.has(victim)) continue;

      victim.center(_victimC);
      const reach = move.hitboxRadius + TUNING.fighter.radius * 1.35;
      if (_hitPos.distanceToSquared(_victimC) > reach * reach) continue;

      attacker.hitThisMove.add(victim);

      /* --- 4. invencível --- */
      if (victim.invulnerable) {
        ctx.vfx?.burst(_hitPos, { count: 6, color: 0xffffff, speed: 3, life: 0.2 });
        continue;
      }

      /* --- 5. vanish --- */
      if (victim.vanishPressFrame <= move.vanishWindow) {
        if (victim.doVanish(attacker, ctx)) {
          const V = TUNING.defense.vanish;
          ctx.juice?.impact({ hitstop: V.hitstop, shake: V.shake });
          ctx.juice?.slowMo(V.slowMoFrames, V.slowMoScale);
          ctx.onVanish?.(victim, attacker, _hitPos);
          continue;
        }
      }

      /* --- 6. guarda (precisa estar de frente) --- */
      _dir.subVectors(_victimC, attacker.position).setY(0);
      if (_dir.lengthSq() < 1e-6) _dir.set(Math.sin(attacker.yaw), 0, Math.cos(attacker.yaw));
      _dir.normalize();

      _fwd.set(Math.sin(victim.yaw), 0, Math.cos(victim.yaw));
      const facingAttacker = _fwd.dot(_dir) < -0.15;   // vítima olhando pro golpe
      const guarded = victim.guarding && facingAttacker;

      /* --- 7. aplica --- */
      const result = victim.applyHit({ move, attacker, direction: _dir, guarded, ctx });

      /* O atacante precisa saber QUE TIPO de contato foi, não só que houve um.
       * É isso que decide se o combo pode emendar: acerto libera, bloqueio não
       * (ver combo.cancelOnBlock). Sem esta distinção, martelar contra a guarda
       * mantinha o turno pra sempre. */
      if (result === 'guard') attacker.blockConfirmThisMove = true;
      else attacker.hitConfirmThisMove = true;

      /* MANDOU PRA LONGE → abre a JANELA DE PERSEGUIÇÃO.
       *
       * Vale pra qualquer coisa que produza blowaway: smash, guard break e
       * também a quebra de poise (a vítima se soltando da pressão). Até aqui,
       * lançar alguém era um beco sem saída — o corpo voava e você
       * re-aproximava com um J. Agora é o começo da SEGUNDA disputa: o
       * atacante escolhe perseguir e o defensor escolhe como voltar. */
      if (victim.state === 'blowaway') attacker.openPursuit(victim);

      ctx.onHit?.({ attacker, victim, move, result, point: _hitPos.clone() });
    }
  }
}

/**
 * Dragon Dash trombando em alguém que NÃO está em dash.
 *
 * Sem isto, o dash atravessava o adversário e seguia reto — você mirava,
 * chegava, e passava direto. No Tenkaichi o dash é barrado pelo corpo do outro:
 * dá um toque de dano e PARA você ali, já na distância de combo. É o que
 * transforma o dash em abertura de ataque em vez de só locomoção.
 *
 * Roda ANTES de resolveDashClash, porque dash-contra-dash tem regra própria.
 */
export function resolveDashImpact(fighters, ctx) {
  for (const a of fighters) {
    if (!a.alive || a.state !== 'dash') continue;

    for (const b of fighters) {
      if (b === a || !b.alive) continue;
      if (b.state === 'dash') continue;          // isso é clash, não impacto
      if (a.dashHits.has(b)) continue;           // um toque por dash
      if (b.invulnerable) continue;

      const reach = TUNING.fighter.radius * 2 + TUNING.dragonDash.impactReachBonus;
      if (a.position.distanceToSquared(b.position) > reach * reach) continue;

      // Vanish também salva de tromba de dash — é um golpe como outro qualquer.
      if (b.vanishPressFrame <= TUNING.dragonDash.impactVanishWindow) {
        if (b.doVanish(a, ctx)) {
          const V = TUNING.defense.vanish;
          ctx.juice?.impact({ hitstop: V.hitstop, shake: V.shake });
          ctx.juice?.slowMo(V.slowMoFrames, V.slowMoScale);
          ctx.onVanish?.(b, a, b.position.clone());
          a.dashHits.add(b);
          continue;
        }
      }

      a.dashImpact(b, ctx);
      ctx.onDashImpact?.(a, b);
      break;                                      // o dash acabou; sai do laço
    }
  }
}

/**
 * Colisão de Dragon Dash: dois lutadores em dash que se encontram ricocheteiam.
 * Puro espetáculo, e é uma das imagens mais reconhecíveis do Tenkaichi.
 */
export function resolveDashClash(fighters, ctx) {
  const D = TUNING.dragonDash;
  if (!D.clashEnabled) return;

  for (let i = 0; i < fighters.length; i++) {
    const a = fighters[i];
    if (!a.alive || a.state !== 'dash') continue;

    for (let j = i + 1; j < fighters.length; j++) {
      const b = fighters[j];
      if (!b.alive || b.state !== 'dash') continue;

      const r = TUNING.fighter.radius * 2.6;
      if (a.position.distanceToSquared(b.position) > r * r) continue;

      _dir.subVectors(b.position, a.position).normalize();
      a.velocity.copy(_dir).multiplyScalar(-D.clashKnockback);
      b.velocity.copy(_dir).multiplyScalar(D.clashKnockback);
      a._enter('idle');
      b._enter('idle');

      const mid = _hitPos.copy(a.position).lerp(b.position, 0.5);
      ctx.juice?.impact({ hitstop: D.clashHitstop, shake: D.clashShake, zoom: 1 });
      ctx.vfx?.burst(mid, { count: 50, color: 0xffffff, speed: 16, life: 0.5 });
      ctx.vfx?.ring(mid, { billboard: true, color: 0xcfefff, from: 0.5, to: 12, life: 0.5 });
      ctx.onClash?.(mid.clone());
    }
  }
}

/** Empurra lutadores sobrepostos — evita que fiquem "dentro" um do outro. */
export function resolveOverlap(fighters) {
  const minDist = TUNING.fighter.radius * 2;
  for (let i = 0; i < fighters.length; i++) {
    const a = fighters[i];
    if (!a.alive) continue;
    for (let j = i + 1; j < fighters.length; j++) {
      const b = fighters[j];
      if (!b.alive) continue;

      _dir.subVectors(b.position, a.position);
      const d = _dir.length();
      if (d > minDist || d < 1e-5) continue;

      // Quem está em blowaway não empurra: ele atravessa, senão o corpo
      // lançado fica preso batendo no adversário.
      if (a.state === 'blowaway' || b.state === 'blowaway') continue;

      _dir.divideScalar(d);
      const push = (minDist - d) * 0.5;
      a.position.addScaledVector(_dir, -push);
      b.position.addScaledVector(_dir, push);
    }
  }
}
