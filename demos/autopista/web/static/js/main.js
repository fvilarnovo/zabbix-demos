// Escena principal: render, cámara, etiquetas y vínculo con el backend (/api/estado cada 0,5 s).
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { Corredor } from './corredor.js';
import { construirMundo } from './mundo.js';
import { Vehiculos, Unidades } from './vehiculos.js';
import { Hud } from './hud.js';
import * as pantallas from './pantallas.js';

const datos = await (await fetch('/static/corredor.json')).json();
const cor = new Corredor(datos);

const cont = document.getElementById('escena');
const renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
cont.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const CIELO_DIA = new THREE.Color(0xa9cfe8), CIELO_NOCHE = new THREE.Color(0x0a1424), CIELO_LLUVIA = new THREE.Color(0x7d8a96);
scene.background = CIELO_DIA.clone();
scene.fog = new THREE.Fog(scene.background, 2000, 120000);
// reflejos suaves para la pintura de los vehículos
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.6;
const hemi = new THREE.HemisphereLight(0xdfefff, 0x3a4a2a, 1.3);
const sol = new THREE.DirectionalLight(0xfff1d6, 2.2);
sol.position.set(30000, 60000, 20000);
scene.add(hemi, sol);

const camara = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 1, 400000);
const orbita = new OrbitControls(camara, renderer.domElement);
orbita.enableDamping = true; orbita.dampingFactor = 0.08;
orbita.maxPolarAngle = Math.PI * 0.47; orbita.minDistance = 6; orbita.maxDistance = 160000;
orbita.screenSpacePanning = false;

const mundo = construirMundo(scene, cor);
const vehiculos = new Vehiculos(scene, cor);
let noche = 0;
const unidades = new Unidades(scene, cor);

// ---------- lugares
const m = {};
const punto = (s, lat = 0) => { cor.marco(s, lat, m); return new THREE.Vector3(m.x, 0, m.z); };
function lugar(s, dist, alto, lado = 1, lat = 0) {
  const t = punto(s, lat);
  cor.marco(s, 0, m);
  const p = t.clone().add(new THREE.Vector3(m.nx * dist * lado - m.tx * dist * 0.6, alto, m.nz * dist * lado - m.tz * dist * 0.6));
  return { t, p };
}
const centro = (() => { const a = punto(0), b = punto(cor.L), c = punto(70); return a.add(b).add(c).multiplyScalar(1 / 3); })();
const LUGARES = {
  corredor: { nombre: 'Corredor completo (153 km)', t: centro, p: centro.clone().add(new THREE.Vector3(-8000, 78000, 62000)) },
  vegachi: { nombre: 'Peaje Vegachí', ...lugar(37.6, 70, 45) },
  sis: { nombre: 'Peaje Santa Isabel', ...lugar(96.2, 70, 45) },
  pbe: { nombre: 'Peaje Puerto Berrío', ...lugar(126.4, 70, 45) },
  accidente: { nombre: 'km 100 · UF-3 (DAI)', ...lugar(100.4, 140, 70, 1) },
  dolores: { nombre: 'Alto de Dolores (meteo)', ...lugar(71.4, 260, 140) },
  fibra: { nombre: 'Nodo de fibra UF-2', ...lugar(52.4, 120, 60) },
  puente: { nombre: 'Puente sobre el Magdalena', ...lugar(120.55, 420, 160, -1) },
  cco: { nombre: 'CCO Puerto Berrío', ...lugar(118.2, 150, 70, -1, -160) },
  uf1: { nombre: 'UF-1 Remedios – Vegachí', ...lugar(17, 9000, 9000) },
  uf4: { nombre: 'UF-4 hasta la Troncal', ...lugar(136, 9000, 9000) },
};
mundo.cco.grupo.updateMatrixWorld(true);
LUGARES.sala = { nombre: 'Sala de control del CCO (Zabbix)', p: mundo.cco.grupo.localToWorld(mundo.cco.sala.camara.clone()),
  t: mundo.cco.grupo.localToWorld(mundo.cco.sala.objetivo.clone()) };
