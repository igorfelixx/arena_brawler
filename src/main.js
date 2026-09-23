/* =============================================================================
 *  main.js  —  Montagem e loop
 * =============================================================================
 *
 *  Ordem de um passo de simulação (a ordem IMPORTA):
 *
 *     1. input.update()           — lê teclado/gamepad uma vez
 *     2. comandos                 — jogador e IA produzem Commands
 *     3. fighters.update()        — máquinas de estado + física
 *     4. resolveMelee()           — quem acertou quem
 *     5. projéteis / feixe
 *     6. resolveOverlap()         — descola corpos sobrepostos
 *     7. arena.update()           — encolhimento
 *     8. ring-out                 — quem saiu
 *     9. eventos                  — VFX, som, HUD reagem ao que aconteceu
 *
 *  O passo 3 vem antes do 4 de propósito: a hitbox é testada na posição do
 *  frame ATUAL, depois que todo mundo já se moveu. Testar antes causaria acertos
 *  em posições velhas — o clássico "ele me acertou de longe".
 *
 *  Durante o HITSTOP os passos 2–8 são pulados, mas o 9 e a renderização
 *  continuam. É isso que faz o congelamento parecer impacto e não travamento.
 * ========================================================================== */

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

import { TUNING } from './tuning.js';
import { FixedLoop } from './core/loop.js';
import { Input } from './core/input.js';
import { Juice } from './core/juice.js';
import { DebugPanel } from './core/debugPanel.js';
import { loadCharacter, loadArenaModel } from './assets/registry.js';
import { Arena } from './world/arena.js';
import { CombatCamera } from './world/camera.js';
import { VFX } from './world/vfx.js';
import { Fighter, emptyCommand, S } from './combat/fighter.js';
import { resolveMelee, resolveDashImpact, resolveDashClash, resolveOverlap } from './combat/resolve.js';
import { pickAttackTarget, cycleTarget, nearestEnemy } from './combat/targeting.js';
import { ProjectileSystem, BeamSystem } from './combat/projectiles.js';
import { BotController } from './ai/bot.js';
import { HUD } from './ui/hud.js';

/* ==========================================================================
 *  Céu — gradiente em shader. Evita depender de HDRI/cubemap (arquivo pesado).
 * ========================================================================== */
