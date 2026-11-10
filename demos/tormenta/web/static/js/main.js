// Escena de la demo: la central y su satélite en corte lateral, por pisos.
//   cielo           satélite en órbita, auroras durante la tormenta, antena de la estación terrena
//   piso superior   turbina, generador y transformador principal
//   piso intermedio sala de control, diodo de datos y centro de datos con la pantalla de Zabbix
//   piso inferior   reactor con sus barras de control y piscina de combustible gastado
// Los datos vienen de /api/estado: la simulación y los problemas reales de Zabbix, con la causa que marcó CEP.
import { anchoTexto, partir, texto, textoCentrado } from "./fuente.js";
import { ALTO, ANCHO, BAYER, azar, lienzo, spriteLuz } from "./pixel.js";
import { Dialogo, dinero } from "./dialogo.js";
import { activarAudio, alternarSilencio, silencio, sonido } from "./audio.js";
import { Caminante, LOOKS } from "./gente.js";

const pantalla = document.getElementById("pantalla");
const salida = pantalla.getContext("2d");
const [buffer, c] = lienzo();
const dialogo = new Dialogo();

const PISO1 = { techo: 110, suelo: 188 };
const PISO2 = { techo: 190, suelo: 268 };
const PISO3 = { techo: 270, suelo: 346 };
const X0 = 20;
const X1 = 620;

const VERDE = "#46d160";
const AMBAR = "#f0b429";
const ROJO = "#f25555";
const SUAVE = "#aab1cf";
const BLANCO = "#f4f1e6";

const r = (k, color, x, y, w, h) => { k.fillStyle = color; k.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)); };

// ---------------------------------------------------------------- estado

let e = null;
let reloj = 0;
let previoEstado = null;
let fallasSondeo = 0;

async function sondear() {
  try {
    const respuesta = await fetch("/api/estado", { cache: "no-store" });
    if (!respuesta.ok) throw new Error(String(respuesta.status));
    const nuevo = await respuesta.json();
    alCambiar(previoEstado, nuevo);
    previoEstado = nuevo;
    e = nuevo;
    fallasSondeo = 0;
  } catch {
    fallasSondeo++;
  }
  setTimeout(sondear, 1000);
}

function alCambiar(a, n) {
  if (!a) return;
  const tenia = a.activos.includes("tormenta");
  const tiene = n.activos.includes("tormenta");
  if (!tenia && tiene) {
    sonido.alerta();
    jefe.decir("¡Alerta de clima espacial! Kp 8.", 4);
  }
  if (tenia && !tiene) sonido.vuelveLuz();
  if (!a.activos.includes("bomba") && n.activos.includes("bomba")) {
    sonido.error();
    tecnica.decir("¡Se disparó la bomba B de la piscina!", 4);
    tecnica.irA(585);
  }
  if (a.satelite.estrellas && !n.satelite.estrellas) satOperador.decir("El satélite perdió el sensor de estrellas.", 4);
  if (a.planta.potencia >= 95 && n.planta.potencia < 95) {
    sonido.arranque();
    jefe.decir("Por procedimiento: insertamos barras y bajamos potencia.", 5);
  }
  if (a.estacion.snr >= 6 && n.estacion.snr < 6) sonido.error();
  if (a.planta.gic <= 30 && n.planta.gic > 30) operadora.decir("Corriente inducida en el transformador.", 4);
}

// ---------------------------------------------------------------- personas

const jefe = new Caminante(LOOKS.jefe, 150, PISO2.suelo, 60, 300);
const operador = new Caminante(LOOKS.operador, 88, PISO2.suelo - 2, 0, 0, { fijo: true, pose: "sentado", mirando: "NE" });
const operadora = new Caminante(LOOKS.operadora, 184, PISO2.suelo - 2, 0, 0, { fijo: true, pose: "sentado", mirando: "NE" });
const satOperador = new Caminante(LOOKS.ti, 420, PISO2.suelo, 392, 444);
const tecnico = new Caminante(LOOKS.tecnico, 420, PISO1.suelo, 120, 560);
const tecnica = new Caminante(LOOKS.tecnica, 420, PISO3.suelo, 290, 590);
const personas = [jefe, operador, operadora, satOperador, tecnico, tecnica];

// ---------------------------------------------------------------- fondo fijo