const sel = document.getElementById('ir');
for (const [id, l] of Object.entries(LUGARES)) sel.add(new Option(l.nombre, id));
sel.add(new Option('Seguir un vehículo (X)', 'seguir'));
let vuelo = null, seguido = null;
const vSeg = new THREE.Vector3();
// cámara que acompaña a un vehículo (prefiere camiones y buses, que lucen más); cada X cambia de vehículo
function seguir() {
  const lista = [...vehiculos.v.entries()].filter(([, e]) => Math.abs(e.v) > 5);
  if (!lista.length) return;
  const pesados = lista.filter(([, e]) => e.cat >= 2);
  const pool = pesados.length && Math.random() < 0.6 ? pesados : lista;
  seguido = pool[Math.floor(Math.random() * pool.length)][0];
  const e = vehiculos.v.get(seguido);
  const f = cor.marco(e.ss, e.ll, {}), sgn = e.v < 0 ? -1 : 1;
  vSeg.set(f.x, 0, f.z);
  vuelo = { t0: performance.now(), p0: camara.position.clone(), t0v: orbita.target.clone(),
    p: vSeg.clone().add(new THREE.Vector3(-f.tx * 22 * sgn + f.nx * 9 * sgn, 9, -f.tz * 22 * sgn + f.nz * 9 * sgn)), t: vSeg.clone(), dur: 1600 };
  sel.value = 'seguir';
}
function ir(id) {
  if (id === 'seguir') return seguir();
  seguido = null;
  const l = LUGARES[id];
  vuelo = { t0: performance.now(), p0: camara.position.clone(), t0v: orbita.target.clone(), p: l.p, t: l.t, dur: 2200 };
  sel.value = id;
}
sel.onchange = () => ir(sel.value);
camara.position.copy(LUGARES.corredor.p);
orbita.target.copy(LUGARES.corredor.t);
// modo centro de mando (/cco): sin paneles y con recorrido automático de cámara
const MODO_CCO = new URLSearchParams(location.search).get('modo') === 'cco';
if (MODO_CCO) {
  document.body.classList.add('modo-cco');
  const recorrido = ['vegachi', 'sala', 'seguir', 'sis', 'accidente', 'sala', 'pbe', 'dolores', 'seguir', 'corredor'];
  let paso = 0;
  const siguiente = () => {
    let id = recorrido[paso++ % recorrido.length];
    // con una falla activa, el recorrido pasa por el lugar afectado
    const foco = { 'accidente-uf3': 'accidente', 'lluvia-dolores': 'dolores', 'energia-vegachi': 'vegachi', 'fibra-uf2': 'fibra', 'barrera-pbe': 'pbe' };
    const activo = (estado?.activos || []).find((a) => foco[a]);
    if (activo && paso % 3 === 0) id = foco[activo];
    ir(id);
    window.parent?.postMessage({ lugar: id === 'seguir' ? 'siguiendo un vehículo' : LUGARES[id].nombre }, '*');
  };
  setTimeout(siguiente, 1500);
  setInterval(siguiente, 16000);
} else setTimeout(() => ir('vegachi'), 1800);

// ---------- etiquetas HTML
const capa = document.getElementById('etiquetas');
const etiquetas = [];
function etiqueta(texto, pos, clase = '', { lejos = 1e9, cerca = 0 } = {}) {
  const el = document.createElement('div');
  el.className = `etq ${clase}`; el.innerHTML = texto;
  capa.appendChild(el);
  const e = { el, pos, lejos, cerca, visible: true };
  etiquetas.push(e);
  return e;
}
for (const p of datos.poblaciones) etiqueta(p.nombre, punto(p.s, 60).setY(40), 'pueblo', { lejos: 130000 });
for (const u of datos.ufs) etiqueta(u.id.replace('UF', 'UF-'), punto(u.desde + 1.5).setY(300), 'uf', { lejos: 200000, cerca: 6000 });
const etqPlazas = {};
for (const p of datos.plazas) etqPlazas[p.id] = etiqueta(`<small>PEAJE</small>${p.nombre.replace('Peaje ', '')}`, punto(p.s).setY(16), 'peaje', { lejos: 200000 });
const etqIts = {};
for (const d of datos.its) etqIts[d.id] = etiqueta(d.nombre, punto(d.s, d.tipo === 'pmv' || d.tipo === 'galibo' ? 0 : (d.sentido === 'B' ? -8 : 8)).setY(13), 'its', { lejos: 4500 });
etiqueta('<small>CCO</small>Centro de Control', punto(datos.cco.s, datos.cco.lat).setY(42), 'peaje', { lejos: 60000 });
const etqAcc = etiqueta('<small>DAI</small>Accidente km 100', punto(datos.accidente.s, 1.8).setY(12), 'falla', { lejos: 60000 });
etqAcc.el.style.display = 'none';
const etqUnid = new Map();
const v3 = new THREE.Vector3();
const centroCco = punto(datos.cco.s, datos.cco.lat);
function moverEtiquetas() {
  const w = window.innerWidth, h = window.innerHeight;
  // dentro de la sala de control las etiquetas del corredor se verían a través de las paredes
  const enSala = Math.hypot(camara.position.x - centroCco.x, camara.position.z - centroCco.z) < 26 && camara.position.y < 13;
  for (const e of etiquetas) {
    if (e.oculta || enSala) { e.el.style.display = 'none'; continue; }
    const d = camara.position.distanceTo(e.pos);
    v3.copy(e.pos).project(camara);
    const ver = v3.z < 1 && d < e.lejos && d > e.cerca && Math.abs(v3.x) < 1.1 && Math.abs(v3.y) < 1.1;
    e.el.style.display = ver ? '' : 'none';
    if (ver) e.el.style.transform = `translate(${(v3.x * 0.5 + 0.5) * w}px, ${(-v3.y * 0.5 + 0.5) * h}px) translate(-50%, -100%)`;
  }
}

