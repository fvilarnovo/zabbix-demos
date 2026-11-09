// Paneles de información en las esquinas: estado de sistemas, nube, ocupación y bitácora.
import { anchoTexto, partir, texto, textoCentrado } from "./fuente.js";
import { ANCHO } from "./pixel.js";

const VERDE = "#46d160";
const AMBAR = "#f0b429";
const ROJO = "#f25555";
const GRIS = "#7c84a8";
const BLANCO = "#f4f1e6";
const SUAVE = "#aab1cf";

function panel(c, x, y, w, h, titulo) {
  c.fillStyle = "rgba(8,10,28,0.86)";
  c.fillRect(x, y, w, h);
  c.fillStyle = "#3b4270";
  c.fillRect(x, y, w, 1);
  c.fillRect(x, y + h - 1, w, 1);
  c.fillRect(x, y, 1, h);
  c.fillRect(x + w - 1, y, 1, h);
  if (titulo) texto(c, titulo, x + 5, y + 4, "#f2c75c");
}

export function filasSistemas(d, m, t) {
  const destello = Math.floor(t * 2.5) % 2 === 0;
  const malo = destello ? ROJO : "#a03434";
  const ventas = !d.web ? ["CAÍDAS", malo]
    : d.pagosMal ? ["PAGOS FALLAN", malo]
    : d.pagosLentos ? ["PAGOS LENTOS", AMBAR]
    : d.promo ? ["PROMOCIÓN", VERDE]
    : ["OK", VERDE];
  const gen = d.gen === 3 ? ["FALLA", malo] : d.gen === 1 ? ["ARRANCANDO", AMBAR] : d.gen === 2 ? ["EN MARCHA", VERDE] : ["EN ESPERA", VERDE];
  const ascensoresOk = d.elev.filter(Boolean).length;
  return [
    ["VENTAS", ...ventas],
    ["LUZ", ...(d.corte ? ["CORTE", malo] : [`${Math.round(d.voltaje)} V`, VERDE])],
    ["UPS", ...(d.ups ? [`${Math.round(d.upsPct)}% ${Math.round(d.upsMin)} MIN`, AMBAR] : d.corte ? ["SIN CARGA", malo] : [`${Math.round(d.upsMin)} MIN`, VERDE])],
    ["GENER.", ...gen],
    ["AIRE", ...(d.chiller ? [`${d.temp.toFixed(1)}°C`, VERDE] : [`PARADO ${d.temp.toFixed(1)}°C`, malo])],
    ["ELEV.", ...(ascensoresOk === 3 ? ["3 DE 3", VERDE] : [`${ascensoresOk} DE 3`, malo])],
    ["WI-FI", ...(d.wifi ? [`${d.aps}/48 AP`, VERDE] : [`${d.aps}/48 AP`, malo])],
    ["NUBE", ...(d.gcp || d.aws ? [d.gcp ? "BIGQUERY" : "EC2 DR", malo] : ["NORMAL", VERDE])],
  ];
}

function panelSistemas(c, d, m, t) {
  const filas = filasSistemas(d, m, t);
  panel(c, 4, 18, 130, filas.length * 10 + 7);
  filas.forEach(([rot, val, col], i) => {
    const y = 22 + i * 10;
    texto(c, "●", 8, y, col);
    texto(c, rot, 16, y, SUAVE);
    texto(c, val, 58, y, col === "#a03434" ? ROJO : col);
  });
}

function nubePixel(c, x, y, color, sombra) {
  const f = (a, b, w, h, col = color) => { c.fillStyle = col; c.fillRect(x + a, y + b, w, h); };
  f(8, 6, 24, 12);
  f(4, 10, 32, 8);
  f(0, 12, 40, 6);
  f(10, 2, 12, 6);
  f(24, 4, 8, 4);
  f(0, 16, 40, 2, sombra);
  f(6, 18, 28, 1, sombra);
}

function panelNube(c, d, m, t) {
  const anomalia = d.gcp || d.aws;
  const x = 468, y = 18, w = 168, h = 72;
  panel(c, x, y, w, h, "LA NUBE DEL HOTEL");
  const bote = Math.round(Math.sin(t * 2) * 1);
  const vibra = anomalia && Math.floor(t * 12) % 2 ? 1 : 0;
  nubePixel(c, x + 8 + vibra, y + 15 + bote, anomalia ? "#e36a6a" : "#e9eef8", anomalia ? "#a13a3a" : "#a9b6cf");
  if (anomalia) {
    texto(c, "$", x + 16, y + 38 + (Math.floor(t * 6) % 3), "#f2c75c");
    texto(c, "$", x + 30, y + 39 + (Math.floor(t * 6 + 1) % 3), "#f2c75c");
  }
  const estado = !anomalia ? ["Gasto normal"] : d.gcp ? ["BigQuery:", "consulta sin", "límite"] : ["EC2: DR", "levantado"];
  estado.forEach((l, i) => texto(c, l, x + 56, y + 16 + i * 9, anomalia ? ROJO : VERDE));
  // Barra sin cifras: ilustra el gasto de hoy; los valores reales están en Hotel · Cloud Cost
  const bx = x + 8, by = y + 56, bw = w - 16;
  texto(c, "GASTO DE HOY", bx, by - 8 + 0, SUAVE);
  c.fillStyle = "#23284a";
  c.fillRect(bx, by + 2, bw, 8);
  c.fillStyle = m.gasto > 0.55 ? (Math.floor(t * 3) % 2 ? ROJO : "#c73e3e") : VERDE;
  c.fillRect(bx, by + 2, Math.round(bw * m.gasto), 8);
  c.fillStyle = "#f2c75c";
  c.fillRect(bx + Math.round(bw * 0.92), by, 1, 12);
}

