// La recepción: fondo, piso, paredes y muebles. Lo fijo se pinta una sola vez; lo que cambia con los actos, en cada cuadro.
import { pixelesTexto } from "./fuente.js";
import {
  ANCHO, BAYER, P, aclarar, azar, caja, enPlanoX, enPlanoY, lienzo, planoX, planoY, rombo, sprite, tonos,
} from "./pixel.js";

export const COLS = 17;
export const FILAS = 13;
const ALTO_PARED = 72;

export const COLOR = {
  madera: "#6b3a22", maderaOscura: "#4a2616", maderaClara: "#8c5230",
  oro: "#d9a441", oroOscuro: "#9c6f22",
  vino: "#7a2230", vinoClaro: "#8d2c3a", vinoOscuro: "#611a27",
  marmol1: "#e3c9a0", marmol2: "#d3b083", junta: "#b8946a", veta: "#c9a57a",
  alfombra: "#a52a2a", alfombraOscura: "#8a2024",
  verde: "#3f9e4d", verdeOscuro: "#2a7038", verdeClaro: "#6cc266",
  acero: "#9aa7b4", aceroClaro: "#c4ced8", aceroOscuro: "#67727e",
};

// ---------------------------------------------------------------- texto y dibujo sobre planos

export function escribir(c, punto, cadena, u0, v0, color) {
  // v0 es la parte de arriba del texto, en píxeles sobre el piso
  c.fillStyle = color;
  for (const [x, y] of pixelesTexto(cadena)) {
    const [sx, sy] = punto(u0 + x, v0 - y);
    c.fillRect(sx, sy, 1, 1);
  }
}

// ---------------------------------------------------------------- cielo y ciudad

function pintarFondo() {
  const [l, c] = lienzo();
  const bandas = [[0, "#101636"], [0.32, "#1b2150"], [0.52, "#3a2c66"], [0.68, "#7a3b6b"], [0.8, "#c9604f"], [0.9, "#e89a55"]];
  const color = (t) => {
    let i = 0;
    while (i < bandas.length - 1 && bandas[i + 1][0] <= t) i++;
    return i;
  };
  const horizonte = 250;
  for (let y = 0; y < horizonte; y++) {
    const t = y / horizonte;
    const i = color(t);
    const siguiente = bandas[Math.min(i + 1, bandas.length - 1)];
    const f = (t - bandas[i][0]) / Math.max(0.001, siguiente[0] - bandas[i][0]);
    for (let x = 0; x < ANCHO; x++) {
      c.fillStyle = f * 16 > BAYER[y % 4][x % 4] ? siguiente[1] : bandas[i][1];
      c.fillRect(x, y, 1, 1);
    }
  }
  const r = azar(77);
  c.fillStyle = "#dfe6ff";
  for (let i = 0; i < 90; i++) c.fillRect(Math.floor(r() * ANCHO), Math.floor(r() * 130), 1, 1);
  // Dos planos de edificios
  for (const [base, color1, ventanas, alto] of [[250, "#2a2452", "#8d6a6a", 80], [270, "#141632", "#e8c56a", 110]]) {
    let x = 0;
    while (x < ANCHO) {
      const w = 18 + Math.floor(r() * 26);
      const h = 30 + Math.floor(r() * alto);
      c.fillStyle = color1;
      c.fillRect(x, base - h, w, h + 120);
      c.fillStyle = ventanas;
      for (let vy = base - h + 4; vy < base + 40; vy += 6) for (let vx = x + 3; vx < x + w - 2; vx += 5) {
        if (r() < 0.34) c.fillRect(vx, vy, 2, 3);
      }
      x += w + Math.floor(r() * 5);
    }
  }
  c.fillStyle = "#0b0d1f";
  c.fillRect(0, 300, ANCHO, 60);
  return l;
}

// ---------------------------------------------------------------- piso

// Rangos de alfombra roja [gx, gy, ancho, fondo]: la T que une entrada, mostrador y ascensores
const ALFOMBRAS = [[0, 7, 8, 2], [5, 3, 3, 10], [7, 3, 10, 2]];
const enAlfombra = (x, y) => ALFOMBRAS.some(([a, b, w, d]) => x >= a && x < a + w && y >= b && y < b + d);

