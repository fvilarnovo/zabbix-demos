// Fuente de mapa de bits 5x7, con acentos del español. La escena no depende de internet ni de fuentes externas.
// Cada glifo son 5 columnas; el bit 0 es la fila de arriba y el bit 7 la de los descendentes.

const ASCII = ("00000000000000 00005F0000 0007000700 147F147F14 242A7F2A12 2313086462 3649562050 0008070300 " +
  "001C224100 0041221C00 2A1C7F1C2A 08083E0808 0080703000 0808080808 0000606000 2010080402 " +
  "3E5149453E 00427F4000 7249494946 2141494D33 1814127F10 2745454539 3C4A494931 4121110907 " +
  "3649494936 464949291E 0000140000 0040340000 0008142241 1414141414 0041221408 0201590906 " +
  "3E415D594E 7C1211127C 7F49494936 3E41414122 7F4141413E 7F49494941 7F09090901 3E41415173 " +
  "7F0808087F 00417F4100 2040413F01 7F08142241 7F40404040 7F021C027F 7F0408107F 3E4141413E " +
  "7F09090906 3E4151215E 7F09192946 2649494932 03017F0103 3F4040403F 1F2040201F 3F4038403F " +
  "6314081463 0304780403 6159494D43 007F414100 0204081020 0041417F00 0402010204 4040404040 " +
  "0003070800 2054547840 7F28444438 3844444428 384444287F 3854545418 00087E0902 18A4A49C78 " +
  "7F08040478 00447D4000 2040403D00 7F10284400 00417F4000 7C04780478 7C08040478 3844444438 " +
  "FC18242418 18242418FC 7C08040408 4854545424 04043F4424 3C4040207C 1C2040201C 3C4030403C " +
  "4428102844 4C9090907C 4464544C44").split(" ").map((h) => [0, 2, 4, 6, 8].map((i) => parseInt(h.slice(i, i + 2), 16)));

const GLIFOS = new Map();
ASCII.forEach((cols, i) => GLIFOS.set(String.fromCharCode(32 + i), cols));
GLIFOS.set(" ", [0, 0, 0, 0, 0]);

// Vuelve un glifo de cabeza: sirve para ¿ y ¡
const invertir = (cols) => cols.slice().reverse().map((c) => {
  let r = 0;
  for (let b = 0; b < 7; b++) if (c & (1 << b)) r |= 1 << (6 - b);
  return r;
});

GLIFOS.set("¿", invertir(GLIFOS.get("?")));
GLIFOS.set("¡", invertir(GLIFOS.get("!")));
GLIFOS.set("°", [0x06, 0x09, 0x09, 0x06, 0]);
GLIFOS.set("·", [0, 0, 0x08, 0, 0]);
GLIFOS.set("▶", [0x7f, 0x3e, 0x1c, 0x08, 0]);
GLIFOS.set("◀", [0, 0x08, 0x1c, 0x3e, 0x7f]);
GLIFOS.set("▼", [0x01, 0x03, 0x07, 0x03, 0x01]);
GLIFOS.set("●", [0x1c, 0x3e, 0x3e, 0x3e, 0x1c]);
GLIFOS.set("♥", [0x0e, 0x1f, 0x3e, 0x1f, 0x0e]);
GLIFOS.set("♪", [0x60, 0x60, 0x3f, 0x02, 0x04]);
GLIFOS.set("²", [0x09, 0x0d, 0x0b, 0, 0]);
GLIFOS.set("×", [0x22, 0x14, 0x08, 0x14, 0x22]);

// Marcas de los acentos: [columna, fila]. Las mayúsculas usan filas negativas, por encima de la letra.
const AGUDO = [[3, 0], [2, 1]];
const AGUDO_MAY = [[3, -2], [2, -1]];
const TILDE = [[1, 1], [2, 0], [3, 1], [4, 0]];
const TILDE_MAY = [[1, -1], [2, -2], [3, -1], [4, -2]];
const DIERESIS = [[1, 0], [3, 0]];
const ACENTOS = {
  á: ["a", AGUDO], é: ["e", AGUDO], í: ["ı", AGUDO], ó: ["o", AGUDO], ú: ["u", AGUDO], ñ: ["n", TILDE], ü: ["u", DIERESIS],
  Á: ["A", AGUDO_MAY], É: ["E", AGUDO_MAY], Í: ["I", AGUDO_MAY], Ó: ["O", AGUDO_MAY], Ú: ["U", AGUDO_MAY], Ñ: ["N", TILDE_MAY],
};
GLIFOS.set("ı", [0, 0x44, 0x7c, 0x40, 0]);

export const ANCHO_LETRA = 6;

// Devuelve los píxeles de un texto como [x, y]; y=0 es la parte de arriba de la mayúscula.
export function pixelesTexto(texto) {
  const pixeles = [];
  [...texto].forEach((letra, i) => {
    const acento = ACENTOS[letra];
    const cols = GLIFOS.get(acento ? acento[0] : letra) || GLIFOS.get("?");
    const x0 = i * ANCHO_LETRA;
    cols.forEach((col, x) => {
      for (let y = 0; y < 8; y++) if (col & (1 << y)) pixeles.push([x0 + x, y]);
    });
    if (acento) acento[1].forEach(([x, y]) => pixeles.push([x0 + x, y]));
  });
  return pixeles;
}

export const anchoTexto = (texto, escala = 1) => [...texto].length * ANCHO_LETRA * escala;

const cache = new Map();

function lineaEnCache(texto, color, escala) {
  const clave = `${color}|${escala}|${texto}`;
  let lienzo = cache.get(clave);
  if (lienzo) return lienzo;
  if (cache.size > 800) cache.clear();
  lienzo = document.createElement("canvas");
  lienzo.width = Math.max(1, anchoTexto(texto, escala));
  lienzo.height = 11 * escala;
  const c = lienzo.getContext("2d");
  c.fillStyle = color;
  for (const [x, y] of pixelesTexto(texto)) c.fillRect(x * escala, (y + 2) * escala, escala, escala);
  cache.set(clave, lienzo);
  return lienzo;
}

export function texto(c, cadena, x, y, color = "#fff", escala = 1) {
  c.drawImage(lineaEnCache(cadena, color, escala), Math.round(x), Math.round(y) - 2 * escala);
}

export function textoCentrado(c, cadena, x, y, color = "#fff", escala = 1) {
  texto(c, cadena, x - anchoTexto(cadena, escala) / 2, y, color, escala);
}

// Corta un texto en líneas de hasta maxLetras caracteres, respetando palabras.
export function partir(cadena, maxLetras) {
  const lineas = [];
  for (const parrafo of cadena.split("\n")) {
    let linea = "";
    for (const palabra of parrafo.split(" ")) {
      if ((linea + " " + palabra).trim().length > maxLetras) {
        if (linea) lineas.push(linea);
        linea = palabra;
      } else {
        linea = (linea + " " + palabra).trim();
      }
    }
    lineas.push(linea);
  }
  return lineas;
}
