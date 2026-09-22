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
import { resolveMelee, resolveDashClash, resolveOverlap } from './combat/resolve.js';
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

const SPAWNS = [
  new THREE.Vector3(0, 12, -9),
  new THREE.Vector3(0, 12, 9),
];

let player = null;
let opponent = null;
let bot = null;
let fighters = [];
let roundOver = false;
let roundOverTimer = 0;

const playerCmd = emptyCommand();
const moveBasis = { forward: new THREE.Vector3(), right: new THREE.Vector3() };

const ctx = {
  arena, vfx, juice, projectiles, beam, moveBasis,
  onHit, onVanish, onClash,
};

/* ==========================================================================
 *  Carregamento
 * ========================================================================== */
async function boot() {
  try {
    loadingMsg.textContent = 'carregando personagens…';
    const [c1, c2] = await Promise.all([
      loadCharacter('fighter_default'),
      loadCharacter('fighter_opponent'),
    ]);

    loadingMsg.textContent = 'montando a arena…';
    const arenaModel = await loadArenaModel(TUNING.arena.startRadius);
    if (arenaModel) {
      // Um modelo de arena substitui o disco procedural.
      arena.floor.visible = false;
      arena.group.add(arenaModel);
    }

    player = new Fighter({ character: c1, spawn: SPAWNS[0], name: 'VOCÊ', auraColor: 0x6fd6ff });
    opponent = new Fighter({ character: c2, spawn: SPAWNS[1], name: 'OPONENTE', auraColor: 0xff8a5c });

    for (const f of [player, opponent]) {
      scene.add(f.char.root);
      f.aura = vfx.createAura(f.char.root, f.auraColor);
      f.trail = vfx.createTrail(f.auraColor);
    }

    player.target = opponent;
    opponent.target = player;
    fighters = [player, opponent];

    bot = new BotController(opponent, 0xC0FFEE);

    combatCam.snapTo(player, opponent);

    loadingEl.classList.add('hidden');
    hud.showBanner('LUTE!', 1600, 'big');
    loop.start();

    if (c1.isPlaceholder) {
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
  if (roundOver) return;
  roundOver = true;
  roundOverTimer = 0;

  const won = loser !== player;
  hud.showBanner(`${reason} — ${won ? 'VOCÊ VENCEU' : 'VOCÊ PERDEU'}`, 60000, won ? 'big' : 'warn');
  juice.impact({ hitstop: 20, shake: 1.0, zoom: 1.2 });
  juice.slowMo(90, 0.3);

  loser.char.root.visible = false;
  vfx.burst(loser.position, { count: 70, color: 0xffffff, speed: 18, life: 0.9 });
  vfx.ring(loser.position, { billboard: true, color: 0xffffff, from: 1, to: 26, life: 0.9 });
}

function resetRound() {
  roundOver = false;
  roundOverTimer = 0;

  player.reset(SPAWNS[0]);
  opponent.reset(SPAWNS[1]);
  player.char.root.visible = true;
  opponent.char.root.visible = true;

  lockedOn = true;
  player.lockOn = true;
  combatCam.locked = true;

  bot.reset();
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
  if (input.pressed('reset')) { resetRound(); return; }

  if (input.pressed('lockTarget') && player && opponent) {
    lockedOn = !lockedOn;
    player.lockOn = lockedOn;
    combatCam.setLocked(lockedOn, player, opponent);
    hud.showBanner(lockedOn ? 'LOCK-ON' : 'LOCK SOLTO', 700);
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

  const pCmd = buildPlayerCommand();
  const oCmd = bot.update(dt, ctx);

  player.update(dt, pCmd, ctx);
  opponent.update(dt, oCmd, ctx);

  resolveMelee(fighters, ctx);
  resolveDashClash(fighters, ctx);
  projectiles.update(dt, fighters, ctx);
  beam.update(dt, fighters, ctx);
  resolveOverlap(fighters);

  arena.update(dt);

  for (const f of fighters) {
    drainEvents(f);
    checkRingOut(f);
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
    hud.update(dt, { player, opponent, arena, loop });

    hud.setLock(
      lockedOn,
      opponent.alive ? projectToScreen(opponent.center(_toTarget.clone())) : null,
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

// Atalho de console pra inspecionar/ajustar sem recarregar.
window.PROTO = { TUNING, get player() { return player; }, get opponent() { return opponent; }, arena, vfx, juice, loop, resetRound };