function pintarPiso(c) {
  // Losa: da grosor al edificio
  planoY(c, FILAS, 0, COLS, -7, 0, "#3b2a2a");
  planoX(c, COLS, 0, FILAS, -7, 0, "#2c1f22");
  const r = azar(9);
  for (let y = 0; y < FILAS; y++) for (let x = 0; x < COLS; x++) {
    rombo(c, x, y, 1, 1, 0, (x + y) % 2 ? COLOR.marmol1 : COLOR.marmol2);
    // Vetas del mármol
    const centro = P(x + 0.5, y + 0.5);
    c.fillStyle = COLOR.veta;
    for (let i = 0; i < 4; i++) {
      const vx = centro.x + Math.floor((r() - 0.5) * 18);
      const vy = centro.y + Math.floor((r() - 0.5) * 8);
      c.fillRect(vx, vy, 2, 1);
    }
  }
  // Líneas de las juntas
  for (let g = 0; g <= COLS; g++) planoEnPiso(c, g, 0, g, FILAS, COLOR.junta);
  for (let g = 0; g <= FILAS; g++) planoEnPiso(c, 0, g, COLS, g, COLOR.junta);
  // Alfombra con ribete dorado: el ribete solo se pinta donde la alfombra termina
  for (let y = 0; y < FILAS; y++) for (let x = 0; x < COLS; x++) {
    if (!enAlfombra(x, y)) continue;
    rombo(c, x, y, 1, 1, 0, (x + y) % 2 ? COLOR.alfombra : COLOR.alfombraOscura);
  }
  for (let y = 0; y < FILAS; y++) for (let x = 0; x < COLS; x++) {
    if (!enAlfombra(x, y)) continue;
    if (!enAlfombra(x - 1, y) && x > 0) planoEnPiso(c, x + 0.06, y, x + 0.06, y + 1, COLOR.oro);
    if (!enAlfombra(x + 1, y) && x < COLS - 1) planoEnPiso(c, x + 0.94, y, x + 0.94, y + 1, COLOR.oro);
    if (!enAlfombra(x, y - 1)) planoEnPiso(c, x, y + 0.06, x + 1, y + 0.06, COLOR.oro);
    if (!enAlfombra(x, y + 1) && y < FILAS - 1) planoEnPiso(c, x, y + 0.94, x + 1, y + 0.94, COLOR.oro);
  }
  // Tapete de la sala izquierda
  tapete(c, 1, 9.6, 3.6, 3, "#3a4a7a", "#2c3861", COLOR.oro);
  // Tapete del piano
  tapete(c, 10, 8.8, 5.5, 3.8, "#37604f", "#2b4d40", "#c7b07a");
  // Tapete de entrada
  rombo(c, 0.1, 7.1, 1.1, 1.8, 0, "#3a3030");
}

function tapete(c, gx, gy, w, d, base, oscuro, borde) {
  rombo(c, gx, gy, w, d, 0, borde);
  rombo(c, gx + 0.12, gy + 0.12, w - 0.24, d - 0.24, 0, base);
  rombo(c, gx + 0.4, gy + 0.4, w - 0.8, d - 0.8, 0, oscuro);
  rombo(c, gx + 0.55, gy + 0.55, w - 1.1, d - 1.1, 0, base);
}

// Línea de 1 px sobre el piso entre dos puntos alineados con los ejes
function planoEnPiso(c, x0, y0, x1, y1, color) {
  const a = P(x0, y0);
  const b = P(x1, y1);
  c.fillStyle = color;
  const pasos = Math.abs(b.x - a.x);
  const sx = Math.sign(b.x - a.x);
  for (let i = 0; i < pasos; i++) c.fillRect(a.x + i * sx, a.y + Math.floor((i * (b.y - a.y)) / pasos), 1, 1);
}

// ---------------------------------------------------------------- paredes

