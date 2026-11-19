// Escenario estático: terreno, río Magdalena, vía, puente, plazas de peaje, equipos ITS, CCO y poblaciones.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const Y_VIA = 0.35;
const rnd = (() => { let s = 1337; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })();

function cinta(cor, desde, hasta, paso, anchoFn, latFn = () => 0, y = Y_VIA) {
  const pos = [], idx = [], m = {};
  let n = 0;
  for (let s = desde; s <= hasta + 1e-9; s += paso) {
    const [a, b] = anchoFn(s);
    const c = latFn(s);
    cor.marco(s, c + a, m); pos.push(m.x, y, m.z);
    cor.marco(s, c + b, m); pos.push(m.x, y, m.z);
    // orden antihorario visto desde arriba: la normal queda hacia +Y y la cara no se descarta
    if (n) idx.push(2 * n - 2, 2 * n - 1, 2 * n, 2 * n - 1, 2 * n + 1, 2 * n);
    n++;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function cintaXZ(pts, ancho, y) {
  const pos = [], idx = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    const tx = b.x - a.x, tz = b.z - a.z, l = Math.hypot(tx, tz) || 1;
    const nx = -tz / l, nz = tx / l, w = ancho(i);
    pos.push(pts[i].x + nx * w, y, pts[i].z + nz * w, pts[i].x - nx * w, y, pts[i].z - nz * w);
    if (i) idx.push(2 * i - 2, 2 * i, 2 * i - 1, 2 * i - 1, 2 * i, 2 * i + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// Índice espacial de la vía (y el río) para alejar montañas, árboles y casas.
class Cercania {
  constructor(puntos, celda = 1000) {
    this.c = celda; this.m = new Map();
    for (const p of puntos) {
      const k = `${Math.floor(p.x / celda)},${Math.floor(p.z / celda)}`;
      if (!this.m.has(k)) this.m.set(k, []);
      this.m.get(k).push(p);
    }
  }
  distancia(x, z, radio) {
    const r = Math.ceil(radio / this.c), cx = Math.floor(x / this.c), cz = Math.floor(z / this.c);
    let d = Infinity;
    for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++) {
      for (const p of this.m.get(`${cx + i},${cz + j}`) || []) d = Math.min(d, Math.hypot(p.x - x, p.z - z));
    }
    return d;
  }
}

export function texturaTexto(lineas, { w = 512, h = 128, fondo = '#0b0f14', color = '#ffb020', fuente = 'bold 54px monospace' } = {}) {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const pintar = (ls) => {
    const g = cv.getContext('2d');
    g.fillStyle = fondo; g.fillRect(0, 0, w, h);
    g.fillStyle = color; g.font = fuente; g.textAlign = 'center'; g.textBaseline = 'middle';
    ls.forEach((l, i) => g.fillText(l, w / 2, h / (ls.length + 1) * (i + 1)));
    tex.needsUpdate = true;
  };
  pintar(lineas);
  return { tex, pintar, canvas: cv };
}

export function construirMundo(scene, cor) {
  const D = cor.d;
  const mundo = { plazas: {}, its: {}, cco: null, luces: [], accidente: null, pmv: {} };
  const m = {};

  // ---- terreno
  const suelo = new THREE.Mesh(new THREE.PlaneGeometry(260000, 260000), new THREE.MeshLambertMaterial({ color: 0x5f8f3c }));
  suelo.rotation.x = -Math.PI / 2;
  scene.add(suelo);
  mundo.suelo = suelo;

  const muestras = [];
  for (let s = 0; s <= cor.L; s += 0.2) { cor.marco(s, 0, m); muestras.push({ x: m.x, z: m.z }); }
  const cerca = new Cercania([...muestras, ...cor.rio.map((p) => ({ x: p.x, z: p.z }))], 1500);
  const cercaVia = new Cercania(muestras, 400);

  // montañas: más altas al occidente (cordillera Central), lomas suaves cerca del Magdalena
  const N = 2600;
  const cono = new THREE.ConeGeometry(1, 1, 7, 1);
  cono.translate(0, 0.5, 0);
  const montes = new THREE.InstancedMesh(cono, new THREE.MeshLambertMaterial({ color: 0xffffff }), N);
  const o = new THREE.Object3D(), col = new THREE.Color();
  let k = 0;
  for (let i = 0; i < N * 4 && k < N; i++) {
    const x = (rnd() - 0.5) * 190000, z = (rnd() - 0.5) * 170000;
    const oeste = THREE.MathUtils.clamp((-x + 30000) / 70000, 0, 1);
    const radio = 1200 + rnd() * 3800;
    if (cerca.distancia(x, z, radio + 1500) < radio + 350) continue;
    const alto = (180 + rnd() * 500) + oeste * (600 + rnd() * 1300);
    o.position.set(x, -20, z); o.rotation.set(0, rnd() * 6, 0); o.scale.set(radio, alto, radio * (0.7 + rnd() * 0.6));
    o.updateMatrix(); montes.setMatrixAt(k, o.matrix);
    montes.setColorAt(k, col.setHSL(0.24 + rnd() * 0.08, 0.38 + rnd() * 0.2, 0.2 + rnd() * 0.12 + oeste * 0.02));
    k++;
  }
  montes.count = k;
  scene.add(montes);

  // árboles junto a la vía
  const copa = new THREE.IcosahedronGeometry(1, 0);
  copa.translate(0, 1.4, 0);
  const NA = 9000;
  const arboles = new THREE.InstancedMesh(copa, new THREE.MeshLambertMaterial({ color: 0xffffff }), NA);
  k = 0;
  for (let i = 0; i < NA * 3 && k < NA; i++) {
    const s = rnd() * cor.L, lado = rnd() < 0.5 ? -1 : 1, lat = lado * (14 + rnd() * rnd() * 260);
    cor.marco(s, lat, m);
    if (D.plazas.some((p) => Math.abs(p.s - s) < 0.45) || cercaVia.distancia(m.x, m.z, 600) < 12) continue;
    const t = 3 + rnd() * 6;
    o.position.set(m.x, 0, m.z); o.rotation.set(0, rnd() * 6, 0); o.scale.set(t * 0.8, t, t * 0.8);
    o.updateMatrix(); arboles.setMatrixAt(k, o.matrix);
    arboles.setColorAt(k, col.setHSL(0.27 + rnd() * 0.07, 0.5, 0.18 + rnd() * 0.12));
    k++;
  }
  arboles.count = k;
  scene.add(arboles);

  // río Magdalena
  const rio = new THREE.Mesh(cintaXZ(cor.rio, (i) => 170 + 40 * Math.sin(i * 0.7), 0.12),
    new THREE.MeshPhongMaterial({ color: 0x7a6a45, emissive: 0x1a1408, shininess: 60, specular: 0x555544 }));
  scene.add(rio);

  // ---- vía
  const enAdelanto = (s) => D.adelantamiento.some(([a, b]) => s >= a && s <= b);
  const asfalto = new THREE.MeshLambertMaterial({ color: 0x3b3e43 });
  const via = new THREE.Mesh(cinta(cor, 0, cor.L, 0.012, (s) => (enAdelanto(s) ? [-8.2, 8.2] : [-4.6, 4.6])), asfalto);
  scene.add(via);
  const berma = new THREE.Mesh(cinta(cor, 0, cor.L, 0.02, (s) => (enAdelanto(s) ? [-10, 10] : [-6.2, 6.2]), () => 0, Y_VIA - 0.12),
    new THREE.MeshLambertMaterial({ color: 0x8c8a7c }));
  scene.add(berma);
  // líneas: central amarilla discontinua y bordes blancos
  const lineas = [];
  for (let s = 0; s < cor.L; s += 0.024) {
    lineas.push(cinta(cor, s, s + 0.012, 0.006, () => [-0.08, 0.08], () => 0, Y_VIA + 0.02));
  }
  scene.add(new THREE.Mesh(mergeGeometries(lineas), new THREE.MeshBasicMaterial({ color: 0xf2c230 })));
  const bordes = [-1, 1].map((l) => cinta(cor, 0, cor.L, 0.02, (s) => { const w = enAdelanto(s) ? 8.0 : 4.4; return [l * w - 0.08, l * w + 0.08]; }, () => 0, Y_VIA + 0.02));
  scene.add(new THREE.Mesh(mergeGeometries(bordes), new THREE.MeshBasicMaterial({ color: 0xf4f4f4 })));
  // trazo visible desde lejos (1 px)
  const traza = new THREE.BufferGeometry().setFromPoints(muestras.map((p) => new THREE.Vector3(p.x, 3, p.z)));
  mundo.traza = new THREE.Line(traza, new THREE.LineBasicMaterial({ color: 0xffd25a, transparent: true, opacity: 0.85 }));
  scene.add(mundo.traza);

  // ---- puente sobre el Magdalena
  const P = D.puente;
  const tablero = new THREE.Mesh(cinta(cor, P.s - P.largo / 2, P.s + P.largo / 2, 0.01, () => [-7, 7], () => 0, Y_VIA - 0.05),
    new THREE.MeshLambertMaterial({ color: 0x9aa0a6 }));
  scene.add(tablero);
  const pilas = [], barandas = [];
  for (let s = P.s - P.largo / 2; s <= P.s + P.largo / 2; s += 0.05) {
    cor.marco(s, 0, m);
    const pila = new THREE.CylinderGeometry(1.6, 2, 14, 8); pila.translate(m.x, -6.5, m.z); pilas.push(pila);
  }
  for (const l of [-7, 7]) barandas.push(cinta(cor, P.s - P.largo / 2, P.s + P.largo / 2, 0.01, () => [l - 0.25, l + 0.25], () => 0, Y_VIA + 1.1));
  scene.add(new THREE.Mesh(mergeGeometries(pilas), new THREE.MeshLambertMaterial({ color: 0x8d9094 })));
  scene.add(new THREE.Mesh(mergeGeometries(barandas), new THREE.MeshLambertMaterial({ color: 0xd8dde2 })));
  // arcos del puente
  const arco = [];
  for (const l of [-7.2, 7.2]) {
    const pts = [];
    for (let i = 0; i <= 40; i++) {
      const f = i / 40, s = P.s - P.largo / 2 + P.largo * f;
      cor.marco(s, l, m); pts.push(new THREE.Vector3(m.x, Y_VIA + 1 + Math.sin(f * Math.PI) * 24, m.z));
    }
    arco.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 60, 0.6, 6));
  }
  scene.add(new THREE.Mesh(mergeGeometries(arco), new THREE.MeshLambertMaterial({ color: 0xe8edf2 })));

  // ---- poblaciones (casas de colores)
  const casa = new THREE.BoxGeometry(1, 1, 1); casa.translate(0, 0.5, 0);
  const NC = 2600;
  const casas = new THREE.InstancedMesh(casa, new THREE.MeshLambertMaterial({ color: 0xffffff }), NC);
  const colores = [0xf4efe6, 0xf6d7a7, 0xa7d4f6, 0xf6a7b9, 0xc9f6a7, 0xffe08a, 0xe9e9e9, 0xd6b38a];
  k = 0;
  for (const p of D.poblaciones) {
    const meta = k + Math.round(p.id === 'troncal' ? 60 : p.id === 'dolores' ? 140 : 380 * p.peso + 120);
    for (let i = 0; i < 4000 && k < Math.min(NC, meta); i++) {
      const s = p.s + (rnd() - 0.5) * 2.4, lat = (rnd() < 0.5 ? -1 : 1) * (22 + rnd() * rnd() * 700);
      if (s < 0 || s > cor.L) continue;
      cor.marco(s, lat, m);
      if (cercaVia.distancia(m.x, m.z, 400) < 18 || D.plazas.some((q) => Math.abs(q.s - s) < 0.4)) continue;
      o.position.set(m.x, 0, m.z); o.rotation.set(0, cor.marco(s, 0, {}).rumbo + (rnd() < 0.5 ? 0 : Math.PI / 2), 0);
      o.scale.set(6 + rnd() * 8, 3 + rnd() * (rnd() < 0.15 ? 9 : 3), 7 + rnd() * 9);
      o.updateMatrix(); casas.setMatrixAt(k, o.matrix); casas.setColorAt(k, col.set(colores[Math.floor(rnd() * colores.length)]));
      k++;
    }
  }
  casas.count = k;
  scene.add(casas);

  // ---- plazas de peaje
  for (const p of D.plazas) mundo.plazas[p.id] = plaza(scene, cor, p, D);

  // ---- equipos ITS
  for (const d of D.its) mundo.its[d.id] = equipo(scene, cor, d, mundo);

  // ---- CCO
  mundo.cco = cco(scene, cor, D.cco);

  // ---- accidente (se muestra con el escenario)
  mundo.accidente = accidente(scene, cor, D.accidente);
  return mundo;
}

function luz(color, r = 0.45) {
  return new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), new THREE.MeshBasicMaterial({ color }));
}