// ---------- estado del backend
let estado = null, ultimoPoll = 0;
const hud = new Hud({
  alEscenario: (id) => accion(`/api/escenario/${id}`),
  alApagar: (id) => accion(`/api/escenario/${id}/apagar`),
  alReset: () => accion('/api/reset'),
  alVelocidad: (v) => accion(`/api/velocidad/${v}`),
});
async function accion(ruta) {
  try {
    const r = await fetch(ruta, { method: 'POST' });
    const j = await r.json();
    hud.aviso(r.ok ? j.mensaje : `No se pudo: ${j.detail || j.mensaje}`);
    sondear();
  } catch (e) { hud.aviso('Sin conexión con la demo'); }
}
async function sondear() {
  try {
    const r = await fetch('/api/estado', { cache: 'no-store' });
    if (!r.ok) return;
    estado = await r.json();
    ultimoPoll = performance.now();
    hud.armar(estado);
    hud.kpis(estado.kpi, estado);
    hud.botones(estado);
    hud.problemas(estado.problemas);
    hud.plazas(estado.plazas);
    hud.bitacora(estado.bitacora);
    vehiculos.actualizar(estado.vehiculos);
    unidades.actualizar(estado.unidades);
    aplicarEstado();
  } catch (e) { /* reintenta en el próximo ciclo */ }
}
setInterval(sondear, 500);
sondear();

const COLOR_LUZ = { ok: 0x38d996, falla: 0xff3b47, alerta: 0xffb020 };
function aplicarEstado() {
  for (const p of estado.plazas) {
    const pl = mundo.plazas[p.id];
    for (const c of pl.carriles) {
      const e = p.carriles.find((x) => x.id === c.id);
      c.barrera = e.barrera; c.falla = e.falla;
      c.sem.material.color.set(e.estado === 'cerrado' ? COLOR_LUZ.falla : e.estado === 'contingencia' ? COLOR_LUZ.alerta : COLOR_LUZ.ok);
    }
    const et = etqPlazas[p.id];
    et.el.classList.toggle('falla', p.modo !== 'normal' || p.carriles.some((c) => c.estado === 'cerrado'));
  }
  for (const d of estado.its) {
    const eq = mundo.its[d.id];
    eq.luz.material.color.set(!d.ok ? COLOR_LUZ.falla : d.alerta ? COLOR_LUZ.alerta : COLOR_LUZ.ok);
    etqIts[d.id].el.classList.toggle('falla', !d.ok || d.alerta);
    etqIts[d.id].lejos = !d.ok || d.alerta ? 40000 : 4500;
    if (d.mensaje && mundo.pmv[d.id] && mundo.pmv[d.id].ultimo !== d.mensaje) {
      mundo.pmv[d.id].ultimo = d.mensaje;
      mundo.pmv[d.id].pintar(d.mensaje.split(' · ').slice(0, 2));
    }
  }
  mundo.accidente.grupo.visible = estado.accidente;
  etqAcc.el.style.display = estado.accidente ? '' : 'none';
  etqAcc.oculta = !estado.accidente;
  for (const u of estado.unidades) {
    let e = etqUnid.get(u.id);
    if (!e) { e = etiqueta(u.nombre, new THREE.Vector3(), 'unidad', { lejos: 25000 }); etqUnid.set(u.id, e); }
    e.oculta = u.estado === 'en base';
    e.el.innerHTML = `<small>${u.estado}</small>${u.nombre}`;
  }
  pintarCco();
}