function pintarFondo() {
  const [l, k] = lienzo();
  const bandas = ["#05081a", "#0a1230", "#111c46", "#1a285c"];
  for (let y = 0; y < 112; y++) {
    const t = (y / 112) * (bandas.length - 1);
    const i = Math.floor(t);
    const f = t - i;
    for (let x = 0; x < ANCHO; x++) {
      k.fillStyle = f * 16 > BAYER[y % 4][x % 4] ? bandas[Math.min(i + 1, bandas.length - 1)] : bandas[i];
      k.fillRect(x, y, 1, 1);
    }
  }
  const azr = azar(17);
  // Ciudad lejana y mar del golfo
  let x = 230;
  while (x < 640) {
    const w = 10 + Math.floor(azr() * 18);
    const h = 6 + Math.floor(azr() * 16);
    r(k, "#0a0f24", x, 106 - h, w, h + 4);
    for (let wy = 106 - h + 3; wy < 104; wy += 4) for (let wx = x + 2; wx < x + w - 1; wx += 3) if (azr() < 0.3) r(k, "#e8c56a", wx, wy, 1, 1);
    x += w + Math.floor(azr() * 6);
  }
  r(k, "#0d2246", 0, 100, 200, 8);
  for (let i = 0; i < 40; i++) r(k, "#2a4a80", Math.floor(azr() * 200), 101 + Math.floor(azr() * 6), 3, 1);

  // Cascarón del edificio
  r(k, "#20242e", X0 - 6, 106, X1 - X0 + 12, 250);
  r(k, "#383d4a", X0, PISO1.techo, X1 - X0, PISO1.suelo - PISO1.techo);
  r(k, "#2c3a4e", X0, PISO2.techo, 316, PISO2.suelo - PISO2.techo);
  r(k, "#222838", X0 + 316, PISO2.techo, X1 - X0 - 316, PISO2.suelo - PISO2.techo);
  r(k, "#2a3240", X0, PISO3.techo, 260, PISO3.suelo - PISO3.techo);
  r(k, "#25303f", X0 + 260, PISO3.techo, X1 - X0 - 260, PISO3.suelo - PISO3.techo);
  // Paneles de pared
  for (const [p, color] of [[PISO1, "#333846"], [PISO2, "#28354a"], [PISO3, "#262e3b"]]) {
    for (let px = X0 + 8; px < X1; px += 40) r(k, color, px, p.techo + 14, 1, p.suelo - p.techo - 18);
    r(k, "#4a4f5c", X0, p.suelo, X1 - X0, 2);
    r(k, "#15181f", X0, p.suelo - 2, X1 - X0, 2);
  }
  // Losas
  for (const y of [106, 188, 268, 346]) {
    r(k, "#4b505e", X0 - 6, y, X1 - X0 + 12, y === 106 ? 4 : 2);
    r(k, "#6a7080", X0 - 6, y, X1 - X0 + 12, 1);
  }
  r(k, "#4b505e", X0 - 6, 346, X1 - X0 + 12, 14);
  r(k, "#2a1f18", 0, 300, X0 - 6, 60);
  r(k, "#2a1f18", X1 + 6, 300, 20, 60);

  // Rótulos de cada sector
  texto(k, "SALA DE TURBINAS", 92, PISO1.techo + 4, "#8fa0c0");
  texto(k, "SALA DE CONTROL", 92, PISO2.techo + 4, "#8fa0c0");
  texto(k, "CENTRO DE DATOS", 336, PISO2.techo + 4, "#8fa0c0");
  texto(k, "EDIFICIO DEL REACTOR", 92, PISO3.techo + 4, "#8fa0c0");
  texto(k, "PISCINA DE COMBUSTIBLE GASTADO", 300, PISO3.techo + 4, "#8fa0c0");

  // Tubería de vapor: del reactor a la turbina, y el agua de alimentación de vuelta
  r(k, "#8d96a8", 62, 156, 8, 132);
  r(k, "#b6bfcf", 62, 156, 2, 132);
  r(k, "#8d96a8", 62, 156, 82, 8);
  r(k, "#b6bfcf", 62, 156, 82, 2);
  r(k, "#8d96a8", 62, 284, 64, 8);
  r(k, "#3d6fa8", 78, 176, 4, 148);
  r(k, "#3d6fa8", 78, 176, 64, 4);
  r(k, "#3d6fa8", 78, 320, 44, 4);

  // Turbina
  r(k, "#5a6474", 140, 178, 182, 6);
  for (let i = 0; i < 4; i++) r(k, "#4a5262", 150 + i * 46, 180, 8, 8);
  r(k, "#6f7a8c", 144, 146, 176, 32);
  r(k, "#8a95a8", 144, 146, 176, 3);
  r(k, "#4f5869", 144, 175, 176, 3);
  r(k, "#6f7a8c", 140, 150, 4, 24);
  r(k, "#6f7a8c", 320, 150, 4, 24);
  r(k, "#20242c", 152, 152, 160, 20);
  // Generador
  r(k, "#3b6fb0", 326, 144, 72, 38);
  r(k, "#5a8fd0", 326, 144, 72, 3);
  for (let fx = 330; fx < 396; fx += 6) r(k, "#2c5590", fx, 166, 2, 14);
  r(k, "#0b1020", 336, 150, 52, 11);
  texto(k, "GENERADOR", 334, 136, "#8fa0c0");
  texto(k, "TURBINA", 210, 136, "#8fa0c0");
  // Transformador principal y línea a la red
  r(k, "#3f4a38", 470, 146, 74, 40);
  for (let fx = 472; fx < 544; fx += 5) r(k, "#55634c", fx, 150, 2, 34);
  for (const bx of [482, 503, 524]) {
    r(k, "#d8dde6", bx, 132, 6, 14);
    for (let by = 134; by < 146; by += 3) r(k, "#a8b0bc", bx - 1, by, 8, 1);
  }
  texto(k, "TRANSFORMADOR", 466, 120, "#8fa0c0");
  r(k, "#20242c", 398, 160, 72, 3);
  // Cables desde el transformador hacia la torre exterior
  r(k, "#9aa2ae", 485, 128, 1, 4);
  r(k, "#9aa2ae", 485, 128, 135, 1);
  r(k, "#9aa2ae", 620, 52, 1, 77);
  // Torre de alta tensión sobre el techo, a la derecha
  for (let y = 52; y < 106; y++) {
    const ancho = Math.round(4 + (y - 52) * 0.22);
    r(k, "#7d8594", 600 - ancho, y, 1, 1);
    r(k, "#7d8594", 600 + ancho, y, 1, 1);
    if (y % 8 === 0) r(k, "#7d8594", 600 - ancho, y, ancho * 2, 1);
  }
  r(k, "#7d8594", 586, 56, 28, 2);
  r(k, "#7d8594", 590, 66, 20, 2);

  // Sala de control: tablero de alarmas y mesas
  r(k, "#12161f", 34, 198, 220, 36);
  r(k, "#3a4256", 34, 198, 220, 1);
  r(k, "#12161f", 260, 198, 70, 36);
  r(k, "#5a4a3a", 46, 252, 200, 3);
  r(k, "#3e3428", 46, 255, 200, 10);
  // Diodo de datos
  r(k, "#1a1f28", 338, 212, 50, 28);
  r(k, "#c9a441", 338, 212, 50, 2);
  textoCentrado(k, "DIODO", 363, 216, "#f2c75c");
  texto(k, "OT", 342, 242, "#8fa0c0");
  texto(k, "TI", 374, 242, "#8fa0c0");
  // Racks
  for (const rx of [396, 422]) {
    r(k, "#0d1018", rx, 202, 22, 64);
    r(k, "#2c3242", rx, 202, 22, 1);
    for (let sy = 206; sy < 262; sy += 6) r(k, "#1a1f2c", rx + 2, sy, 18, 4);
  }
  // Pantalla de Zabbix
  r(k, "#3b4270", 450, 196, 160, 68);
  r(k, "#06080f", 452, 198, 156, 64);
  r(k, "#d40000", 452, 198, 156, 10);
  texto(k, "ZABBIX · PROBLEMAS", 456, 200, "#ffffff");

  // Contención y vasija del reactor
  r(k, "#3b4252", 74, 282, 170, 64);
  r(k, "#4b5262", 74, 282, 170, 2);
  r(k, "#2a3140", 80, 288, 158, 58);
  r(k, "#9aa4b4", 116, 290, 84, 54);
  r(k, "#9aa4b4", 122, 286, 72, 4);
  r(k, "#9aa4b4", 132, 283, 52, 3);
  texto(k, "VASIJA", 206, 292, "#8fa0c0");
  // Piscina: muros
  r(k, "#5b6476", 300, 292, 250, 54);
  r(k, "#7a8496", 300, 292, 250, 2);
  // Bombas
  r(k, "#3a4050", 558, 318, 52, 28);
  texto(k, "A", 566, 306, "#8fa0c0");
  texto(k, "B", 592, 306, "#8fa0c0");
  texto(k, "BOMBAS", 560, 296, "#8fa0c0");

  // Pedestal de la antena en el techo
  r(k, "#5a606e", 470, 94, 10, 12);
  r(k, "#7a808e", 466, 102, 18, 4);
  texto(k, "ESTACIÓN TERRENA", 372, 98, "#8fa0c0");
  return l;
}