function plaza(scene, cor, p, D) {
  const g = new THREE.Group();
  const m = {};
  const nCar = D.carriles.length;
  const media = 1.8 + 1.2 + (nCar - 1) * D.carril_ancho + 2.6;
  // plataforma ensanchada (abanico de entrada y salida)
  const ancho = (s) => {
    const d = s - p.s;
    const f = d < 0 ? THREE.MathUtils.smoothstep(d, -0.24, -0.07) : 1 - THREE.MathUtils.smoothstep(d, 0.05, 0.14);
    const w = 4.6 + (media - 4.6) * f;
    return [-w, w];
  };
  const losa = new THREE.Mesh(cinta(cor, p.s - 0.26, p.s + 0.16, 0.004, ancho, () => 0, Y_VIA + 0.01), new THREE.MeshLambertMaterial({ color: 0x55595f }));
  scene.add(losa);
  cor.marco(p.s, 0, m);
  g.position.set(m.x, 0, m.z);
  g.rotation.y = m.rumbo;
  scene.add(g);
  // techo
  const techo = new THREE.Mesh(new THREE.BoxGeometry(media * 2 + 2, 0.9, 18), new THREE.MeshLambertMaterial({ color: 0xf3f6f9 }));
  techo.position.y = 7.2; g.add(techo);
  const franja = new THREE.Mesh(new THREE.BoxGeometry(media * 2 + 2.05, 0.5, 18.05), new THREE.MeshLambertMaterial({ color: 0x0f5aa8 }));
  franja.position.y = 6.9; g.add(franja);
  // islas y casetas: x local = -lat (el grupo mira hacia +z en el sentido A)
  const carriles = [];
  const isla = new THREE.BoxGeometry(1.4, 0.35, 14), caseta = new THREE.BoxGeometry(1.3, 2.6, 2.6);
  const matIsla = new THREE.MeshLambertMaterial({ color: 0xd9c25c }), matCaseta = new THREE.MeshLambertMaterial({ color: 0xe9eef3 });
  for (const sgn of [1, -1]) {
    for (let i = 0; i <= nCar; i++) {
      const lat = sgn * (1.2 + i * D.carril_ancho);
      const a = new THREE.Mesh(isla, matIsla); a.position.set(-lat, 0.35, 0); g.add(a);
      const c = new THREE.Mesh(caseta, matCaseta); c.position.set(-lat, 1.6, sgn > 0 ? -0.5 : 0.5); g.add(c);
      const col = new THREE.Mesh(new THREE.BoxGeometry(0.5, 7, 0.5), matCaseta); col.position.set(-lat, 3.6, 0); g.add(col);
    }
    D.carriles.forEach((tipo, i) => {
      const lat = sgn * (1.8 + 1.2 + i * D.carril_ancho);
      // brazo de barrera: pivota en la isla derecha del carril
      const pivote = new THREE.Group();
      pivote.position.set(-(lat + sgn * 1.6), 1.05, sgn > 0 ? 1.4 : -1.4);
      const brazo = new THREE.Mesh(new THREE.BoxGeometry(3.1, 0.14, 0.14), new THREE.MeshLambertMaterial({ color: 0xffffff }));
      brazo.position.x = sgn * 1.55;
      pivote.add(brazo);
      const rayas = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.16, 0.16), new THREE.MeshLambertMaterial({ color: 0xd03b3b }));
      rayas.position.x = sgn * 2.4; pivote.add(rayas);
      g.add(pivote);
      // semáforo de carril sobre el techo
      const sem = luz(0x38d996, 0.5); sem.position.set(-lat, 6.3, sgn > 0 ? -9.2 : 9.2); g.add(sem);
      // marca TAG
      if (tipo === 'TAG') {
        const cartel = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.9), new THREE.MeshBasicMaterial({ map: texturaTexto(['TAG'], { w: 256, h: 96, fondo: '#0f7a3a', color: '#ffffff', fuente: 'bold 64px sans-serif' }).tex }));
        cartel.position.set(-lat, 6.1, sgn > 0 ? -9.06 : 9.06); cartel.rotation.y = sgn > 0 ? Math.PI : 0; g.add(cartel);
      }
      carriles.push({ id: `${sgn > 0 ? 'A' : 'B'}${i + 1}`, pivote, sgn, sem, tipo });
    });
  }
  return { grupo: g, carriles, datos: p };
}

