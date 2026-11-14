// Escena de la demo: el Estadio Zabbix en corte lateral.
//   cielo           torres de reflectores, pantalla gigante y tableros de estado
//   estadio         tribuna con el público, cartelería LED perimetral y la cancha con el partido
//   anillo          acceso con molinetes, boletería y tienda oficial de Zabbix FC, con las TVs del estadio
//   subsuelo        sala eléctrica (acometida, tableros, UPS, generador) y centro de control con la pantalla de Zabbix
// Los datos vienen de /api/estado: la simulación y los problemas reales de Zabbix, con la causa que marcó CEP.
import { anchoTexto, partir, texto, textoCentrado } from "./fuente.js";
import { ALTO, ANCHO, BAYER, azar, lienzo } from "./pixel.js";
import { Dialogo, dinero } from "./dialogo.js";
import { activarAudio, alternarSilencio, silencio, sonido } from "./audio.js";
import { Caminante, LOOKS } from "./gente.js";

const pantalla = document.getElementById("pantalla");
const salida = pantalla.getContext("2d");
const [buffer, c] = lienzo();
const dialogo = new Dialogo();

const GRADA = { techo: 68, suelo: 134 };
const LED = { x: 60, y: 135, w: 520, h: 9 };
const CANCHA = { techo: 145, suelo: 186 };
const PISO2 = { techo: 190, suelo: 268 };
const PISO3 = { techo: 270, suelo: 346 };
const X0 = 20;
const X1 = 620;
const GIGANTE = { x: 256, y: 18, w: 128, h: 46 };
const TORRES = [30, 610];
const TVS = [178, 356, 584];
const MOLINETES = [148, 166, 184];
const TABLEROS = [["iluminacion", "ILU", 84], ["pantallas", "PAN", 114], ["comercial", "COM", 144], ["servicios", "SRV", 174]];
const LUX_NOMINAL = 1400;

const VERDE = "#46d160";
const AMBAR = "#f0b429";
const ROJO = "#f25555";
const SUAVE = "#aab1cf";
const BLANCO = "#f4f1e6";
const ROTULO = "#8fa0c0";
const CLUB = "#d40000";

const r = (k, color, x, y, w, h) => { k.fillStyle = color; k.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)); };
const miles = (n) => Math.round(n).toLocaleString("en-US");

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
  if (a.energia.red && !n.energia.red) {
    sonido.apagon();
    electricista.decir("¡Se cortó la red! La UPS sostiene lo crítico.", 5);
    electricista.irA(60);
  }
  if (!a.energia.red && n.energia.red) sonido.vuelveLuz();
  if (!a.energia.generador && n.energia.generador) {
    sonido.arranque();
    electricista.decir("Generador en marcha: luz de emergencia.", 4);
    electricista.irA(250);
  }
  if (a.luces.cancha >= 800 && n.luces.cancha < 800) operadora.decir("Cancha a oscuras: el partido se detiene.", 5);
  if (a.boleteria.bd && !n.boleteria.bd) {
    sonido.error();
    boletero.decir("¡Se cayó el sistema de entradas!", 4);
  }
  if (a.accesos.fila <= 10 && n.accesos.fila > 10) operadora.decir("La fila en las puertas pasó los 10 minutos.", 5);
  if (a.tableros.comercial.cerrado && !n.tableros.comercial.cerrado) {
    sonido.error();
    vendedora.decir("¡Nos quedamos sin luz y sin terminales!", 4);
    electricista.decir("Saltó el interruptor del tablero comercial.", 5);
    electricista.irA(160);
  }
  if (!a.tableros.comercial.cerrado && n.tableros.comercial.cerrado) sonido.vuelveLuz();
  if (n.partido.gol_t > a.partido.gol_t) {
    if (n.partido.gol_de === 0) sonido.exito();
    else sonido.campana();
    alGol(n.partido.gol_de);
  }
}

// ---------------------------------------------------------------- personas

const look = (id, piel, pelo, ropa, pantalon, estilo, extra = {}) => ({ id, piel, pelo, ropa, pantalon, zapato: "#14100e", estilo, ...extra });
const HINCHAS = [
  look("h1", "#e7b48a", "#201512", CLUB, "#27303c", "corto"),
  look("h2", "#c98f66", "#3b1f14", CLUB, "#1d2336", "largo"),
  look("h3", "#a06a48", "#15100e", "#f4f1e6", "#2d3a66", "corto", { gorra: CLUB }),
  look("h4", "#efc4a0", "#a0522d", CLUB, "#39465e", "moño"),
  look("h5", "#d9a074", "#20160e", "#8a0f0f", "#27303c", "corto", { gorra: "#f4f1e6" }),
  look("h6", "#f2c79a", "#6a6660", "#f4f1e6", "#1d2336", "largo"),
  look("h7", "#c98f66", "#201512", CLUB, "#2f3a4a", "calvo"),
];
const LOOK_BOLETERO = look("boletero", "#e7b48a", "#3b1f14", "#28304a", "#1d2336", "corto", { camisa: true, corbata: CLUB });
const LOOK_VENDEDORA = look("vendedora", "#c98f66", "#15100e", CLUB, "#27303c", "largo");

// Hincha en la fila: camina hasta su lugar y espera, sin pasear
class Hincha extends Caminante {
  actualizar(dt) {
    if (this.emoteT > 0 && (this.emoteT -= dt) <= 0) this.emote = null;
    const d = this.destino - this.x;
    if (Math.abs(d) < 1) {
      this.fase = 0;
      this.mirando = "SE";
      return;
    }
    this.x += Math.sign(d) * Math.min(Math.abs(d), this.vel * dt);
    this.mirando = d > 0 ? "SE" : "SO";
    this.fase += dt * this.vel * 0.22;
  }
}

const FRENTE_FILA = 138;
const cola = [];
const pasando = [];
let proximoPase = 0;
let siguienteLook = 0;
const luzMolinete = { color: null, t: 0 };

function actualizarCola(dt) {
  const a = e ? e.accesos : { por_min: 220, rechazo: 1.5, fila: 3 };
  const objetivo = Math.max(3, Math.min(10, Math.round(2 + a.fila * 0.3)));
  if (cola.length < objetivo && (!cola.length || cola[cola.length - 1].x > 36)) {
    const h = new Hincha(HINCHAS[siguienteLook++ % HINCHAS.length], 22, PISO2.suelo, 0, 0, { vel: 30 });
    cola.push(h);
  }
  cola.forEach((h, i) => { h.destino = FRENTE_FILA - i * 11; });
  proximoPase -= dt;
  luzMolinete.t -= dt;
  const frente = cola[0];
  if (frente && Math.abs(frente.x - FRENTE_FILA) < 1 && proximoPase <= 0) {
    proximoPase = Math.max(0.9, Math.min(9, 260 / Math.max(8, a.por_min)));
    if (Math.random() * 100 < a.rechazo) {
      frente.mostrar("!", 1.4);
      Object.assign(luzMolinete, { color: ROJO, t: 1.2 });
    } else {
      cola.shift();
      frente.destino = 217;
      frente.vel = 44;
      pasando.push(frente);
      Object.assign(luzMolinete, { color: VERDE, t: 0.6 });
    }
  }
  for (const h of cola) h.actualizar(dt);
  for (let i = pasando.length - 1; i >= 0; i--) {
    pasando[i].actualizar(dt);
    if (pasando[i].x >= 216) pasando.splice(i, 1);
  }
}