function pintarParedBase(c, plano, g1, oscurecer) {
  const t = (hex) => aclarar(hex, oscurecer);
  plano(c, 0, g1, 0, 3, t(COLOR.maderaOscura));
  plano(c, 0, g1, 3, 22, t(COLOR.madera));
  plano(c, 0, g1, 22, 24, t(COLOR.oro));
  plano(c, 0, g1, 24, 66, t(COLOR.vino));
  plano(c, 0, g1, 66, 68, t(COLOR.oro));
  plano(c, 0, g1, 68, ALTO_PARED, t(COLOR.maderaOscura));
  // Rayas del tapiz y paneles del zócalo
  for (let g = 0; g < g1; g += 0.5) {
    plano(c, g, g + 1 / 16, 24, 66, t(COLOR.vinoClaro));
    plano(c, g + 0.25, g + 0.25 + 1 / 16, 24, 66, t(COLOR.vinoOscuro));
  }
  for (let g = 0; g < g1; g += 1) {
    plano(c, g + 0.1, g + 0.9, 6, 7, t(COLOR.maderaClara));
    plano(c, g + 0.1, g + 0.9, 18, 19, t(COLOR.maderaOscura));
    plano(c, g + 0.1, g + 0.17, 7, 18, t(COLOR.maderaClara));
    plano(c, g + 0.83, g + 0.9, 7, 18, t(COLOR.maderaOscura));
  }
}

export const VENTANAS = [[2.6, 4.4], [4.7, 6.5], [9.8, 12.4]];
export const PUERTA = { g0: 7, g1: 9 };
export const ELEVADORES = [11, 13, 15];
export const APLIQUES_DER = [0.2, 6.05, 10.15, 12.5, 14.5];
export const APLIQUES_IZQ = [2.3, 6.75, 9.45];

function pintarVentana(c, g0, g1, semilla) {
  const r = azar(semilla);
  const anchoPx = Math.round((g1 - g0) * 16);
  const punto = enPlanoX(0, g1);
  const altura = [];
  let u = 0;
  while (u < anchoPx) {
    const w = 4 + Math.floor(r() * 7);
    const h = 8 + Math.floor(r() * 18);
    for (let i = 0; i < w; i++) altura.push(h);
    u += w;
  }
  for (u = 0; u < anchoPx; u++) for (let v = 26; v < 62; v++) {
    const t = (62 - v) / 36;
    let col = t < 0.45 ? "#1b2150" : t < 0.7 ? "#3a2c66" : t < 0.87 ? "#7a3b6b" : "#c9604f";
    if ((t * 40 + BAYER[v % 4][u % 4] / 8) % 8 < 0.8 && t > 0.3) col = "#7a3b6b";
    const h = altura[u] + 26;
    if (v < h) col = (u % 3 === 1 && v % 3 === 0 && r() < 0.55) ? "#f0d27a" : "#14162f";
    else if (r() < 0.004) col = "#ffffff";
    const [sx, sy] = punto(u, v);
    c.fillStyle = col;
    c.fillRect(sx, sy, 1, 1);
  }
  // Marco y parteluz
  planoX(c, 0, g0 - 0.1, g1 + 0.1, 24, 26, COLOR.oro);
  planoX(c, 0, g0 - 0.1, g1 + 0.1, 62, 64, COLOR.oro);
  planoX(c, 0, g0 - 0.1, g0, 24, 64, COLOR.oroOscuro);
  planoX(c, 0, g1, g1 + 0.1, 24, 64, COLOR.oro);
  const medio = (g0 + g1) / 2;
  planoX(c, 0, medio - 0.04, medio + 0.04, 26, 62, COLOR.oroOscuro);
}

function pintarParedIzquierda(c) {
  pintarParedBase(c, (ctx, a, b, z0, z1, col) => planoX(ctx, 0, a, b, z0, z1, col), FILAS, -0.22);
  VENTANAS.forEach(([a, b], i) => pintarVentana(c, a, b, 40 + i));
  // Marco de la puerta de entrada
  planoX(c, 0, PUERTA.g0 - 0.15, PUERTA.g1 + 0.15, 0, 56, COLOR.oroOscuro);
  planoX(c, 0, PUERTA.g0, PUERTA.g1, 0, 52, "#0e1026");
  // Rejilla del aire
  planoX(c, 0, 0.5, 2.1, 56, 62, "#cfc8bd");
  for (let g = 0.55; g < 2.05; g += 0.18) planoX(c, 0, g, g + 0.06, 57, 61, "#6e685f");
  // Marco del termostato
  planoX(c, 0, 0.75, 1.95, 36, 48, "#2c2a30");
}

