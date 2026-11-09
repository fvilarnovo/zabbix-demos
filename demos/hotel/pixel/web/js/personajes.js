// Personajes: sprites generados por código, caminata por casillas y comportamiento con corrutinas.
import { P, aclarar, lienzo, recortar } from "./pixel.js";

const ANCHO_SPR = 16;
const ALTO_SPR = 26;
const cache = new Map();

export const LOOKS = {
  jugador: { id: "jugador", piel: "#f2c79a", pelo: "#3a2616", gorra: "#2f6fd0", ropa: "#d6332e", pantalon: "#2d3a66", zapato: "#2a1c14", estilo: "corto" },
  recepcion: { id: "recepcion", piel: "#e7b48a", pelo: "#201512", ropa: "#28304a", pantalon: "#1d2336", zapato: "#14100e", estilo: "corto", corbata: "#d9a441", camisa: true },
  recepcionista: { id: "recepcionista", piel: "#c98f66", pelo: "#3b1f14", ropa: "#28304a", pantalon: "#1d2336", zapato: "#14100e", estilo: "largo", corbata: "#d9a441", camisa: true },
  tecnico: { id: "tecnico", piel: "#d9a074", pelo: "#20160e", gorra: "#e8a21c", ropa: "#d9791c", pantalon: "#39465e", zapato: "#201810", estilo: "corto" },
  gerente: { id: "gerente", piel: "#efc4a0", pelo: "#6a6660", ropa: "#3a3a48", pantalon: "#2a2a36", zapato: "#14100e", estilo: "moño", corbata: "#b5473c", camisa: true },
  analista: { id: "analista", piel: "#e7b48a", pelo: "#a0522d", ropa: "#4a7f6a", pantalon: "#2f3a4a", zapato: "#2a2018", estilo: "largo" },
  pianista: { id: "pianista", piel: "#a06a48", pelo: "#15100e", ropa: "#17151c", pantalon: "#17151c", zapato: "#0c0a0e", estilo: "corto", corbata: "#f0f0f0", camisa: true },
};

const PIELES = ["#f2c79a", "#e7b48a", "#c98f66", "#a06a48", "#7a4a30"];
const PELOS = ["#20160e", "#3b1f14", "#6a3a1c", "#a0522d", "#d8b048", "#8a8a8a"];
const ROPAS = ["#c94f4f", "#4f7fc9", "#4fa86a", "#c9a24f", "#8a5fb0", "#3a8a90", "#d97a4a", "#efe6d0", "#55607a"];
const PANTALONES = ["#2d3a66", "#3a3a48", "#5a4632", "#27303c"];

export function lookAzar(i) {
  const r = (lista) => lista[Math.floor(Math.random() * lista.length)];
  return {
    id: `h${i}`, piel: r(PIELES), pelo: r(PELOS), ropa: r(ROPAS), pantalon: r(PANTALONES), zapato: "#241812",
    estilo: r(["corto", "largo", "moño", "corto", "calvo"]), vestido: Math.random() < 0.25, maleta: Math.random() < 0.3 ? r(["#6a4a30", "#2f5f8f", "#8f3030"]) : null,
  };
}