const fondo = pintarFondo();

// ---------------------------------------------------------------- cielo

const ESTRELLAS = (() => {
  const azr = azar(5);
  return Array.from({ length: 70 }, () => ({ x: Math.floor(azr() * ANCHO), y: 16 + Math.floor(azr() * 76), f: azr() * 6 }));
})();

function pintarCielo() {
  for (const s of ESTRELLAS) {
    const b = Math.sin(reloj * 1.5 + s.f) > 0.7;
    r(c, b ? "#ffffff" : "#8a94c0", s.x, s.y, 1, 1);
  }
  const kp = e ? e.clima.kp : 2.7;
  const intensidad = Math.max(0, Math.min(1, (kp - 4.5) / 3.5));
  if (intensidad <= 0) return;
  // Auroras: cortinas verdes con borde violeta, tramadas
  for (let x = 0; x < ANCHO; x++) {
    const base = 30 + Math.sin(x / 41 + reloj * 0.7) * 9 + Math.sin(x / 13 - reloj * 1.3) * 3;
    const alto = (14 + Math.sin(x / 23 + reloj) * 6) * intensidad;
    for (let y = 0; y < alto; y++) {
      const t = y / Math.max(1, alto);
      if ((1 - t) * 16 * intensidad < BAYER[(y + Math.floor(base)) % 4][x % 4]) continue;
      r(c, t < 0.15 ? "#b06ad6" : t < 0.5 ? "#59f0a0" : "#2fa070", x, base + y, 1, 1);
    }
  }
}

function posSatelite() {
  const f = e ? e.satelite.fase : (reloj / 90) % 1;
  return { x: 170 + f * 300, y: 70 - Math.sin(f * Math.PI) * 44, f };
}

function pintarSatelite() {
  const { x, y } = posSatelite();
  const sat = e ? e.satelite : { estrellas: true, seu: 0, eclipse: false };
  const gira = !sat.estrellas;
  const angulo = gira ? Math.floor(reloj * 3) % 4 : 0;
  const panel = sat.eclipse ? "#1e3a6a" : "#3d7fd8";
  const lineas = sat.eclipse ? "#16294a" : "#8fc0ff";
  const vertical = angulo % 2 === 1;
  // Se dibuja a escala 2: cada píxel del satélite ocupa 2x2 en la escena
  c.save();
  c.translate(Math.round(x), Math.round(y));
  c.scale(2, 2);
  if (vertical) {
    r(c, panel, -2, -15, 5, 11);
    r(c, panel, -2, 5, 5, 11);
    for (let i = 0; i < 3; i++) { r(c, lineas, -2, -13 + i * 4, 5, 1); r(c, lineas, -2, 7 + i * 4, 5, 1); }
  } else {
    r(c, panel, -17, -2, 12, 5);
    r(c, panel, 6, -2, 12, 5);
    for (let i = 0; i < 3; i++) { r(c, lineas, -15 + i * 4, -2, 1, 5); r(c, lineas, 8 + i * 4, -2, 1, 5); }
  }
  r(c, "#7a5a18", -4, -4, 9, 9);
  r(c, "#e3b341", -3, -3, 7, 7);
  r(c, "#fff0a8", -3, -3, 2, 1);
  r(c, "#d0d6e0", 0, 5, 1, 3);
  r(c, "#d0d6e0", -2, 8, 5, 1);
  c.restore();
  // Errores por radiación: chispas
  if (sat.seu > 5) {
    for (let i = 0; i < 5; i++) {
      if (Math.random() < 0.5) r(c, "#ff6060", x + Math.round((Math.random() - 0.5) * 60), y + Math.round((Math.random() - 0.5) * 34), 2, 2);
    }
  }
  textoCentrado(c, "ZABBIXSAT-1", x, y + 22, "#aab4d8");
}

const ANTENA = { x: 475, y: 92 };