function poste(alto, color = 0x9aa3ab) {
  const g = new THREE.CylinderGeometry(0.12, 0.16, alto, 8); g.translate(0, alto / 2, 0);
  return new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color }));
}

function equipo(scene, cor, d, mundo) {
  const m = {};
  const lado = d.sentido === 'B' ? -1 : 1;
  const g = new THREE.Group();
  const lat = d.tipo === 'pmv' || d.tipo === 'galibo' ? 0 : lado * 8;
  cor.marco(d.s, lat, m);
  g.position.set(m.x, 0, m.z);
  g.rotation.y = m.rumbo + (d.sentido === 'B' ? Math.PI : 0);
  scene.add(g);
  const gris = new THREE.MeshLambertMaterial({ color: 0x5b6670 }), blanco = new THREE.MeshLambertMaterial({ color: 0xe5e9ee });
  let estado = luz(0x38d996, 0.35), panel = null;
  if (d.tipo === 'pmv' || d.tipo === 'galibo') {
    for (const x of [-9, 9]) { const p = poste(7.5); p.position.x = x; g.add(p); }
    const viga = new THREE.Mesh(new THREE.BoxGeometry(18.4, 0.6, 0.6), gris); viga.position.y = 7.4; g.add(viga);
    if (d.tipo === 'pmv') {
      const t = texturaTexto(['VIAJE SEGURO'], { w: 1024, h: 160, fuente: 'bold 64px monospace' });
      panel = new THREE.Mesh(new THREE.PlaneGeometry(11, 1.8), new THREE.MeshBasicMaterial({ map: t.tex }));
      panel.position.set(-2.5, 6.9, -0.35); panel.rotation.y = Math.PI;
      const caja = new THREE.Mesh(new THREE.BoxGeometry(11.6, 2.3, 0.6), new THREE.MeshLambertMaterial({ color: 0x1b1f24 })); caja.position.set(-2.5, 6.9, 0);
      g.add(caja, panel);
      mundo.pmv[d.id] = { ...t, ultimo: '' };
    } else {
      const sensor = new THREE.Mesh(new THREE.BoxGeometry(17.6, 0.25, 0.25), new THREE.MeshLambertMaterial({ color: 0xffb020 })); sensor.position.y = 6.6; g.add(sensor);
    }
    estado.position.set(9, 8.2, 0);
  } else {
    const alto = d.tipo === 'meteo' ? 10 : d.tipo === 'nodo' ? 2 : 9;
    const p = poste(alto); g.add(p);
    if (d.tipo === 'dai' || d.tipo === 'cctv') {
      const cam = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 1.1), blanco); cam.position.set(1.2, alto, 0.4); cam.rotation.x = 0.3; g.add(cam);
      const brazo = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.12, 0.12), gris); brazo.position.set(0.6, alto, 0); g.add(brazo);
    } else if (d.tipo === 'radar') {
      const r = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.25, 16), blanco); r.rotation.z = Math.PI / 2; r.position.set(0, alto, 0.3); g.add(r);
    } else if (d.tipo === 'meteo') {
      const cruz = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.08, 0.08), gris); cruz.position.y = alto; g.add(cruz);
      const cop = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.6, 10), blanco); cop.position.set(1.1, alto + 0.3, 0); g.add(cop);
      const caja = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.2, 0.5), blanco); caja.position.set(0, 2, 0); g.add(caja);
      const solar = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.06, 1), new THREE.MeshLambertMaterial({ color: 0x1d3c78 })); solar.position.set(0, 5, 0.4); solar.rotation.x = -0.6; g.add(solar);
    } else if (d.tipo === 'nodo') {
      const gab = new THREE.Mesh(new THREE.BoxGeometry(1.4, 2, 0.9), new THREE.MeshLambertMaterial({ color: 0xc9ced4 })); gab.position.y = 1; g.add(gab);
      const ant = poste(12, 0xb5bcc4); ant.position.set(1.4, 0, 0); g.add(ant);
    }
    estado.position.set(0, alto + 1.2, 0);
  }
  g.add(estado);
  return { grupo: g, luz: estado, panel, datos: d };
}

