// Bucle principal: une escena, personas, luces, HUD y el diálogo de reserva.
import { anchoTexto, partir, texto, textoCentrado } from "./fuente.js";
import { ALTO, ANCHO, P, lienzo, pantallaAGrid, planoX, planoY, enPlanoX, enPlanoY, spriteLuz } from "./pixel.js";
import { APLIQUES_DER, APLIQUES_IZQ, COLOR, PUERTA, construirEscena, escribir, mascaraEdificio, pintarVentanasEnBlanco } from "./escena.js";
import { LOOKS, Persona, pintarEmote, buscarRuta } from "./personajes.js";
import { Mundo } from "./vida.js";
import { Sondeo, atencion, entrarAlLobby, estadoInicial, ordenar, reservar } from "./estado.js";
import { Dialogo, dinero } from "./dialogo.js";
import { pintarAyudaControles, pintarHUD } from "./hud.js";
import { activarAudio, alternarSilencio, silencio, sonido } from "./audio.js";

const pantalla = document.getElementById("pantalla");
const salida = pantalla.getContext("2d");
const [buffer, c] = lienzo();
const [mapaLuz, cl] = lienzo();
const mascara = mascaraEdificio();

const escena = construirEscena();
const mundo = new Mundo(escena);
const dialogo = new Dialogo();
const jugador = new Persona(LOOKS.jugador, 6.5, 8.5);
jugador.vel = 3.4;
jugador.mirando = "NE";

let d = estadoInicial();
mundo.d = d;
let conocido = false;
let reloj = 0;
const estado = { resultado: { ok: 0, mal: 0 }, bitacora: [] };

// Parpadeo de las luces al caer o volver la energía
let luz = 1;
let tParpadeo = 0;
let tRafaga = 0;

const ROJO = "#f25555";
const VERDE = "#6fe085";
const AMBAR = "#f0b429";

function registrar(texto1, color) {
  const hora = new Date().toTimeString().slice(0, 5);
  estado.bitacora.push({ hora, texto: texto1, color });
  if (estado.bitacora.length > 20) estado.bitacora.shift();
}

// ---------------------------------------------------------------- reacción a cambios del estado

function alCambiarEstado(n) {
  const a = d;
  d = n;
  mundo.d = n;
  if (!conocido) {
    conocido = true;
    mundo.sembrar(n.promo ? 12 : 8);
    if (n.corte) {
      luz = 0;
      mundo.entrarEnApagon();
      registrar("Hotel sin energía", ROJO);
    } else {
      registrar("Abrimos el lobby", VERDE);
    }
    if (n.elevadorFalla) mundo.traerTecnico(0.5, "elevador");
    return;
  }
  if (!a.corte && n.corte) {
    tParpadeo = 0.9;
    sonido.apagon();
    mundo.entrarEnApagon();
    registrar("Cayó la red eléctrica", ROJO);
  }
  if (a.corte && !n.corte) {
    tParpadeo = 0.9;
    sonido.vuelveLuz();
    mundo.salirDeApagon();
    registrar("Volvió la energía", VERDE);
  }
  if (!a.ups && n.ups) { sonido.alerta(); registrar("Luces de emergencia: UPS", AMBAR); }
  if (a.gen !== 1 && n.gen === 1) { sonido.arranque(); registrar("Intento de generador", AMBAR); }
  if (a.gen !== 3 && n.gen === 3) { sonido.error(); registrar("El generador falló", ROJO); }
  if (a.chiller && !n.chiller) registrar("Se apagó el aire", ROJO);
  if (a.elev[1] && !n.elev[1]) { sonido.error(); registrar("Elevador 2 detenido", ROJO); }
  if (a.elev[2] && !n.elev[2]) { sonido.error(); registrar("Elevador 3 detenido", ROJO); }
  if (a.wifi && !n.wifi) { sonido.error(); registrar("Se cayó el Wi-Fi", ROJO); }
  if (!a.elevadorFalla && n.elevadorFalla) {
    sonido.error();
    registrar("Falla el elevador 1", ROJO);
    if (!mundo.tecnico) mundo.traerTecnico(0.5, "elevador");
  }
  if (a.elevadorFalla && !n.elevadorFalla) registrar("Elevador 1 reparado", VERDE);
  if (a.modo !== n.modo) {
    if (n.pagosMal) { sonido.alerta(); registrar("Falla la pasarela de pagos", ROJO); }
    else if (n.pagosLentos) { sonido.alerta(); registrar("Pagos muy lentos", AMBAR); }
    else if (n.promo) registrar("Empieza la promoción", VERDE);
    else registrar("Pagos normales", VERDE);
  }
  if (a.web !== n.web) {
    if (n.web) registrar("Reservas de vuelta", VERDE);
    else { sonido.error(); registrar("Reservas sin respuesta", ROJO); }
  }
  if (!a.gcp && n.gcp) { sonido.alerta(); registrar("BigQuery dispara el gasto", ROJO); }
  if (!a.aws && n.aws) { sonido.alerta(); registrar("EC2 dispara el gasto", ROJO); }
  if ((a.gcp || a.aws) && !n.gcp && !n.aws) registrar("La nube vuelve a lo normal", VERDE);
}

