// Primitivas isométricas en píxeles. Todo se pinta por columnas para mantener la escalera 2:1 limpia.
//
// Coordenadas del mundo: gx crece hacia abajo a la derecha, gy hacia abajo a la izquierda, z hacia arriba (en píxeles).

export const ANCHO = 640;
export const ALTO = 360;
const TX = 16;
const TY = 8;
const OX = 288;
const OY = 100;

export const P = (gx, gy, z = 0) => ({
  x: Math.round(OX + (gx - gy) * TX),
  y: Math.round(OY + (gx + gy) * TY - z),
});

export function pantallaAGrid(x, y) {
  const a = (x - OX) / TX;
  const b = (y - OY) / TY;
  return { gx: (a + b) / 2, gy: (b - a) / 2 };
}

export function lienzo(ancho = ANCHO, alto = ALTO) {
  const l = document.createElement("canvas");
  l.width = ancho;
  l.height = alto;
  const c = l.getContext("2d", { willReadFrequently: false });
  c.imageSmoothingEnabled = false;
  return [l, c];
}

// Rectángulo en un plano de gy constante: corre de arriba-izquierda a abajo-derecha (pared derecha, cara izquierda de un mueble)
export function planoY(c, gy, g0, g1, z0, z1, color) {
  const a = P(g0, gy);
  const b = P(g1, gy);
  c.fillStyle = color;
  for (let x = a.x; x < b.x; x++) {
    const base = a.y + Math.floor((x - a.x) / 2);
    c.fillRect(x, base - z1, 1, z1 - z0);
  }
}

// Rectángulo en un plano de gx constante: corre de arriba-derecha a abajo-izquierda (pared izquierda, cara derecha de un mueble)
export function planoX(c, gx, g0, g1, z0, z1, color) {
  const a = P(gx, g1);
  const b = P(gx, g0);
  c.fillStyle = color;
  for (let x = a.x; x < b.x; x++) {
    const base = b.y + Math.floor((b.x - x) / 2);
    c.fillRect(x, base - z1, 1, z1 - z0);
  }
}

// Punto de un plano en píxeles: u columnas desde el inicio del plano, v píxeles sobre el piso.
export const enPlanoY = (gy, g0) => {
  const a = P(g0, gy);
  return (u, v) => [a.x + u, a.y + Math.floor(u / 2) - v];
};
// En este plano g0 es el extremo izquierdo en pantalla (el de mayor gy) y u avanza hacia la derecha, para leer bien el texto.
export const enPlanoX = (gx, g0) => {
  const a = P(gx, g0);
  return (u, v) => [a.x + u, a.y - Math.ceil(u / 2) - v];
};

// Rombo horizontal a la altura z
export function rombo(c, gx, gy, w, d, z, color) {
  const A = P(gx, gy, z);
  const B = P(gx + w, gy, z);
  const C = P(gx + w, gy + d, z);
  const D = P(gx, gy + d, z);
  c.fillStyle = color;
  for (let x = D.x; x < B.x; x++) {
    const arriba = x < A.x ? A.y + Math.floor((A.x - x) / 2) : A.y + Math.floor((x - A.x) / 2);
    const abajo = x < C.x ? D.y + Math.floor((x - D.x) / 2) : B.y + Math.floor((B.x - x) / 2);
    if (abajo >= arriba) c.fillRect(x, arriba, 1, abajo - arriba + 1);
  }
}

// Caja sólida. colores: { t: tapa, l: cara izquierda, r: cara derecha, b: brillo del borde superior (opcional) }
export function caja(c, gx, gy, w, d, z, h, colores) {
  planoY(c, gy + d, gx, gx + w, z, z + h, colores.l);
  planoX(c, gx + w, gy, gy + d, z, z + h, colores.r);
  rombo(c, gx, gy, w, d, z + h, colores.t);
  if (colores.b) {
    planoY(c, gy + d, gx, gx + w, z + h - 1, z + h, colores.b);
    planoX(c, gx + w, gy, gy + d, z + h - 1, z + h, colores.b);
  }
}