function cco(scene, cor, c) {
  const m = {};
  cor.marco(c.s, c.lat, m);
  const g = new THREE.Group();
  g.position.set(m.x, 0, m.z);
  g.rotation.y = m.rumbo;
  scene.add(g);
  const edificio = new THREE.Mesh(new THREE.BoxGeometry(46, 13, 26), new THREE.MeshLambertMaterial({ color: 0xe8ecf0 }));
  edificio.position.y = 6.5; g.add(edificio);
  // franja de vidrio sin cara inferior: desde la sala de control taparía la pared de video
  const matVidrio = new THREE.MeshLambertMaterial({ color: 0x23466e }), invisible = new THREE.MeshBasicMaterial({ visible: false });
  const vidrio = new THREE.Mesh(new THREE.BoxGeometry(46.2, 3, 26.2), [matVidrio, matVidrio, matVidrio, invisible, matVidrio, matVidrio]);
  vidrio.position.y = 9.5; g.add(vidrio);
  const pared = texturaTexto(['CCO'], { w: 1024, h: 512, fondo: '#0b1220', color: '#e8f1ff', fuente: 'bold 40px sans-serif' });
  const pantalla = new THREE.Mesh(new THREE.PlaneGeometry(36, 18), new THREE.MeshBasicMaterial({ map: pared.tex }));
  // la pantalla mira hacia la vía (lado derecho del grupo: +x local es -lat)
  pantalla.position.set(0, 23, 0);
  pantalla.rotation.y = Math.PI / 2 * Math.sign(c.lat);
  g.add(pantalla);
  const soporte = new THREE.Mesh(new THREE.BoxGeometry(1.2, 10, 1.2), new THREE.MeshLambertMaterial({ color: 0x6b7680 })); soporte.position.y = 17; g.add(soporte);
  const torre = poste(42, 0xd03b3b); torre.position.set(18, 0, 8); g.add(torre);
  const logo = new THREE.Mesh(new THREE.PlaneGeometry(20, 3), new THREE.MeshBasicMaterial({ map: texturaTexto(['Centro de Control de Operaciones'], { w: 1024, h: 150, fondo: '#0f5aa8', color: '#ffffff', fuente: 'bold 58px sans-serif' }).tex }));
  logo.position.set(0, 11, 13.1); g.add(logo);
  return { grupo: g, pantalla, pared, sala: salaDeControl(g) };
}