function pintarParedDerecha(c) {
  pintarParedBase(c, (ctx, a, b, z0, z1, col) => planoY(ctx, 0, a, b, z0, z1, col), COLS, 0);
  // Puerta de mantenimiento
  planoY(c, 0, 0.45, 1.65, 0, 46, COLOR.oroOscuro);
  planoY(c, 0, 0.53, 1.57, 0, 44, "#5a5f68");
  planoY(c, 0, 0.65, 1.45, 28, 38, "#454952");
  planoY(c, 0, 0.65, 1.45, 8, 22, "#454952");
  planoY(c, 0, 1.38, 1.46, 20, 25, COLOR.oro);
  // Tablero eléctrico
  planoY(c, 0, 1.9, 3.1, 20, 56, "#2d3138");
  planoY(c, 0, 1.96, 3.04, 22, 54, "#3b4048");
  // Placa del hotel, detrás del mostrador
  // Dos líneas centradas: la placa mide 96 px de ancho (6 columnas) y cada letra, 6 px
  planoY(c, 0, 3.1, 9.1, 47, 64, COLOR.maderaOscura);
  planoY(c, 0, 3.1, 9.1, 47, 48, COLOR.oro);
  planoY(c, 0, 3.1, 9.1, 63, 64, COLOR.oro);
  escribir(c, enPlanoY(0, 3.1), "HOTEL GRAN", 18, 62, "#f2c75c");
  escribir(c, enPlanoY(0, 3.1), "ZABBIX 8.0", 18, 54, "#f2c75c");
  // Casillero de llaves
  planoY(c, 0, 3.4, 5.6, 22, 46, COLOR.maderaOscura);
  for (let f = 0; f < 3; f++) for (let g = 0; g < 6; g++) {
    const gx = 3.5 + g * 0.34;
    const z = 26 + f * 7;
    planoY(c, 0, gx, gx + 0.27, z, z + 5, "#2f180e");
    if ((f * 7 + g * 3) % 4 !== 0) planoY(c, 0, gx + 0.09, gx + 0.17, z + 1, z + 4, COLOR.oro);
  }
  // Librero con carpetas
  planoY(c, 0, 6.5, 8.8, 22, 46, COLOR.maderaOscura);
  const r = azar(21);
  const lomos = ["#b5473c", "#3a6ea5", "#d9a441", "#4f8a55", "#7b4b94", "#e0d6c0"];
  for (const z of [25, 35]) {
    planoY(c, 0, 6.6, 8.7, z, z + 8, "#2f180e");
    for (let g = 6.62; g < 8.62; g += 0.08) {
      planoY(c, 0, g, g + 0.06, z, z + 5 + Math.floor(r() * 3), lomos[Math.floor(r() * lomos.length)]);
    }
  }
  // Letrero y reloj entre mostrador y ascensores
  planoY(c, 0, 9.55, 10.75, 28, 46, COLOR.maderaOscura);
  relojPared(c);
  // Marco de cada ascensor
  ELEVADORES.forEach((g) => {
    planoY(c, 0, g - 0.18, g + 1.18, 0, 48, COLOR.oroOscuro);
    planoY(c, 0, g - 0.1, g + 1.1, 0, 46, COLOR.aceroOscuro);
    planoY(c, 0, g + 0.15, g + 0.85, 50, 60, "#1b1820");
  });
  escribir(c, enPlanoY(0, 11.7), "ELEVADORES", 0, 66, "#f2c75c");
  // Apliques de pared
  for (const g of APLIQUES_DER) aplique(c, (a, b, z0, z1, col) => planoY(c, 0, a, b, z0, z1, col), g);
  for (const g of APLIQUES_IZQ) aplique(c, (a, b, z0, z1, col) => planoX(c, 0, a, b, z0, z1, col), g);
}

function aplique(c, plano, g) {
  plano(g - 0.12, g + 0.12, 42, 44, COLOR.oro);
  plano(g - 0.06, g + 0.06, 38, 42, COLOR.oroOscuro);
  plano(g - 0.16, g + 0.16, 44, 49, "#f3deaa");
}