function pintarAntenaYEnlace() {
  const s = posSatelite();
  const dx = s.x - ANTENA.x;
  const dy = s.y - ANTENA.y;
  const largo = Math.hypot(dx, dy);
  const ux = dx / largo;
  const uy = dy / largo;
  // Plato orientado al satélite
  const cx = ANTENA.x + ux * 4;
  const cy = ANTENA.y + uy * 4;
  for (let t = -13; t <= 13; t++) {
    const px = cx - uy * t - ux * (t * t) / 22;
    const py = cy + ux * t - uy * (t * t) / 22;
    r(c, "#e4e8ef", px, py, 2, 2);
  }
  for (let k = 4; k < 14; k++) r(c, "#9aa2ae", ANTENA.x + ux * k, ANTENA.y + uy * k, 1, 1);
  r(c, "#c0c6d0", ANTENA.x + ux * 14, ANTENA.y + uy * 14, 2, 2);
  // Enlace de bajada: puntos que bajan del satélite a la antena
  const snr = e ? e.estacion.snr : 13;
  const bueno = snr >= 6;
  for (let i = 0; i < 12; i++) {
    const t = ((reloj * 0.8 + i / 12) % 1);
    if (!bueno && Math.random() < 0.6) continue;
    const px = s.x + (ANTENA.x + ux * 14 - s.x) * t;
    const py = s.y + (ANTENA.y + uy * 14 - s.y) * t;
    r(c, bueno ? "#7ad0ff" : "#ff5a5a", px, py, 2, 1);
  }
}

// ---------------------------------------------------------------- piso superior

let giroTurbina = 0;
let pulsoRed = 0;

function pintarPisoSuperior(dt) {
  const p = e ? e.planta : { potencia: 100, mw: 680, gic: 1.5, temp_trafo: 61 };
  giroTurbina += dt * (p.potencia / 100) * 90;
  // Rotor: álabes que pasan
  for (let x = 152; x < 312; x++) {
    const fase = Math.floor((x + giroTurbina) / 5) % 2;
    const tam = 8 + Math.round(6 * Math.sin((x - 152) / 160 * Math.PI));
    r(c, fase ? "#9aa6b8" : "#55606f", x, 162 - tam / 2, 1, tam);
  }
  r(c, "#c0c8d4", 152, 161, 160, 2);
  // Vapor que sube por la tubería
  for (let i = 0; i < 10; i++) {
    const t = ((reloj * 0.35 * (p.potencia / 100) + i / 10) % 1);
    const yy = 286 - t * 126;
    if (yy > 160) r(c, "#eef4ff", 65, yy, 2, 3);
  }
  // Lectura del generador
  texto(c, `${Math.round(p.mw)} MW`, 340, 152, p.potencia < 95 ? AMBAR : VERDE);
  // Transformador: se calienta y chispea con la corriente inducida
  const calor = Math.max(0, Math.min(1, (p.temp_trafo - 61) / 23));
  if (calor > 0.05) {
    c.globalAlpha = 0.5 * calor;
    r(c, "#ff7a2a", 470, 146, 74, 40);
    c.globalAlpha = 1;
  }
  if (p.gic > 30) {
    for (let i = 0; i < 4; i++) {
      if (Math.random() < 0.5) continue;
      const bx = [482, 503, 524][Math.floor(Math.random() * 3)] + 3;
      let sx = bx;
      for (let sy = 130; sy > 118; sy -= 2) {
        sx += Math.round((Math.random() - 0.5) * 4);
        r(c, "#fff27a", sx, sy, 1, 2);
      }
    }
    r(c, "#120c0c", 474, 168, 66, 11);
    texto(c, `GIC ${Math.round(p.gic)} A`, 478, 170, "#ff8080");
  } else {
    texto(c, `${Math.round(p.temp_trafo)}°C`, 490, 170, "#c9d4b8");
  }
  // Energía que sale hacia la red
  pulsoRed += dt * (p.mw / 680) * 60;
  for (let i = 0; i < 6; i++) {
    const t = ((pulsoRed / 200 + i / 6) % 1);
    const recorrido = 135 + 77;
    const d = t * recorrido;
    if (d < 135) r(c, "#ffe066", 485 + d, 127, 2, 3);
    else r(c, "#ffe066", 619, 128 - (d - 135), 3, 2);
  }
}

// ---------------------------------------------------------------- piso intermedio

const NOMBRE_A_BALDOSA = new Map();
function baldosa(nombre) {
  if (!NOMBRE_A_BALDOSA.has(nombre)) {
    let h = 0;
    for (const ch of nombre) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    let i = h % 36;
    const usadas = new Set(NOMBRE_A_BALDOSA.values());
    while (usadas.has(i)) i = (i + 7) % 36;
    NOMBRE_A_BALDOSA.set(nombre, i);
  }
  return NOMBRE_A_BALDOSA.get(nombre);
}

function problemas() {
  return e ? e.problemas : [];
}