const boletero = new Caminante(LOOK_BOLETERO, 252, PISO2.suelo - 8, 0, 0, { fijo: true, mirando: "SO" });
const vendedora = new Caminante(LOOK_VENDEDORA, 600, PISO2.suelo - 6, 0, 0, { fijo: true, mirando: "SO" });
const clienteA = new Caminante(HINCHAS[1], 400, PISO2.suelo, 350, 528);
const clienteB = new Caminante(HINCHAS[4], 480, PISO2.suelo, 350, 528);
const electricista = new Caminante(LOOKS.tecnico, 120, PISO3.suelo, 30, 320);
const operadora = new Caminante(LOOKS.operadora, 414, PISO3.suelo - 2, 0, 0, { fijo: true, pose: "sentado", mirando: "NE" });
const soporte = new Caminante(LOOKS.ti, 370, PISO3.suelo, 338, 392);
const paseantes = [clienteA, clienteB, electricista, operadora, soporte];
const conVoz = [boletero, vendedora, ...paseantes];

// ---------------------------------------------------------------- fondo fijo

function camiseta(k, x, y, color, detalle) {
  r(k, color, x + 2, y, 8, 11);
  r(k, color, x, y + 1, 2, 4);
  r(k, color, x + 10, y + 1, 2, 4);
  r(k, detalle, x + 5, y, 2, 1);
  // La Z del escudo
  r(k, detalle, x + 4, y + 3, 4, 1);
  r(k, detalle, x + 6, y + 4, 1, 1);
  r(k, detalle, x + 5, y + 5, 1, 1);
  r(k, detalle, x + 4, y + 6, 4, 1);
}