// ---------------------------------------------------------------- reserva

// Un clic, una reserva real y un solo cartel con el resultado. Usa la habitación y las noches más comunes.
const RESERVA = { tipo: "estandar", noches: 1 };

function* guionRecepcion() {
  const R = "Recepción";
  const aviso = atencion(d);
  if (!aviso.puede) {
    sonido.error();
    yield* dialogo.decir(aviso.razon, R);
    return;
  }
  mundo.recep2.mostrar("…", 8);
  const r = yield* dialogo.esperarPromesa(reservar(RESERVA.tipo, RESERVA.noches), "Procesando el pago", R);
  mundo.recep2.emote = null;
  if (r.ok) {
    estado.resultado.ok++;
    sonido.exito();
    jugador.mostrar("llave", 3);
    registrar(`Reservaste: ${r.codigo}`, VERDE);
    const noches = `${r.noches} ${r.noches === 1 ? "noche" : "noches"}`;
    yield* dialogo.decir(`¡Reserva confirmada! Código ${r.codigo}\n${r.habitacion}, ${noches}: ${dinero(r.monto)} MXN`, R);
    return;
  }
  estado.resultado.mal++;
  sonido.error();
  jugador.mostrar("ira", 2.5);
  registrar(r.motivo === "pago" ? "Tu pago falló" : "Tu reserva falló", ROJO);
  yield* dialogo.decir(`No es posible reservar. ${r.mensaje}`, R);
}

function hablarConRecepcion() {
  jugador.mirando = "NE";
  dialogo.abrir(guionRecepcion());
}

let hablarAlLlegar = false;

function caminarAlMostrador() {
  const r = buscarRuta(escena.bloqueo, jugador.tx, jugador.ty, 7, 3);
  if (!r) return;
  jugador.ruta = r;
  hablarAlLlegar = true;
}

// ---------------------------------------------------------------- entrada

const pulsadas = new Set();
const entrada = {};
let raton = { x: -1, y: -1 };

function gesto() {
  activarAudio();
}

// Teclas de la barra de controles. La 9 (web caída) solo existe en ensayo: en la demo real no se apaga hotel-web.
const ORDENES = { 1: "pagos-error", 2: "pagos-lentos", 3: "promo", 4: "normal", 5: "corte", 6: "elevador", 7: "gcp", 8: "aws", 9: "web", 0: "reset" };

window.addEventListener("keydown", (e) => {
  gesto();
  const k = e.key;
  if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " "].includes(k)) e.preventDefault();
  pulsadas.add(k);
  if (!e.repeat) {
    if (k === "Enter" || k === " " || k === "z") entrada.a = true;
    if (k === "Escape" || k === "x") entrada.b = true;
    if (k === "m") alternarSilencio();
    if (d.controles && ORDENES[k] && (d.ensayo || k !== "9")) ordenar(ORDENES[k]);
  }
});
window.addEventListener("keyup", (e) => pulsadas.delete(e.key));

function aInterno(e) {
  const r = pantalla.getBoundingClientRect();
  return { x: ((e.clientX - r.left) / r.width) * ANCHO, y: ((e.clientY - r.top) / r.height) * ALTO };
}

pantalla.addEventListener("mousemove", (e) => {
  raton = aInterno(e);
});