function pintarPisoIntermedio() {
  const lista = problemas();
  const encendidas = new Map();
  for (const p of lista) encendidas.set(baldosa(p.nombre), p);
  // Tablero de alarmas
  for (let i = 0; i < 36; i++) {
    const col = i % 12;
    const fila = Math.floor(i / 12);
    const x = 38 + col * 18;
    const y = 202 + fila * 10;
    const p = encendidas.get(i);
    let color = "#283040";
    if (p) {
      const rapido = Math.floor(reloj * (p.causa ? 6 : 3)) % 2 === 0;
      color = p.severidad >= 4 ? (rapido ? "#ff3b3b" : "#7a1a1a") : (rapido ? "#ffb02e" : "#6a4810");
    } else if ((i * 7) % 5 === 0) {
      color = "#1f5a32";
    }
    r(c, color, x, y, 16, 8);
  }
  // Mímico del reactor
  const pot = e ? e.planta.potencia : 100;
  texto(c, "REACTOR", 270, 202, "#8fa0c0");
  r(c, "#20283a", 268, 214, 54, 8);
  r(c, pot < 95 ? AMBAR : VERDE, 268, 214, Math.round(54 * pot / 100), 8);
  texto(c, `${Math.round(pot)}%`, 280, 224, pot < 95 ? AMBAR : VERDE);
  // Monitores de las mesas
  const alarma = lista.length > 0 && Math.floor(reloj * 2) % 2 === 0;
  for (const mx of [60, 108, 156, 204]) {
    r(c, "#0a0d14", mx, 238, 16, 12);
    r(c, alarma ? "#c0392b" : "#1f6a5a", mx + 1, 239, 14, 9);
    for (let i = 0; i < 3; i++) r(c, "#a8f0d0", mx + 2, 240 + i * 3, 4 + ((i * 5 + Math.floor(reloj * 2)) % 9), 1);
    r(c, "#0a0d14", mx + 7, 250, 2, 2);
  }
  // Diodo: los datos solo salen de la red de control
  for (let i = 0; i < 4; i++) {
    const t = ((reloj * 0.9 + i / 4) % 1);
    r(c, "#7ad0ff", 340 + t * 46, 228, 3, 2);
  }
  texto(c, "▶", 359, 226, "#f2c75c");
  // Leds de los racks
  for (const rx of [396, 422]) {
    for (let sy = 206; sy < 262; sy += 6) {
      const encendido = Math.sin(reloj * 7 + sy * 1.7 + rx) > 0;
      r(c, encendido ? "#46d160" : "#14301e", rx + 16, sy + 1, 2, 2);
      if (Math.sin(reloj * 3 + sy) > 0.8) r(c, "#f0b429", rx + 13, sy + 1, 2, 2);
    }
  }
  pintarPantallaZabbix(lista);
}

function recortarTexto(cadena, letras) {
  return cadena.length > letras ? cadena.slice(0, letras - 1) + "." : cadena;
}

function pintarPantallaZabbix(lista) {
  const x = 456;
  let y = 211;
  if (!lista.length) {
    texto(c, "Sin problemas abiertos", x, y + 16, VERDE);
    texto(c, e && !e.zabbix_ok ? (e.ensayo ? "(ensayo, sin Zabbix)" : "(sin conexión)") : "", x, y + 30, SUAVE);
    return;
  }
  // Causas primero, cada una con sus síntomas debajo; lo que no está correlacionado, aparte
  const causas = lista.filter((p) => p.causa);
  const sintomas = lista.filter((p) => p.sintoma && !p.causa);
  const sueltos = lista.filter((p) => !p.causa && !p.sintoma);
  const filas = [];
  for (const p of causas) filas.push(["● ", p.nombre, ROJO]);
  for (const p of sintomas) filas.push(["  · ", p.nombre, AMBAR]);
  for (const p of sueltos) filas.push(["● ", p.nombre, BLANCO]);
  for (const [marca, nombre, color] of filas.slice(0, 4)) {
    texto(c, recortarTexto(marca + nombre, 25), x, y, color);
    y += 9;
  }
  if (filas.length > 4) texto(c, `  +${filas.length - 4} más`, x, y - 1, SUAVE);
  const pie = causas.length ? `CEP: ${causas.length} causa · ${sintomas.length} síntomas` : `${lista.length} problemas`;
  texto(c, pie, x, 254, causas.length ? "#7ad0ff" : SUAVE);
}

// ---------------------------------------------------------------- piso inferior

const burbujas = Array.from({ length: 18 }, (_, i) => ({ x: 124 + (i * 37) % 68, f: i / 18 }));
let giroBombaA = 0;
let giroBombaB = 0;

function pintarPisoInferior(dt) {
  const p = e ? e.planta : { potencia: 100, barras: 12, piscina: 31, bomba_b: true };
  // Agua de la vasija y núcleo
  r(c, "#1d4f8a", 120, 294, 76, 48);
  r(c, "#2a6ab0", 120, 294, 76, 2);
  for (let fx = 128; fx < 190; fx += 8) r(c, "#5a6474", fx, 306, 4, 30);
  // Brillo del núcleo según la potencia
  c.globalCompositeOperation = "lighter";
  const luz = spriteLuz([40, 110, 200], 44);
  c.globalAlpha = 0.35 + 0.5 * (p.potencia / 100);
  c.drawImage(luz, 158 - luz.width / 2, 320 - luz.height / 2);
  c.globalAlpha = 1;
  c.globalCompositeOperation = "source-over";
  // Barras de control: entran desde abajo, como en un reactor de agua en ebullición
  const altura = Math.round(30 * p.barras / 100) + 2;
  for (let bx = 132; bx < 190; bx += 8) {
    r(c, "#2a1416", bx, 342 - altura, 2, altura);
    r(c, "#d04a3a", bx, 342 - altura, 2, 1);
  }
  r(c, "#646c7a", 120, 342, 76, 2);
  // Ebullición
  for (const b of burbujas) {
    const t = ((reloj * (0.2 + 0.5 * p.potencia / 100) + b.f) % 1);
    if (t * 100 > p.potencia + 10) continue;
    r(c, "#bfe2ff", b.x + Math.round(Math.sin(t * 9 + b.f * 20)), 336 - t * 40, 1, 1);
  }
  texto(c, `BARRAS ${Math.round(p.barras)}%`, 206, 312, p.barras > 20 ? AMBAR : "#8fa0c0");

  // Piscina: agua con brillo de Cherenkov sobre los racks de combustible
  const caliente = Math.max(0, Math.min(1, (p.piscina - 31) / 10));
  r(c, caliente > 0.5 ? "#1a4e7a" : "#13406e", 304, 298, 242, 46);
  for (let x = 304; x < 546; x++) {
    const ola = Math.round(Math.sin(x / 9 + reloj * 2) * 1);
    r(c, "#4a8ad0", x, 298 + ola, 1, 1);
  }
  for (let rx = 320; rx < 534; rx += 14) {
    r(c, "#0c2036", rx, 318, 10, 24);
    for (let i = 0; i < 3; i++) r(c, "#1f4a70", rx + 1 + i * 3, 320, 2, 20);
  }
  c.globalCompositeOperation = "lighter";
  const cherenkov = spriteLuz([30, 120, 255], 70);
  c.globalAlpha = 0.8 + Math.sin(reloj * 2) * 0.06;
  for (const gx of [360, 430, 500]) c.drawImage(cherenkov, gx - cherenkov.width / 2, 330 - cherenkov.height / 2);
  c.globalAlpha = 1;
  c.globalCompositeOperation = "source-over";
  // Vapor si se calienta
  if (caliente > 0.4) {
    for (let i = 0; i < 8; i++) {
      const t = ((reloj * 0.3 + i / 8) % 1);
      if (Math.random() < 0.3) continue;
      r(c, "#c8d8e8", 320 + i * 28 + Math.sin(reloj + i) * 3, 296 - t * 14, 2, 1);
    }
  }
  const color = p.piscina > 36 ? ROJO : p.piscina > 33 ? AMBAR : VERDE;
  texto(c, `${p.piscina.toFixed(1)}°C`, 470, 282, color);
  // Bombas de enfriamiento
  giroBombaA += dt * 8;
  if (p.bomba_b) giroBombaB += dt * 8;
  pintarBomba(570, 330, giroBombaA, true);
  pintarBomba(596, 330, giroBombaB, p.bomba_b);
}