// Sala de control dentro del edificio: se ve desde adentro porque las caras exteriores se descartan por detrás.
// Pared de video con tres pantallas (Zabbix: problemas con CEP, gráficos; app de peajes), consolas y operadores.
function salaDeControl(g) {
  const interior = new THREE.Mesh(new THREE.BoxGeometry(45.4, 12.6, 25.4), new THREE.MeshLambertMaterial({ color: 0x1c232c, side: THREE.BackSide }));
  interior.position.y = 6.35; g.add(interior);
  const piso = new THREE.Mesh(new THREE.PlaneGeometry(45, 25), new THREE.MeshLambertMaterial({ color: 0x2c333b }));
  piso.rotation.x = -Math.PI / 2; piso.position.y = 0.08; g.add(piso);
  const muro = new THREE.Mesh(new THREE.BoxGeometry(44, 9.6, 0.4), new THREE.MeshLambertMaterial({ color: 0x0b0f14 }));
  muro.position.set(0, 5.6, -12.4); g.add(muro);
  const pantallas = [-14.6, 0, 14.6].map((x) => {
    const cv = document.createElement('canvas');
    cv.width = 1024; cv.height = 576;
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    const p = new THREE.Mesh(new THREE.PlaneGeometry(14, 7.875), new THREE.MeshBasicMaterial({ map: tex }));
    p.position.set(x, 5.6, -12.17); g.add(p);
    return { canvas: cv, tex };
  });
  // franja de luz sobre la pared de video
  const franja = new THREE.Mesh(new THREE.BoxGeometry(44, 0.25, 0.3), new THREE.MeshBasicMaterial({ color: 0xd40000 }));
  franja.position.set(0, 10.1, -12.1); g.add(franja);
  // consolas en dos filas, con monitores que repiten las pantallas grandes
  const matMesa = new THREE.MeshLambertMaterial({ color: 0x3a4450 }), matPiel = new THREE.MeshLambertMaterial({ color: 0xc69c78 });
  const matCamisa = [0x2f5d8a, 0x8a2f3f, 0x2f8a62, 0x5d4a8a].map((c) => new THREE.MeshLambertMaterial({ color: c }));
  [[-3.5, 5], [3.5, 6]].forEach(([z, n], fila) => {
    for (let i = 0; i < n; i++) {
      const x = (i - (n - 1) / 2) * 6.4;
      const mesa = new THREE.Mesh(new THREE.BoxGeometry(5.2, 0.9, 1.4), matMesa); mesa.position.set(x, 0.55, z); g.add(mesa);
      [-1.3, 0, 1.3].forEach((dx, k) => {
        const mon = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.7), new THREE.MeshBasicMaterial({ map: pantallas[(i + k + fila) % 3].tex }));
        mon.position.set(x + dx, 1.45, z - 0.35); mon.rotation.y = dx * -0.25; g.add(mon);
        const pata = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.4, 0.08), matMesa); pata.position.set(x + dx, 1.05, z - 0.4); g.add(pata);
      });
      // operador sentado
      const cuerpo = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.32, 0.9, 10), matCamisa[(i + fila) % 4]); cuerpo.position.set(x, 1.0, z + 1.1); g.add(cuerpo);
      const cabeza = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 10), matPiel); cabeza.position.set(x, 1.62, z + 1.1); g.add(cabeza);
      const silla = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.9, 0.12), new THREE.MeshLambertMaterial({ color: 0x15191e })); silla.position.set(x, 0.95, z + 1.55); g.add(silla);
    }
  });
  return { pantallas, camara: new THREE.Vector3(0, 5.0, 11.0), objetivo: new THREE.Vector3(0, 5.6, -12) };
}