function sobreMostrador(x, y) {
  const s = escena.mostrador.spr;
  const a = P(7.5, 2.5, 30);
  return (x >= s.x && x < s.x + s.w && y >= s.y && y < s.y + s.h && colorEnSprite(s, x, y)) || Math.hypot(x - a.x, y - a.y) < 14;
}

function colorEnSprite(s, x, y) {
  const datos = s.img.getContext("2d").getImageData(Math.floor(x - s.x), Math.floor(y - s.y), 1, 1).data;
  return datos[3] > 0;
}

pantalla.addEventListener("click", (e) => {
  gesto();
  pantalla.focus();
  const { x, y } = aInterno(e);
  if (dialogo.abierto) {
    entrada.a = true;
    return;
  }
  if (sobreMostrador(x, y)) {
    caminarAlMostrador();
    return;
  }
  const { gx, gy } = pantallaAGrid(x, y);
  const tx = Math.floor(gx);
  const ty = Math.floor(gy);
  const r = buscarRuta(escena.bloqueo, jugador.tx, jugador.ty, tx, ty);
  if (r) {
    jugador.ruta = r;
    hablarAlLlegar = false;
  }
});

function moverJugadorConTeclas() {
  if (jugador.ruta.length) return;
  const direccion = pulsadas.has("ArrowUp") || pulsadas.has("w") ? [0, -1]
    : pulsadas.has("ArrowDown") || pulsadas.has("s") ? [0, 1]
    : pulsadas.has("ArrowLeft") || pulsadas.has("a") ? [-1, 0]
    : pulsadas.has("ArrowRight") || pulsadas.has("d") ? [1, 0] : null;
  if (!direccion) return;
  hablarAlLlegar = false;
  const nx = jugador.tx + direccion[0];
  const ny = jugador.ty + direccion[1];
  jugador.mirarA(jugador.x + direccion[0], jugador.y + direccion[1]);
  if (ny >= 0 && nx >= 0 && ny < escena.bloqueo.length && nx < escena.bloqueo[0].length && !escena.bloqueo[ny][nx]) {
    jugador.ruta = [[nx + 0.5, ny + 0.5]];
  }
}

// ---------------------------------------------------------------- pintado de partes dinámicas

function pintarAscensor(a, blancos) {
  const g = a.g;
  const hayEnergia = a.func;
  // Interior
  planoY(c, 0, g, g + 1, 0, 44, hayEnergia ? "#d8c79a" : "#14121c");
  if (hayEnergia) planoY(c, 0, g + 0.2, g + 0.8, 8, 40, "#c0ae80");
  // Puertas corredizas
  const hoja = 0.5 * (1 - a.o);
  planoY(c, 0, g, g + hoja, 0, 44, COLOR.acero);
  planoY(c, 0, g + 1 - hoja, g + 1, 0, 44, COLOR.acero);
  if (hoja > 0.06) {
    planoY(c, 0, g, g + 0.06, 0, 44, COLOR.aceroClaro);
    planoY(c, 0, g + hoja - 0.04, g + hoja, 0, 44, COLOR.aceroOscuro);
    planoY(c, 0, g + 1 - hoja, g + 1 - hoja + 0.04, 0, 44, COLOR.aceroClaro);
  }
  // Indicador
  const punto = enPlanoY(0, g + 0.2);
  let cadena, color;
  if (hayEnergia) {
    cadena = String(a.piso).padStart(2, " ");
    color = "#ffb547";
  } else if (a.i === 0 && d.elevadorFalla) {
    cadena = "XX";
    color = "#ff5050";
  } else {
    cadena = "--";
    color = "#7a2a2a";
  }
  escribir(c, punto, cadena, 0, 59, color);
  blancos.push((k) => planoY(k, 0, g + 0.15, g + 0.85, 50, 60, "#fff"));
  // Cartel de fuera de servicio
  if (!hayEnergia) {
    planoY(c, 0, g + 0.2, g + 0.8, 18, 30, "#f4e04d");
    const puntoC = enPlanoY(0, g + 0.25);
    escribir(c, puntoC, "NO", 2, 28, "#1a1020");
  }
}