function relojPared(c) {
  // Marca las 3 de la mañana: es la hora del guion
  const punto = enPlanoY(0, 9.75);
  const cx = 8, cy = 37;
  c.fillStyle = "#efe6d0";
  for (let u = -6; u <= 6; u++) for (let v = -6; v <= 6; v++) {
    if (u * u + v * v > 34) continue;
    const [x, y] = punto(cx + u, cy + v);
    c.fillRect(x, y, 1, 1);
  }
  c.fillStyle = "#222";
  for (let i = 0; i <= 3; i++) {
    let [x, y] = punto(cx, cy + i * 1.6);
    c.fillRect(x, y, 1, 1);
    [x, y] = punto(cx + i, cy);
    c.fillRect(x, y, 1, 1);
  }
}

// ---------------------------------------------------------------- muebles

function planta(gx, gy, semilla = 1, alto = 22) {
  return objeto(gx, gy, 1, 1, (c) => {
    caja(c, gx + 0.22, gy + 0.22, 0.56, 0.56, 0, 7, tonos("#a55a33"));
    rombo(c, gx + 0.3, gy + 0.3, 0.4, 0.4, 7, "#3b2415");
    const base = P(gx + 0.5, gy + 0.5, 8);
    const r = azar(semilla * 131);
    const verdes = [COLOR.verdeOscuro, COLOR.verde, COLOR.verdeClaro];
    for (let capa = 0; capa < 3; capa++) {
      c.fillStyle = verdes[capa];
      for (let i = 0; i < 16; i++) {
        const a = r() * Math.PI * 2;
        const d = r() * (10 - capa * 2.5);
        const x = base.x + Math.round(Math.cos(a) * d);
        const y = base.y - Math.round(alto * (0.45 + capa * 0.1)) + Math.round(Math.sin(a) * d * 0.9) - capa;
        c.fillRect(x - 2, y - 1, 4, 3);
      }
    }
    c.fillStyle = COLOR.verdeOscuro;
    c.fillRect(base.x, base.y - 8, 1, 8);
  });
}

function lampara(gx, gy) {
  return objeto(gx, gy, 1, 1, (c) => {
    caja(c, gx + 0.32, gy + 0.32, 0.36, 0.36, 0, 2, tonos(COLOR.oroOscuro));
    const b = P(gx + 0.5, gy + 0.5, 2);
    c.fillStyle = COLOR.oroOscuro;
    c.fillRect(b.x, b.y - 30, 1, 30);
    c.fillStyle = "#f3deaa";
    c.fillRect(b.x - 5, b.y - 40, 11, 10);
    c.fillStyle = "#ffeec2";
    c.fillRect(b.x - 3, b.y - 41, 7, 1);
    c.fillStyle = "#d2b67c";
    c.fillRect(b.x - 5, b.y - 31, 11, 1);
  });
}

function columna(gx, gy) {
  return objeto(gx, gy, 1, 1, (c) => {
    caja(c, gx + 0.05, gy + 0.05, 0.9, 0.9, 0, 4, tonos(COLOR.oroOscuro));
    caja(c, gx + 0.15, gy + 0.15, 0.7, 0.7, 4, 62, { t: "#ece4d6", l: "#e4dccd", r: "#b9b0a2" });
    const r = azar(gx * 13 + gy);
    for (let i = 0; i < 16; i++) {
      const lado = r() < 0.5;
      const f = 0.15 + r() * 0.7;
      const z = 8 + Math.floor(r() * 54);
      const p = lado ? P(gx + f, gy + 0.85, z) : P(gx + 0.85, gy + f, z);
      c.fillStyle = "#a8a092";
      c.fillRect(p.x, p.y, 2, 1);
    }
    caja(c, gx + 0.05, gy + 0.05, 0.9, 0.9, 66, 6, tonos(COLOR.oro));
  });
}

function sofa(gx, gy, w, color) {
  return objeto(gx, gy, w, 1, (c) => {
    const t = tonos(color);
    caja(c, gx, gy, w, 1, 0, 4, tonos("#3a2416"));
    caja(c, gx, gy + 0.28, w, 0.72, 4, 5, t);
    caja(c, gx, gy, w, 0.3, 4, 14, t);
    caja(c, gx, gy + 0.28, 0.22, 0.72, 4, 9, t);
    caja(c, gx + w - 0.22, gy + 0.28, 0.22, 0.72, 4, 9, t);
    for (let g = gx + 0.22 + (w - 0.44) / 2; g < gx + w - 0.3; g += (w - 0.44) / 2) {
      planoY(c, gy + 1, g, g + 0.05, 4, 9, aclarar(color, -0.28));
    }
  });
}