function pintarFondo() {
  const [l, k] = lienzo();
  const bandas = ["#05081a", "#0a1230", "#111c46", "#1a285c"];
  for (let y = 0; y < 70; y++) {
    const t = (y / 70) * (bandas.length - 1);
    const i = Math.floor(t);
    const f = t - i;
    for (let x = 0; x < ANCHO; x++) {
      k.fillStyle = f * 16 > BAYER[y % 4][x % 4] ? bandas[Math.min(i + 1, bandas.length - 1)] : bandas[i];
      k.fillRect(x, y, 1, 1);
    }
  }
  const azr = azar(23);
  // Ciudad lejana detrás del estadio
  let x = 0;
  while (x < ANCHO) {
    const w = 10 + Math.floor(azr() * 18);
    const h = 6 + Math.floor(azr() * 18);
    r(k, "#0a0f24", x, 68 - h, w, h + 2);
    for (let wy = 68 - h + 3; wy < 66; wy += 4) for (let wx = x + 2; wx < x + w - 1; wx += 3) if (azr() < 0.3) r(k, "#e8c56a", wx, wy, 1, 1);
    x += w + Math.floor(azr() * 6);
  }

  // Cascarón del estadio
  r(k, "#20242e", X0 - 6, 66, X1 - X0 + 12, 290);
  r(k, "#343a48", X0, GRADA.techo, X1 - X0, 120);
  r(k, "#6a7080", X0 - 6, 66, X1 - X0 + 12, 2);
  // Tribuna: gradas en escalera
  r(k, "#1b1f29", 60, GRADA.techo, 520, GRADA.suelo - GRADA.techo);
  for (let y = 72; y < GRADA.suelo; y += 6) r(k, "#252a36", 60, y + 5, 520, 1);
  for (let px = 160; px < 580; px += 104) r(k, "#2f3542", px, GRADA.techo, 8, GRADA.suelo - GRADA.techo);
  // Laterales: escaleras de acceso a la tribuna
  for (const lx of [X0, 580]) {
    r(k, "#2c313d", lx, GRADA.techo, 40, 120);
    for (let i = 0; i < 12; i++) r(k, "#454c5b", lx + (lx === X0 ? 38 - i * 3 : i * 3), 92 + i * 8, 3, 2);
  }

  // Cancha
  for (let fx = 60; fx < 580; fx += 40) r(k, ((fx - 60) / 40) % 2 ? "#2f8a3c" : "#37983f", fx, CANCHA.techo, 40, CANCHA.suelo - CANCHA.techo + 2);
  r(k, "#dff3df", 64, 148, 512, 1);
  r(k, "#dff3df", 64, 184, 512, 1);
  r(k, "#dff3df", 64, 148, 1, 37);
  r(k, "#dff3df", 575, 148, 1, 37);
  r(k, "#dff3df", 320, 148, 1, 37);
  for (let a = 0; a < 40; a++) {
    const ang = (a / 40) * Math.PI * 2;
    r(k, "#dff3df", 320 + Math.cos(ang) * 26, 166 + Math.sin(ang) * 10, 1, 1);
  }
  for (const [ax, sentido] of [[64, 1], [575, -1]]) {
    r(k, "#dff3df", ax + (sentido > 0 ? 0 : -44), 155, 45, 1);
    r(k, "#dff3df", ax + (sentido > 0 ? 0 : -44), 177, 45, 1);
    r(k, "#dff3df", ax + sentido * 44, 155, 1, 23);
    // Arco con red
    const gx = sentido > 0 ? ax - 4 : ax - 3;
    for (let ny = 157; ny < 175; ny += 2) for (let nx = 0; nx < 8; nx += 2) r(k, "#b8c4b8", gx + nx, ny, 1, 1);
    r(k, "#ffffff", gx, 156, 8, 1);
    r(k, "#ffffff", sentido > 0 ? gx + 7 : gx, 156, 1, 19);
  }
  // Soporte de la cartelería LED
  r(k, "#11131a", LED.x - 2, LED.y - 1, LED.w + 4, LED.h + 2);

  // Pantalla gigante sobre la tribuna
  r(k, "#5a606e", 276, 64, 4, 6);
  r(k, "#5a606e", 360, 64, 4, 6);
  r(k, "#3b4270", GIGANTE.x - 2, GIGANTE.y - 2, GIGANTE.w + 4, GIGANTE.h + 4);
  r(k, "#05060a", GIGANTE.x, GIGANTE.y, GIGANTE.w, GIGANTE.h);

  // Torres de reflectores
  for (const tx of TORRES) {
    for (let y = 42; y < 188; y++) {
      r(k, "#7d8594", tx - 3, y, 1, 1);
      r(k, "#7d8594", tx + 2, y, 1, 1);
      if (y % 6 === 0) r(k, "#7d8594", tx - 3, y, 6, 1);
      if (y % 12 === 3) r(k, "#5d6574", tx - 2 + ((y / 12) % 2 ? 0 : 3), y, 1, 3);
    }
    r(k, "#3a3f4c", tx - 11, 28, 22, 15);
    r(k, "#5a6070", tx - 11, 28, 22, 1);
  }

  // Anillo de servicios y subsuelo técnico
  r(k, "#2c3a4e", X0, PISO2.techo, 196, PISO2.suelo - PISO2.techo);
  r(k, "#28303f", X0 + 196, PISO2.techo, 120, PISO2.suelo - PISO2.techo);
  r(k, "#3a2c38", X0 + 316, PISO2.techo, X1 - X0 - 316, PISO2.suelo - PISO2.techo);
  r(k, "#2a3240", X0, PISO3.techo, 310, PISO3.suelo - PISO3.techo);
  r(k, "#222838", X0 + 310, PISO3.techo, X1 - X0 - 310, PISO3.suelo - PISO3.techo);
  for (const [p, color] of [[PISO2, "#27344a"], [PISO3, "#262e3b"]]) {
    for (let px = X0 + 8; px < X1; px += 40) r(k, color, px, p.techo + 16, 1, p.suelo - p.techo - 20);
    r(k, "#4a4f5c", X0, p.suelo, X1 - X0, 2);
    r(k, "#15181f", X0, p.suelo - 2, X1 - X0, 2);
  }
  for (const y of [188, 268]) {
    r(k, "#4b505e", X0 - 6, y, X1 - X0 + 12, 2);
    r(k, "#6a7080", X0 - 6, y, X1 - X0 + 12, 1);
  }
  r(k, "#4b505e", X0 - 6, 346, X1 - X0 + 12, 14);
  r(k, "#6a7080", X0 - 6, 346, X1 - X0 + 12, 1);

  // Acceso: la calle, el cartel y la escalera a la tribuna
  r(k, "#0a1230", X0, 208, 20, 60);
  r(k, "#15181f", X0 + 20, 204, 3, 64);
  r(k, "#1a5a2e", 58, 192, 82, 11);
  texto(k, "ACCESO NORTE", 63, 194, "#eafff0");
  r(k, "#0a0c12", 56, 207, 86, 11);
  for (let i = 0; i < 6; i++) r(k, "#4a5262", 202 + i * 3, 262 - i * 5, 16 - i * 3, 6);
  r(k, "#15181f", 216, PISO2.techo, 4, 78);
  // Boletería
  r(k, CLUB, 232, 192, 90, 11);
  textoCentrado(k, "BOLETERÍA", 277, 194, "#ffffff");
  r(k, "#141a26", 228, 208, 98, 40);
  // Tienda oficial
  r(k, CLUB, 396, 192, 170, 11);
  textoCentrado(k, "TIENDA OFICIAL ZABBIX FC", 481, 194, "#ffffff");
  r(k, "#241a24", 346, 212, 130, 34);
  r(k, "#8a8f9c", 348, 214, 126, 1);
  for (let i = 0; i < 8; i++) {
    camiseta(k, 351 + i * 15, 216, i % 3 === 2 ? "#f4f1e6" : CLUB, i % 3 === 2 ? CLUB : "#f4f1e6");
    camiseta(k, 351 + i * 15, 231, i % 3 === 0 ? "#1d2336" : CLUB, "#f4f1e6");
  }
  r(k, "#241a24", 482, 212, 50, 40);
  for (const sy of [224, 237, 250]) r(k, "#6a5040", 482, sy, 50, 2);
  for (let i = 0; i < 5; i++) {
    r(k, "#f4f1e6", 486 + i * 9, 219, 5, 5);
    r(k, "#22262e", 487 + i * 9, 220, 2, 2);
    r(k, i % 2 ? CLUB : "#f4f1e6", 485 + i * 9, 233, 7, 4);
    r(k, i % 2 ? "#f4f1e6" : CLUB, 485 + i * 9, 234, 7, 1);
    r(k, CLUB, 486 + i * 9, 245, 5, 3);
    r(k, "#8a0f0f", 485 + i * 9, 248, 7, 2);
  }
  // Cables de las TVs
  for (const tx of TVS) r(k, "#15181f", tx + 10, PISO2.techo, 2, 4);

  // Sala eléctrica
  texto(k, "SALA ELÉCTRICA", 28, PISO3.techo + 4, ROTULO);
  texto(k, "CENTRO DE CONTROL", 342, PISO3.techo + 4, ROTULO);
  r(k, "#15181f", 330, PISO3.techo, 4, 76);
  // Acometida y transformador
  r(k, "#3f4a38", 28, 306, 44, 40);
  for (let fx = 30; fx < 72; fx += 5) r(k, "#55634c", fx, 310, 2, 34);
  for (const bx of [36, 48, 60]) {
    r(k, "#d8dde6", bx, 296, 4, 10);
    for (let by = 298; by < 306; by += 3) r(k, "#a8b0bc", bx - 1, by, 6, 1);
  }
  texto(k, "RED", 78, 284, ROTULO);
  // Barra de distribución
  r(k, "#8a6428", 38, 292, 262, 2);
  r(k, "#8a6428", 38, 292, 2, 6);
  // Tableros
  for (const [, sigla, tx] of TABLEROS) {
    r(k, "#8a6428", tx + 13, 292, 2, 8);
    r(k, "#59616f", tx, 300, 28, 46);
    r(k, "#737c8c", tx, 300, 28, 1);
    r(k, "#454c59", tx + 26, 300, 2, 46);
    r(k, "#2a2f3a", tx + 3, 303, 22, 9);
    texto(k, sigla, tx + 5, 304, "#d8dde6");
    r(k, "#15181f", tx + 10, 315, 8, 13);
  }
  // UPS
  r(k, "#8a6428", 230, 292, 2, 8);
  r(k, "#1e2430", 212, 300, 38, 46);
  r(k, "#3a4256", 212, 300, 38, 1);
  texto(k, "UPS", 222, 304, "#d8dde6");
  r(k, "#0a0d14", 217, 315, 28, 10);
  // Generador
  r(k, "#8a6428", 298, 292, 2, 20);
  r(k, "#b8901c", 258, 312, 66, 30);
  r(k, "#d9ad2a", 258, 312, 66, 2);
  r(k, "#8a6a10", 258, 340, 66, 2);
  r(k, "#2a2c34", 262, 342, 8, 4);
  r(k, "#2a2c34", 312, 342, 8, 4);
  for (let gy = 318; gy < 338; gy += 3) r(k, "#7a5e10", 262, gy, 22, 1);
  r(k, "#15181f", 290, 318, 28, 18);
  r(k, "#5a606e", 316, PISO3.techo, 4, 42);
  texto(k, "GENERADOR", 258, 302, ROTULO);

  // Centro de control: racks, mesa y pantalla de Zabbix
  for (const rx of [338, 362]) {
    r(k, "#0d1018", rx, 284, 22, 62);
    r(k, "#2c3242", rx, 284, 22, 1);
    for (let sy = 288; sy < 342; sy += 6) r(k, "#1a1f2c", rx + 2, sy, 18, 4);
  }
  r(k, "#5a4a3a", 392, 332, 50, 3);
  r(k, "#3e3428", 392, 335, 50, 11);
  r(k, "#3b4270", 450, 278, 162, 68);
  r(k, "#06080f", 452, 280, 158, 64);
  r(k, CLUB, 452, 280, 158, 10);
  texto(k, "ZABBIX · PROBLEMAS", 456, 282, "#ffffff");
  return l;
}

const fondo = pintarFondo();

// ---------------------------------------------------------------- cielo y luces