// pared de video del CCO con datos reales
let ultimoCco = 0;
function pintarCco() {
  if (performance.now() - ultimoCco < 2000) return;
  ultimoCco = performance.now();
  const cv = mundo.cco.pared.canvas, g = cv.getContext('2d');
  g.fillStyle = '#0b1220'; g.fillRect(0, 0, cv.width, cv.height);
  g.fillStyle = '#d40000'; g.fillRect(0, 0, cv.width, 54);
  g.fillStyle = '#fff'; g.font = 'bold 30px sans-serif'; g.textAlign = 'left';
  g.fillText('ZABBIX 8.0 · Centro de Control de Operaciones', 20, 38);
  const k = estado.kpi;
  const kp = [['Vehículos', k.vehiculos], ['Vel. media', `${k.velocidad.toFixed(0)} km/h`], ['Cola máx.', `${k.cola_km.toFixed(1)} km`], ['APM p95', `${k.latencia_ms} ms`]];
  kp.forEach(([n, v], i) => {
    g.fillStyle = '#16233a'; g.fillRect(20 + i * 250, 70, 236, 92);
    g.fillStyle = '#93a7c0'; g.font = '20px sans-serif'; g.fillText(n, 34 + i * 250, 98);
    g.fillStyle = '#fff'; g.font = 'bold 36px sans-serif'; g.fillText(String(v), 34 + i * 250, 144);
  });
  g.font = '22px sans-serif';
  const probs = estado.problemas.slice(0, 9);
  if (!probs.length) { g.fillStyle = '#38d996'; g.fillText('Sin problemas: operación normal', 24, 210); }
  probs.forEach((p, i) => {
    g.fillStyle = p.severidad >= 4 ? '#ff3b47' : p.severidad === 3 ? '#ffb020' : '#49c6ff';
    g.fillRect(20 + (p.sintoma ? 30 : 0), 186 + i * 34, 8, 26);
    g.fillStyle = p.tags?.incidente ? '#ff8ad8' : '#eaf1fb';
    g.fillText(p.nombre.slice(0, 70), 40 + (p.sintoma ? 30 : 0), 207 + i * 34);
  });
  mundo.cco.pared.tex.needsUpdate = true;
  pintarSala();
}

// pantallas de la sala de control: los mismos datos de Zabbix que el centro de mando (/api/zabbix)
let zdatos = null;
async function pintarSala() {
  try { zdatos = await (await fetch('/api/zabbix', { cache: 'no-store' })).json(); } catch (e) { /* usa lo último */ }
  const [p1, p2, p3] = mundo.cco.sala.pantallas;
  const dibujar = (pt, fn, datos) => { fn(pt.canvas.getContext('2d'), pt.canvas.width, pt.canvas.height, datos); pt.tex.needsUpdate = true; };
  dibujar(p1, pantallas.problemas, zdatos);
  dibujar(p2, pantallas.graficos, zdatos);
  dibujar(p3, pantallas.peajes, estado);
}

// ---------- lluvia
const NL = 9000;
const lluviaPos = new Float32Array(NL * 3);
const lluviaGeo = new THREE.BufferGeometry();
lluviaGeo.setAttribute('position', new THREE.BufferAttribute(lluviaPos, 3));
const lluvia = new THREE.Points(lluviaGeo, new THREE.PointsMaterial({ color: 0xb8c7d6, size: 0.5, transparent: true, opacity: 0.7 }));
lluvia.frustumCulled = false;
scene.add(lluvia);
for (let i = 0; i < NL; i++) { lluviaPos[i * 3] = (Math.random() - 0.5) * 900; lluviaPos[i * 3 + 1] = Math.random() * 300; lluviaPos[i * 3 + 2] = (Math.random() - 0.5) * 900; }
const zonaLluvia = punto((datos.lluvia.desde + datos.lluvia.hasta) / 2);