function pintarBomba(x, y, giro, enMarcha) {
  r(c, "#1a1e28", x - 9, y - 9, 18, 18);
  r(c, enMarcha ? "#46d160" : (Math.floor(reloj * 3) % 2 ? ROJO : "#5a1010"), x - 9, y - 9, 18, 2);
  for (let i = 0; i < 4; i++) {
    const a = giro + i * Math.PI / 2;
    for (let k = 1; k < 7; k++) r(c, "#aab4c4", x + Math.cos(a) * k, y + Math.sin(a) * k, 1, 1);
  }
}

// ---------------------------------------------------------------- alarmas por piso

function pintarBalizas() {
  const lista = problemas();
  const pisos = new Set();
  for (const p of lista) {
    const n = p.nombre.toLowerCase();
    if (/transformador|generador|red|gic/.test(n)) pisos.add(1);
    if (/gps|diodo|apm|enlace|estación|zabbixsat|clima/.test(n)) pisos.add(2);
    if (/reactor|piscina|bomba/.test(n)) pisos.add(3);
  }
  const on = Math.floor(reloj * 2.5) % 2 === 0;
  for (const [n, piso] of [[1, PISO1], [2, PISO2], [3, PISO3]]) {
    const x = n === 3 ? 270 : n === 2 ? 330 : 420;
    r(c, "#30343e", x, piso.techo, 8, 3);
    if (pisos.has(n)) {
      r(c, on ? "#ff3030" : "#701010", x + 1, piso.techo + 3, 6, 3);
      if (on) {
        c.globalAlpha = 0.07;
        r(c, "#ff2020", X0, piso.techo, X1 - X0, piso.suelo - piso.techo);
        c.globalAlpha = 1;
      }
    } else {
      r(c, "#3a4a3a", x + 1, piso.techo + 3, 6, 3);
    }
  }
}

// ---------------------------------------------------------------- HUD

function panel(x, y, w, h, titulo) {
  c.fillStyle = "rgba(6,8,22,0.86)";
  c.fillRect(x, y, w, h);
  r(c, "#3b4270", x, y, w, 1);
  r(c, "#3b4270", x, y + h - 1, w, 1);
  r(c, "#3b4270", x, y, 1, h);
  r(c, "#3b4270", x + w - 1, y, 1, h);
  if (titulo) texto(c, titulo, x + 5, y + 4, "#f2c75c");
}

function pintarHUD() {
  // Barra superior con el titular del momento
  c.fillStyle = "rgba(6,8,22,0.94)";
  c.fillRect(0, 0, ANCHO, 13);
  r(c, "#d9a441", 0, 13, ANCHO, 1);
  texto(c, "CENTRAL ZABBIX · ZABBIXSAT-1", 5, 3, "#f2c75c");
  const b = titular();
  const color = b.grave ? (Math.floor(reloj * 2.5) % 2 ? ROJO : "#ffdddd") : b.color;
  textoCentrado(c, b.texto, ANCHO / 2 + 40, 3, color);
  const hora = new Date().toTimeString().slice(0, 8);
  texto(c, hora, ANCHO - anchoTexto(hora) - 5, 3, SUAVE);
  if (!e) return;

  // Estado de sistemas
  const p = e.planta;
  const s = e.satelite;
  const filas = [
    ["Kp", e.clima.kp.toFixed(1), e.clima.kp >= 7 ? ROJO : e.clima.kp >= 5 ? AMBAR : VERDE],
    ["SATÉLITE", !s.estrellas ? "SIN ENGANCHE" : s.seu > 5 ? `SEU ${Math.round(s.seu)}/MIN` : "OK", !s.estrellas ? ROJO : s.seu > 5 ? AMBAR : VERDE],
    ["ENLACE", `${e.estacion.snr.toFixed(1)} dB`, e.estacion.snr < 6 ? ROJO : VERDE],
    ["HORA GPS", `${p.gps_ms.toFixed(2)} ms`, p.gps_ms > 1 ? AMBAR : VERDE],
    ["GIC", `${Math.round(p.gic)} A`, p.gic > 30 ? ROJO : VERDE],
    ["REACTOR", `${Math.round(p.potencia)}%`, p.potencia < 95 ? AMBAR : VERDE],
    ["PISCINA", `${p.piscina.toFixed(1)}°C${p.bomba_b ? "" : " B OFF"}`, !p.bomba_b ? ROJO : VERDE],
    ["ZABBIX", e.zabbix_ok ? "CONECTADO" : e.ensayo ? "ENSAYO" : "SIN CONEXIÓN", e.zabbix_ok ? VERDE : AMBAR],
  ];
  panel(4, 17, 152, filas.length * 9 + 6);
  filas.forEach(([rot, val, col], i) => {
    const y = 21 + i * 9;
    texto(c, "●", 8, y, col);
    texto(c, rot, 16, y, SUAVE);
    texto(c, val, 70, y, col);
  });

  // Negocio
  panel(498, 17, 138, 44, "NEGOCIO");
  texto(c, `${Math.round(p.mw)} MW a la red`, 503, 28, p.potencia < 95 ? AMBAR : BLANCO);
  texto(c, `${dinero(p.ingresos_h)} MXN/h`, 503, 38, p.potencia < 95 ? AMBAR : BLANCO);
  texto(c, `${e.estacion.imagenes_h} imágenes/h`, 503, 48, e.estacion.snr < 6 ? ROJO : BLANCO);
}