// cuadro: 0 parado, 1 y 3 pasos; pose: "pie" o "sentado"
function dibujar(l, frente, cuadro, pose) {
  const [lz, c] = lienzo(ANCHO_SPR, ALTO_SPR);
  const r = (color, x, y, w, h) => { c.fillStyle = color; c.fillRect(x, y, w, h); };
  const paso = cuadro === 1 ? 1 : cuadro === 3 ? -1 : 0;
  const sombra = aclarar(l.ropa, -0.25);

  if (l.maleta && pose === "pie") {
    r(l.maleta, 13, 15, 3, 8);
    r(aclarar(l.maleta, -0.3), 13, 22, 3, 1);
    r("#222", 14, 13, 1, 2);
  }
  // Piernas
  if (pose === "sentado") {
    r(l.pantalon, 4, 17, 8, 3);
    r(l.zapato, 4, 20, 3, 2);
    r(l.zapato, 9, 20, 3, 2);
  } else if (l.vestido) {
    r(l.ropa, 3, 16, 10, 5);
    r(sombra, 10, 16, 3, 5);
    r(l.piel, 5, 21, 2, 2 - Math.max(0, paso));
    r(l.piel, 9, 21, 2, 2 + Math.min(0, paso));
    r(l.zapato, 4 , 23 - Math.max(0, paso), 3, 1);
    r(l.zapato, 9, 23 + Math.min(0, paso), 3, 1);
  } else {
    r(l.pantalon, 4, 16, 8, 2);
    r(l.pantalon, 4, 18, 3, 4 - Math.max(0, paso));
    r(l.pantalon, 9, 18, 3, 4 + Math.min(0, paso));
    r(l.zapato, 3 + (paso > 0 ? 1 : 0), 22 - Math.max(0, paso), 4, 2);
    r(l.zapato, 9 - (paso < 0 ? 1 : 0), 22 + Math.min(0, paso), 4, 2);
  }
  // Torso y brazos
  r(l.ropa, 3, 10, 10, 7);
  r(sombra, 11, 10, 2, 7);
  r(l.ropa, 1, 11 - paso, 2, 6);
  r(sombra, 13, 11 + paso, 2, 6);
  r(l.piel, 1, 17 - paso, 2, 1);
  r(l.piel, 13, 17 + paso, 2, 1);
  if (frente) {
    if (l.camisa) r("#f0ece0", 6, 10, 3, 3);
    if (l.corbata) r(l.corbata, 7, 10, 1, 5);
  }
  // Cabeza
  r(l.piel, 7, 9, 2, 1);
  r(l.piel, 3, 2, 10, 7);
  r(l.piel, 4, 1, 8, 1);
  if (frente) {
    if (l.estilo !== "calvo") {
      r(l.pelo, 3, 0, 10, 3);
      r(l.pelo, 2, 2, 2, 4);
      r(l.pelo, 12, 2, 2, 4);
    }
    if (l.estilo === "largo") { r(l.pelo, 2, 5, 2, 7); r(l.pelo, 12, 5, 2, 7); }
    if (l.estilo === "moño") r(l.pelo, 6, -1 + 0, 4, 1);
    // Ojos, corridos hacia el lado al que mira
    r("#1c1420", 5, 5, 2, 2);
    r("#1c1420", 9, 5, 2, 2);
    r("#fff", 5, 5, 1, 1);
    r("#fff", 9, 5, 1, 1);
    r(aclarar(l.piel, -0.18), 7, 8, 2, 1);
  } else if (l.estilo !== "calvo") {
    r(l.pelo, 2, 0, 12, 9);
    r(l.pelo, 3, 9, 10, l.estilo === "largo" ? 3 : 0);
    if (l.estilo === "moño") r(l.pelo, 6, 0, 4, 1);
  } else {
    r(aclarar(l.piel, -0.1), 3, 1, 10, 8);
  }
  if (l.gorra) {
    r(l.gorra, 3, 0, 10, 3);
    r(aclarar(l.gorra, 0.3), 3, 0, 10, 1);
    if (frente) r(aclarar(l.gorra, -0.2), 2, 3, 8, 1);
    else r(l.pelo, 3, 3, 10, 2);
  }
  return lz;
}

function sprPersona(look, mirando, cuadro, pose) {
  const frente = mirando === "SO" || mirando === "SE";
  const espejo = mirando === "SE" || mirando === "NO";
  const clave = `${look.id}|${frente}|${espejo}|${cuadro}|${pose}`;
  let s = cache.get(clave);
  if (s) return s;
  const fuente = dibujar(look, frente, cuadro, pose);
  let base = fuente;
  if (espejo) {
    const [lz, c] = lienzo(ANCHO_SPR, ALTO_SPR);
    c.translate(ANCHO_SPR, 0);
    c.scale(-1, 1);
    c.drawImage(fuente, 0, 0);
    base = lz;
  }
  s = recortar(base, "#171020");
  cache.set(clave, s);
  return s;
}