// Paleta de una caja a partir de un color base, con la luz que viene de la izquierda
export function tonos(hex, brillo = true) {
  const t = aclarar(hex, 0.16);
  return { t, l: hex, r: aclarar(hex, -0.2), b: brillo ? aclarar(hex, 0.34) : undefined };
}

export function aclarar(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const ajuste = (v) => Math.max(0, Math.min(255, Math.round(f >= 0 ? v + (255 - v) * f : v * (1 + f))));
  const [r, g, b] = [ajuste(n >> 16), ajuste((n >> 8) & 255), ajuste(n & 255)];
  return "#" + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
}

// Pequeño generador con semilla: los detalles (vetas, hojas, edificios) salen iguales en cada carga
export function azar(semilla) {
  let s = semilla >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

export const BAYER = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]];

// Recorta al tamaño justo y agrega contorno oscuro de 1 px
export function recortar(lienzoFuente, contorno) {
  const c = lienzoFuente.getContext("2d");
  const { width: w, height: h } = lienzoFuente;
  const datos = c.getImageData(0, 0, w, h).data;
  const opaco = (x, y) => x >= 0 && y >= 0 && x < w && y < h && datos[(y * w + x) * 4 + 3] > 128;
  let x0 = w, y0 = h, x1 = 0, y1 = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (opaco(x, y)) {
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  if (x1 < x0) return { img: lienzo(1, 1)[0], x: 0, y: 0, w: 1, h: 1 };
  const m = contorno ? 1 : 0;
  const [l, s] = lienzo(x1 - x0 + 1 + 2 * m, y1 - y0 + 1 + 2 * m);
  if (contorno) {
    s.fillStyle = contorno;
    for (let y = y0 - 1; y <= y1 + 1; y++) for (let x = x0 - 1; x <= x1 + 1; x++) {
      if (!opaco(x, y) && (opaco(x - 1, y) || opaco(x + 1, y) || opaco(x, y - 1) || opaco(x, y + 1))) {
        s.fillRect(x - x0 + m, y - y0 + m, 1, 1);
      }
    }
  }
  s.drawImage(lienzoFuente, x0, y0, x1 - x0 + 1, y1 - y0 + 1, m, m, x1 - x0 + 1, y1 - y0 + 1);
  return { img: l, x: x0 - m, y: y0 - m, w: l.width, h: l.height };
}

const [tablero, cTablero] = lienzo();

// Pinta en un lienzo de trabajo y devuelve un sprite recortado, ya ubicado en la pantalla
export function sprite(pintar, contorno = "#1a1020") {
  cTablero.clearRect(0, 0, ANCHO, ALTO);
  pintar(cTablero);
  return recortar(tablero, contorno);
}

const lucesCache = new Map();

// Luz circular aplastada 2:1, con bandas tramadas al estilo de los juegos de 8 bits
export function spriteLuz(color, radio) {
  const clave = `${color}|${radio}`;
  if (lucesCache.has(clave)) return lucesCache.get(clave);
  const alto = Math.round(radio * 0.62);
  const [l, c] = lienzo(radio * 2, alto * 2);
  const img = c.createImageData(radio * 2, alto * 2);
  const [r, g, b] = color;
  const NIVELES = 5;
  for (let y = 0; y < alto * 2; y++) for (let x = 0; x < radio * 2; x++) {
    const d = Math.hypot((x - radio) / radio, (y - alto) / alto);
    if (d >= 1) continue;
    const i = Math.pow(1 - d, 1.15) * NIVELES + BAYER[y % 4][x % 4] / 16 - 0.5;
    const v = Math.max(0, Math.min(NIVELES, Math.round(i))) / NIVELES;
    const o = (y * radio * 2 + x) * 4;
    img.data[o] = r * v;
    img.data[o + 1] = g * v;
    img.data[o + 2] = b * v;
    img.data[o + 3] = 255;
  }
  c.putImageData(img, 0, 0);
  lucesCache.set(clave, l);
  return l;
}