const ESTRELLAS = (() => {
  const azr = azar(5);
  return Array.from({ length: 50 }, () => ({ x: Math.floor(azr() * ANCHO), y: 15 + Math.floor(azr() * 34), f: azr() * 6 }));
})();

const luces = () => (e ? e.luces : { torres: [LUX_NOMINAL, LUX_NOMINAL, LUX_NOMINAL, LUX_NOMINAL], cancha: LUX_NOMINAL });
const fraccionLuz = () => Math.max(0, Math.min(1, luces().cancha / LUX_NOMINAL));

function pintarCielo() {
  for (const s of ESTRELLAS) {
    const b = Math.sin(reloj * 1.5 + s.f) > 0.7;
    r(c, b ? "#ffffff" : "#8a94c0", s.x, s.y, 1, 1);
  }
}

function pintarHaces() {
  const f = fraccionLuz();
  if (f <= 0.02) return;
  c.globalAlpha = 0.075 * f;
  for (const [tx, destino] of [[TORRES[0], 340], [TORRES[1], 300]]) {
    for (let y = 43; y < CANCHA.suelo; y++) {
      const t = (y - 43) / (CANCHA.suelo - 43);
      const borde = tx + (tx < 320 ? 30 : -30) * t;
      const lejos = tx + (destino - tx) * t;
      r(c, "#fff6c8", Math.min(borde, lejos), y, Math.abs(lejos - borde), 1);
    }
  }
  c.globalAlpha = 1;
}

function pintarPenumbra() {
  const oscuro = (1 - fraccionLuz()) * 0.62;
  if (oscuro <= 0.01) return;
  c.globalAlpha = oscuro;
  r(c, "#02030a", X0, GRADA.techo, X1 - X0, 120);
  c.globalAlpha = 1;
}

function pintarReflectores() {
  const t = luces().torres;
  TORRES.forEach((tx, n) => {
    const f = (t[n * 2] + t[n * 2 + 1]) / 2 / LUX_NOMINAL;
    for (let i = 0; i < 12; i++) {
      const encendida = f > 0.8 || (f > 0.2 && i % 2 === 0);
      r(c, encendida ? "#fffbe0" : "#22242c", tx - 9 + (i % 4) * 5, 30 + Math.floor(i / 4) * 4, 4, 3);
    }
  });
}

// ---------------------------------------------------------------- tribuna

const PUBLICO = (() => {
  const a = azar(11);
  const pieles = ["#e7b48a", "#c98f66", "#a06a48", "#efc4a0"];
  const otros = ["#e0b040", "#3a4a6a", "#6a6a72"];
  const lista = [];
  for (let fila = 0; fila < 10; fila++) {
    for (let x = 64; x < 576; x += 4) {
      if ((x - 60) % 104 >= 96) continue;
      const visita = x >= 480 && fila < 6;
      const u = a();
      const color = visita ? (u < 0.7 ? "#4aa3df" : "#e8eef4") : u < 0.62 ? CLUB : u < 0.82 ? "#f4f1e6" : u < 0.9 ? "#8a0f0f" : otros[Math.floor(a() * 3)];
      lista.push({ x, y: 71 + fila * 6, color, piel: pieles[Math.floor(a() * 4)], f: a(), umbral: a(), visita });
    }
  }
  return lista;
})();

function festejo() {
  if (!e || !e.partido.gol_t) return null;
  return e.ts - e.partido.gol_t < 9 ? e.partido.gol_de : null;
}

function pintarPublico() {
  const ocupacion = e ? e.accesos.asistencia / e.accesos.aforo : 0.91;
  const gol = festejo();
  for (const p of PUBLICO) {
    if (p.umbral > ocupacion) continue;
    let dy = Math.sin(reloj * 1.4 + p.f * 40) > 0.94 ? -1 : 0;
    if (gol !== null && (gol === 1) === p.visita) dy = Math.floor(reloj * 7 + p.f * 3) % 2 ? -2 : 0;
    r(c, p.piel, p.x, p.y + dy, 2, 2);
    r(c, p.color, p.x, p.y + 2 + dy, 2, 3);
  }
}

// A oscuras, la tribuna prende los celulares
function pintarCelulares() {
  if (fraccionLuz() > 0.6) return;
  const ocupacion = e ? e.accesos.asistencia / e.accesos.aforo : 0.91;
  for (const p of PUBLICO) {
    if (p.umbral > ocupacion || p.f > 0.4) continue;
    if (Math.sin(reloj * 2.5 + p.f * 90) > 0) r(c, "#fff8d0", p.x, p.y + 1, 1, 1);
  }
}

// ---------------------------------------------------------------- cartelería LED y pantalla gigante

const ANUNCIOS = [
  ["ZABBIX 8.0", "#ffffff", CLUB],
  ["OBSERVABILIDAD TOTAL", "#ffe066", "#101830"],
  ["ZABBIX FC", CLUB, "#f4f1e6"],
  ["CEP · CAUSA Y SÍNTOMAS", "#7ad0ff", "#0b1020"],
  ["APM NATIVO", "#0b1020", "#59f0a0"],
  ["TIENDA OFICIAL", "#ffffff", "#8a0f0f"],
  ["ZABBIX FORUM", "#ffffff", "#3b2a70"],
].map(([txt, color, fondoA]) => ({ txt, color, fondo: fondoA, w: anchoTexto(txt) + 28 }));
const ANCHO_ANUNCIOS = ANUNCIOS.reduce((s, a) => s + a.w, 0);

const pantallas = () => (e ? e.pantallas : { gigante: true, led: 48, led_total: 48, tvs: 64, tvs_total: 64, pub_h: 186000 });

function pintarLED() {
  const p = pantallas();
  r(c, "#07080d", LED.x, LED.y, LED.w, LED.h);
  if (p.led <= 0) return;
  c.save();
  c.beginPath();
  c.rect(LED.x, LED.y, LED.w, LED.h);
  c.clip();
  let x = LED.x - (Math.floor(reloj * 28) % ANCHO_ANUNCIOS);
  while (x < LED.x + LED.w) {
    for (const a of ANUNCIOS) {
      if (x + a.w > LED.x && x < LED.x + LED.w) {
        r(c, a.fondo, x, LED.y, a.w, LED.h);
        texto(c, a.txt, x + 14, LED.y + 1, a.color);
      }
      x += a.w;
    }
  }
  c.restore();
  const ancho = LED.w / p.led_total;
  for (let i = 0; i < p.led_total; i++) {
    if ((i * 7) % p.led_total >= p.led) r(c, "#07080d", LED.x + i * ancho, LED.y, Math.ceil(ancho), LED.h);
  }
}

function marcador() {
  const p = e ? e.partido : { minuto: 0, goles: [0, 0] };
  return { texto: `${p.goles[0]} - ${p.goles[1]}`, minuto: p.minuto > 90 ? "FINAL" : `${p.minuto}'` };
}

