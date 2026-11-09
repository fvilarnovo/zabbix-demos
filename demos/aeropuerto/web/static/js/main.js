// Escena principal: render, cámara, selección con clic y vínculo con el backend.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutlinePass } from 'three/addons/postprocessing/OutlinePass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { construirMundo, LUGARES, ciudadMat } from './mundo.js';
import { Multitud } from './personas.js';
import { Aviones } from './aviones.js';
import { Cielo, Chispas } from './cielo.js';
import { Hud } from './hud.js';

const cont = document.getElementById('escena');
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
let dpr = Math.min(window.devicePixelRatio || 1, 1.5);
renderer.setPixelRatio(dpr);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.shadowMap.autoUpdate = false;
cont.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xbfe0f5, 500, 3000);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), .04).texture;

const camara = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, .5, 7000);
camara.position.copy(LUGARES.general.p);
const orbita = new OrbitControls(camara, renderer.domElement);
orbita.target.copy(LUGARES.general.t);
orbita.enableDamping = true; orbita.dampingFactor = .07;
orbita.maxPolarAngle = Math.PI * .485; orbita.minDistance = 8; orbita.maxDistance = 520;

const mundo = construirMundo(scene);
mundo.ciudad = ciudadMat();
const baseAvion = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .42, metalness: .15, side: THREE.DoubleSide });
const multitud = new Multitud(scene);
const aviones = new Aviones(scene, baseAvion);
const cielo = new Cielo(scene);
const chispas = new Chispas(scene);

// Valijas sobre la cinta y acumulación cuando se detiene
const NV = 46;
const valijas = new THREE.InstancedMesh(new THREE.BoxGeometry(.72, .42, .95), new THREE.MeshStandardMaterial({ roughness: .55 }), NV);
valijas.frustumCulled = false; valijas.castShadow = true;
const COLV = ['#c0392b', '#2c3e50', '#16a085', '#8e44ad', '#d68910', '#34495e'];
const auxC = new THREE.Color();
for (let i = 0; i < NV; i++) valijas.setColorAt(i, auxC.set(COLV[i % COLV.length]));
scene.add(valijas);
const NP = 70;
const pila = new THREE.InstancedMesh(new THREE.BoxGeometry(.72, .42, .95), new THREE.MeshStandardMaterial({ roughness: .55 }), NP);
pila.frustumCulled = false;
for (let i = 0; i < NP; i++) pila.setColorAt(i, auxC.set(COLV[(i * 5) % COLV.length]));
scene.add(pila);

const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 }));
composer.setPixelRatio(dpr); composer.setSize(window.innerWidth, window.innerHeight);
composer.addPass(new RenderPass(scene, camara));
const outline = new OutlinePass(new THREE.Vector2(window.innerWidth, window.innerHeight), scene, camara);
outline.edgeStrength = 5; outline.edgeGlow = .8; outline.edgeThickness = 1.6; outline.visibleEdgeColor.set(0x49c6ff); outline.hiddenEdgeColor.set(0x1a4b6b); outline.enabled = false;
composer.addPass(outline);
const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth / 2, window.innerHeight / 2), .32, .6, 1.35);
composer.addPass(bloom);
composer.addPass(new OutputPass());

window.addEventListener('resize', () => {
  camara.aspect = window.innerWidth / window.innerHeight; camara.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight); composer.setSize(window.innerWidth, window.innerHeight);
});

let estado = null;
async function post(ruta, cuerpo) {
  const r = await fetch(ruta, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: cuerpo ? JSON.stringify(cuerpo) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.detail || `Error ${r.status}`);
  return j;
}

const hud = new Hud({
  accion: (nombre) => post(`/api/escenario/${nombre}`).then(() => hud.aviso('Escenario activado')).catch((e) => hud.aviso(e.message)),
  reset: () => post('/api/reset').then(() => hud.aviso('Reset: volviendo a la normalidad')).catch((e) => hud.aviso(e.message)),
  velocidad: (v) => post(`/api/velocidad/${v}`).catch((e) => hud.aviso(e.message)),
  vista: (v) => { if (v === 'tour') iniciarTour(); else volar(LUGARES.general); },
  dia: (m) => { cielo.modo = m; },
});

async function sondear() {
  try {
    const r = await fetch('/api/estado');
    if (r.ok) {
      estado = await r.json();
      hud.actualizar(estado);
      mundo.tablero(estado);
      for (const it of mundo.interactivos) it.alEstado?.(estado);
      const fallaP = estado.activos.includes('pasajes-error') || estado.activos.includes('pasajes-lentos');
      mundo.materiales.pantallas.emissive.set(fallaP ? 0xff2233 : 0x3fc1ff);
      mundo.materiales.ledCinta.emissive.set(estado.activos.includes('cinta') ? 0xff2233 : 0x38d996);
    }
  } catch { /* el sondeo reintenta */ }
  setTimeout(sondear, 1000);
}
sondear();

