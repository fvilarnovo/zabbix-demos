// Personas del edificio: sprites generados por código (los mismos del hotel) que caminan por su piso.
import { aclarar, lienzo, recortar } from "./pixel.js";

const ANCHO_SPR = 16;
const ALTO_SPR = 26;
const cache = new Map();

export const LOOKS = {
  operador: { id: "operador", piel: "#e7b48a", pelo: "#201512", ropa: "#f0ece0", pantalon: "#2d3a66", zapato: "#14100e", estilo: "corto" },
  operadora: { id: "operadora", piel: "#c98f66", pelo: "#3b1f14", ropa: "#f0ece0", pantalon: "#27303c", zapato: "#14100e", estilo: "largo" },
  jefe: { id: "jefe", piel: "#efc4a0", pelo: "#6a6660", ropa: "#28304a", pantalon: "#1d2336", zapato: "#14100e", estilo: "corto", corbata: "#d9a441", camisa: true },
  tecnico: { id: "tecnico", piel: "#d9a074", pelo: "#20160e", gorra: "#f2f2f2", ropa: "#d9791c", pantalon: "#39465e", zapato: "#201810", estilo: "corto" },
  tecnica: { id: "tecnica", piel: "#a06a48", pelo: "#15100e", gorra: "#f2f2f2", ropa: "#2f6fd0", pantalon: "#39465e", zapato: "#201810", estilo: "largo" },
  ti: { id: "ti", piel: "#f2c79a", pelo: "#a0522d", ropa: "#4a7f6a", pantalon: "#2f3a4a", zapato: "#2a2018", estilo: "moño" },
};

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

export function sprPersona(look, mirando, cuadro, pose) {
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

// ---------------------------------------------------------------- caminantes

// Una persona que camina de un lado a otro de su piso, se detiene y a veces mira hacia el fondo
export class Caminante {
  constructor(look, x, piso, desde, hasta, opciones = {}) {
    this.look = look;
    this.x = x;
    this.piso = piso;
    this.desde = desde;
    this.hasta = hasta;
    this.destino = x;
    this.espera = Math.random() * 3;
    this.vel = opciones.vel || 18 + Math.random() * 10;
    this.pose = opciones.pose || "pie";
    this.fijo = Boolean(opciones.fijo);
    this.mirando = opciones.mirando || "SO";
    this.fase = 0;
    this.emote = null;
    this.emoteT = 0;
    this.dicho = null;
    this.dichoT = 0;
  }

  mostrar(emote, segundos = 1.6) { this.emote = emote; this.emoteT = segundos; }
  decir(texto, segundos = 4) { this.dicho = texto; this.dichoT = segundos; }

  irA(x) {
    this.destino = Math.max(this.desde, Math.min(this.hasta, x));
    this.espera = 0;
  }

  actualizar(dt, apurado = false) {
    if (this.emoteT > 0 && (this.emoteT -= dt) <= 0) this.emote = null;
    if (this.dichoT > 0 && (this.dichoT -= dt) <= 0) this.dicho = null;
    if (this.fijo) return;
    const d = this.destino - this.x;
    if (Math.abs(d) < 1) {
      this.fase = 0;
      this.espera -= dt;
      if (this.espera <= 0) {
        this.destino = this.desde + Math.random() * (this.hasta - this.desde);
        this.espera = apurado ? 0.4 + Math.random() : 1.5 + Math.random() * 4;
        if (Math.random() < 0.3) this.mirando = "NE";
      }
      return;
    }
    const v = this.vel * (apurado ? 1.9 : 1);
    this.x += Math.sign(d) * Math.min(Math.abs(d), v * dt);
    this.mirando = d > 0 ? "SE" : "SO";
    this.fase += dt * v * 0.22;
  }

  pintar(c) {
    const cuadro = this.fijo || Math.abs(this.destino - this.x) < 1 ? 0 : [1, 0, 3, 0][Math.floor(this.fase) % 4];
    const s = sprPersona(this.look, this.mirando, cuadro, this.pose);
    const x = Math.round(this.x);
    const y = Math.round(this.piso);
    if (this.pose === "pie") {
      c.fillStyle = "rgba(10,10,20,0.35)";
      c.fillRect(x - 6, y - 1, 12, 2);
    }
    c.drawImage(s.img, x - 8 + s.x, y - 24 + s.y + (cuadro === 0 ? 0 : -1));
    if (this.emote) c.drawImage(sprEmote(this.emote), x - 7, y - 39 - (this.emoteT > 1.3 ? 1 : 0));
  }
}

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
