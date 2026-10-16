/* =============================================================================
 *  obstacles.js  —  Colunas que escondem, e que afundam conforme a arena fecha
 * =============================================================================
 *
 *  O limite de detecção (targeting.js) deu ao jogo a opção de FUGIR — mas só
 *  por distância. Num vazio de 300 m não existe esconder, cobrir nem usar
 *  terreno. Este módulo é o terreno.
 *
 *  O QUE UMA COLUNA FAZ, e onde cada coisa é consumida:
 *
 *    linha de visão  →  targeting.js   (não se adquire alvo atrás de coluna;
 *                                       perder por coluna tem atraso)
 *    colisão         →  fighter._integrate (todos os estados, blowaway incluso)
 *    câmera          →  camera.js      (encurta o braço; transparência em
 *                                       quem tapa você ou o alvo)
 *    IA              →  bot.js         (desvia; com vida baixa e fora de
 *                                       combate, se esconde na sombra)
 *    projéteis       →  projectiles.js (ki blast morre na coluna)
 *
 *  A DENSIDADE VEM DA FASE (`phases[].obst`): fração de colunas de pé. Elas
 *  AFUNDAM no chão em vez de sumir — o jogador vê o esconderijo acabando e
 *  tem tempo de sair. Ver `TUNING.obstacles` pro porquê de cada número.
 *
 *  ---------------------------------------------------------------------------
 *  POR QUE CILINDRO VERTICAL (e o que isso vira no Unreal)
 *  ---------------------------------------------------------------------------
 *  Cilindro de pé = círculo no plano XZ + uma altura. Visão, colisão e mira da
 *  câmera viram contas de 2D com um teste de altura no fim, e é por isso que
 *  este arquivo é curto. No Unreal tudo isto é `LineTraceByChannel` contra
 *  um canal "Visibility" + capsule/cylinder collision — o motor faz.
 *
 *  A grade espacial (`_grade`) existe só porque `PROTO.simular()` roda 90 mil
 *  passos com 30 lutadores; sem ela cada partida medida levaria minutos. Não é
 *  otimização que porta.
 *
 *  SEM obstáculos (duelo, `enabled: 0`) a lista é vazia e TODA consulta
 *  devolve "livre" no primeiro teste — o duelo não pode mudar nem um frame.
 * ========================================================================== */

import * as THREE from 'three';
import { TUNING } from '../tuning.js';

const CELULA = 24;            // m — lado da célula da grade espacial

const _n = new THREE.Vector3();

export class Obstaculos {
  constructor(scene) {
    this.scene = scene;
    this.lista = [];
    this.group = new THREE.Group();
    scene.add(this.group);
    this._grade = new Map();
    this._carimbo = 0;        // evita testar a mesma coluna 2× numa consulta
    this._fracAnterior = 1;
  }

  /* ------------------------------------------------------------------ */
  /*  Construção                                                         */
  /* ------------------------------------------------------------------ */

  /**
   * Gera as colunas. Chamado no boot, DEPOIS dos spawns (precisa deles pra
   * não nascer ninguém dentro de uma coluna).
   * @param {number} raioArena  raio da primeira fase
   * @param {THREE.Vector3[]} spawns
   */
  gerar(raioArena, spawns = []) {
    this._limpar();
    const O = TUNING.obstacles;
    if (!O || !O.enabled) return;

    const rand = mulberry32(O.seed);
    const R = raioArena * 0.97;
    let tentativas = 0;

    while (this.lista.length < O.count && tentativas < O.count * 60) {
      tentativas++;
      // uniforme no disco
      const a = rand() * Math.PI * 2;
      const d = Math.sqrt(rand()) * R;
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      const r = O.radiusMin + rand() * (O.radiusMax - O.radiusMin);

      let ok = true;
      for (const s of spawns) {
        if (Math.hypot(s.x - x, s.z - z) < r + O.spawnClearance) { ok = false; break; }
      }
      if (!ok) continue;
      for (const o of this._vizinhos(x, z, r + O.minGap + O.radiusMax)) {
        if (Math.hypot(o.x - x, o.z - z) < o.r + r + O.minGap) { ok = false; break; }
      }
      if (!ok) continue;

      const h = O.heightMin + rand() * (O.heightMax - O.heightMin);
      const o = { x, z, r, h, top: h, ordem: 0, mesh: null, opac: 1 };
      this.lista.push(o);
      this._inserir(o);
    }

    /* Ordem de afundar SORTEADA (Fisher–Yates sobre a lista). Sem região
     * privilegiada: se afundassem de fora pra dentro, o centro viraria o
     * esconderijo garantido do fim — o oposto do que se quer. */
    const idx = this.lista.map((_, i) => i);
    for (let i = idx.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [idx[i], idx[j]] = [idx[j], idx[i]];
    }
    idx.forEach((k, pos) => { this.lista[k].ordem = (pos + 0.5) / idx.length; });

    this._construirMalhas();
  }