// ---------- ciclo
window.addEventListener('resize', () => {
  camara.aspect = window.innerWidth / window.innerHeight;
  camara.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
let previo = performance.now(), t = 0;
const cTmp = new THREE.Color();
function ciclo(ahora) {
  const dt = Math.min(0.1, (ahora - previo) / 1000);
  previo = ahora; t += dt;
  if (vuelo) {
    const f = Math.min(1, (ahora - vuelo.t0) / vuelo.dur), e = f < 0.5 ? 4 * f * f * f : 1 - Math.pow(-2 * f + 2, 3) / 2;
    camara.position.lerpVectors(vuelo.p0, vuelo.p, e);
    orbita.target.lerpVectors(vuelo.t0v, vuelo.t, e);
    if (f >= 1) vuelo = null;
  }
  if (seguido !== null && !vuelo) {
    const e = vehiculos.v.get(seguido);
    if (!e) seguir();
    else {
      // mueve cámara y objetivo con el vehículo: el usuario puede seguir orbitando alrededor
      const f = cor.marco(e.ss, e.ll, {});
      const dx = f.x - orbita.target.x, dz = f.z - orbita.target.z;
      orbita.target.x += dx; orbita.target.z += dz; camara.position.x += dx; camara.position.z += dz;
    }
  }
  orbita.update();
  const dist = camara.position.distanceTo(orbita.target);
  const lejos = dist > 3500;
  const vel = estado ? estado.velocidad : 1;
  vehiculos.dibujar(dt, vel, lejos, noche);
  unidades.dibujar(dt);
  mundo.traza.visible = dist > 2500;
  // barreras (animadas con el último dato del simulador) y baliza del accidente
  for (const pl of Object.values(mundo.plazas)) {
    for (const c of pl.carriles) {
      const objetivo = (c.barrera || 0) * 1.45;
      c.pivote.rotation.z += (c.sgn * objetivo - c.pivote.rotation.z) * Math.min(1, dt * 8);
      c.pivote.children[0].material.color.set(c.falla && Math.floor(t * 3) % 2 ? 0xff3b47 : 0xffffff);
    }
  }
  mundo.accidente.baliza.visible = Math.floor(t * 3) % 2 === 0;
  for (const u of etqUnid.keys()) {
    const e = unidades.u.get(u);
    if (e) etqUnid.get(u).pos.set(e.g.position.x, 10, e.g.position.z);
  }
  // día y noche según el reloj de la simulación (hora de Bogotá)
  if (estado) {
    const hora = ((estado.t_sim / 3600 - 5) % 24 + 24) % 24;
    const luzDia = THREE.MathUtils.clamp(Math.sin((hora - 6) / 12 * Math.PI) * 1.6, 0, 1);
    const ll = estado.lluvia * THREE.MathUtils.clamp(1 - orbita.target.distanceTo(zonaLluvia) / 12000, 0, 1);
    cTmp.copy(CIELO_NOCHE).lerp(CIELO_DIA, luzDia).lerp(CIELO_LLUVIA, ll * 0.7);
    scene.background.copy(cTmp); scene.fog.color.copy(cTmp);
    noche = 1 - luzDia;
    scene.environmentIntensity = 0.15 + 0.5 * luzDia;
    hemi.intensity = 0.25 + 1.05 * luzDia; sol.intensity = 0.1 + 2.1 * luzDia * (1 - ll * 0.6);
    lluvia.visible = ll > 0.05 && dist < 3000;
    if (lluvia.visible) {
      lluvia.position.set(orbita.target.x, 0, orbita.target.z);
      for (let i = 0; i < NL; i++) { lluviaPos[i * 3 + 1] -= dt * 160; if (lluviaPos[i * 3 + 1] < 0) lluviaPos[i * 3 + 1] += 300; }
      lluviaGeo.attributes.position.needsUpdate = true;
    }
  }
  scene.fog.near = Math.max(800, dist * 0.8);
  scene.fog.far = Math.max(9000, dist * 3.2);
  renderer.render(scene, camara);
  moverEtiquetas();
  requestAnimationFrame(ciclo);
}
requestAnimationFrame(ciclo);
window.addEventListener('keydown', (e) => {
  const atajos = { v: 'vegachi', s: 'sis', p: 'pbe', a: 'accidente', c: 'corredor', d: 'dolores', f: 'fibra', o: 'sala', x: 'seguir' };
  if (e.target.tagName !== 'SELECT' && atajos[e.key.toLowerCase()] && !e.metaKey && !e.ctrlKey) ir(atajos[e.key.toLowerCase()]);
});
void ultimoPoll;