// Cámara: recorrido y vuelos a un punto
const TOUR = [LUGARES.general,
  { p: new THREE.Vector3(-70, 26, 52), t: new THREE.Vector3(-26, 2, 4) },
  { p: new THREE.Vector3(-25, 6.5, 19), t: new THREE.Vector3(-27, 1.2, -2) },
  { p: new THREE.Vector3(15, 7.5, 19), t: new THREE.Vector3(16, 1.5, -3) },
  { p: new THREE.Vector3(66, 22, -22), t: new THREE.Vector3(14, 2, -52) },
  { p: new THREE.Vector3(-170, 26, -60), t: new THREE.Vector3(-20, 8, -120) },
  { p: new THREE.Vector3(70, 34, -180), t: new THREE.Vector3(-30, 2, -40) },
];
let vuelo = null, tour = { activo: false, i: 0 }, ultimaInteraccion = performance.now();
const aEase = (t) => t * t * (3 - 2 * t);

function volar(destino, dur = 2.4) {
  tour.activo = false;
  vuelo = { p0: camara.position.clone(), t0: orbita.target.clone(), p1: destino.p.clone(), t1: destino.t.clone(), u: 0, dur };
  orbita.enabled = false;
}
function iniciarTour() { tour.activo = true; tour.i = 0; siguienteTour(); }
function siguienteTour() {
  tour.i = (tour.i + 1) % TOUR.length;
  vuelo = { p0: camara.position.clone(), t0: orbita.target.clone(), p1: TOUR[tour.i].p, t1: TOUR[tour.i].t, u: 0, dur: 7.5, enTour: true };
  orbita.enabled = false;
}

// Selección
const ray = new THREE.Raycaster(), puntero = new THREE.Vector2();
let hover = null, moved = 0;
const interactivos = mundo.interactivos.map((it) => { it.objeto.traverse((o) => { o.userData.it = it; }); return it; });

function apuntado() {
  ray.setFromCamera(puntero, camara);
  const hitP = ray.intersectObject(multitud.cuerpo, false)[0];
  const hits = ray.intersectObjects(interactivos.map((i) => i.objeto), true);
  const hitO = hits[0];
  if (hitP && (!hitO || hitP.distance < hitO.distance)) { const a = multitud.agente(hitP.instanceId); if (a) return { tipo: 'pax', a }; }
  if (hitO?.object.userData.it) return { tipo: 'obj', it: hitO.object.userData.it };
  return null;
}

renderer.domElement.addEventListener('pointermove', (e) => {
  puntero.set(e.clientX / window.innerWidth * 2 - 1, -(e.clientY / window.innerHeight * 2 - 1));
  moved += Math.abs(e.movementX) + Math.abs(e.movementY);
});
let tPick = 0;
function detectarHover(ahora) {
  if (ahora - tPick < 60) return;
  tPick = ahora;
  const h = apuntado();
  const obj = h?.tipo === 'obj' ? h.it : null;
  if (obj !== hover) {
    hover = obj;
    outline.selectedObjects = obj ? [obj.objeto] : [];
    outline.enabled = !!obj;
  }
  renderer.domElement.style.cursor = h ? 'pointer' : 'grab';
}

['pointerdown', 'wheel'].forEach((n) => renderer.domElement.addEventListener(n, () => {
  ultimaInteraccion = performance.now(); tour.activo = false; if (vuelo?.enTour) { vuelo = null; orbita.enabled = true; }
}));
renderer.domElement.addEventListener('pointerdown', () => { moved = 0; });
renderer.domElement.addEventListener('pointerup', () => { if (moved < 6) clic(); });

let pax = null;
function clic() {
  const h = apuntado(); if (!h) return;
  if (h.tipo === 'obj') {
    post(`/api/escenario/${h.it.escenario}`).then(() => hud.aviso('Falla provocada: mirá Zabbix')).catch((e) => hud.aviso(e.message));
    volar(LUGARES[h.it.id] || LUGARES.general, 1.8);
  } else {
    multitud.marcar(h.a);
    pax = { a: h.a, texto: 'Check-in en curso…', mal: false, hasta: performance.now() + 9000 };
    post('/api/checkin', { vuelo: estado?.vuelos?.[0]?.codigo || 'ZB410', valijas: 1 + Math.floor(Math.random() * 2) })
      .then((r) => { pax.texto = r.ok ? `Check-in OK · ${r.ms} ms · traza ${r.trace_id.slice(0, 8)}` : `Falló en ${r.paso} · ${r.ms} ms · traza ${(r.trace_id || '').slice(0, 8)}`; pax.mal = !r.ok; pax.hasta = performance.now() + 7000; })
      .catch((e) => { pax.texto = e.message; pax.mal = true; });
  }
}