function pintarPuertaEntrada() {
  const { g0, g1 } = PUERTA;
  const hoja = (g1 - g0) / 2 * (1 - mundo.puertaAbierta);
  const vidrio = "#7f9fc4";
  planoX(c, 0, g0, g0 + hoja, 0, 52, vidrio);
  planoX(c, 0, g1 - hoja, g1, 0, 52, vidrio);
  if (hoja > 0.1) {
    planoX(c, 0, g0, g0 + 0.08, 0, 52, COLOR.oro);
    planoX(c, 0, g0 + hoja - 0.08, g0 + hoja, 0, 52, COLOR.oro);
    planoX(c, 0, g1 - hoja, g1 - hoja + 0.08, 0, 52, COLOR.oro);
    planoX(c, 0, g1 - 0.08, g1, 0, 52, COLOR.oro);
    planoX(c, 0, g0 + hoja * 0.4, g0 + hoja * 0.6, 0, 52, "#a6c0dd");
    planoX(c, 0, g1 - hoja * 0.6, g1 - hoja * 0.4, 0, 52, "#a6c0dd");
  }
}

function pintarTablero(blancos) {
  // Tablero eléctrico: leds de red, UPS y generador
  const leds = [
    { rot: "RED", col: d.corte ? "#ff4040" : "#46d160" },
    { rot: "UPS", col: d.ups ? "#f0b429" : d.corte ? "#ff4040" : "#46d160" },
    { rot: "GEN", col: d.gen === 3 ? (Math.floor(reloj * 3) % 2 ? "#ff4040" : "#551010") : d.gen === 1 ? "#f0b429" : "#46d160" },
  ];
  leds.forEach((l, i) => {
    const z = 46 - i * 10;
    const punto = enPlanoY(0, 2.0);
    escribir(c, punto, l.rot, 0, z, "#c7ccd4");
    planoY(c, 0, 2.5 + 0.28, 2.5 + 0.42, z - 5, z, l.col);
    blancos.push((k) => planoY(k, 0, 2.5 + 0.28, 2.5 + 0.42, z - 5, z, "#fff"));
  });
}

function pintarTermostato(blancos) {
  planoX(c, 0, 0.8, 1.9, 38, 46, "#0b1a12");
  const punto = enPlanoX(0, 1.86);
  const temp = `${Math.round(d.temp)}°`;
  const color = d.temp >= 26 ? "#ff5050" : d.temp >= 24.5 ? "#f0b429" : "#46d160";
  escribir(c, punto, temp, 1, 45, color);
  blancos.push((k) => planoX(k, 0, 0.8, 1.9, 38, 46, "#fff"));
}

function pintarWifi(blancos) {
  const p = P(9.9, 0, 60);
  c.fillStyle = "#e8e4d8";
  c.fillRect(p.x - 6, p.y - 3, 12, 5);
  c.fillStyle = "#b8b4a8";
  c.fillRect(p.x - 6, p.y + 2, 12, 1);
  const ok = d.wifi;
  c.fillStyle = ok ? "#46d160" : (Math.floor(reloj * 3) % 2 ? "#ff4040" : "#551010");
  c.fillRect(p.x - 1, p.y - 1, 2, 2);
  blancos.push((k) => { k.fillStyle = "#fff"; k.fillRect(p.x - 1, p.y - 1, 2, 2); });
  if (ok) {
    const fase = Math.floor(reloj * 3) % 3;
    c.fillStyle = "#7ad0ff";
    for (let i = 0; i <= fase; i++) {
      const r = 8 + i * 4;
      c.fillRect(p.x - r, p.y - 5 - i * 2, 2, 1);
      c.fillRect(p.x + r - 2, p.y - 5 - i * 2, 2, 1);
      c.fillRect(p.x - r + 2, p.y - 7 - i * 2, r * 2 - 4, 1);
    }
    blancos.push((k) => { k.fillStyle = "#fff"; k.fillRect(p.x - 18, p.y - 14, 36, 10); });
  }
}

function pintarAire() {
  // Rayitas de aire frío bajo la rejilla
  for (const q of mundo.particulas) {
    if (q.tipo !== "aire") continue;
    const base = P(0.2, q.gy, q.z);
    c.fillStyle = "#cdeaff";
    c.fillRect(base.x + q.x, base.y + q.y, 3, 1);
  }
}

