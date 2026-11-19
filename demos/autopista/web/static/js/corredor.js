// Geometría del corredor a partir de corredor.json (el mismo modelo que usa sim/simulador.py).
// Todo se ubica por abscisa s (km desde Remedios). El trazado sale de puntos lat/lon aproximados suavizados con
// Catmull-Rom; cada UF se mapea proporcionalmente a su tramo de curva, así las longitudes de las UF son las publicadas.
// Coordenadas locales en metros: x = este, z = sur.

const LAT0 = 6.73, LON0 = -74.5;
const KX = 111320 * Math.cos(LAT0 * Math.PI / 180), KZ = 110570;
export const aLocal = (lat, lon) => ({ x: (lon - LON0) * KX, z: -(lat - LAT0) * KZ });

function catmull(pts, paso) {
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
    const n = Math.max(2, Math.ceil(Math.hypot(p2.x - p1.x, p2.z - p1.z) / paso));
    for (let k = 0; k < n; k++) {
      const t = k / n, t2 = t * t, t3 = t2 * t;
      const f = (a, b, c, e) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - e) * t2 + (-a + 3 * b - 3 * c + e) * t3);
      out.push({ x: f(p0.x, p1.x, p2.x, p3.x), z: f(p0.z, p1.z, p2.z, p3.z), src: k === 0 ? i : -1 });
    }
  }
  const u = pts[pts.length - 1];
  out.push({ x: u.x, z: u.z, src: pts.length - 1 });
  return out;
}

// Sinuosidad de montaña (determinista) en las UF-2 y UF-3.
function sinuosidad(pts, desde, hasta) {
  let acc = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1], b = pts[i + 1];
    acc += Math.hypot(pts[i].x - a.x, pts[i].z - a.z);
    if (i < desde || i > hasta) continue;
    const tx = b.x - a.x, tz = b.z - a.z, l = Math.hypot(tx, tz) || 1;
    const w = Math.sin(acc / 900) * 160 + Math.sin(acc / 2300 + 1.3) * 260;
    const f = Math.min(1, (i - desde) / 40, (hasta - i) / 40);
    pts[i].dx = (-tz / l) * w * f;
    pts[i].dz = (tx / l) * w * f;
  }
  for (const p of pts) if (p.dx) { p.x += p.dx; p.z += p.dz; }
}

export class Corredor {
  constructor(datos) {
    this.d = datos;
    this.L = datos.longitud;
    const ctrl = datos.trazado.map(([lat, lon, ancla]) => ({ ...aLocal(lat, lon), ancla }));
    const pts = catmull(ctrl, 40);
    const iVeg = pts.findIndex((p) => p.src === datos.trazado.findIndex((r) => r[2] === 35.5));
    const iPb = pts.findIndex((p) => p.src === datos.trazado.findIndex((r) => r[2] === 119.3));
    sinuosidad(pts, iVeg + 10, iPb - 30);
    let g = 0;
    pts[0].g = 0;
    for (let i = 1; i < pts.length; i++) { g += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z); pts[i].g = g; }
    this.pts = pts;
    this.anclas = pts.filter((p) => p.src >= 0 && ctrl[p.src].ancla !== undefined).map((p) => ({ s: ctrl[p.src].ancla, g: p.g }));
    this.rio = catmull(datos.rio.map(([lat, lon]) => aLocal(lat, lon)), 300);
    this.ultimo = 0;
  }

  sAg(s) {
    const A = this.anclas;
    if (s <= A[0].s) return A[0].g;
    for (let i = 1; i < A.length; i++) if (s <= A[i].s) return A[i - 1].g + (s - A[i - 1].s) / (A[i].s - A[i - 1].s) * (A[i].g - A[i - 1].g);
    return A[A.length - 1].g;
  }

  // Punto de la vía en la abscisa s (km) con desplazamiento lateral lat (m, + = derecha del sentido A).
  marco(s, lat = 0, out = {}) {
    const g = this.sAg(Math.max(0, Math.min(this.L, s)));
    const P = this.pts;
    let i = this.ultimo;
    if (!(P[i].g <= g && P[i + 1] && P[i + 1].g >= g)) {
      let lo = 0, hi = P.length - 1;
      while (hi - lo > 1) { const m = (lo + hi) >> 1; if (P[m].g <= g) lo = m; else hi = m; }
      i = lo;
    }
    this.ultimo = i;
    const a = P[i], b = P[Math.min(P.length - 1, i + 1)];
    const seg = b.g - a.g || 1, t = (g - a.g) / seg;
    const tx = (b.x - a.x) / seg, tz = (b.z - a.z) / seg;
    out.x = a.x + (b.x - a.x) * t - tz * lat;
    out.z = a.z + (b.z - a.z) * t + tx * lat;
    out.tx = tx; out.tz = tz; out.nx = -tz; out.nz = tx;
    out.rumbo = Math.atan2(tx, tz);
    return out;
  }

  limite(s) {
    for (const [a, b, v] of this.d.limites) if (s >= a && s < b) return v;
    return 80;
  }
}