// Bucle
const reloj = new THREE.Clock();
const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), tan = new THREE.Vector3(), esc = new THREE.Vector3(1, 1, 1), adel = new THREE.Vector3(0, 0, 1);
const vec = new THREE.Vector3();
let avanceCinta = 0, velVisual = 1.6, frames = 0, tFps = performance.now(), calidad = 2, cuadro = 0;
const largoCinta = mundo.curvaCinta.getLength();
const posicionEtiq = (n, ancla, despl = 0) => {
  vec.copy(ancla).project(camara);
  if (vec.z > 1) { n.style.display = 'none'; return; }
  const x = (vec.x + 1) / 2 * window.innerWidth, y = (1 - vec.y) / 2 * window.innerHeight;
  const dist = camara.position.distanceTo(ancla);
  n.style.display = dist > 340 ? 'none' : 'block';
  const s = THREE.MathUtils.clamp(70 / dist + .55, .68, 1.1);
  n.style.transform = `translate(${x}px, ${y - despl}px) translate(-50%, -100%) scale(${s})`;
};

function ajustarCalidad() {
  frames++;
  const ahora = performance.now();
  if (ahora - tFps < 2500) return;
  const fps = frames / ((ahora - tFps) / 1000);
  frames = 0; tFps = ahora;
  if (fps < 32 && calidad > 0) {
    calidad--;
    if (calidad === 1) { dpr = Math.min(dpr, 1); renderer.setPixelRatio(dpr); composer.setPixelRatio(dpr); composer.setSize(window.innerWidth, window.innerHeight); }
    if (calidad === 0) { bloom.enabled = false; renderer.shadowMap.enabled = false; scene.traverse((o) => { if (o.material) o.material.needsUpdate = true; }); }
  }
}

function animar() {
  requestAnimationFrame(animar);
  const dt = Math.min(reloj.getDelta(), .1);
  const ahora = performance.now();
  cuadro++;
  const sim = estado?.velocidad ?? 1;

  cielo.actualizar(dt, mundo);
  if (cuadro % 4 === 0 && renderer.shadowMap.enabled) renderer.shadowMap.needsUpdate = true;

  for (const f of mundo.animar) f(dt, sim);
  if (estado) {
    multitud.actualizar(dt, estado, sim);
    aviones.actualizar(dt, estado, sim, cielo.noche);

    velVisual += (estado.ot.cinta.vel - velVisual) * Math.min(1, dt * 2);
    avanceCinta = (avanceCinta + velVisual * dt * sim) % largoCinta;
    for (let i = 0; i < NV; i++) {
      const u = ((avanceCinta + i * (largoCinta / NV)) % largoCinta) / largoCinta;
      mundo.curvaCinta.getPointAt(u, p); mundo.curvaCinta.getTangentAt(u, tan);
      q.setFromUnitVectors(adel, tan);
      m.compose(p.setY(p.y + .3), q, esc); valijas.setMatrixAt(i, m);
    }
    valijas.instanceMatrix.needsUpdate = true;
    const visibles = Math.min(NP, Math.round(estado.kpi.backlog / 3.4));
    for (let i = 0; i < NP; i++) {
      if (i < visibles) { const c = i % 7, f = Math.floor(i / 7); m.makeTranslation(-48 + c * 1.05, .22 + f * .46, -9.1); } else m.makeScale(0, 0, 0);
      pila.setMatrixAt(i, m);
    }
    pila.instanceMatrix.needsUpdate = true;

    const falla = estado.activos.includes('cinta') ? mundo.posMotor : null;
    chispas.actualizar(dt, falla);

    for (const it of interactivos) {
      const f = it.falla(estado);
      const n = hud.etiqueta(it.id, it.etiqueta(estado), f, hover === it);
      posicionEtiq(n, it.ancla);
      // De lejos los scanners se superponen: solo se muestran si fallan o si la cámara está cerca
      if (it.id.startsWith('scanner') && !f && camara.position.distanceTo(it.ancla) > 95) n.style.display = 'none';
    }
    if (pax) {
      const n = hud.etiquetaPasajero(pax.texto, pax.mal);
      if (ahora > pax.hasta || !pax.a.activo) { n.style.display = 'none'; multitud.marcar(null); pax = null; } else posicionEtiq(n, p.set(pax.a.x, 2.1, pax.a.z), 8);
    }
  }

  if (vuelo) {
    vuelo.u += dt / vuelo.dur;
    const k = aEase(Math.min(1, vuelo.u));
    camara.position.lerpVectors(vuelo.p0, vuelo.p1, k); orbita.target.lerpVectors(vuelo.t0, vuelo.t1, k);
    camara.lookAt(orbita.target);
    if (vuelo.u >= 1) {
      const enTour = vuelo.enTour; vuelo = null; orbita.enabled = true; ultimaInteraccion = ahora;
      if (enTour && tour.activo) setTimeout(() => { if (tour.activo) siguienteTour(); }, 1800);
    }
  } else {
    orbita.update();
    if (!tour.activo && ahora - ultimaInteraccion > 40000) iniciarTour();
  }
  detectarHover(ahora);
  composer.render(dt);
  ajustarCalidad();
}
animar();
window.__escena = { camara, orbita, scene, cielo, renderer, volar, LUGARES, multitud, aviones };