function textoLed() {
  const a = atencion(d);
  if (d.corte && !d.ups) return ["", "#000"];
  if (!a.puede) return d.corte ? ["SIN CONEXIÓN", "#ff5050"] : ["NO DISPONIBLE", "#ff5050"];
  if (d.pagosMal) return ["PAGOS CON FALLA", Math.floor(reloj * 3) % 2 ? "#ff5050" : "#a02020"];
  if (d.pagosLentos) return ["PAGOS LENTOS", "#f0b429"];
  if (d.corte) return ["CON BATERÍA", "#f0b429"];
  return ["RESERVAS ABIERTAS", "#59ec74"];
}

function pintarExtrasMostrador(blancos) {
  // Letrero luminoso al frente del mostrador
  const [cadena, color] = textoLed();
  const gy = 3;
  planoY(c, gy, 3.3, 9.7, 4, 15, "#120e18");
  if (cadena) {
    const u0 = Math.round(((9.7 - 3.3) * 16 - anchoTexto(cadena)) / 2);
    escribir(c, enPlanoY(gy, 3.3), cadena, u0, 13, color);
    blancos.push((k) => planoY(k, gy, 3.3, 9.7, 4, 15, "#fff"));
  }
  // Terminales de pago, de cara al huésped
  for (const g of [4.2, 7.2]) {
    const p0 = P(g, 2.75, 21);
    c.fillStyle = "#23252e";
    c.fillRect(p0.x - 4, p0.y - 6, 11, 9);
    let col = "#46d160";
    if (d.corte && !d.ups) col = "#07080c";
    else if (!atencion(d).puede || d.pagosMal) col = Math.floor(reloj * 4) % 2 ? "#ff4040" : "#601414";
    else if (d.pagosLentos) col = Math.floor(reloj * 2) % 2 ? "#f0b429" : "#6a4f12";
    c.fillStyle = col;
    c.fillRect(p0.x - 3, p0.y - 5, 9, 6);
    blancos.push((k) => { k.fillStyle = "#fff"; k.fillRect(p0.x - 3, p0.y - 5, 9, 6); });
  }
}

function pintarExit(blancos) {
  // Salida de emergencia, siempre encendida
  planoX(c, 0, 7.3, 8.7, 58, 66, "#0d2a14");
  escribir(c, enPlanoX(0, 8.62), "SALIDA", 1, 65, "#59ec74");
  blancos.push((k) => planoX(k, 0, 7.3, 8.7, 58, 66, "#fff"));
}

const LUCES_EMERGENCIA = [[6, 0, 69], [10.3, 0, 66], [0, 3.8, 66], [0, 10.6, 66]];

function pintarEmergencia(blancos) {
  if (!d.ups) return;
  const parpadea = Math.random() < 0.02;
  for (const [gx, gy, z] of LUCES_EMERGENCIA) {
    const p = P(gx, gy, z);
    c.fillStyle = "#2d2f36";
    c.fillRect(p.x - 7, p.y - 2, 14, 5);
    c.fillStyle = parpadea ? "#a06a10" : "#ffc865";
    c.fillRect(p.x - 6, p.y - 1, 3, 3);
    c.fillRect(p.x + 3, p.y - 1, 3, 3);
    blancos.push((k) => { k.fillStyle = "#fff"; k.fillRect(p.x - 6, p.y - 1, 12, 3); });
  }
}

function pintarGente(blancos) {
  const dinamicos = [...mundo.gente, mundo.recep1, mundo.recep2, mundo.pianista, mundo.analista, jugador];
  if (mundo.tecnico) dinamicos.push(mundo.tecnico);
  if (mundo.gerente) dinamicos.push(mundo.gerente);

  // Cada persona entra después del último mueble que tiene por detrás
  const objetos = escena.objetos;
  const ranuras = objetos.map(() => []);
  const alInicio = [];
  for (const p of dinamicos) {
    if (p.oculto) continue;
    let ultimo = -1;
    for (let i = 0; i < objetos.length; i++) if (p.delanteDe(objetos[i])) ultimo = i;
    (ultimo < 0 ? alInicio : ranuras[ultimo]).push(p);
  }
  const porProfundidad = (a, b) => a.x + a.y - (b.x + b.y);
  const pintarUno = (p) => {
    p.pintar(c);
    if (p.factura) pintarFactura(p);
  };
  alInicio.sort(porProfundidad).forEach(pintarUno);
  objetos.forEach((o, i) => {
    c.drawImage(o.spr.img, o.spr.x, o.spr.y);
    if (o.esMostrador) pintarExtrasMostrador(blancos);
    ranuras[i].sort(porProfundidad).forEach(pintarUno);
  });
}