function sillon(gx, gy, color) {
  return objeto(gx, gy, 1, 1, (c) => {
    const t = tonos(color);
    caja(c, gx + 0.08, gy + 0.08, 0.84, 0.84, 0, 3, tonos("#3a2416"));
    caja(c, gx + 0.08, gy + 0.08, 0.28, 0.84, 3, 15, t);
    caja(c, gx + 0.08, gy + 0.08, 0.84, 0.22, 3, 15, t);
    caja(c, gx + 0.36, gy + 0.3, 0.56, 0.62, 3, 6, t);
  });
}

function mesita(gx, gy, w, d) {
  return objeto(gx, gy, w, d, (c) => {
    caja(c, gx + w / 2 - 0.1, gy + d / 2 - 0.1, 0.2, 0.2, 0, 8, tonos(COLOR.maderaOscura));
    caja(c, gx, gy, w, d, 8, 2, tonos(COLOR.maderaClara));
    // Revistas y una taza
    rombo(c, gx + 0.2, gy + 0.2, 0.45, 0.3, 10, "#cfe0ef");
    rombo(c, gx + 0.3, gy + 0.3, 0.3, 0.2, 10, "#d95d4f");
  });
}

function carroMaletas(gx, gy) {
  return objeto(gx, gy, 1, 2, (c) => {
    caja(c, gx + 0.05, gy + 0.1, 0.9, 1.8, 3, 2, tonos(COLOR.oro));
    caja(c, gx + 0.2, gy + 0.25, 0.6, 0.65, 5, 11, tonos("#a14832"));
    caja(c, gx + 0.2, gy + 1, 0.6, 0.6, 5, 7, tonos("#3f6ea0"));
    caja(c, gx + 0.26, gy + 0.32, 0.5, 0.5, 16, 5, tonos("#4a8050"));
    for (const [a, b] of [[0.1, 0.15], [0.9, 0.15], [0.1, 1.85], [0.9, 1.85]]) {
      const p = P(gx + a, gy + b, 5);
      c.fillStyle = COLOR.oro;
      c.fillRect(p.x, p.y - 30, 1, 30);
    }
    planoX(c, gx + 0.9, gy + 0.15, gy + 1.85, 34, 36, COLOR.oro);
    planoY(c, gy + 1.85, gx + 0.1, gx + 0.9, 34, 36, COLOR.oro);
    const p = P(gx + 0.5, gy + 1.9, 0);
    c.fillStyle = "#222";
    c.fillRect(p.x - 2, p.y - 2, 4, 2);
  });
}

function piano(gx, gy) {
  return objeto(gx, gy, 3, 3, (c) => {
    const negro = { t: "#26222e", l: "#1a1720", r: "#121016", b: "#4a4556" };
    for (const [a, b] of [[0.2, 0.3], [2.6, 0.3], [0.2, 1.6], [2.6, 1.6]]) caja(c, gx + a, gy + b, 0.2, 0.2, 0, 10, negro);
    caja(c, gx, gy, 3, 2, 10, 7, negro);
    // Teclado hacia el pianista
    caja(c, gx + 0.2, gy + 2, 2.6, 0.32, 10, 3, negro);
    rombo(c, gx + 0.25, gy + 2.02, 2.5, 0.26, 13, "#efe9dc");
    for (let g = gx + 0.3; g < gx + 2.7; g += 0.16) rombo(c, g, gy + 2.02, 0.05, 0.14, 13, "#17141c");
    // Tapa levantada
    const a = P(gx + 0.4, gy + 0.2, 17);
    const b = P(gx + 2.8, gy + 0.2, 30);
    const d = P(gx + 0.4, gy + 1.8, 17);
    c.fillStyle = "#2d2935";
    for (let x = d.x; x < b.x; x++) {
      const t = (x - d.x) / (b.x - d.x);
      const arriba = Math.min(a.y, d.y) + (b.y - Math.min(a.y, d.y)) * t - 10 * (1 - Math.abs(t - 0.5) * 2);
      const abajo = d.y + (b.y - d.y) * t;
      c.fillRect(x, Math.round(arriba), 1, Math.max(1, Math.round(abajo - arriba)));
    }
    c.fillStyle = COLOR.oro;
    const v = P(gx + 1.5, gy + 1, 17);
    c.fillRect(v.x, v.y - 8, 1, 8);
    caja(c, gx + 0.9, gy + 2.6, 1.2, 0.34, 0, 7, tonos(COLOR.maderaOscura));
  });
}