function makeSky(scene) {
  const geo = new THREE.SphereGeometry(900, 32, 20);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      uTop: { value: new THREE.Color(0x0a0e1a) },
      uMid: { value: new THREE.Color(0x1d2a45) },
      uBot: { value: new THREE.Color(0x3a2f3e) },
    },
    vertexShader: `
      varying vec3 vWorld;
      void main() {
        vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform vec3 uTop, uMid, uBot;
      varying vec3 vWorld;
      void main() {
        float h = normalize(vWorld).y;
        vec3 c = h > 0.0
          ? mix(uMid, uTop, pow(h, 0.65))
          : mix(uMid, uBot, pow(-h, 0.55));
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  const sky = new THREE.Mesh(geo, mat);
  sky.frustumCulled = false;
  scene.add(sky);
  return sky;
}

/* ==========================================================================
 *  Boot
 * ========================================================================== */
const app = document.getElementById('app');
const loadingEl = document.getElementById('loading');
const loadingMsg = document.getElementById('loading-msg');

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x161c2c, 60, 420);
makeSky(scene);

const camera = new THREE.PerspectiveCamera(TUNING.camera.fov, innerWidth / innerHeight, 0.1, 2000);
scene.add(camera);   // a câmera tem filhos (speed lines), então precisa estar na cena

/* --- luz -------------------------------------------------------------- */
scene.add(new THREE.HemisphereLight(0x94b8ff, 0x35302c, 0.85));

const sun = new THREE.DirectionalLight(0xffe6c4, 2.1);
sun.position.set(38, 60, 24);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 220;
const SH = 70;
sun.shadow.camera.left = -SH; sun.shadow.camera.right = SH;
sun.shadow.camera.top = SH; sun.shadow.camera.bottom = -SH;
sun.shadow.bias = -0.0009;
scene.add(sun);

// Luz de contorno fria por trás: separa os personagens do fundo escuro.
const rim = new THREE.DirectionalLight(0x6fa8ff, 1.15);
rim.position.set(-30, 18, -40);
scene.add(rim);

/* --- pós-processamento ------------------------------------------------- */
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));

const bloom = new UnrealBloomPass(
  new THREE.Vector2(innerWidth, innerHeight),
  TUNING.juice.bloomStrength,
  TUNING.juice.bloomRadius,
  TUNING.juice.bloomThreshold,
);
composer.addPass(bloom);
composer.addPass(new OutputPass());

/* ==========================================================================
 *  Mundo
 * ========================================================================== */
const juice = new Juice();
const arena = new Arena(scene);
const vfx = new VFX(scene, camera);
const projectiles = new ProjectileSystem(scene, vfx);
const beam = new BeamSystem(scene, vfx);
const combatCam = new CombatCamera(camera);
const input = new Input(renderer.domElement);
const hud = new HUD(app);
const debugPanel = new DebugPanel(app, input);

// Lock-on. Começa ligado — é o padrão do Tenkaichi e o modo de combate.
let lockedOn = true;

/* Modo treino: 0 = normal, 1 = parado, 2 = guarda.
 * Comando fixo reaproveitado — criar um objeto por frame por boneco geraria
 * lixo à toa no loop mais quente do jogo. */
const MODOS_TREINO = ['NORMAL', 'PARADO', 'GUARDA'];
let modoTreino = 0;
const cmdTreino = emptyCommand();

/* Spawns em círculo: com N lutadores, posição fixa em par vira duelo e some o
 * tumulto que o jogo propõe. O raio é fração do raio da arena pra ninguém
 * nascer na borda. */
function makeSpawns(n) {
  const out = [];
  const r = TUNING.arena.startRadius * 0.34;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    out.push(new THREE.Vector3(Math.cos(a) * r, 12 + (i % 3) * 3, Math.sin(a) * r));
  }
  return out;
}

const CORES = [0x6fd6ff, 0xff8a5c, 0x9dff6f, 0xffd75c, 0xd98aff, 0x5cffd7, 0xff5c9d];

let player = null;
let opponent = null;          // alvo ATUAL do jogador (não "o oponente")
let bots = [];
let fighters = [];
let SPAWNS = [];
let roundOver = false;
let roundOverTimer = 0;

const playerCmd = emptyCommand();
const moveBasis = { forward: new THREE.Vector3(), right: new THREE.Vector3() };

const ctx = {
  arena, vfx, juice, projectiles, beam, moveBasis,
  onHit, onVanish, onClash, onDashImpact,
  /* Chamado pelo Fighter no início de CADA golpe. É o que permite trocar de
   * alvo no meio do combo: a direção que você segura escolhe em quem bate. */
  pickTarget: (f, cmd) => pickAttackTarget(f, fighters, cmd, moveBasis, f.target),
};

/* ==========================================================================
 *  Carregamento
 * ========================================================================== */
async function boot() {
  try {
    const nInimigos = Math.max(1, TUNING.match.opponents);
    loadingMsg.textContent = `carregando ${nInimigos + 1} lutadores…`;
    const chars = await Promise.all([
      loadCharacter('fighter_default'),
      ...Array.from({ length: nInimigos }, () => loadCharacter('fighter_opponent')),
    ]);
    SPAWNS = makeSpawns(chars.length);

    loadingMsg.textContent = 'montando a arena…';
    const arenaModel = await loadArenaModel(TUNING.arena.startRadius);
    if (arenaModel) {
      // Um modelo de arena substitui o disco procedural.
      arena.floor.visible = false;
      arena.group.add(arenaModel);
    }

    fighters = chars.map((c, i) => new Fighter({
      character: c,
      spawn: SPAWNS[i],
      name: i === 0 ? 'VOCÊ' : `RIVAL ${i}`,
      auraColor: CORES[i % CORES.length],
    }));
    player = fighters[0];

    for (const f of fighters) {
      scene.add(f.char.root);
      f.aura = vfx.createAura(f.char.root, f.auraColor);
      f.trail = vfx.createTrail(f.auraColor);
      // Cada rival ganha um tom próprio, senão viram um borrão só.
      if (f !== player) f.char.setTint?.(f.auraColor);
    }

    // Cada IA tem semente própria: com a mesma, todas tomariam a MESMA decisão
    // no mesmo frame e o grupo se moveria como um cardume.
    bots = fighters.slice(1).map((f, i) => new BotController(f, 0xC0FFEE + i * 7919));

    for (const f of fighters) f.target = nearestEnemy(f, fighters);
    opponent = player.target;

    combatCam.snapTo(player, opponent);

    loadingEl.classList.add('hidden');
    hud.showBanner('LUTE!', 1600, 'big');
    loop.start();

    if (chars[0].isPlaceholder) {
      console.info(
        '%c[arena-proto] Rodando com o mannequin procedural.',
        'color:#7fd8ff;font-weight:bold',
      );
      console.info(
        'Para trocar por um personagem de verdade: baixe um FBX no Mixamo,\n' +
        'jogue em ./assets/models/ e edite UMA linha em assets.config.js:\n' +
        "    source: './assets/models/seu-arquivo.fbx'",
      );
    }
  } catch (err) {
    console.error(err);
    loadingMsg.innerHTML = `<span style="color:#ff8080">Falhou ao carregar.</span><br>` +
      `<small>${err.message}</small><br><small>Veja o console (F12).</small>`;
  }
}

/* ==========================================================================
 *  Comando do jogador
 * ========================================================================== */
function buildPlayerCommand() {
  const c = playerCmd;
  const mv = input.moveVector();

  c.moveX = mv.x;
  c.moveY = mv.y;
  c.vertical = (input.down('ascend') ? 1 : 0) - (input.down('descend') ? 1 : 0);

  c.rush = input.buffered('rush', 8);
  c.smash = input.buffered('smash', 10);
  c.blast = input.pressed('blast');
  c.blastHeld = input.down('blast');
  c.guard = input.down('guard');
  c.vanish = input.pressed('vanish');
  c.dash = input.down('dash');
  c.charge = input.down('chargeKi');
  c.ultimate = input.pressed('ultimate');

  // Direção do smash: vertical manda. Espaço+K sobe, C+K crava.
  c.smashDir = c.vertical > 0.5 ? 'up' : c.vertical < -0.5 ? 'down' : 'forward';

  // Gasta o buffer pra ação não repetir no frame seguinte.
  if (c.rush && player?.state !== S.ATTACK) input.consume('rush');
  if (c.smash) input.consume('smash');

  return c;
}

/* ==========================================================================
 *  Eventos de combate
 * ========================================================================== */
function onHit({ attacker, victim, move, result, point, projectile }) {
  const isPlayerAttacker = attacker === player;

  if (result === 'guard') {
    juice.impact({ hitstop: Math.round(move.hitstop * 0.5), shake: move.shake * 0.4 });
    vfx.burst(point, { count: 10, color: 0x9fd0ff, speed: 5, life: 0.25 });
    vfx.ring(point, { billboard: true, color: 0x9fd0ff, from: 0.3, to: 2.4, life: 0.28 });
    return;
  }

  juice.impact({
    hitstop: move.hitstop,
    shake: move.shake,
    zoom: move.punchZoom ? 1 : (move.causesBlowaway ? 0.6 : 0),
  });

  const heavy = !!move.causesBlowaway;
  vfx.burst(point, {
    count: heavy ? TUNING.juice.impactSparkCount * 2 : null,
    color: heavy ? 0xfff0c0 : 0xbfefff,
    speed: heavy ? 15 : null,
    life: heavy ? 0.6 : null,
  });
  vfx.ring(point, {
    billboard: true,
    color: heavy ? 0xffe3a0 : 0xaee6ff,
    from: 0.4, to: heavy ? 11 : 3.6,
    life: heavy ? 0.5 : 0.32,
  });

  if (result === 'guardbreak') {
    hud.showBanner('GUARDA QUEBRADA', 1100, 'warn');
    vfx.burst(point, { count: 40, color: 0xffd080, speed: 12, life: 0.5 });
  }

  if (isPlayerAttacker) hud.addCombo();
  else hud.resetCombo();
}

function onVanish(victim, attacker, point) {
  vfx.burst(point, { count: 26, color: 0xffffff, speed: 12, life: 0.35 });
  for (let i = 0; i < TUNING.defense.vanish.afterimageCount; i++) vfx.afterimage(victim.char, 0xaad8ff);
  if (victim === player) hud.showBanner('VANISH', 900, '');
  else hud.resetCombo();
}

function onClash(point) {
  hud.showBanner('CLASH!', 1000, 'big');
}

/* Tromba de dash: precisa de um baque visível, senão o dash parece ter
 * "travado sozinho" em vez de ter sido barrado pelo adversário. */
function onDashImpact(dasher, victim) {
  const p = dasher.position.clone().lerp(victim.position, 0.5);
  p.y += 0.9;
  vfx.burst(p, { count: 20, color: 0xdff2ff, speed: 9, life: 0.32 });
  vfx.ring(p, { billboard: true, color: 0xaee6ff, from: 0.4, to: 5.5, life: 0.34 });
  if (dasher === player) hud.addCombo();
}

/** Eventos que o próprio Fighter emitiu neste frame. */
function drainEvents(f) {
  for (const e of f.events) {
    switch (e.type) {
      case 'afterimage':
        vfx.afterimage(f.char, f.auraColor);
        break;

      case 'chargePulse':
        vfx.auraTick(f.position, { intensity: 2.2, color: f.auraColor, count: 5 });
        if (f.stateFrame % 20 === 0) {
          vfx.ring(f.position, { color: f.auraColor, from: 0.5, to: 4.5, life: 0.5 });
          juice.shake(0.05);
        }
        break;

      case 'fireBlast': {
        const spec = e.charged ? TUNING.blasts.charged_blast : TUNING.blasts.ki_blast;
        projectiles.fire(f, spec, e.chargeT);
        juice.shake(e.charged ? 0.3 : 0.06);
        if (e.charged) juice.zoom(0.5);
        break;
      }

      case 'blastCharging':
        vfx.auraTick(f.char.socket('hand_r').getWorldPosition(new THREE.Vector3()),
          { intensity: 1.6, color: 0x88e0ff, count: 3 });
        break;

      case 'ultimateStart':
        hud.showBanner(f === player ? 'ULTIMATE!' : 'CUIDADO!', 1400, 'big');
        juice.slowMo(TUNING.blasts.ultimate.cinematicFrames, 0.45);
        break;

      case 'ultimateFire':
        beam.start(f);
        juice.impact({ shake: TUNING.blasts.ultimate.shake, zoom: 1.4 });
        vfx.ring(f.position, { billboard: true, color: 0xcfefff, from: 1, to: 22, life: 0.7 });
        break;

      case 'groundSlam': {
        const p = f.position.clone();
        p.y = TUNING.arena.floorY;
        const power = Math.min(1, e.speed / 30);
        vfx.dust(p, { count: 30, speed: 7 * (0.5 + power), radius: 1.4, life: 1.2 });
        vfx.ring(p, { color: 0xd8c8a0, from: 1, to: 16 * (0.4 + power), life: 0.6 });
        vfx.burst(p, { count: 24, color: 0xffd9a0, speed: 10, life: 0.5 });
        juice.impact({ hitstop: 8, shake: 0.5 * (0.4 + power), zoom: 0.7 });
        break;
      }

      case 'airRecover':
        vfx.burst(f.position, { count: 14, color: f.auraColor, speed: 7, life: 0.3 });
        vfx.ring(f.position, { billboard: true, color: f.auraColor, from: 0.4, to: 4, life: 0.35 });
        break;

      case 'vanish':
        break;
    }
  }
}

/* ==========================================================================
 *  Manutenção dos bonecos de treino
 * ==========================================================================
 *  Sem isto o treino dura dez segundos: você mata o boneco, ou manda ele pra
 *  fora com um smash, e acabou. Ele precisa se recompor sozinho.
 * ========================================================================== */
function manterBonecos() {
  const T = TUNING.training;

  for (let i = 1; i < fighters.length; i++) {
    const f = fighters[i];

    // Saiu da arena (ou morreu): volta ao lugar depois de um instante.
    if (!f.alive) {
      f._respawn = (f._respawn || 0) + 1;
      if (f._respawn >= T.respawnDelayFrames) {
        f._respawn = 0;
        f.reset(SPAWNS[i]);
        f.char.root.visible = true;
        f.target = player;
      }
      continue;
    }
    f._respawn = 0;

    // Vida volta ao cheio depois de um tempo sem apanhar — assim dá pra ler
    // quanto um combo inteiro tirou antes de recomeçar.
    if (f.health < TUNING.fighter.maxHealth) {
      f._healTimer = (f._healTimer || 0) + 1;
      if (f._healTimer >= T.healDelayFrames) {
        f.health = TUNING.fighter.maxHealth;
        f.poise = TUNING.fighter.maxPoise;
        f._healTimer = 0;
      }
    } else {
      f._healTimer = 0;
    }
  }
}

/* ==========================================================================
 *  Projeção mundo → tela (usada pelo marcador de alvo)
 * ========================================================================== */
const _proj = new THREE.Vector3();
const _camDir = new THREE.Vector3();
const _toTarget = new THREE.Vector3();

function projectToScreen(worldPos) {
  // Teste de "está à frente" feito por produto escalar, NÃO pelo z projetado.
  // Ponto atrás da câmera atravessa a divisão por w negativo e volta espelhado
  // na tela — o marcador apareceria do lado oposto, grudado numa borda.
  camera.getWorldDirection(_camDir);
  _toTarget.subVectors(worldPos, camera.position);
  const inFront = _toTarget.dot(_camDir) > 0;

  _proj.copy(worldPos).project(camera);
  return {
    x: (_proj.x * 0.5 + 0.5) * innerWidth,
    y: (-_proj.y * 0.5 + 0.5) * innerHeight,
    onScreen: inFront && Math.abs(_proj.x) <= 1.1 && Math.abs(_proj.y) <= 1.1,
  };
}

/* ==========================================================================
 *  Ring-out
 * ========================================================================== */
function checkRingOut(f) {
  if (!f.alive) return;

  const out = arena.isOutOfBounds(f.position);

  if (arena.isRingOut(f.position)) {
    f.eliminate('queda');
    announceKO(f, 'CAIU DA ARENA');
    return;
  }

  if (out) {
    f.outOfBoundsFrames++;
    if (f.outOfBoundsFrames === 1 && f === player) hud.showBanner('VOLTE PRA ARENA!', 1200, 'warn');
    if (f.outOfBoundsFrames > TUNING.arena.outOfBoundsFrames) {
      f.eliminate('fora');
      announceKO(f, 'RING OUT');
    }
  } else {
    f.outOfBoundsFrames = 0;
  }

  if (f.health <= 0 && f.state !== S.BLOWAWAY && f.velocity.lengthSq() < 4) {
    f.eliminate('nocaute');
    announceKO(f, 'K.O.');
  }
}

function announceKO(loser, reason) {
  // Com vários lutadores, uma eliminação NÃO acaba a partida — só tira um.
  // O fim é decidido no fim do step, quando sobra um vivo.
  hud.showBanner(`${reason}: ${loser.name}`, 1200, loser === player ? 'warn' : '');
  juice.impact({ hitstop: 12, shake: 0.7, zoom: 0.8 });

  loser.char.root.visible = false;
  vfx.burst(loser.position, { count: 70, color: 0xffffff, speed: 18, life: 0.9 });
  vfx.ring(loser.position, { billboard: true, color: 0xffffff, from: 1, to: 26, life: 0.9 });
}

function resetRound() {
  roundOver = false;
  roundOverTimer = 0;

  fighters.forEach((f, i) => {
    f.reset(SPAWNS[i]);
    f.char.root.visible = true;
  });
  for (const f of fighters) f.target = nearestEnemy(f, fighters);
  opponent = player.target;

  lockedOn = true;
  player.lockOn = true;
  combatCam.locked = true;

  for (const b of bots) b.reset();
  arena.reset();
  vfx.reset();
  projectiles.reset();
  beam.reset();
  juice.reset();
  hud.reset();
  combatCam.reset();
  combatCam.snapTo(player, opponent);

  hud.showBanner('LUTE!', 1400, 'big');
}

/* ==========================================================================
 *  Loop
 * ==========================================================================*/
const loop = new FixedLoop({
  fps: TUNING.sim.fps,
  maxCatchUp: TUNING.sim.maxCatchUpFrames,
  step,
  render,
});

function step(dt) {
  input.update();

  if (input.pressed('debugPanel')) debugPanel.toggle();

  if (input.pressed('training')) {
    modoTreino = (modoTreino + 1) % MODOS_TREINO.length;
    cmdTreino.guard = modoTreino === 2;
    hud.showBanner(`TREINO: ${MODOS_TREINO[modoTreino]}`, 1100);
    // Ao voltar pro normal, devolve todo mundo inteiro pra luta valer.
    if (modoTreino === 0) {
      for (const f of fighters) { if (f.alive) { f.health = TUNING.fighter.maxHealth; f.ki = TUNING.ki.max * TUNING.ki.startPercent; } }
    }
  }
  if (input.pressed('reset')) { resetRound(); return; }

  if (player) {
    // Q — troca de alvo. Se o lock estava solto, Q também retoma: é o gesto
    // natural de "quero focar NAQUELE ali".
    if (input.pressed('lockCycle')) {
      combatCam.getMoveBasis(moveBasis);
      const novo = cycleTarget(player, fighters, player.target, moveBasis);
      if (novo) {
        player.target = novo;
        opponent = novo;
        if (!lockedOn) { lockedOn = true; player.lockOn = true; combatCam.setLocked(true, player, novo); }
        hud.showBanner(`ALVO: ${novo.name}`, 600);
      }
    }

    // E — solta/retoma o lock sem mudar de alvo.
    if (input.pressed('lockToggle')) {
      lockedOn = !lockedOn;
      player.lockOn = lockedOn;
      combatCam.setLocked(lockedOn, player, player.target);
      hud.showBanner(lockedOn ? 'LOCK-ON' : 'LOCK SOLTO', 700);
    }
  }

  // Juice roda SEMPRE — é ele que mantém a vibração viva durante o hitstop.
  juice.update(dt);
  loop.timeScale = juice.timeScale;

  if (!player || !opponent) return;

  if (roundOver) {
    roundOverTimer += dt;
    // Reinício automático depois de um tempo, além do Backspace.
    if (roundOverTimer > 5) resetRound();
    return;
  }

  // Congelado no impacto: nada de gameplay anda.
  if (juice.frozen) return;

  combatCam.getMoveBasis(moveBasis);

  player.update(dt, buildPlayerCommand(), ctx);

  for (const b of bots) {
    if (!b.f.alive) continue;

    if (modoTreino !== 0) {
      /* Boneco de treino: não AGE, mas continua REAGINDO. Passamos um comando
       * vazio em vez de pular o update — pular congelaria hitstun, knockback e
       * blowaway, e aí o alvo não ensinaria nada sobre o combo. */
      b.f.target = player;
      b.f.update(dt, cmdTreino, ctx);
      continue;
    }

    // Cada IA persegue o inimigo vivo mais próximo — inclusive outras IAs.
    // É isso que faz a arena parecer uma batalha campal e não N duelos.
    if (!b.f.target || !b.f.target.alive) b.f.target = nearestEnemy(b.f, fighters);
    b.f.update(dt, b.update(dt, ctx), ctx);
  }

  if (modoTreino !== 0) manterBonecos();

  resolveMelee(fighters, ctx);
  // Dash-contra-dash (clash) tem regra própria e é testado depois do impacto
  // normal, senão um dos dois seria tratado como tromba comum.
  resolveDashImpact(fighters, ctx);
  resolveDashClash(fighters, ctx);
  projectiles.update(dt, fighters, ctx);
  beam.update(dt, fighters, ctx);
  resolveOverlap(fighters);

  if (modoTreino === 0) arena.update(dt);

  for (const f of fighters) {
    drainEvents(f);
    checkRingOut(f);
  }

  // O alvo do jogador morreu ou saiu: reengata no mais próximo sem pedir nada.
  if (player.alive && (!player.target || !player.target.alive)) {
    const novo = nearestEnemy(player, fighters);
    player.target = novo;
    opponent = novo;
    if (novo) hud.showBanner(`ALVO: ${novo.name}`, 600);
  }
  opponent = player.target;

  // Fim de partida: sobrou um.
  const vivos = fighters.filter((f) => f.alive);
  if (!roundOver && modoTreino === 0 && vivos.length <= 1) {
    roundOver = true;
    roundOverTimer = 0;
    const venceu = vivos[0] === player;
    hud.showBanner(venceu ? 'VOCÊ VENCEU' : 'VOCÊ PERDEU', 60000, venceu ? 'big' : 'warn');
    juice.impact({ hitstop: 20, shake: 1.0, zoom: 1.2 });
    juice.slowMo(90, 0.3);
  }
}

function render(alpha, dtReal) {
  const dt = Math.min(dtReal, 0.1);

  if (player) {
    // Aura e rastro seguem o render, não a simulação: durante o hitstop eles
    // continuam vivos, e é isso que impede o congelamento de parecer bug.
    for (const f of fighters) {
      f.char.update(dt * (f.state === S.KNOCKDOWN ? 0.6 : 1));
      f.aura?.update(dt, vfx.elapsed);

      if (f.aura && f.aura.intensity > 0.3) {
        vfx.auraTick(f.position, {
          intensity: f.aura.intensity * 0.5,
          color: f.auraColor,
          count: 1,
        });
      }

      if (f.trail) {
        const socket = f.move ? f.char.socket(f.move.socket) : f.char.socket('hand_r');
        f.trail.update(socket.getWorldPosition(new THREE.Vector3()), camera.position);
      }
    }

    combatCam.update(dt, player, opponent, juice);

    const look = input.takeMouseDelta();
    if (look.x || look.y) combatCam.addLookInput(look.x, look.y);

    vfx.update(dt, player.velocity.length());
    arena.render(dt, vfx.elapsed);
    hud.update(dt, { player, opponent, arena, loop, fighters, treino: MODOS_TREINO[modoTreino] });

    hud.setLock(
      lockedOn,
      opponent && opponent.alive ? projectToScreen(opponent.center(_toTarget.clone())) : null,
    );
  }

  bloom.strength = TUNING.juice.bloomStrength;
  bloom.radius = TUNING.juice.bloomRadius;
  bloom.threshold = TUNING.juice.bloomThreshold;

  composer.render();
}

/* ==========================================================================
 *  Resize
 * ========================================================================== */
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
  bloom.resolution.set(innerWidth, innerHeight);
});

boot();

/* Atalho de console pra inspecionar/ajustar sem recarregar. Exemplos:
 *     PROTO.TUNING.moves.smash_forward.knockback = 70
 *     PROTO.player.ki = 100
 *     PROTO.TUNING.ai.enabled = false
 *     PROTO.resetRound()
 */
window.PROTO = {
  TUNING,
  get player() { return player; },
  get opponent() { return opponent; },
  get fighters() { return fighters; },
  get bots() { return bots; },
  get lockedOn() { return lockedOn; },
  get modoTreino() { return MODOS_TREINO[modoTreino]; },
  arena, vfx, juice, loop, camera, combatCam,
  projectiles, beam,
  resetRound,
};