function accidente(scene, cor, a) {
  const g = new THREE.Group();
  const m = {};
  cor.marco(a.s, a.sentido === 'A' ? 1.8 : -1.8, m);
  g.position.set(m.x, Y_VIA, m.z);
  g.rotation.y = m.rumbo;
  const c1 = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.4, 4.4), new THREE.MeshLambertMaterial({ color: 0xc0392b }));
  c1.position.set(0.3, 0.7, 0); c1.rotation.y = 0.5; g.add(c1);
  const c2 = new THREE.Mesh(new THREE.BoxGeometry(2.4, 3, 9), new THREE.MeshLambertMaterial({ color: 0xecf0f1 }));
  c2.position.set(-0.6, 1.5, 7.5); c2.rotation.y = -0.25; c2.rotation.z = 0.08; g.add(c2);
  const conoG = new THREE.ConeGeometry(0.25, 0.75, 10); conoG.translate(0, 0.37, 0);
  for (let i = 0; i < 9; i++) {
    const cono = new THREE.Mesh(conoG, new THREE.MeshLambertMaterial({ color: 0xff6a00 }));
    cono.position.set(-1.6 + i * 0.05, 0, -6 - i * 4); g.add(cono);
  }
  const baliza = luz(0xffa000, 0.6); baliza.position.set(1.8, 1.6, -4); g.add(baliza);
  g.visible = false;
  scene.add(g);
  return { grupo: g, baliza };
}