function mesaTrabajo(gx, gy) {
  return objeto(gx, gy, 2, 1, (c) => {
    for (const [a, b] of [[0.08, 0.1], [1.8, 0.1], [0.08, 0.8], [1.8, 0.8]]) caja(c, gx + a, gy + b, 0.12, 0.12, 0, 11, tonos(COLOR.maderaOscura));
    caja(c, gx, gy, 2, 1, 11, 2, tonos("#a06a3a"));
    // Laptop, de espaldas al público
    caja(c, gx + 0.65, gy + 0.3, 0.7, 0.42, 13, 1, tonos("#5a6068"));
    planoY(c, gy + 0.3, gx + 0.65, gx + 1.35, 14, 22, "#3e434a");
    // Carpeta y vaso
    rombo(c, gx + 1.45, gy + 0.3, 0.35, 0.45, 13, "#e8e2d0");
    caja(c, gx + 0.25, gy + 0.3, 0.2, 0.2, 13, 4, tonos("#c8d8e8"));
  });
}

function banca(gx, gy, w, d) {
  return objeto(gx, gy, w, d, (c) => {
    const ancho = w >= d;
    caja(c, gx + 0.1, gy + 0.1, ancho ? 0.15 : w - 0.2, ancho ? d - 0.2 : 0.15, 0, 7, tonos(COLOR.maderaOscura));
    caja(c, gx + (ancho ? w - 0.25 : 0.1), gy + (ancho ? 0.1 : d - 0.25), ancho ? 0.15 : w - 0.2, ancho ? d - 0.2 : 0.15, 0, 7, tonos(COLOR.maderaOscura));
    caja(c, gx, gy, w, d, 7, 3, tonos("#8d2c3a"));
  });
}

function mostrador() {
  const [gx, gy, w, d] = [3, 2, 7, 1];
  return objeto(gx, gy, w, d, (c) => {
    // Costado y frente de madera, con paneles
    caja(c, gx, gy, w, d, 0, 18, { t: "#5a3220", l: COLOR.madera, r: COLOR.maderaOscura, b: COLOR.maderaClara });
    planoY(c, gy + d, gx, gx + w, 0, 2, COLOR.maderaOscura);
    planoY(c, gy + d, gx, gx + w, 16, 18, COLOR.oro);
    // Cubierta
    caja(c, gx - 0.08, gy - 0.08, w + 0.16, d + 0.16, 18, 2, { t: "#3a2a22", l: "#2a1c16", r: "#20140f", b: COLOR.oro });
    // Libro de registro y timbre
    rombo(c, gx + 5.2, gy + 0.3, 0.55, 0.4, 20, "#efe6cf");
    rombo(c, gx + 5.47, gy + 0.3, 0.03, 0.4, 20, "#7a6a50");
    caja(c, gx + 2.2, gy + 0.35, 0.22, 0.22, 20, 3, tonos(COLOR.oro));
    // Papeleo en el otro extremo
    rombo(c, gx + 0.25, gy + 0.25, 0.5, 0.42, 20, "#d8d2c0");
  });
}

// Objeto con huella en el piso: sirve para ordenar la profundidad y bloquear las casillas que pisa
function objeto(gx, gy, w, d, pintar, opciones = {}) {
  return { x1: gx, y1: gy, x2: gx + w, y2: gy + d, spr: sprite(pintar), ...opciones };
}

function ordenarPorProfundidad(lista) {
  // a va antes que b si a queda detrás de b en el eje de alguna de sus huellas
  const detras = (a, b) => a.x2 <= b.x1 || a.y2 <= b.y1;
  const pendientes = lista.slice();
  const salida = [];
  while (pendientes.length) {
    let i = pendientes.findIndex((o) => pendientes.every((p) => p === o || !(detras(p, o) && !detras(o, p))));
    if (i < 0) i = 0;
    salida.push(pendientes.splice(i, 1)[0]);
  }
  return salida;
}

// ---------------------------------------------------------------- construcción