function titular() {
  if (!e) return { texto: fallasSondeo > 2 ? "SIN CONEXIÓN CON EL SERVIDOR" : "CONECTANDO...", grave: fallasSondeo > 2 };
  const p = e.planta;
  if (e.activos.includes("tormenta")) {
    if (p.potencia < 95) return { texto: `TORMENTA G4: POTENCIA REDUCIDA AL ${Math.round(p.potencia)}% DE FORMA SEGURA`, grave: true };
    return { texto: `TORMENTA GEOMAGNÉTICA G4 · Kp ${e.clima.kp.toFixed(1)}`, grave: true };
  }
  if (!p.bomba_b) return { texto: `PISCINA: BOMBA B DETENIDA · ${p.piscina.toFixed(1)}°C`, grave: true };
  if (e.clima.kp >= 5) return { texto: "EL CLIMA ESPACIAL SE NORMALIZA", color: AMBAR };
  return { texto: `OPERACIÓN NORMAL · ${Math.round(p.mw)} MW A LA RED`, color: VERDE };
}

function pintarControles() {
  if (!e || !e.controles || dialogo.abierto) return;
  const ayuda = `${e.ensayo ? "ENSAYO" : "DEMO"}  1 tormenta solar   2 bomba de la piscina   0 reset   ·   clic en el satélite: pedir imagen`;
  c.fillStyle = "rgba(90,20,110,0.92)";
  c.fillRect(0, 350, ANCHO, 10);
  textoCentrado(c, ayuda, ANCHO / 2, 352, "#fff");
}

function globo(cadena, x, y) {
  const lineas = partir(cadena, 30);
  const ancho = Math.max(...lineas.map((l) => anchoTexto(l))) + 8;
  const alto = lineas.length * 10 + 5;
  const bx = Math.max(2, Math.min(ANCHO - ancho - 2, Math.round(x - ancho / 2)));
  const by = Math.max(16, y - alto - 3);
  r(c, "#171020", bx - 1, by, ancho + 2, alto);
  r(c, "#171020", bx, by - 1, ancho, alto + 2);
  r(c, "#fbf7ea", bx, by, ancho, alto);
  const px = Math.max(bx + 2, Math.min(bx + ancho - 6, x - 2));
  r(c, "#171020", px, by + alto + 1, 5, 1);
  r(c, "#fbf7ea", px + 1, by + alto, 3, 1);
  lineas.forEach((l, i) => texto(c, l, bx + 4, by + 3 + i * 10, "#171020"));
}

// ---------------------------------------------------------------- interacción

const ZONAS = [
  { nombre: "satelite", dentro: (x, y) => { const s = posSatelite(); return Math.hypot(x - s.x, y - s.y) < 34; } },
  { nombre: "reactor", dentro: (x, y) => x >= 74 && x < 244 && y >= 280 && y < 346 },
  { nombre: "piscina", dentro: (x, y) => x >= 300 && x < 612 && y >= 280 && y < 346 },
  { nombre: "turbina", dentro: (x, y) => x >= 140 && x < 400 && y >= 132 && y < 188 },
  { nombre: "transformador", dentro: (x, y) => x >= 462 && x < 548 && y >= 116 && y < 188 },
  { nombre: "zabbix", dentro: (x, y) => x >= 450 && x < 610 && y >= 196 && y < 264 },
  { nombre: "diodo", dentro: (x, y) => x >= 336 && x < 390 && y >= 210 && y < 250 },
  { nombre: "alarmas", dentro: (x, y) => x >= 34 && x < 330 && y >= 198 && y < 234 },
];

const zonaEn = (x, y) => ZONAS.find((z) => z.dentro(x, y));

function* guionImagen() {
  const S = "Estación terrena";
  sonido.mover();
  const promesa = fetch("/api/imagen", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ zona: "Golfo de México" }) })
    .then((x) => x.json()).catch(() => ({ ok: false, error: "La estación terrena no responde" }));
  const res = yield* dialogo.esperarPromesa(promesa, "Pidiendo una imagen a ZABBIXSAT-1", S);
  if (res.ok) {
    sonido.exito();
    satOperador.mostrar("♥", 2);
    yield* dialogo.decir(`¡Imagen ${res.imagen} entregada! ${res.zona}, ${res.megas} MB en ${res.ms} ms.`, S);
  } else {
    sonido.error();
    satOperador.mostrar("!", 2);
    yield* dialogo.decir(`No es posible bajar la imagen. ${res.error || res.detail || "Falló el pedido."}`, S);
  }
}