function pintarGigante() {
  const { x, y, w, h } = GIGANTE;
  if (!pantallas().gigante) {
    r(c, "#05060a", x, y, w, h);
    return;
  }
  const m = marcador();
  const gol = festejo();
  if (gol !== null && Math.floor(reloj * 4) % 2 === 0) {
    r(c, gol === 0 ? CLUB : "#1f5a9a", x, y, w, h);
    textoCentrado(c, "¡GOOOL!", x + w / 2, y + 8, "#ffffff", 2);
    textoCentrado(c, gol === 0 ? "ZABBIX FC" : "DEPORTIVO DOWNTIME", x + w / 2, y + 31, "#ffffff");
    return;
  }
  r(c, "#0b1630", x, y, w, h);
  r(c, CLUB, x, y, w / 2, 11);
  r(c, "#1f5a9a", x + w / 2, y, w / 2, 11);
  textoCentrado(c, "ZABBIX FC", x + w / 4, y + 2, "#ffffff");
  textoCentrado(c, "DOWNTIME", x + (w * 3) / 4, y + 2, "#ffffff");
  textoCentrado(c, m.texto, x + w / 2, y + 15, "#ffe066", 2);
  const enJuego = !e || e.partido.en_juego;
  textoCentrado(c, enJuego ? m.minuto : "PARTIDO DETENIDO", x + w / 2, y + 35, enJuego ? "#ffffff" : ROJO);
}

// ---------------------------------------------------------------- el partido

const CENTRO = { x: 320, y: 168 };
const pelota = { x: 320, y: 168, tx: 320, ty: 168, espera: 1, vel: 80 };
const JUGADORES = (() => {
  const base = [[0.06, 0.5, true], [0.22, 0.2], [0.22, 0.8], [0.4, 0.5], [0.55, 0.15], [0.55, 0.85], [0.72, 0.5]];
  const lista = [];
  for (const [fx, fy, arquero] of base) {
    lista.push({ bx: 70 + fx * 500, by: 152 + fy * 30, x: 70 + fx * 500, y: 152 + fy * 30, color: arquero ? "#e8c020" : CLUB, arquero: Boolean(arquero), f: fx * 7 });
    lista.push({ bx: 570 - fx * 500, by: 152 + (1 - fy) * 30, x: 570 - fx * 500, y: 152 + (1 - fy) * 30, color: arquero ? "#40c070" : "#4aa3df", arquero: Boolean(arquero), f: fy * 5 });
  }
  return lista;
})();

function alGol(equipo) {
  Object.assign(pelota, { tx: equipo === 0 ? 572 : 68, ty: 166, espera: 5, vel: 220 });
}

function actualizarPartido(dt) {
  if (e && !e.partido.en_juego) return;
  const dx = pelota.tx - pelota.x;
  const dy = pelota.ty - pelota.y;
  const d = Math.hypot(dx, dy);
  if (d < 2) {
    pelota.espera -= dt;
    if (pelota.espera <= 0) {
      const desdeArco = pelota.x > 560 || pelota.x < 80;
      Object.assign(pelota, { tx: desdeArco ? CENTRO.x : 90 + Math.random() * 460, ty: desdeArco ? CENTRO.y : 152 + Math.random() * 30, espera: 0.3 + Math.random() * 1.4, vel: 60 + Math.random() * 70 });
    }
  } else {
    pelota.x += (dx / d) * Math.min(d, pelota.vel * dt);
    pelota.y += (dy / d) * Math.min(d, pelota.vel * dt);
  }
  const cerca = [...JUGADORES].filter((j) => !j.arquero).sort((a, b) => Math.hypot(a.x - pelota.x, a.y - pelota.y) - Math.hypot(b.x - pelota.x, b.y - pelota.y)).slice(0, 2);
  for (const j of JUGADORES) {
    let ox = j.bx + (pelota.x - CENTRO.x) * (j.arquero ? 0.02 : 0.32);
    let oy = j.by + (pelota.y - CENTRO.y) * (j.arquero ? 0.4 : 0.3);
    if (cerca.includes(j)) { ox = pelota.x; oy = pelota.y; }
    const jx = ox - j.x;
    const jy = oy - j.y;
    const jd = Math.hypot(jx, jy);
    j.corre = jd > 1.5;
    if (j.corre) {
      j.x += (jx / jd) * Math.min(jd, 34 * dt);
      j.y += (jy / jd) * Math.min(jd, 34 * dt);
    }
  }
}

function pintarPartido() {
  for (const j of [...JUGADORES].sort((a, b) => a.y - b.y)) {
    const paso = j.corre && Math.floor(reloj * 8 + j.f) % 2;
    r(c, "rgba(0,0,0,0.25)", j.x - 1, j.y, 4, 1);
    r(c, "#e7b48a", j.x, j.y - 7, 2, 2);
    r(c, j.color, j.x, j.y - 5, 2, 3);
    r(c, "#f4f1e6", j.x, j.y - 2, 2, 1);
    r(c, "#1a1a22", j.x + (paso ? 1 : 0), j.y - 1, 1, 1);
    r(c, "#1a1a22", j.x + (paso ? 0 : 1), j.y - 1, 1, 1);
  }
  r(c, "rgba(0,0,0,0.3)", pelota.x, pelota.y + 1, 2, 1);
  r(c, "#ffffff", pelota.x, pelota.y - 1, 2, 2);
}

// ---------------------------------------------------------------- anillo de servicios

function pintarTVs() {
  const p = pantallas();
  const m = marcador();
  TVS.forEach((tx, i) => {
    r(c, "#0a0d14", tx, 194, 22, 13);
    const encendida = p.tvs / p.tvs_total > (i + 1) / 4;
    if (!encendida) {
      r(c, "#05060a", tx + 1, 195, 20, 11);
      if (Math.floor(reloj * 2) % 2) r(c, "#a01010", tx + 19, 204, 1, 1);
      return;
    }
    r(c, "#1f7a3a", tx + 1, 195, 20, 11);
    r(c, "#2a8a46", tx + 1, 195, 10, 11);
    texto(c, m.texto.replace(/ /g, ""), tx + 2, 197, "#ffffff");
  });
}

function pintarAnillo() {
  const a = e ? e.accesos : { fila: 3, rechazo: 1.5, por_min: 220 };
  // Cartel de la fila
  const colorFila = a.fila > 10 ? ROJO : a.fila > 6 ? AMBAR : VERDE;
  textoCentrado(c, `FILA ${Math.round(a.fila)} MIN`, 99, 209, a.fila > 10 && Math.floor(reloj * 2) % 2 ? "#ffdddd" : colorFila);

  // Boletería: el boletero detrás del vidrio y el monitor del sistema de entradas
  boletero.pintar(c);
  const bd = !e || e.boleteria.bd;
  r(c, "#0a0d14", 292, 224, 24, 15);
  r(c, bd ? "#123a2a" : (Math.floor(reloj * 3) % 2 ? "#7a1414" : "#3a0c0c"), 293, 225, 22, 13);
  textoCentrado(c, bd ? "OK" : "ERR", 304, 228, bd ? "#7af0b0" : "#ffb0b0");
  c.globalAlpha = 0.14;
  r(c, "#9fd0ff", 230, 210, 44, 36);
  r(c, "#9fd0ff", 280, 210, 44, 36);
  c.globalAlpha = 1;
  r(c, "#6a7080", 228, 208, 98, 2);
  r(c, "#6a7080", 274, 208, 6, 40);
  r(c, "#6a7080", 228, 208, 2, 40);
  r(c, "#6a7080", 324, 208, 2, 40);
  r(c, "#7a6248", 224, 246, 106, 3);
  r(c, "#4a3a2c", 226, 249, 102, 19);
  texto(c, "PLATEA $1,250", 238, 255, "#e8d8b8");

  // Tienda: la vendedora, el mostrador y las terminales de cobro
  vendedora.pintar(c);
  r(c, "#8a8f9c", 538, 246, 76, 3);
  r(c, "#8a0f0f", 540, 249, 72, 19);
  r(c, "#f4f1e6", 570, 253, 12, 2);
  r(c, "#f4f1e6", 578, 255, 2, 2);
  r(c, "#f4f1e6", 574, 257, 2, 2);
  r(c, "#f4f1e6", 570, 259, 12, 2);
}