function pintarFactura(p) {
  // La factura kilométrica de la gerente
  const pos = P(p.x, p.y);
  const lado = p.mirando === "SE" || p.mirando === "NE" ? 1 : -1;
  c.fillStyle = "#f7f3e6";
  const x = pos.x + lado * 8;
  c.fillRect(lado > 0 ? x : x - 6, pos.y - 18, 6, 18);
  c.fillRect(lado > 0 ? x + 2 : x - 8, pos.y, 6, 2);
  c.fillStyle = "#b5473c";
  for (let i = 0; i < 5; i++) c.fillRect(lado > 0 ? x + 1 : x - 5, pos.y - 16 + i * 3, 4, 1);
}

function pintarGlobos() {
  for (const p of [...mundo.gente, mundo.recep1, mundo.recep2, mundo.pianista, mundo.analista, jugador, mundo.tecnico, mundo.gerente]) {
    if (!p) continue;
    pintarEmote(c, p);
  }
  for (const p of [...mundo.gente, mundo.recep1, mundo.recep2, mundo.analista, mundo.tecnico, mundo.gerente]) {
    if (p && p.dicho && !p.oculto) pintarDicho(p);
  }
  for (const g of mundo.gritos) {
    const pos = P(g.a.g + 0.5, 0, 46);
    globoTexto(g.texto, pos.x, pos.y);
  }
}

function pintarDicho(p) {
  const pos = P(p.x, p.y, p.z);
  globoTexto(p.dicho, pos.x, pos.y - 28);
}

function globoTexto(cadena, x, y) {
  const lineas = partir(cadena, 26);
  const ancho = Math.max(...lineas.map((l) => anchoTexto(l))) + 8;
  const alto = lineas.length * 10 + 5;
  const bx = Math.max(2, Math.min(ANCHO - ancho - 2, Math.round(x - ancho / 2)));
  const by = Math.max(16, y - alto - 3);
  c.fillStyle = "#171020";
  c.fillRect(bx - 1, by, ancho + 2, alto);
  c.fillRect(bx, by - 1, ancho, alto + 2);
  c.fillStyle = "#fbf7ea";
  c.fillRect(bx, by, ancho, alto);
  const px = Math.max(bx + 2, Math.min(bx + ancho - 6, x - 2));
  c.fillStyle = "#171020";
  c.fillRect(px, by + alto + 1, 5, 1);
  c.fillRect(px + 1, by + alto + 2, 3, 1);
  c.fillStyle = "#fbf7ea";
  c.fillRect(px + 1, by + alto, 3, 1);
  lineas.forEach((l, i) => texto(c, l, bx + 4, by + 3 + i * 10, "#171020"));
}

function pintarParticulasFinales() {
  const destino = { x: 494, y: 44 };
  for (const q of mundo.particulas) {
    if (q.tipo === "nota") {
      const b = P(q.gx, q.gy, q.z);
      texto(c, "♪", b.x + q.x, b.y + q.y, "#f2c75c");
    } else if (q.tipo === "moneda") {
      const b = P(q.gx, q.gy, q.z);
      const t = q.t / q.vida;
      const x = b.x + (destino.x - b.x) * t + Math.sin(t * 7 + q.vida) * 4;
      const y = b.y + (destino.y - b.y) * t - Math.sin(t * Math.PI) * 26;
      const gira = Math.floor(q.t * 10) % 2;
      c.fillStyle = "#6a4a10";
      c.fillRect(x - 3 + gira, y - 3, 7 - 2 * gira, 7);
      c.fillStyle = gira ? "#d9a441" : "#ffd84d";
      c.fillRect(x - 2 + gira, y - 2, 5 - 2 * gira, 5);
    }
  }
}

// ---------------------------------------------------------------- luces