  _construirMalhas() {
    /* Uma malha (e um material) por coluna: é o jeito mais curto de ter
     * transparência POR coluna, que a câmera precisa. Custa draw calls — e
     * performance de three.js não é pergunta deste protótipo. */
    const geo = new THREE.CylinderGeometry(0.82, 1, 1, 9, 1, false);
    geo.translate(0, 0.5, 0);           // base no chão, cresce pra cima
    for (const o of this.lista) {
      const mat = new THREE.MeshStandardMaterial({
        color: 0x7d746a,
        emissive: 0x23262f,
        emissiveIntensity: 0.55,
        roughness: 0.95,
        metalness: 0.02,
        flatShading: true,
        transparent: true,
        opacity: 1,
      });
      const m = new THREE.Mesh(geo, mat);
      m.position.set(o.x, TUNING.arena.floorY, o.z);
      m.scale.set(o.r, o.top, o.r);
      m.rotation.y = (o.x * 0.37 + o.z * 0.11) % (Math.PI * 2);
      m.castShadow = false;
      m.receiveShadow = true;
      o.mesh = m;
      this.group.add(m);
    }
  }

  _limpar() {
    for (const o of this.lista) {
      if (o.mesh) { this.group.remove(o.mesh); o.mesh.material.dispose(); }
    }
    this.lista = [];
    this._grade.clear();
  }

  /* ------------------------------------------------------------------ */
  /*  Simulação                                                          */
  /* ------------------------------------------------------------------ */

  /**
   * Afunda as colunas conforme a fração de pé da fase atual.
   * @param {number} dt
   * @param {object|null} fase  `arena.fase` (tem `.obst`)
   */
  update(dt, fase) {
    if (this.lista.length === 0) return;
    const frac = fase && fase.obst !== undefined ? fase.obst : 1;
    const O = TUNING.obstacles;
    for (const o of this.lista) {
      // `ordem` acima da fração de pé → esta coluna está afundando
      if (o.ordem > frac && o.top > 0) {
        o.top = Math.max(0, o.top - (o.h / O.sinkSeconds) * dt);
      }
    }
  }

  /** Volta tudo de pé (reinício de rodada). */
  reset() {
    for (const o of this.lista) o.top = o.h;
  }

  contagemDePe() {
    let n = 0;
    for (const o of this.lista) if (o.top > 0.5) n++;
    return n;
  }

  /* ------------------------------------------------------------------ */
  /*  Consultas                                                          */
  /* ------------------------------------------------------------------ */

  /** O ponto está dentro de alguma coluna? (projéteis) */
  contem(p) {
    if (this.lista.length === 0) return false;
    for (const o of this._celula(p.x, p.z)) {
      if (o.top <= 0 || p.y > TUNING.arena.floorY + o.top) continue;
      const dx = p.x - o.x, dz = p.z - o.z;
      if (dx * dx + dz * dz < o.r * o.r) return true;
    }
    return false;
  }