export function construirEscena() {
  const fondo = pintarFondo();
  const [plancha, c] = lienzo();
  c.drawImage(fondo, 0, 0);
  // Cantos superiores de las paredes y extremos
  rombo(c, -0.25, -0.25, COLS + 0.25, 0.25, ALTO_PARED, "#8a5a3a");
  rombo(c, -0.25, 0, 0.25, FILAS, ALTO_PARED, "#7a4d32");
  planoY(c, FILAS, -0.25, 0, -7, ALTO_PARED, "#3a2018");
  planoX(c, COLS, -0.25, 0, -7, ALTO_PARED, "#2c1812");
  pintarPiso(c);
  pintarParedIzquierda(c);
  pintarParedDerecha(c);

  const elMostrador = mostrador();
  elMostrador.esMostrador = true;
  const objetos = [
    elMostrador,
    planta(2, 2, 12, 28), columna(10, 2),
    planta(0, 1, 3), planta(10, 0, 4, 26), planta(16, 1, 5, 26), planta(0, 6, 6, 20), planta(0, 9, 7, 20), planta(16, 7, 8),
    planta(16, 12, 9, 18), planta(9, 12, 10, 18),
    lampara(5, 12), lampara(9, 9),
    sofa(1.2, 9.7, 3, "#3f5b96"), mesita(1.7, 11, 1.8, 0.8), sillon(3.8, 11, "#3f5b96"),
    piano(11, 8.9),
    mesaTrabajo(13, 5.6), banquito(13.7, 6.8), banca(15.2, 3.4, 1.4, 0.6),
    carroMaletas(1, 4.3),
  ];
  const ordenados = ordenarPorProfundidad(objetos);

  // Casillas que no se pueden pisar
  const bloqueo = Array.from({ length: FILAS }, () => Array(COLS).fill(false));
  for (const o of objetos) {
    if (o.sinBloqueo) continue;
    for (let y = Math.floor(o.y1 + 0.01); y < Math.ceil(o.y2 - 0.01) && y < FILAS; y++) {
      for (let x = Math.floor(o.x1 + 0.01); x < Math.ceil(o.x2 - 0.01) && x < COLS; x++) bloqueo[y][x] = true;
    }
  }
  // Zona de empleados, detrás del mostrador, y la pared de fondo salvo la puerta de mantenimiento y los ascensores
  for (let x = 3; x < 10; x++) for (let y = 0; y < 2; y++) bloqueo[y][x] = true;
  for (let x = 0; x < COLS; x++) if (![1, ...ELEVADORES].includes(x)) bloqueo[0][x] = true;
  for (let y = 0; y < FILAS; y++) if (y !== 7 && y !== 8) bloqueo[y][0] = true;

  return { fondo, plancha, objetos: ordenados, bloqueo, mostrador: elMostrador };
}

function banquito(gx, gy) {
  return objeto(gx, gy, 0.6, 0.3, (c) => {
    caja(c, gx, gy, 0.6, 0.3, 0, 6, tonos("#3a3f4a"));
  });
}

// Silueta de la recepción, para que las luces no alcancen el cielo
export function mascaraEdificio() {
  const [l, c] = lienzo();
  planoY(c, FILAS, -0.25, 0, -7, ALTO_PARED + 3, "#fff");
  planoX(c, COLS, -0.25, 0, -7, ALTO_PARED + 3, "#fff");
  rombo(c, -0.25, -0.25, COLS + 0.25, 0.25, ALTO_PARED, "#fff");
  rombo(c, -0.25, 0, 0.25, FILAS, ALTO_PARED, "#fff");
  planoY(c, FILAS, 0, COLS, -7, 0, "#fff");
  planoX(c, COLS, 0, FILAS, -7, 0, "#fff");
  rombo(c, 0, 0, COLS, FILAS, 0, "#fff");
  planoY(c, 0, 0, COLS, 0, ALTO_PARED, "#fff");
  planoX(c, 0, 0, FILAS, 0, ALTO_PARED, "#fff");
  return l;
}

// Partes que tienen luz propia (cielo por las ventanas): no las oscurece un corte
export function pintarVentanasEnBlanco(c) {
  for (const [a, b] of VENTANAS) planoX(c, 0, a, b, 26, 62, "#fff");
}