function panelOcupacion(c, d, resultado) {
  const x = 4, y = 300, w = 170, h = 56;
  panel(c, x, y, w, h, "OCUPACIÓN");
  const hay = d.ocupadas !== null && d.ocupadas !== undefined;
  texto(c, hay ? `${d.ocupadas} de ${d.total} habitaciones` : "Sin dato del sistema", x + 5, y + 14, hay ? BLANCO : ROJO);
  c.fillStyle = "#23284a";
  c.fillRect(x + 5, y + 24, w - 10, 6);
  if (hay) {
    c.fillStyle = VERDE;
    c.fillRect(x + 5, y + 24, Math.round((w - 10) * d.ocupadas / d.total), 6);
  }
  texto(c, "TUS RESERVAS", x + 5, y + 35, SUAVE);
  texto(c, `${resultado.ok}`, x + 5, y + 45, VERDE);
  texto(c, "listas", x + 17, y + 45, SUAVE);
  texto(c, `${resultado.mal}`, x + 66, y + 45, resultado.mal ? ROJO : GRIS);
  texto(c, "fallidas", x + 78, y + 45, SUAVE);
}

function panelBitacora(c, bitacora) {
  const x = 460, y = 288, w = 176, h = 68;
  panel(c, x, y, w, h, "BITÁCORA");
  const lineas = [];
  for (const e of bitacora.slice(-5)) {
    const partes = partir(e.texto, 22);
    partes.forEach((p, i) => lineas.push([i === 0 ? e.hora : "", p, e.color]));
  }
  lineas.slice(-5).forEach(([hora, p, color], i) => {
    const ly = y + 14 + i * 10;
    if (hora) texto(c, hora, x + 5, ly, GRIS);
    texto(c, p, x + 39, ly, color || BLANCO);
  });
}

function barraSuperior(c, d, t, banner) {
  c.fillStyle = "rgba(8,10,28,0.92)";
  c.fillRect(0, 0, ANCHO, 14);
  c.fillStyle = "#d9a441";
  c.fillRect(0, 14, ANCHO, 1);
  texto(c, "HOTEL GRAN ZABBIX 8.0", 5, 4, "#f2c75c");
  const color = banner.grave ? (Math.floor(t * 2.5) % 2 ? ROJO : "#ffdddd") : banner.color || VERDE;
  textoCentrado(c, banner.texto, ANCHO / 2, 4, color);
  const ahora = new Date();
  const hora = ahora.toTimeString().slice(0, 8);
  texto(c, hora, ANCHO - anchoTexto(hora) - 5, 4, SUAVE);
}

export function textoBanner(d) {
  if (!d.conectado) return { texto: "SIN CONEXIÓN CON EL SERVIDOR DE LA ESCENA", grave: true };
  if (d.corte) {
    if (!d.ups) return { texto: "SIN ENERGÍA: TODO EL HOTEL A OSCURAS", grave: true };
    return { texto: `SIN RED ELÉCTRICA · LA UPS AGUANTA ${Math.round(d.upsMin)} MIN`, grave: true };
  }
  if (!d.web) return { texto: "EL SISTEMA DE RESERVAS NO RESPONDE", grave: true };
  if (d.pagosMal) return { texto: "EL SITIO RESPONDE, PERO NO SE VENDE: FALLA LA PASARELA DE PAGOS", grave: true };
  if (d.pagosLentos) return { texto: "LOS PAGOS VAN MUY LENTOS: SE FORMA FILA", color: AMBAR };
  if (d.elevadorFalla) return { texto: "ELEVADOR 1 FUERA DE SERVICIO", color: AMBAR };
  if (d.gcp || d.aws) return { texto: "EN EL LOBBY TODO VA BIEN... PERO LA FACTURA SUBE", color: AMBAR };
  if (d.promo) return { texto: "PROMOCIÓN ACTIVA: LOBBY LLENO", color: VERDE };
  return { texto: "TODO EN ORDEN", color: VERDE };
}

export function pintarHUD(c, d, m, t, estado, ocultarInferior) {
  barraSuperior(c, d, t, textoBanner(d));
  panelSistemas(c, d, m, t);
  panelNube(c, d, m, t);
  if (!ocultarInferior) {
    panelOcupacion(c, d, estado.resultado);
    panelBitacora(c, estado.bitacora);
  }
}

export function pintarAyudaControles(c, y, ensayo) {
  const ayuda = ensayo
    ? "ENSAYO  1 pagos-error  2 lentos  3 promo  4 normal  5 corte  6 elevador  7 gcp  8 aws  9 web  0 reset"
    : "DEMO REAL  1 pagos-error  2 lentos  3 promo  4 normal  5 corte  6 elevador  7 gcp  8 aws  0 reset";
  c.fillStyle = "rgba(90,20,110,0.9)";
  c.fillRect(0, y, ANCHO, 10);
  textoCentrado(c, ayuda, ANCHO / 2, y + 2, "#fff");
}