  /**
   * Primeiro ponto (0..1) em que o segmento a→b entra numa coluna, ou 1 se
   * livre. É a primitiva única: visão e câmera usam a MESMA conta, senão o
   * que a IA "vê" e o que o jogador vê divergiriam no primeiro ajuste.
   */
  tracar(a, b) {
    if (this.lista.length === 0) return 1;
    const dx = b.x - a.x, dz = b.z - a.z, dy = b.y - a.y;
    const aa = dx * dx + dz * dz;
    let melhor = 1;
    const y0 = TUNING.arena.floorY;

    for (const o of this._noRetangulo(
      Math.min(a.x, b.x), Math.min(a.z, b.z), Math.max(a.x, b.x), Math.max(a.z, b.z))) {
      if (o.top <= 0) continue;
      const topo = y0 + o.top;
      if (a.y > topo && b.y > topo) continue;          // passa por cima

      const fx = a.x - o.x, fz = a.z - o.z;
      const c = fx * fx + fz * fz - o.r * o.r;
      let t0, t1;
      if (aa < 1e-9) {
        if (c > 0) continue;
        t0 = 0; t1 = 1;
      } else {
        const bb = fx * dx + fz * dz;
        const disc = bb * bb - aa * c;
        if (disc < 0) continue;
        const sq = Math.sqrt(disc);
        t0 = (-bb - sq) / aa;
        t1 = (-bb + sq) / aa;
        if (t1 < 0 || t0 > 1) continue;
        t0 = Math.max(0, t0);
        t1 = Math.min(1, t1);
      }

      // Dentro do intervalo horizontal, a altura é linear: basta checar onde
      // ela cruza o topo.
      const ya = a.y + dy * t0, yb = a.y + dy * t1;
      let t;
      if (ya <= topo) t = t0;                          // entrou pela lateral
      else if (yb <= topo) t = t0 + (t1 - t0) * (ya - topo) / (ya - yb);  // pelo topo
      else continue;
      if (t < melhor) melhor = t;
    }
    return melhor;
  }

  /** Visão livre entre dois pontos? */
  visaoLivre(a, b) {
    return this.tracar(a, b) >= 1;
  }

  /**
   * Empurra o corpo pra fora de qualquer coluna. Devolve a NORMAL do contato
   * mais forte e a velocidade de impacto (componente que entrava na coluna),
   * ou null se não encostou. Quem decide o que fazer com a velocidade é o
   * Fighter — deslizar, quicar ou wall-slam dependem do estado dele.
   */
  colidir(pos, raioCorpo) {
    if (this.lista.length === 0) return null;
    const y0 = TUNING.arena.floorY;
    let contato = null;

    for (const o of this._celula(pos.x, pos.z)) {
      if (o.top <= 0) continue;
      const topo = y0 + o.top;
      if (pos.y >= topo + raioCorpo) continue;

      const dx = pos.x - o.x, dz = pos.z - o.z;
      const d = Math.hypot(dx, dz);
      const R = o.r + raioCorpo;
      if (d >= R) continue;

      const penLado = R - d;
      const penTopo = topo + raioCorpo - pos.y;

      /* Pelo TOPO só se o corpo já estava perto dele — senão alguém colado na
       * base de uma coluna baixa seria catapultado pra cima. */
      if (penTopo < penLado && pos.y > topo - 1.5) {
        pos.y = topo + raioCorpo;
        _n.set(0, 1, 0);
      } else {
        if (d < 1e-6) _n.set(1, 0, 0); else _n.set(dx / d, 0, dz / d);
        pos.x = o.x + _n.x * R;
        pos.z = o.z + _n.z * R;
      }
      contato = contato || { normal: new THREE.Vector3(), obst: null };
      contato.normal.copy(_n);
      contato.obst = o;
    }
    return contato;
  }