function pintarFrenteAnillo() {
  const a = e ? e.accesos : { rechazo: 1.5 };
  const bloqueado = a.rechazo > 30;
  MOLINETES.forEach((mx, i) => {
    r(c, "#8d96a8", mx, 252, 6, 16);
    r(c, "#b6bfcf", mx, 252, 6, 1);
    r(c, "#5a6474", mx + 5, 253, 1, 15);
    let color = bloqueado ? (Math.floor(reloj * 3 + i) % 2 ? ROJO : "#5a1010") : VERDE;
    if (i === 0 && luzMolinete.t > 0) color = luzMolinete.color;
    r(c, color, mx + 1, 249, 4, 3);
    const giro = !bloqueado && Math.floor(reloj * 3 + i) % 2;
    r(c, "#d8dde6", mx - (giro ? 4 : 6), giro ? 256 : 258, giro ? 4 : 6, 1);
  });
}

function pintarTerminales() {
  const t = e ? e.tienda : { pos: 6, pos_total: 6 };
  [548, 564, 590].forEach((px, i) => {
    const enLinea = t.pos / t.pos_total > i / 3 + 0.01;
    r(c, "#15181f", px, 239, 7, 7);
    r(c, enLinea ? "#46d160" : (Math.floor(reloj * 3 + i) % 2 ? "#c02020" : "#3a0c0c"), px + 1, 240, 5, 4);
  });
}

function pintarTiendaSinLuz() {
  if (!e || e.tableros.comercial.cerrado) return;
  c.globalAlpha = 0.6;
  r(c, "#02030a", 336, PISO2.techo, 284, PISO2.suelo - PISO2.techo);
  c.globalAlpha = 1;
}

// ---------------------------------------------------------------- subsuelo

let giroGenerador = 0;

function pintarSubsuelo(dt) {
  const en = e ? e.energia : { red: true, tension: 13.2, ups_bateria: false, ups_pct: 100, generador: false, combustible: 96 };
  const tab = e ? e.tableros : null;
  // Acometida
  texto(c, en.red ? `${en.tension.toFixed(1)} kV` : "0.0 kV", 98, 284, en.red ? VERDE : (Math.floor(reloj * 3) % 2 ? ROJO : "#7a2020"));
  if (!en.red) {
    c.globalAlpha = 0.45;
    r(c, "#02030a", 28, 296, 44, 50);
    c.globalAlpha = 1;
  }
  // Energía que corre por la barra: desde la red o desde el generador
  if (en.red || en.generador) {
    for (let i = 0; i < 9; i++) {
      const t = (reloj * 0.5 + i / 9) % 1;
      r(c, "#ffe066", en.red ? 40 + t * 258 : 298 - t * 258, 292, 3, 2);
    }
  }
  // Tableros: interruptor, corriente y piloto
  for (const [nombre, , tx] of TABLEROS) {
    const t = tab ? tab[nombre] : { a: 200, cerrado: true };
    const parpadeo = Math.floor(reloj * 3) % 2;
    if (t.cerrado) {
      r(c, "#46d160", tx + 11, 316, 6, 5);
    } else {
      r(c, parpadeo ? "#ff3b3b" : "#7a1a1a", tx + 11, 322, 6, 5);
    }
    textoCentrado(c, `${t.a}A`, tx + 14, 331, !t.cerrado ? ROJO : t.a < 5 ? SUAVE : "#d8f0d8");
    r(c, !t.cerrado ? (parpadeo ? "#ff3b3b" : "#5a1010") : t.a < 5 ? "#3a3f4a" : "#46d160", tx + 3, 341, 4, 2);
  }
  // UPS: barra de batería
  const segmentos = Math.ceil(en.ups_pct / 20);
  const colorUps = en.ups_bateria ? AMBAR : VERDE;
  for (let i = 0; i < 5; i++) r(c, i < segmentos ? colorUps : "#20283a", 219 + i * 5, 317, 4, 6);
  textoCentrado(c, `${en.ups_pct}%`, 231, 329, colorUps);
  if (en.ups_bateria && Math.floor(reloj * 2.5) % 2) textoCentrado(c, "BAT", 231, 338, AMBAR);
  if (!en.ups_bateria) textoCentrado(c, "LÍNEA", 231, 338, "#7a8498");
  // Generador
  if (en.generador) {
    giroGenerador += dt * 14;
    for (let i = 0; i < 6; i++) {
      const t = (reloj * 0.9 + i / 6) % 1;
      r(c, "#c8ccd4", 317 + Math.round(Math.sin(reloj * 5 + i)), 310 - t * 38, 2, 2);
    }
    if (Math.floor(reloj * 12) % 2) r(c, "#d9ad2a", 258, 311, 66, 1);
  }
  for (let i = 0; i < 4; i++) {
    const ang = giroGenerador + (i * Math.PI) / 2;
    for (let k = 1; k < 7; k++) r(c, "#aab4c4", 304 + Math.cos(ang) * k, 327 + Math.sin(ang) * k, 1, 1);
  }
  r(c, en.generador ? "#46d160" : "#3a3f4a", 262, 314, 4, 2);
  r(c, "#15181f", 261, 325, 26, 11);
  texto(c, `${en.combustible}%`, 263, 327, en.combustible < 25 ? AMBAR : "#d8dde6");

  // Centro de control
  for (const rx of [338, 362]) {
    for (let sy = 288; sy < 342; sy += 6) {
      const encendido = Math.sin(reloj * 7 + sy * 1.7 + rx) > 0;
      r(c, encendido ? "#46d160" : "#14301e", rx + 16, sy + 1, 2, 2);
      if (Math.sin(reloj * 3 + sy) > 0.8) r(c, "#f0b429", rx + 13, sy + 1, 2, 2);
    }
  }
  const alarma = problemas().length > 0 && Math.floor(reloj * 2) % 2 === 0;
  for (const mx of [396, 422]) {
    r(c, "#0a0d14", mx, 318, 16, 12);
    r(c, alarma ? "#c0392b" : "#1f6a5a", mx + 1, 319, 14, 9);
    for (let i = 0; i < 3; i++) r(c, "#a8f0d0", mx + 2, 320 + i * 3, 4 + ((i * 5 + Math.floor(reloj * 2)) % 9), 1);
    r(c, "#0a0d14", mx + 7, 330, 2, 2);
  }
  pintarPantallaZabbix(problemas());
}

