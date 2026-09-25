/* =============================================================================
 *  moves.js  —  CATÁLOGO DE GOLPES E CONSULTAS
 * =============================================================================
 *
 *  Um lugar só pra responder perguntas SOBRE um golpe, em vez de espalhar a
 *  mesma conta por `fighter.js`, `resolve.js`, `bot.js` e `hud.js`:
 *
 *      qual golpe sai com esta direção?
 *      esta defesa funciona contra este golpe?
 *      quanto de hitstop este contato merece?
 *      este golpe é carregável, e com que janela?
 *      este lançamento abre perseguição?
 *
 *  ---------------------------------------------------------------------------
 *  ESCOPO: UM PERSONAGEM
 *  ---------------------------------------------------------------------------
 *  Este arquivo NÃO tem sistema de personagens, e isso é uma decisão, não uma
 *  pendência. O MVP existe pra responder uma pergunta — "o combate é divertido o
 *  bastante pra valer o porte pra Unreal?" — e essa pergunta se responde com um
 *  lutador e um conjunto de golpes. Kits, movesets alternativos e diversidade de
 *  personagem multiplicam o trabalho de balanceamento ANTES de se saber se há
 *  algo pra balancear.
 *
 *  Se a resposta for sim, os golpes viram linhas de uma `UDataTable` no Unreal e
 *  variação por personagem é uma linha nova naquela tabela — não uma reescrita.
 *  Por isso é seguro deixar pra depois.
 *
 *  ---------------------------------------------------------------------------
 *  NORMALIZAÇÃO  (§21)
 *  ---------------------------------------------------------------------------
 *  No boot, todo golpe recebe as propriedades que faltam (priority, armor,
 *  launch, category…). É a armadilha 8.19 do doc de passagem — "frame data que
 *  ninguém lê é pior que frame data errado": se `armor` existe em três golpes e
 *  não nos outros, ninguém sabe se ali vale zero ou se o campo foi esquecido.
 *
 *  A normalização MUTA os objetos de `TUNING.moves` em vez de copiar, e isso é
 *  essencial: o painel de debug (P) escreve em
 *  `TUNING.moves.smash_forward.knockback` ao vivo. Uma cópia faria o slider
 *  parar de funcionar, e a pessoa passaria vinte minutos achando que o painel
 *  quebrou.
 *
 *  Ela preenche apenas o que é ESTRUTURAL (tipo, categoria, tipo de lançamento).
 *  Nenhum número que o painel possa mexer é congelado aqui.
 * ========================================================================== */

import { TUNING } from '../tuning.js';

/* ========================================================================== */
/*  Tipos                                                                      */
/* ========================================================================== */
export const MOVE_TYPE = {
  RUSH: 'rush',
  SMASH: 'smash',
  GRAB: 'grab',
  PURSUIT: 'pursuit',
  BLAST: 'blast',
  ULTIMATE: 'ultimate',
  DASH: 'dash',
};

/** Tipos de LANÇAMENTO. Separar isto de "acerto" é o §9. */
export const LAUNCH = {
  NONE: 'none',
  HITSTUN: 'hitstun',       // empurra e prende — o combo continua do atacante
  BLOWAWAY: 'blowaway',     // voando sem controle — ABRE PERSEGUIÇÃO
  SLAM: 'slam',             // crava pro chão — quica, cratera, pode derrubar
  KNOCKDOWN: 'knockdown',   // derruba direto
};

/* ========================================================================== */
/*  Normalização                                                               */
/* ========================================================================== */
/** Descobre o tipo pelo nome quando o golpe não declara. */
function inferType(id) {
  if (id.startsWith('rush')) return MOVE_TYPE.RUSH;
  if (id.startsWith('smash')) return MOVE_TYPE.SMASH;
  if (id.startsWith('grab')) return MOVE_TYPE.GRAB;
  if (id.startsWith('pursuit')) return MOVE_TYPE.PURSUIT;
  return MOVE_TYPE.RUSH;
}

/** Preenche as propriedades estruturais que faltam, NO PRÓPRIO OBJETO. */
export function normalizeMove(id, m) {
  if (m.__normalized) return m;

  if (!m.id) m.id = id;
  if (!m.type) m.type = inferType(id);
  if (!m.category) m.category = m.type;

  const D = TUNING.moveDefaults;
  if (m.priority === undefined) m.priority = D.priority;
  if (m.armor === undefined) m.armor = D.armor;
  if (m.invulnerability === undefined) m.invulnerability = D.invulnerability;
  if (m.guardDamage === undefined) m.guardDamage = D.guardDamage;
  if (m.beatsSway === undefined) m.beatsSway = D.beatsSway;
  if (m.zCounterable === undefined) m.zCounterable = D.zCounterable;

  /* LANÇAMENTO. Os golpes atuais descrevem o resultado com dois booleanos
   * (`causesBlowaway`, `groundSlam`). Traduzimos pro tipo explícito e mantemos
   * os dois coerentes — `causesBlowaway` ainda é lido em vários lugares, e sumir
   * com ele seria uma refatoração sem ganho de gameplay. */
  if (!m.launch) {
    m.launch = {
      type: m.groundSlam ? LAUNCH.SLAM
          : m.causesBlowaway ? LAUNCH.BLOWAWAY
          : LAUNCH.HITSTUN,
    };
  }
  if (m.launch.type === LAUNCH.BLOWAWAY || m.launch.type === LAUNCH.SLAM) {
    m.causesBlowaway = true;
  }

  m.__normalized = true;
  return m;
}