function* guionInfo(zona) {
  if (!e) return;
  const p = e.planta;
  const lista = problemas();
  const textos = {
    reactor: ["Reactor", `${Math.round(p.potencia)}% de potencia, barras insertadas al ${Math.round(p.barras)}%, presión ${p.presion} MPa.`],
    piscina: ["Piscina", `Agua a ${p.piscina.toFixed(1)} °C. Bomba A en marcha; bomba B ${p.bomba_b ? "en marcha" : "DETENIDA"}.`],
    turbina: ["Generador", `${Math.round(p.mw)} MW a la red, ${p.frecuencia} Hz. Ingresos: ${dinero(p.ingresos_h)} MXN por hora.`],
    transformador: ["Transformador", `Corriente inducida ${Math.round(p.gic)} A; aceite a ${Math.round(p.temp_trafo)} °C.`],
    diodo: ["Diodo de datos", "Los datos salen de la red de control y nada puede entrar. Zabbix observa; no controla la planta."],
    alarmas: ["Sala de control", lista.length ? `${lista.length} alarmas en el panel. Mira la pantalla de Zabbix: ahí están agrupadas.` : "Panel de alarmas en calma."],
    zabbix: ["Zabbix", resumenZabbix(lista)],
  };
  const [quien, dicho] = textos[zona];
  sonido.mover();
  yield* dialogo.decir(dicho, quien);
}

function resumenZabbix(lista) {
  if (!lista.length) return "No hay problemas abiertos de la demo.";
  const causas = lista.filter((p) => p.causa);
  const sintomas = lista.filter((p) => p.sintoma && !p.causa);
  if (!causas.length) return `${lista.length} problemas abiertos, sin correlación.`;
  const sueltos = lista.length - causas.length - sintomas.length;
  return `CEP agrupó ${sintomas.length} síntomas bajo la causa: ${causas[0].nombre}.${sueltos ? ` ${sueltos} aparte, sin relación.` : ""}`;
}

function aInterno(ev) {
  const b = pantalla.getBoundingClientRect();
  return { x: ((ev.clientX - b.left) / b.width) * ANCHO, y: ((ev.clientY - b.top) / b.height) * ALTO };
}

let raton = { x: -1, y: -1 };
const entrada = {};

pantalla.addEventListener("mousemove", (ev) => { raton = aInterno(ev); });
pantalla.addEventListener("click", (ev) => {
  activarAudio();
  pantalla.focus();
  if (dialogo.abierto) {
    entrada.a = true;
    return;
  }
  const { x, y } = aInterno(ev);
  const z = zonaEn(x, y);
  if (!z) return;
  dialogo.abrir(z.nombre === "satelite" ? guionImagen() : guionInfo(z.nombre));
});

function ordenar(ruta) {
  fetch(ruta, { method: "POST" }).catch(() => {});
}

window.addEventListener("keydown", (ev) => {
  activarAudio();
  const k = ev.key;
  if (k === " ") ev.preventDefault();
  if (ev.repeat) return;
  if (k === "Enter" || k === " " || k === "z") entrada.a = true;
  if (k === "Escape" || k === "x") entrada.b = true;
  if (k === "m") alternarSilencio();
  if (e && e.controles && !dialogo.abierto) {
    if (k === "1") ordenar("/api/escenario/tormenta");
    if (k === "2") ordenar("/api/escenario/bomba");
    if (k === "0") ordenar("/api/reset");
  }
});

// ---------------------------------------------------------------- cuadro

let previo = performance.now();

function cuadro(ahora) {
  const dt = Math.min(0.05, (ahora - previo) / 1000);
  previo = ahora;
  reloj += dt;

  dialogo.actualizar(dt, { ...entrada });
  for (const k of Object.keys(entrada)) entrada[k] = false;
  const hayAlarma = problemas().length > 0;
  for (const p of personas) p.actualizar(dt, hayAlarma);
  if (hayAlarma && Math.random() < dt * 0.3) jefe.mostrar("!", 1.2);

  c.drawImage(fondo, 0, 0);
  pintarCielo();
  pintarAntenaYEnlace();
  pintarSatelite();
  pintarPisoSuperior(dt);
  pintarPisoIntermedio();
  pintarPisoInferior(dt);
  pintarBalizas();
  for (const p of personas) p.pintar(c);
  for (const p of personas) if (p.dicho) globo(p.dicho, p.x, p.piso - 30);
  pintarHUD();

  const z = dialogo.abierto ? null : zonaEn(raton.x, raton.y);
  pantalla.style.cursor = z ? "pointer" : "default";
  if (!dialogo.abierto) {
    const s = posSatelite();
    const bote = Math.round(Math.sin(reloj * 4) * 2) + Math.max(0, 64 - s.y);
    const etiqueta = z && z.nombre === "satelite" ? "¡Clic: pedir imagen!" : "PEDIR IMAGEN";
    const w = anchoTexto(etiqueta) + 8;
    c.fillStyle = "rgba(6,8,22,0.9)";
    c.fillRect(s.x - w / 2, s.y - 48 + bote, w, 11);
    textoCentrado(c, etiqueta, s.x, s.y - 46 + bote, "#fff27a");
    texto(c, "▼", s.x - 2, s.y - 36 + bote, "#fff27a");
  }
  dialogo.pintar(c);
  pintarControles();
  if (silencio) texto(c, "SIN SONIDO", ANCHO - 66, 64, SUAVE);

  salida.imageSmoothingEnabled = false;
  salida.drawImage(buffer, 0, 0, pantalla.width, pantalla.height);
  requestAnimationFrame(cuadro);
}

// Se dibuja en un múltiplo entero y el navegador lo ajusta al tamaño final: los píxeles quedan todos iguales
function ajustar() {
  const dpr = window.devicePixelRatio || 1;
  const escala = Math.min(window.innerWidth / ANCHO, window.innerHeight / ALTO);
  const k = Math.max(1, Math.ceil(escala * dpr));
  pantalla.width = ANCHO * k;
  pantalla.height = ALTO * k;
  pantalla.style.width = `${Math.floor(ANCHO * escala)}px`;
  pantalla.style.height = `${Math.floor(ALTO * escala)}px`;
}
window.addEventListener("resize", ajustar);
ajustar();

window.tormenta = { get estado() { return e; } };
sondear();
pantalla.focus();
requestAnimationFrame(cuadro);