// ---------------------------------------------------------------- persona

export class Persona {
  constructor(look, x, y) {
    this.look = look;
    this.x = x;
    this.y = y;
    this.mirando = "SO";
    this.ruta = [];
    this.vel = 2.4;
    this.fase = 0;
    this.pose = "pie";
    this.z = 0;
    this.co = null;
    this.emote = null;
    this.emoteT = 0;
    this.dicho = null;
    this.dichoT = 0;
    this.linterna = false;
    this.oculto = false;
    this.salio = false;
    this.ox = 0;
    this.oy = 0;
    this.sudor = false;
    this.tipeando = false;
  }

  get tx() { return Math.floor(this.x); }
  get ty() { return Math.floor(this.y); }
  get caminando() { return this.ruta.length > 0; }

  decir(texto, segundos = 3.5) { this.dicho = texto; this.dichoT = segundos; }
  mostrar(emote, segundos = 1.6) { this.emote = emote; this.emoteT = segundos; }

  mirarA(x, y) {
    const dx = x - this.x;
    const dy = y - this.y;
    if (Math.abs(dx) > Math.abs(dy)) this.mirando = dx > 0 ? "SE" : "NO";
    else this.mirando = dy > 0 ? "SO" : "NE";
  }

  actualizar(dt) {
    if (this.emoteT > 0 && (this.emoteT -= dt) <= 0) this.emote = null;
    if (this.dichoT > 0 && (this.dichoT -= dt) <= 0) this.dicho = null;
    if (this.ruta.length) {
      const [nx, ny] = this.ruta[0];
      const dx = nx - this.x;
      const dy = ny - this.y;
      const d = Math.hypot(dx, dy);
      const avance = this.vel * dt;
      if (d <= avance) {
        this.x = nx;
        this.y = ny;
        this.ruta.shift();
      } else {
        this.x += (dx / d) * avance;
        this.y += (dy / d) * avance;
        this.mirarA(nx, ny);
      }
      this.fase += dt * this.vel * 2.6;
    } else {
      this.fase = 0;
    }
    if (this.co) {
      const r = this.co.next(dt);
      if (r.done) this.co = null;
    }
  }

  pintar(c) {
    if (this.oculto) return;
    const p = P(this.x + this.ox, this.y + this.oy, this.z);
    const cuadro = this.ruta.length ? [1, 0, 3, 0][Math.floor(this.fase) % 4] : 0;
    const s = sprPersona(this.look, this.mirando, cuadro, this.pose);
    if (this.pose === "pie") {
      c.fillStyle = "rgba(20,10,20,0.28)";
      c.fillRect(p.x - 6, p.y - 1, 12, 2);
      c.fillRect(p.x - 4, p.y - 2, 8, 4);
    }
    const bote = cuadro === 0 ? 0 : -1;
    c.drawImage(s.img, p.x - 8 + s.x, p.y - 24 + s.y + bote);
    if (this.tipeando) {
      c.fillStyle = "#f2c79a";
      c.fillRect(p.x - 8 + (Math.floor(performance.now() / 160) % 2) * 2, p.y - 8, 2, 1);
    }
  }

  // Delante de un mueble si está más allá de su huella en alguno de los dos ejes
  delanteDe(o) { return this.x >= o.x2 || this.y >= o.y2; }
}

// ---------------------------------------------------------------- caminos