function agregarLuz(color, radio, x, y, intensidad = 1) {
  cl.globalAlpha = Math.max(0, Math.min(1, intensidad));
  const s = spriteLuz(color, radio);
  cl.drawImage(s, Math.round(x - s.width / 2), Math.round(y - s.height / 2));
  cl.globalAlpha = 1;
}

function pintarLuces(dt, blancos) {
  // Nivel de luz, con parpadeo en las transiciones y ráfagas al probar el generador
  const objetivo = d.corte ? 0 : 1;
  if (tParpadeo > 0) {
    tParpadeo -= dt;
    luz = Math.random() < 0.5 ? 0.15 : 0.9;
    if (tParpadeo <= 0) luz = objetivo;
  } else {
    luz += (objetivo - luz) * Math.min(1, dt * 6);
  }
  let nivel = luz;
  if (d.gen === 1 && d.corte) {
    tRafaga -= dt;
    if (tRafaga <= 0) tRafaga = 0.7 + Math.random();
    if (tRafaga < 0.14) nivel = 0.45;
  }

  const oscuro = d.ups ? [40, 34, 66] : [20, 22, 48];
  const claro = [232, 224, 214];
  const amb = claro.map((v, i) => Math.round(oscuro[i] + (v - oscuro[i]) * nivel));
  cl.globalCompositeOperation = "source-over";
  cl.fillStyle = `rgb(${amb[0]},${amb[1]},${amb[2]})`;
  cl.fillRect(0, 0, ANCHO, ALTO);

  cl.globalCompositeOperation = "lighter";
  if (nivel > 0.02) {
    const calido = [90, 72, 46];
    for (const g of APLIQUES_DER) {
      const p = P(g, 0, 46);
      agregarLuz(calido, 62, p.x, p.y + 10, nivel);
    }
    for (const g of APLIQUES_IZQ) {
      const p = P(0, g, 46);
      agregarLuz(calido, 62, p.x, p.y + 10, nivel);
    }
    for (const [gx, gy] of [[5.5, 12.5], [9.5, 9.5]]) {
      const p = P(gx, gy, 20);
      agregarLuz([104, 84, 50], 78, p.x, p.y, nivel);
    }
    const centro = P(6.5, 6, 0);
    agregarLuz([60, 52, 36], 150, centro.x, centro.y, nivel);
  }
  // Luna por las ventanas
  for (const [gy, r] of [[3.5, 70], [5.6, 70], [11, 80]]) {
    const p = P(1.6, gy);
    agregarLuz([34, 42, 92], r, p.x, p.y);
  }
  if (d.ups) {
    const pulso = 0.85 + Math.sin(reloj * 3) * 0.1;
    for (const [gx, gy, z] of LUCES_EMERGENCIA) {
      const p = P(gx, gy, z);
      agregarLuz([116, 66, 26], 96, p.x, p.y + 38, pulso);
    }
  }
  // Salida en verde, terminal del mostrador y ascensor 1 con su circuito propio
  const salidaP = P(0, 8, 62);
  agregarLuz([12, 66, 26], 50, salidaP.x, salidaP.y + 14);
  if (d.corte) {
    for (const a of mundo.ascensores) {
      if (!a.func) continue;
      const p = P(a.g + 0.5, 0, 24);
      agregarLuz([100, 88, 60], 46, p.x, p.y + 10);
    }
  }
  // Linternas y pantallas de teléfono
  const conLuz = [...mundo.gente, mundo.recep1, mundo.recep2, jugador];
  if (mundo.tecnico) conLuz.push(mundo.tecnico);
  for (const p of conLuz) {
    if (p.oculto || !p.linterna) continue;
    const pos = P(p.x, p.y);
    agregarLuz([120, 112, 84], 34, pos.x, pos.y - 2);
  }
  // Pantalla de la laptop
  if (!d.corte || d.ups) {
    const lap = P(14, 6.1, 18);
    agregarLuz(d.gcp || d.aws ? [110, 30, 30] : [30, 54, 80], 36, lap.x, lap.y);
  }

  cl.globalCompositeOperation = "source-over";
  blancos.forEach((f) => f(cl));
  pintarVentanasEnBlanco(cl);
  // Fuera del edificio no se oscurece
  cl.globalCompositeOperation = "destination-in";
  cl.drawImage(mascara, 0, 0);
  cl.globalCompositeOperation = "destination-over";
  cl.fillStyle = "#fff";
  cl.fillRect(0, 0, ANCHO, ALTO);
  cl.globalCompositeOperation = "source-over";
}