  /**
   * Direção desviada pra contornar a coluna mais ameaçadora no caminho.
   * Escreve em `out` (normalizado, no plano XZ). Devolve true se desviou.
   * @param {number} ateDist  não desvia de coluna além disto (o alvo está
   *                          mais perto que ela — não há o que contornar)
   */
  desviar(pos, dir, lookahead, ateDist, out) {
    out.copy(dir);
    if (this.lista.length === 0) return false;
    out.y = 0;
    const len = out.length();
    if (len < 1e-4) return false;
    out.divideScalar(len);

    const alcance = Math.min(lookahead, ateDist);
    let pior = null, piorFolga = Infinity, piorLado = 1;
    const y0 = TUNING.arena.floorY;

    for (const o of this._noRetangulo(pos.x - alcance - 12, pos.z - alcance - 12,
      pos.x + alcance + 12, pos.z + alcance + 12)) {
      if (o.top <= 0 || pos.y > y0 + o.top + 1) continue;
      const cx = o.x - pos.x, cz = o.z - pos.z;
      const along = cx * out.x + cz * out.z;            // distância ao longo do rumo
      if (along < 0 || along - o.r > alcance) continue;
      const lat = cx * out.z - cz * out.x;              // desvio lateral (sinal = lado)
      const folga = Math.abs(lat) - (o.r + 2.0);
      if (folga >= 0) continue;                         // passa ao lado
      if (folga < piorFolga) { piorFolga = folga; pior = o; piorLado = lat >= 0 ? 1 : -1; }
    }
    if (!pior) return false;

    /* Contorna pelo lado em que já está desviado (menos curva), girando o
     * rumo pra tangente. O peso cresce com a proximidade: longe é um ajuste
     * leve, perto é uma curva fechada. */
    const cx = pior.x - pos.x, cz = pior.z - pos.z;
    const dist = Math.max(0.1, Math.hypot(cx, cz) - pior.r);
    const peso = THREE.MathUtils.clamp(1 - dist / alcance, 0.25, 1);
    /* tangente: perpendicular ao vetor até o centro, do lado oposto à coluna.
     * `lat` < 0 = coluna à esquerda do rumo (lado +z indo em +x) → vira pro
     * outro lado. Conferido na mão com rumo (1,0) e coluna em (10, 1). */
    const tx = piorLado * -cz, tz = piorLado * cx;
    const tl = Math.hypot(tx, tz) || 1;
    out.x = out.x * (1 - peso) + (tx / tl) * peso;
    out.z = out.z * (1 - peso) + (tz / tl) * peso;
    out.normalize();
    return true;
  }

  /**
   * Ponto de esconderijo: atrás da coluna de pé mais próxima, do lado OPOSTO
   * à ameaça. Devolve null se não há coluna ao alcance.
   * @param {number} raioSeguro  só colunas inteiras dentro deste raio
   */
  esconderijo(pos, ameaca, raioBusca, out, raioSeguro = Infinity) {
    if (this.lista.length === 0) return null;
    let melhor = null, melhorD = Infinity;
    for (const o of this._noRetangulo(pos.x - raioBusca, pos.z - raioBusca,
      pos.x + raioBusca, pos.z + raioBusca)) {
      if (o.top < o.h * 0.6) continue;               // afundando: não serve
      // Fora da arena (ou na faixa da borda) esconder é suicídio por ring-out.
      if (Math.hypot(o.x, o.z) + o.r + 4 > raioSeguro) continue;
      const d = Math.hypot(o.x - pos.x, o.z - pos.z);
      if (d < melhorD && d < raioBusca) { melhorD = d; melhor = o; }
    }
    if (!melhor) return null;
    let ax = melhor.x - ameaca.x, az = melhor.z - ameaca.z;
    const al = Math.hypot(ax, az);
    if (al < 1e-3) { ax = 1; az = 0; } else { ax /= al; az /= al; }
    const folga = melhor.r + 2.5;
    out.set(melhor.x + ax * folga, Math.min(pos.y, melhor.top * 0.5), melhor.z + az * folga);
    return melhor;
  }

  /* ------------------------------------------------------------------ */
  /*  Visual                                                             */
  /* ------------------------------------------------------------------ */