let _ready = false;

/** Chamado uma vez no boot, antes de qualquer lutador existir. */
export function initMoves() {
  if (_ready) return;
  for (const [id, m] of Object.entries(TUNING.moves)) normalizeMove(id, m);
  _ready = true;
}

/** O golpe sob esta chave, já normalizado. */
export function moveOf(key) {
  const m = TUNING.moves[key];
  return m ? normalizeMove(key, m) : null;
}

/* ========================================================================== */
/*  Consultas                                                                  */
/* ========================================================================== */
export const moveTotalFrames = (m) => m.startup + m.active + m.recovery;

/** Dano de guarda efetivo: o do golpe, ou o padrão da guarda. */
export const moveGuardDamage = (m) =>
  m.guardDamage ?? TUNING.defense.guard.staminaPerHit;

/**
 * Config de carga deste golpe: `TUNING.smashCharge` com o que o golpe
 * sobrescrever. Resolvida na HORA DO USO, nunca guardada — senão os sliders de
 * janela perfeita não fariam efeito ao vivo, que é o principal motivo de eles
 * existirem.
 */
export function moveCharge(m) {
  if (!m.chargeable || !TUNING.smashCharge.enabled) return null;
  return m.charge ? { ...TUNING.smashCharge, ...m.charge } : TUNING.smashCharge;
}

/**
 * Esta defesa funciona contra este golpe?  (§15)
 *
 * A matriz em dados, e não num `if`, é o que faz o grab existir como ameaça: ele
 * não lista `guard`, então a guarda simplesmente não responde a ele. Consultada
 * pela resolução de acerto E pela IA — as duas usarem a MESMA função é o que
 * impede a IA de tentar uma defesa que o jogo não aceita.
 */
export function defenseWorks(move, defense) {
  const lista = TUNING.defenseMatrix[move.category] || TUNING.defenseMatrix.rush;
  return lista.includes(defense);
}

/** Este golpe abre a janela de perseguição? Vem do TIPO de lançamento. */
export const opensPursuit = (m) =>
  TUNING.launch.opensPursuit.includes(m.launch?.type);

/**
 * Categoria de hitstop deste contato.  (§22)
 *
 * O `hitstop` do golpe VENCE quando existe — é o escape pra exceções. Sem ele,
 * cai na escala nomeada, que é o que garante que dois golpes de peso parecido
 * congelem parecido em vez de depender de quem digitou o número.
 */
export function hitstopFor(move, { guarded = false, perfect = false, counter = false } = {}) {
  const P = TUNING.juice.hitstopProfiles;
  if (perfect) return P.perfect;
  if (counter) return P.counter;
  if (guarded) return Math.round((move.hitstop ?? P.normal) * 0.5) || P.guard;
  if (move.hitstop !== undefined) return move.hitstop;
  if (opensPursuit(move)) return P.launch;
  if (move.type === MOVE_TYPE.SMASH) return P.heavy;
  return P.normal;
}

/* ========================================================================== */
/*  Qual golpe sai                                                             */
/* ========================================================================== */
/**
 * A direção segurada escolhe o golpe.
 *
 *   nada / direita → soco de direita
 *   esquerda       → soco de esquerda
 *   frente/cima    → gancho (levanta)
 *   trás/baixo     → chute descendente (crava)
 *
 * Vertical (Espaço/C) tem prioridade sobre o horizontal: quem aperta Espaço+J
 * está claramente pedindo o gancho, não um soco lateral.
 */
export function rushKeyFor(cmd) {
  if (cmd.vertical > 0.4) return 'rush_u';
  if (cmd.vertical < -0.4) return 'rush_d';
  if (cmd.moveY > 0.4) return 'rush_u';
  if (cmd.moveY < -0.4) return 'rush_d';
  if (cmd.moveX < -0.4) return 'rush_l';
  return 'rush_r';
}

export function smashKeyFor(dir) {
  if (dir === 'up') return 'smash_up';
  if (dir === 'down') return 'smash_down';
  return 'smash_forward';
}

/* ========================================================================== */
/*  Perseguição                                                                */
/* ========================================================================== */
/**
 * Qual TIPO de perseguição este comando está pedindo.  (§10)
 *
 *     Shift        DIRETA           barata, viaja, dá ROTA NOVA, pode errar
 *     Shift + V    VANISH           caríssima, infalível, NÃO dá rota
 *     Shift + K    ALTA VELOCIDADE  acerta um spike que RE-LANÇA, recovery enorme
 *
 * Nenhuma tecla nova: a perseguição continua sendo Shift, e o modificador é um
 * botão que o jogador já associa àquela ideia (V = sumir, K = golpe pesado).
 * É o §29 aplicado — contexto em vez de teclado novo.
 */
export function pursuitTypeFor(cmd) {
  if (cmd.vanish) return 'vanish';
  if (cmd.smash) return 'highSpeed';
  return 'direct';
}

/** Config de um tipo de perseguição: os campos do tipo sobre os compartilhados. */
export function pursuitSpec(type) {
  const P = TUNING.pursuit;
  const t = P.types[type] || P.types.direct;
  return { ...P, ...t, type };
}
