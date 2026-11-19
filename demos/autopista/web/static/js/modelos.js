// Modelos low-poly de vehículos colombianos por categoría de peaje. Cada modelo tiene tres geometrías:
//   carroceria  se pinta con el color de cada instancia (vertex color blanco × instanceColor)
//   detalles    colores propios: vidrios, ruedas, rines, chasis y carga
//   luces       faros y stops (MeshBasic: brillan de noche o con el vehículo detenido)
// Todo mira hacia +z (adelante), con las ruedas apoyadas en y = 0. El largo coincide con el del simulador.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const NEUMATICO = 0x1b1c1e, RIN = 0xb9bec4, VIDRIO = 0x22303d, CHASIS = 0x2b2d31, FARO = 0xfff3cf, STOP = 0xff2b2b, GUIA = 0xffa200;

function colorear(g, color) {
  g = g.index ? g.toNonIndexed() : g;
  g.deleteAttribute('uv');
  const n = g.attributes.position.count, c = new Float32Array(n * 3), col = new THREE.Color(color);
  for (let i = 0; i < n; i++) col.toArray(c, i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return g;
}

function caja(color, w, h, l, x = 0, y = 0, z = 0) {
  const g = new THREE.BoxGeometry(w, h, l);
  g.translate(x, y + h / 2, z);
  return colorear(g, color);
}

// Silueta lateral [[z, y], ...] extruida a lo ancho (centrada en x), con bordes biselados.
function perfil(color, puntos, ancho, x = 0, bisel = 0.06) {
  const s = new THREE.Shape(puntos.map(([z, y]) => new THREE.Vector2(z, y)));
  const g = new THREE.ExtrudeGeometry(s, { depth: ancho - 2 * bisel, bevelEnabled: true, bevelThickness: bisel, bevelSize: bisel, bevelSegments: 1, curveSegments: 4 });
  g.rotateY(-Math.PI / 2);
  g.translate(x + ancho / 2 - bisel, 0, 0);
  return colorear(g, color);
}

function rueda(r, ancho, x, z, dobles = false) {
  const partes = [];
  for (const lado of [-1, 1]) {
    for (let k = 0; k < (dobles ? 2 : 1); k++) {
      const xx = lado * (x - k * (ancho + 0.04));
      const n = new THREE.CylinderGeometry(r, r, ancho, 16); n.rotateZ(Math.PI / 2); n.translate(xx, r, z);
      partes.push(colorear(n, NEUMATICO));
      if (k === 0) {
        const h = new THREE.CylinderGeometry(r * 0.55, r * 0.55, ancho + 0.02, 10); h.rotateZ(Math.PI / 2); h.translate(xx + lado * 0.01, r, z);
        partes.push(colorear(h, RIN));
      }
    }
  }
  return partes;
}

function faros(ancho, y, zFrente, zAtras, h = 0.16, w = 0.32) {
  zFrente += 0.06; zAtras -= 0.06; // por fuera del bisel de la carrocería
  return [
    ...[-1, 1].map((l) => caja(FARO, w, h, 0.06, l * (ancho / 2 - w / 2 - 0.08), y, zFrente)),
    ...[-1, 1].map((l) => caja(STOP, w * 0.8, h, 0.06, l * (ancho / 2 - w / 2 - 0.06), y, zAtras)),
  ];
}

// Vidrio plano apoyado sobre el tramo (z1,y1)→(z2,y2) de la silueta (de adelante hacia atrás), por fuera del bisel.
function vidrioInclinado(z1, y1, z2, y2, ancho, sobre = 0.075) {
  const dz = z2 - z1, dy = y2 - y1, largo = Math.hypot(dz, dy);
  const g = new THREE.BoxGeometry(ancho, 0.03, largo * 0.92);
  g.rotateX(Math.atan2(-dy / largo, dz / largo));
  const nz = dy / largo, ny = -dz / largo;
  g.translate(0, (y1 + y2) / 2 + ny * sobre, (z1 + z2) / 2 + nz * sobre);
  return colorear(g, VIDRIO);
}

function modelo(carroceria, detalles, luces) {
  return { carroceria: mergeGeometries(carroceria), detalles: mergeGeometries(detalles), luces: mergeGeometries(luces) };
}

// ---------- livianos (cat. I), 4,5 m
function sedan() {
  const L = 2.25, W = 1.78;
  const cuerpo = perfil(0xffffff, [[-L, 0.3], [L, 0.3], [L, 0.72], [1.95, 0.84], [0.95, 0.94], [0.32, 1.38], [-0.95, 1.42], [-1.75, 1.0], [-L, 0.92]], W);
  const vidrios = perfil(VIDRIO, [[0.88, 0.97], [0.36, 1.33], [-0.92, 1.36], [-1.62, 1.02]], W + 0.03, 0, 0.01);
  const parabrisas = vidrioInclinado(0.95, 0.94, 0.32, 1.38, W - 0.3), luneta = vidrioInclinado(-0.95, 1.42, -1.75, 1.0, W - 0.35);
  return modelo([cuerpo], [vidrios, parabrisas, luneta, ...rueda(0.32, 0.22, 0.78, 1.38), ...rueda(0.32, 0.22, 0.78, -1.38)], faros(W, 0.6, L + 0.01, -L - 0.01));
}

function camioneta() {
  const L = 2.3, W = 1.86;
  const cuerpo = perfil(0xffffff, [[-L, 0.36], [L, 0.36], [L, 0.9], [1.75, 1.02], [1.0, 1.1], [0.55, 1.68], [-L + 0.1, 1.72], [-L, 1.6]], W);
  const vidrios = perfil(VIDRIO, [[0.95, 1.13], [0.58, 1.62], [-L + 0.25, 1.64], [-L + 0.25, 1.14]], W + 0.03, 0, 0.01);
  const barras = [-1, 1].map((l) => caja(0x3a3a3a, 0.06, 0.06, 2.6, l * 0.7, 1.74, -0.6));
  const parabrisas = vidrioInclinado(1.0, 1.1, 0.55, 1.68, W - 0.3), trasero = caja(VIDRIO, W - 0.4, 0.45, 0.03, 0, 1.12, -L - 0.06);
  return modelo([cuerpo], [vidrios, parabrisas, trasero, ...barras, ...rueda(0.38, 0.26, 0.82, 1.45), ...rueda(0.38, 0.26, 0.82, -1.45)], faros(W, 0.78, L + 0.01, -L - 0.01));
}

function pickup() {
  const L = 2.3, W = 1.86;
  const cabina = perfil(0xffffff, [[-0.35, 0.38], [L, 0.38], [L, 0.92], [1.7, 1.04], [1.05, 1.1], [0.6, 1.7], [-0.35, 1.72]], W);
  const platon = perfil(0xffffff, [[-L, 0.38], [-0.35, 0.38], [-0.35, 1.08], [-L, 1.08]], W);
  const vidrios = perfil(VIDRIO, [[1.0, 1.13], [0.62, 1.64], [-0.2, 1.65], [-0.2, 1.14]], W + 0.03, 0, 0.01);
  const fondo = caja(0x2a2a2a, W - 0.2, 0.05, 1.8, 0, 0.62, -1.3);
  const parabrisas = vidrioInclinado(1.05, 1.1, 0.6, 1.7, W - 0.3), trasero = caja(VIDRIO, W - 0.5, 0.4, 0.03, 0, 1.2, -0.42);
  return modelo([cabina, platon], [vidrios, fondo, parabrisas, trasero, ...rueda(0.38, 0.26, 0.82, 1.45), ...rueda(0.38, 0.26, 0.82, -1.45)], faros(W, 0.8, L + 0.01, -L - 0.01));
}

// ---------- bus (cat. II), 10 m
function bus() {
  const L = 5, W = 2.5;
  const cuerpo = perfil(0xffffff, [[-L, 0.42], [L, 0.42], [L, 2.5], [L - 0.35, 3.05], [-L + 0.2, 3.1], [-L, 2.9]], W);
  const banda = caja(VIDRIO, W + 0.04, 0.95, 8.6, 0, 1.75, -0.2);
  const parabrisas = caja(VIDRIO, W - 0.25, 1.25, 0.04, 0, 1.45, L + 0.08);
  const techo = caja(0xd9dde2, W - 0.4, 0.22, 3.2, 0, 3.08, -0.5);
  return modelo([cuerpo], [banda, parabrisas, techo, ...rueda(0.52, 0.32, 1.02, 3.0), ...rueda(0.52, 0.3, 1.02, -2.9, true)],
    faros(W, 0.85, L + 0.01, -L - 0.01, 0.22, 0.4));
}

// ---------- carga: cabina de camión (trompa colombiana tipo "nariz") + chasis
function cabinaCamion(zFrente, W = 2.4, alto = 2.75) {
  const z0 = zFrente;
  const cab = perfil(0xffffff, [[z0 - 2.3, 0.75], [z0, 0.75], [z0, 1.55], [z0 - 0.15, 1.75], [z0 - 1.1, 1.85], [z0 - 1.3, alto], [z0 - 2.3, alto]], W);
  const vidrio = perfil(VIDRIO, [[z0 - 1.12, 1.9], [z0 - 1.3, alto - 0.12], [z0 - 1.95, alto - 0.12], [z0 - 1.95, 1.9]], W + 0.03, 0, 0.01);
  const frente = vidrioInclinado(z0 - 1.1, 1.85, z0 - 1.3, alto, W - 0.4);
  const parrilla = caja(0x9aa1a8, W - 0.9, 0.55, 0.05, 0, 0.9, z0 + 0.08);
  const guia = [-1, 1].map((l) => caja(GUIA, 0.12, 0.08, 0.08, l * (W / 2 - 0.1), alto + 0.02, z0 - 1.4));
  return { cab, detalles: [vidrio, frente, parrilla, ...guia] };
}

function chasis(z1, z2, W = 1.0) {
  return caja(CHASIS, W, 0.3, z1 - z2, 0, 0.55, (z1 + z2) / 2);
}

// cat. III: camión turbo con estacas, 7 m
function turbo() {
  const L = 3.5;
  const { cab, detalles } = cabinaCamion(L, 2.25, 2.55);
  const plataforma = caja(0x6b4a2b, 2.35, 0.18, 4.4, 0, 0.95, -1.1);
  const estacas = [-1, 1].map((l) => caja(0x8a6238, 0.1, 1.2, 4.3, l * 1.12, 1.13, -1.1));
  const carga = caja(0x7f9a54, 2.0, 0.9, 3.6, 0, 1.13, -1.2);
  return modelo([cab], [...detalles, chasis(L - 1, -L + 0.3), plataforma, ...estacas, carga,
    ...rueda(0.45, 0.28, 0.95, L - 1.2), ...rueda(0.45, 0.26, 0.92, -L + 1.3, true)], faros(2.25, 1.0, L + 0.01, -L - 0.01));
}

// cat. IV: camión sencillo con furgón, 9 m
function sencillo() {
  const L = 4.5;
  const { cab, detalles } = cabinaCamion(L);
  const furgon = caja(0xeef0f2, 2.5, 2.7, 6.2, 0, 0.95, -1.25);
  const franja = caja(0x0f5aa8, 2.52, 0.35, 6.0, 0, 1.4, -1.25);
  return modelo([cab], [...detalles, chasis(L - 1, -L + 0.3), furgon, franja,
    ...rueda(0.5, 0.3, 1.0, L - 1.3), ...rueda(0.5, 0.28, 0.96, -L + 1.6, true)], faros(2.4, 1.0, L + 0.01, -L - 0.01));
}

// cat. V: doble troque volqueta, 12 m
function dobleTroque() {
  const L = 6;
  const { cab, detalles } = cabinaCamion(L);
  const volco = perfil(0xf2b705, [[-L + 0.2, 1.05], [L - 2.5, 1.05], [L - 2.4, 2.75], [-L + 0.2, 2.75]], 2.5);
  const material = caja(0x8d7b68, 2.3, 0.35, 8.0, 0, 2.6, -1.9);
  return modelo([cab], [...detalles, chasis(L - 1, -L + 0.3), volco, material,
    ...rueda(0.52, 0.3, 1.0, L - 1.3), ...rueda(0.52, 0.28, 0.96, -L + 3.2, true), ...rueda(0.52, 0.28, 0.96, -L + 1.85, true)],
    faros(2.4, 1.0, L + 0.01, -L - 0.01));
}

// cat. VI y VII: tractomula con semirremolque. ejesRemolque = 2 (5 ejes) o 3 (6 ejes)
function tractomula(largo, ejesRemolque, tipo) {
  const L = largo / 2;
  const { cab, detalles } = cabinaCamion(L, 2.5, 3.0);
  const z1 = L - 2.6, z2 = -L + 0.2; // semirremolque
  const partes = [...detalles, chasis(L - 1, L - 6)];
  if (tipo === 'cisterna') {
    const t = new THREE.CylinderGeometry(1.2, 1.2, z1 - z2 - 0.4, 20); t.rotateX(Math.PI / 2); t.translate(0, 2.35, (z1 + z2) / 2);
    partes.push(colorear(t, 0xc9cfd6), caja(0x8d949b, 2.2, 0.35, z1 - z2, 0, 0.95, (z1 + z2) / 2));
    partes.push(caja(0xff6b00, 0.6, 0.4, 0.05, 0, 2.3, z2 - 0.01));
  } else {
    partes.push(caja(tipo === 'contenedor' ? 0xb23a2e : 0xeef0f2, 2.55, 2.75, z1 - z2, 0, 1.25, (z1 + z2) / 2));
    if (tipo === 'contenedor') for (let z = z2 + 0.6; z < z1; z += 0.6) partes.push(caja(0x8f2c22, 2.58, 2.6, 0.08, 0, 1.32, z));
    else partes.push(caja(0x2f80ed, 2.57, 0.4, z1 - z2 - 0.4, 0, 3.2, (z1 + z2) / 2));
  }
  partes.push(...rueda(0.52, 0.3, 1.0, L - 1.3), ...rueda(0.52, 0.28, 0.96, L - 4.6, true), ...rueda(0.52, 0.28, 0.96, L - 5.95, true));
  for (let k = 0; k < ejesRemolque; k++) partes.push(...rueda(0.52, 0.28, 0.96, z2 + 1.3 + k * 1.35, true));
  return modelo([cab], partes, faros(2.5, 1.0, L + 0.01, z2 - 0.01));
}

// Variantes por categoría de peaje: [nombre, constructor, peso]
export const VARIANTES = {
  1: [['sedan', sedan, 0.5], ['camioneta', camioneta, 0.32], ['pickup', pickup, 0.18]],
  2: [['bus', bus, 1]],
  3: [['turbo', turbo, 1]],
  4: [['sencillo', sencillo, 1]],
  5: [['doble_troque', dobleTroque, 1]],
  6: [['tracto5_furgon', () => tractomula(17, 2, 'furgon'), 0.6], ['tracto5_contenedor', () => tractomula(17, 2, 'contenedor'), 0.4]],
  7: [['tracto6_cisterna', () => tractomula(19, 3, 'cisterna'), 0.55], ['tracto6_furgon', () => tractomula(19, 3, 'furgon'), 0.45]],
};

export const PINTURA = {
  sedan: [0xd8dde3, 0x1d2733, 0xb3261e, 0x2a5aa0, 0xf4f4f2, 0x7d838a, 0x355e3b, 0xc8a46a, 0x0e0e10],
  camioneta: [0xf4f4f2, 0x1d2733, 0x8c9399, 0x5a1d1d, 0x23395b, 0x0e0e10],
  pickup: [0xf4f4f2, 0xb3261e, 0x7d838a, 0x23395b, 0x2d2d2d],
  bus: [0x1f6fb2, 0xd94f30, 0x2a9d8f, 0xf2b134, 0x6a4c93],
  turbo: [0xd62828, 0x1d3557, 0x2a9d8f, 0xf4a261, 0xffffff],
  sencillo: [0xffffff, 0xd62828, 0x1d3557, 0x2a9d8f],
  doble_troque: [0xd62828, 0xf4f4f2, 0x1d3557, 0xff8c00],
  tracto5_furgon: [0xb5179e, 0xd00000, 0x14213d, 0xfca311, 0xe5e5e5, 0x2a9d8f],
  tracto5_contenedor: [0x14213d, 0xe5e5e5, 0xd00000],
  tracto6_cisterna: [0xd00000, 0xf4f4f2, 0x14213d, 0x2a9d8f],
  tracto6_furgon: [0x3a0ca3, 0xfca311, 0xe5e5e5, 0xd00000],
};