  /**
   * Afunda as malhas e deixa TRANSPARENTE quem tapa a visão da câmera pro
   * jogador ou pro alvo. É a solução do Tenkaichi: a cena nunca é comida
   * pela parede.
   */
  render(dt, camPos, alvos) {
    if (this.lista.length === 0) return;
    const O = TUNING.obstacles;
    const k = 1 - Math.exp(-10 * dt);
    this._carimbo++;
    const marca = this._carimbo;
    for (const p of alvos) {
      if (!p) continue;
      this._marcarTapando(camPos, p, marca);
    }
    for (const o of this.lista) {
      const m = o.mesh;
      if (!m) continue;
      if (o.top <= 0.05) { m.visible = false; continue; }
      m.visible = true;
      m.scale.y = o.top;
      const alvo = o._tapa === marca ? O.occluderOpacity : 1;
      o.opac += (alvo - o.opac) * k;
      m.material.opacity = o.opac;
      // opaco escreve profundidade; transparente não, senão tapa o que está atrás
      m.material.depthWrite = o.opac > 0.95;
    }
  }

  _marcarTapando(a, b, marca) {
    const dx = b.x - a.x, dz = b.z - a.z, dy = b.y - a.y;
    const aa = dx * dx + dz * dz;
    for (const o of this._noRetangulo(
      Math.min(a.x, b.x), Math.min(a.z, b.z), Math.max(a.x, b.x), Math.max(a.z, b.z))) {
      if (o.top <= 0 || aa < 1e-9) continue;
      const fx = a.x - o.x, fz = a.z - o.z;
      const c = fx * fx + fz * fz - (o.r + 0.6) ** 2;   // margem: borda também tapa
      const bb = fx * dx + fz * dz;
      const disc = bb * bb - aa * c;
      if (disc < 0) continue;
      const sq = Math.sqrt(disc);
      const t0 = Math.max(0, (-bb - sq) / aa), t1 = Math.min(1, (-bb + sq) / aa);
      if (t1 < 0 || t0 > 1 || t0 > t1) continue;
      const topo = TUNING.arena.floorY + o.top;
      if (Math.min(a.y + dy * t0, a.y + dy * t1) > topo) continue;
      o._tapa = marca;
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Grade espacial                                                     */
  /* ------------------------------------------------------------------ */
  _chave(ix, iz) { return ix * 100003 + iz; }

  _inserir(o) {
    const m = 3;                        // margem: corpo e olho perto da borda
    const x0 = Math.floor((o.x - o.r - m) / CELULA), x1 = Math.floor((o.x + o.r + m) / CELULA);
    const z0 = Math.floor((o.z - o.r - m) / CELULA), z1 = Math.floor((o.z + o.r + m) / CELULA);
    for (let ix = x0; ix <= x1; ix++) {
      for (let iz = z0; iz <= z1; iz++) {
        const k = this._chave(ix, iz);
        let l = this._grade.get(k);
        if (!l) { l = []; this._grade.set(k, l); }
        l.push(o);
      }
    }
  }

  _celula(x, z) {
    return this._grade.get(this._chave(Math.floor(x / CELULA), Math.floor(z / CELULA))) || VAZIO;
  }

  /** Colunas cujas células tocam o retângulo — sem repetição. */
  _noRetangulo(xa, za, xb, zb) {
    const out = this._buf || (this._buf = []);
    out.length = 0;
    this._carimboBusca = (this._carimboBusca || 0) + 1;
    const marca = this._carimboBusca;
    const x0 = Math.floor(xa / CELULA), x1 = Math.floor(xb / CELULA);
    const z0 = Math.floor(za / CELULA), z1 = Math.floor(zb / CELULA);
    for (let ix = x0; ix <= x1; ix++) {
      for (let iz = z0; iz <= z1; iz++) {
        const l = this._grade.get(this._chave(ix, iz));
        if (!l) continue;
        for (const o of l) {
          if (o._busca === marca) continue;
          o._busca = marca;
          out.push(o);
        }
      }
    }
    return out;
  }

  _vizinhos(x, z, raio) {
    return this._noRetangulo(x - raio, z - raio, x + raio, z + raio);
  }
}

const VAZIO = [];

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