export function buscarRuta(bloqueo, ax, ay, bx, by, permitir = null) {
  const altoG = bloqueo.length;
  const anchoG = bloqueo[0].length;
  const libre = (x, y) => x >= 0 && y >= 0 && x < anchoG && y < altoG && (!bloqueo[y][x] || (permitir && permitir(x, y)));
  if (ax === bx && ay === by) return [];
  const previo = new Map();
  const clave = (x, y) => y * anchoG + x;
  const cola = [[ax, ay]];
  previo.set(clave(ax, ay), null);
  while (cola.length) {
    const [x, y] = cola.shift();
    if (x === bx && y === by) {
      const salida = [];
      let k = clave(x, y);
      while (k !== clave(ax, ay)) {
        salida.unshift([(k % anchoG) + 0.5, Math.floor(k / anchoG) + 0.5]);
        k = previo.get(k);
      }
      return salida;
    }
    const orden = [[1, 0], [-1, 0], [0, 1], [0, -1]].sort(() => Math.random() - 0.5);
    for (const [dx, dy] of orden) {
      const nx = x + dx;
      const ny = y + dy;
      if (!libre(nx, ny) || previo.has(clave(nx, ny))) continue;
      previo.set(clave(nx, ny), clave(x, y));
      cola.push([nx, ny]);
    }
  }
  return null;
}

export function* esperar(segundos) {
  let t = segundos;
  while (t > 0) t -= yield;
}

// ---------------------------------------------------------------- globitos

const EMOTES = {
  "!": ["...RR...", "...RR...", "...RR...", "...RR...", "........", "...RR..."],
  "?": ["..BBBB..", ".BB..BB.", "....BB..", "...BB...", "........", "...BB..."],
  "…": ["........", "........", "........", "........", "K..K..K.", "........"],
  "♥": [".RR..RR.", "RRRRRRRR", "RRRRRRRR", ".RRRRRR.", "..RRRR..", "...RR..."],
  ira: ["R..RR..R", ".R....R.", "........", "........", ".R....R.", "R..RR..R"],
  "♪": ["...KKKK.", "...K..K.", "...K..K.", ".KKK.KK.", "KKKK.KK.", ".KK....."],
  sudor: ["...B....", "...B....", "..BBB...", ".BBBBB..", ".BBBBB..", "..BBB..."],
  wifi: ["R.KKKK.R", ".RK..KR.", "K.R..R.K", "...RR...", "..RKKR..", ".R.KK.R."],
  llave: ["..YYY...", "..Y.Y...", "..YYY...", "...Y....", "...YY...", "...YY..."],
  $: ["...Y....", ".YYYYY..", ".Y.Y....", ".YYYYY..", "...Y.Y..", ".YYYYY.."],
};
const COLOR_EMOTE = { R: "#d62c2c", B: "#2f6fd0", K: "#2a2230", Y: "#c98d10" };
const cacheEmote = new Map();

function sprEmote(nombre) {
  if (cacheEmote.has(nombre)) return cacheEmote.get(nombre);
  const [l, c] = lienzo(14, 13);
  c.fillStyle = "#1a1224";
  c.fillRect(1, 0, 12, 10);
  c.fillRect(0, 1, 14, 8);
  c.fillRect(5, 10, 4, 1);
  c.fillRect(6, 11, 2, 1);
  c.fillStyle = "#fff";
  c.fillRect(1, 1, 12, 8);
  c.fillRect(6, 9, 2, 1);
  (EMOTES[nombre] || EMOTES["?"]).forEach((fila, y) => [...fila].forEach((ch, x) => {
    if (ch === ".") return;
    c.fillStyle = COLOR_EMOTE[ch];
    c.fillRect(3 + x, 2 + y, 1, 1);
  }));
  cacheEmote.set(nombre, l);
  return l;
}

export function pintarEmote(c, p) {
  if (!p.emote || p.oculto) return;
  const pos = P(p.x + p.ox, p.y + p.oy, p.z);
  const salto = p.emoteT > 1.3 ? -1 : 0;
  c.drawImage(sprEmote(p.emote), pos.x - 7, pos.y - 39 + salto);
}