function problemas() {
  return e ? e.problemas : [];
}

function recortarTexto(cadena, letras) {
  return cadena.length > letras ? cadena.slice(0, letras - 1) + "." : cadena;
}

function pintarPantallaZabbix(lista) {
  const x = 456;
  let y = 293;
  if (!lista.length) {
    texto(c, "Sin problemas abiertos", x, y + 14, VERDE);
    texto(c, e && !e.zabbix_ok ? (e.ensayo ? "(ensayo, sin Zabbix)" : "(sin conexión)") : "", x, y + 28, SUAVE);
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
  const pie = causas.length ? `CEP: ${causas.length} causa${causas.length > 1 ? "s" : ""} · ${sintomas.length} síntomas` : `${lista.length} problemas`;
  texto(c, pie, x, 335, causas.length ? "#7ad0ff" : SUAVE);
}

// ---------------------------------------------------------------- balizas por piso

function pintarBalizas() {
  const pisos = new Set();
  for (const p of problemas()) {
    const n = p.nombre.toLowerCase();
    if (/acceso|boleter|tienda|molinete|tv/.test(n)) pisos.add(2);
    if (/energ|ups|tablero|generador/.test(n)) pisos.add(3);
  }
  const on = Math.floor(reloj * 2.5) % 2 === 0;
  for (const [n, piso, x] of [[2, PISO2, 150], [3, PISO3, 200]]) {
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
  c.fillStyle = "rgba(6,8,22,0.94)";
  c.fillRect(0, 0, ANCHO, 13);
  r(c, "#d9a441", 0, 13, ANCHO, 1);
  texto(c, "ESTADIO ZABBIX · ZABBIX FC", 5, 3, "#f2c75c");
  const b = titular();
  const color = b.grave ? (Math.floor(reloj * 2.5) % 2 ? ROJO : "#ffdddd") : b.color;
  textoCentrado(c, b.texto, ANCHO / 2 + 50, 3, color);
  const hora = new Date().toTimeString().slice(0, 8);
  texto(c, hora, ANCHO - anchoTexto(hora) - 5, 3, SUAVE);
  if (!e) return;

  const en = e.energia;
  const a = e.accesos;
  const t = e.tienda;
  const lux = e.luces.cancha;
  const filas = [
    ["ENERGÍA", !en.red ? (en.generador ? "GENERADOR" : en.ups_bateria ? `UPS ${en.ups_pct}%` : "SIN RED") : "RED OK", !en.red ? (en.generador ? AMBAR : ROJO) : VERDE],
    ["CANCHA", `${lux} lux`, lux < 800 ? ROJO : VERDE],
    ["ACCESOS", `${a.por_min}/min`, a.por_min < 80 ? ROJO : VERDE],
    ["TIENDA", `${t.pos}/${t.pos_total} POS`, t.pos < 3 ? ROJO : VERDE],
    ["ZABBIX", e.zabbix_ok ? "CONECTADO" : e.ensayo ? "ENSAYO" : "SIN CONEX.", e.zabbix_ok ? VERDE : AMBAR],
  ];
  panel(62, 16, 130, filas.length * 9 + 6);
  filas.forEach(([rot, val, col], i) => {
    const y = 20 + i * 9;
    texto(c, "●", 66, y, col);
    texto(c, rot, 74, y, SUAVE);
    texto(c, val, 124, y, col);
  });

  panel(448, 16, 132, 51, "NEGOCIO");
  const pub = e.pantallas.pub_h;
  texto(c, `${miles(a.asistencia)} hinchas`, 453, 30, BLANCO);
  texto(c, `${dinero(e.ingresos_h)} MXN/h`, 453, 39, e.ingresos_h < 150000 ? AMBAR : BLANCO);
  texto(c, `publicidad ${dinero(pub)}`, 453, 48, pub < 10000 ? ROJO : BLANCO);
  texto(c, `tienda ${dinero(t.ventas_h)}`, 453, 57, t.ventas_h < 20000 ? ROJO : BLANCO);
}

function titular() {
  if (!e) return { texto: fallasSondeo > 2 ? "SIN CONEXIÓN CON EL SERVIDOR" : "CONECTANDO...", grave: fallasSondeo > 2 };
  if (e.activos.includes("apagon")) {
    if (e.energia.generador) return { texto: "APAGÓN · GENERADOR EN MARCHA · PANTALLAS SIN ENERGÍA", grave: true };
    return { texto: "CORTE DE LA RED ELÉCTRICA · PARTIDO DETENIDO", grave: true };
  }
  if (e.activos.includes("molinetes")) return { texto: `SIN BASE DE ENTRADAS · FILA DE ${Math.round(e.accesos.fila)} MIN`, grave: true };
  if (e.activos.includes("tablero")) return { texto: "TABLERO COMERCIAL DISPARADO · TIENDA SIN COBRO", grave: true };
  if (!e.partido.en_juego) return { texto: "VUELVE LA LUZ A LA CANCHA", color: AMBAR };
  const g = e.partido.goles;
  return { texto: `PARTIDO EN JUEGO · ZABBIX FC ${g[0]} - ${g[1]} DOWNTIME · ${miles(e.accesos.asistencia)} HINCHAS`, color: VERDE };
}

function pintarControles() {
  if (!e || !e.controles || dialogo.abierto) return;
  const ayuda = `${e.ensayo ? "ENSAYO" : "DEMO"}  1 apagón  2 base de entradas  3 tablero comercial  0 reset  ·  clic: boletería, molinetes, tienda`;
  c.fillStyle = "rgba(120,12,12,0.94)";
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

const caja = (x0, y0, x1, y1) => (x, y) => x >= x0 && x < x1 && y >= y0 && y < y1;
const ZONAS = [
  { nombre: "entrada", accion: true, etiqueta: "ENTRADA", px: 277, py: 216, dentro: caja(222, 204, 332, 268) },
  { nombre: "acceso", accion: true, etiqueta: "PASAR", px: 169, py: 232, dentro: caja(142, 218, 216, 268) },
  { nombre: "merch", accion: true, etiqueta: "CAMISETA", px: 574, py: 222, dentro: caja(340, 204, 620, 268) },
  { nombre: "fila", dentro: caja(22, 204, 142, 268) },
  { nombre: "gigante", dentro: caja(GIGANTE.x, GIGANTE.y, GIGANTE.x + GIGANTE.w, GIGANTE.y + GIGANTE.h) },
  { nombre: "torres", dentro: (x, y) => y >= 26 && y < 68 && (x < 44 || x >= 596) },
  { nombre: "led", dentro: caja(LED.x, LED.y - 1, LED.x + LED.w, LED.y + LED.h + 1) },
  { nombre: "tribuna", dentro: caja(60, GRADA.techo, 580, GRADA.suelo) },
  { nombre: "cancha", dentro: caja(60, CANCHA.techo, 580, CANCHA.suelo + 2) },
  { nombre: "acometida", dentro: caja(24, 282, 78, 346) },
  { nombre: "tableros", dentro: caja(82, 296, 204, 346) },
  { nombre: "ups", dentro: caja(210, 296, 252, 346) },
  { nombre: "generador", dentro: caja(256, 298, 326, 346) },
  { nombre: "zabbix", dentro: caja(450, 278, 612, 346) },
];

const zonaEn = (x, y) => ZONAS.find((z) => z.dentro(x, y));

const ACCIONES = {
  entrada: { quien: "Boletería", espera: "Comprando una platea", ok: (d) => `¡Entrada ${d.entrada}! ${d.sector}, ${dinero(d.precio)} MXN. Vendida en ${d.ms} ms.`, mal: "No se pudo vender la entrada.", emote: "$", persona: () => boletero },
  acceso: { quien: "Molinete", espera: "Validando la entrada", ok: (d) => `¡Adelante! Puerta ${d.puerta}, ${d.sector}. Validada en ${d.ms} ms.`, mal: "El molinete no abre.", emote: "♪", persona: () => cola[0] },
  merch: { quien: "Tienda oficial", espera: "Cobrando la camiseta", ok: (d) => `¡${d.producto} de Zabbix FC! ${dinero(d.precio)} MXN. Cobrada en ${d.ms} ms.`, mal: "No se pudo cobrar.", emote: "♥", persona: () => vendedora },
};

function* guionAccion(nombre) {
  const a = ACCIONES[nombre];
  sonido.mover();
  const promesa = fetch(`/api/accion/${nombre}`, { method: "POST" })
    .then((x) => x.json()).catch(() => ({ ok: false, error: "El servidor no responde" }));
  const res = yield* dialogo.esperarPromesa(promesa, a.espera, a.quien);
  const persona = a.persona();
  if (res.ok) {
    sonido.moneda();
    if (persona) persona.mostrar(a.emote, 2);
    yield* dialogo.decir(a.ok(res), a.quien);
  } else {
    sonido.error();
    if (persona) persona.mostrar("!", 2);
    yield* dialogo.decir(`${a.mal} ${res.error || res.detail || ""}`, a.quien);
  }
}

function* guionInfo(zona) {
  if (!e) return;
  const en = e.energia;
  const a = e.accesos;
  const p = e.pantallas;
  const t = e.tableros;
  const g = e.partido.goles;
  const lista = problemas();
  const textos = {
    fila: ["Acceso norte", `${a.por_min} personas por minuto en las cuatro puertas. Fila de ${a.fila} min; los molinetes rechazan el ${a.rechazo}%.`],
    gigante: ["Pantalla gigante", p.gigante ? `Zabbix FC ${g[0]}, Deportivo Downtime ${g[1]}. Minuto ${e.partido.minuto}.` : "Apagada: no es una carga esencial y no entra al generador."],
    torres: ["Reflectores", `${e.luces.cancha} lux en la cancha. Para jugar y transmitir hacen falta 800.`],
    led: ["Cartelería LED", `${p.led} de ${p.led_total} segmentos encendidos. Publicidad: ${dinero(p.pub_h)} MXN por hora.`],
    tribuna: ["Tribuna", `${miles(a.asistencia)} hinchas de ${miles(a.aforo)}: ${Math.round((a.asistencia / a.aforo) * 100)}% de ocupación.`],
    cancha: ["Cancha", e.partido.en_juego ? `Partido en juego, minuto ${e.partido.minuto}. Zabbix FC ${g[0]}, Deportivo Downtime ${g[1]}.` : "Partido detenido: sin luz suficiente no se puede jugar."],
    acometida: ["Acometida", en.red ? `Red externa en ${en.tension} kV. El estadio consume ${en.carga_kw} kW.` : "Sin suministro de la red externa."],
    tableros: ["Tableros", `Iluminación ${t.iluminacion.a} A, pantallas ${t.pantallas.a} A, comercial ${t.comercial.cerrado ? t.comercial.a + " A" : "DISPARADO"}, servicios ${t.servicios.a} A.`],
    ups: ["UPS", `${en.ups_bateria ? "En batería" : "En línea"}: ${en.ups_pct}% de carga, ${en.autonomia_min} min de autonomía. Sostiene molinetes, boletería y centro de control.`],
    generador: ["Generador", `${en.generador ? "En marcha" : "En espera"}. Combustible al ${en.combustible}%. Solo alimenta cargas esenciales.`],
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
  if (causas.length > 1) return `CEP separó ${causas.length} incidentes: ${causas.map((p) => p.nombre).join("; ")}. ${sintomas.length} síntomas en total.`;
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
  dialogo.abrir(z.accion ? guionAccion(z.nombre) : guionInfo(z.nombre));
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
    if (k === "1") ordenar("/api/escenario/apagon");
    if (k === "2") ordenar("/api/escenario/molinetes");
    if (k === "3") ordenar("/api/escenario/tablero");
    if (k === "0") ordenar("/api/reset");
  }
});

// ---------------------------------------------------------------- cuadro

function pintarEtiquetas(zonaActual) {
  if (dialogo.abierto) return;
  ZONAS.filter((z) => z.accion).forEach((z, i) => {
    const sobre = zonaActual === z;
    const bote = Math.round(Math.sin(reloj * 4 + i * 1.3) * 1.5);
    const etiqueta = sobre ? "¡CLIC!" : z.etiqueta;
    const w = anchoTexto(etiqueta) + 8;
    c.fillStyle = "rgba(6,8,22,0.9)";
    c.fillRect(z.px - w / 2, z.py - 2 + bote, w, 11);
    textoCentrado(c, etiqueta, z.px, z.py + bote, "#fff27a");
  });
}

let previo = performance.now();

function cuadro(ahora) {
  const dt = Math.min(0.05, (ahora - previo) / 1000);
  previo = ahora;
  reloj += dt;

  dialogo.actualizar(dt, { ...entrada });
  for (const k of Object.keys(entrada)) entrada[k] = false;
  const hayAlarma = problemas().length > 0;
  for (const p of paseantes) p.actualizar(dt, hayAlarma);
  boletero.actualizar(dt);
  vendedora.actualizar(dt);
  actualizarCola(dt);
  actualizarPartido(dt);
  if (hayAlarma && Math.random() < dt * 0.3) operadora.mostrar("!", 1.2);

  c.drawImage(fondo, 0, 0);
  pintarCielo();
  pintarPublico();
  pintarPartido();
  pintarHaces();
  pintarPenumbra();
  pintarCelulares();
  pintarLED();
  pintarGigante();
  pintarReflectores();
  pintarTVs();
  pintarAnillo();
  pintarSubsuelo(dt);
  for (const h of [...pasando, ...cola].reverse()) h.pintar(c);
  for (const p of paseantes) p.pintar(c);
  pintarFrenteAnillo();
  pintarTiendaSinLuz();
  pintarTerminales();
  pintarBalizas();
  for (const p of conVoz) if (p.dicho) globo(p.dicho, p.x, p.piso - 30);
  pintarHUD();

  const z = dialogo.abierto ? null : zonaEn(raton.x, raton.y);
  pantalla.style.cursor = z ? "pointer" : "default";
  pintarEtiquetas(z);
  dialogo.pintar(c);
  pintarControles();
  if (silencio) texto(c, "SIN SONIDO", ANCHO - 66, 70, SUAVE);

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

window.estadio = { get estado() { return e; } };
sondear();
pantalla.focus();
requestAnimationFrame(cuadro);