// ---------------------------------------------------------------- marcador sobre el mostrador

function pintarIndicador() {
  if (dialogo.abierto) return;
  const a = atencion(d);
  const p = P(7.5, 2.5, 46);
  const bote = Math.round(Math.sin(reloj * 4) * 2);
  const cerca = sobreMostrador(raton.x, raton.y);
  const etiqueta = a.puede ? (cerca ? "¡Clic para reservar!" : "RESERVAR") : "SIN SERVICIO";
  const color = a.puede ? "#fff27a" : "#ff8080";
  const w = anchoTexto(etiqueta) + 8;
  c.fillStyle = "rgba(10,10,28,0.9)";
  c.fillRect(p.x - w / 2, p.y - 16 + bote, w, 11);
  textoCentrado(c, etiqueta, p.x, p.y - 14 + bote, color);
  texto(c, "▼", p.x - 2, p.y - 4 + bote, color);
}

// ---------------------------------------------------------------- cuadro

let previo = performance.now();

function cuadro(ahora) {
  const dt = Math.min(0.05, (ahora - previo) / 1000);
  previo = ahora;
  reloj += dt;

  if (!dialogo.abierto) moverJugadorConTeclas();
  mundo.actualizar(dt, d, jugador);
  if (hablarAlLlegar && !jugador.ruta.length && jugador.tx === 7 && jugador.ty === 3) {
    hablarAlLlegar = false;
    hablarConRecepcion();
  } else if (!dialogo.abierto && entrada.a && jugador.ty === 3 && jugador.tx >= 3 && jugador.tx < 10) {
    entrada.a = false;
    hablarConRecepcion();
  }
  dialogo.actualizar(dt, { ...entrada });
  for (const k of Object.keys(entrada)) entrada[k] = false;

  pantalla.style.cursor = !dialogo.abierto && sobreMostrador(raton.x, raton.y) ? "pointer" : "default";

  const blancos = [];
  c.drawImage(escena.plancha, 0, 0);
  mundo.ascensores.forEach((a) => pintarAscensor(a, blancos));
  pintarPuertaEntrada();
  pintarTablero(blancos);
  pintarTermostato(blancos);
  pintarWifi(blancos);
  pintarExit(blancos);
  pintarEmergencia(blancos);
  pintarAire();
  pintarGente(blancos);
  pintarLuces(dt, blancos);
  c.globalCompositeOperation = "multiply";
  c.drawImage(mapaLuz, 0, 0);
  c.globalCompositeOperation = "source-over";

  pintarParticulasFinales();
  pintarGlobos();
  pintarIndicador();
  pintarHUD(c, d, mundo, reloj, estado, dialogo.abierto);
  dialogo.pintar(c);
  if (silencio) texto(c, "SIN SONIDO", ANCHO - 70, 18 + 66 + 3, "#aab1cf");
  if (d.controles && !dialogo.abierto) pintarAyudaControles(c, 350, d.ensayo);

  salida.imageSmoothingEnabled = false;
  salida.drawImage(buffer, 0, 0, pantalla.width, pantalla.height);
  requestAnimationFrame(cuadro);
}

// Se dibuja en un múltiplo entero y el navegador lo ajusta al tamaño final: los píxeles quedan todos iguales
function ajustar() {
  const dpr = window.devicePixelRatio || 1;
  const escalaCss = Math.min(window.innerWidth / ANCHO, window.innerHeight / ALTO);
  const k = Math.max(1, Math.ceil(escalaCss * dpr));
  pantalla.width = ANCHO * k;
  pantalla.height = ALTO * k;
  pantalla.style.width = `${Math.floor(ANCHO * escalaCss)}px`;
  pantalla.style.height = `${Math.floor(ALTO * escalaCss)}px`;
}
window.addEventListener("resize", ajustar);
ajustar();

// Sirve para la consola del navegador durante los ensayos
window.hotel = { mundo, jugador, dialogo, get d() { return d; } };

entrarAlLobby();
new Sondeo(alCambiarEstado).iniciar();
pantalla.focus();
requestAnimationFrame(cuadro);
