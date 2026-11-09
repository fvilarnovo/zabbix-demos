// La terminal: edificio, plataforma, pista y los objetos interactivos.
import * as THREE from 'three';
import { Lote, texturaCanvas } from './lote.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
export const LUGARES = {
  general: { p: V(86, 46, 88), t: V(-2, 3, -16) },
  cinta: { p: V(-40, 15, -28), t: V(-14, 1, -9) },
  mostrador: { p: V(-25, 8, 21), t: V(-27, 1.6, -3) },
  'scanner-1': { p: V(5, 8, 16), t: V(8, 1, -5) },
  'scanner-2': { p: V(15, 8, 16), t: V(16, 1, -5) },
  'scanner-3': { p: V(25, 8, 16), t: V(24, 1, -5) },
  'manga-1': { p: V(-22, 20, -30), t: V(-38, 4, -40) },
  'manga-2': { p: V(18, 20, -30), t: V(2, 4, -40) },
  'manga-3': { p: V(58, 20, -30), t: V(42, 4, -40) },
  ups: { p: V(-82, 10, 2), t: V(-66, 1.5, -7) },
};
export const CINTA_PUNTOS = [V(-50, 1.05, -7), V(-20, 1.05, -7), V(-6, 1.05, -7), V(-3, 1.05, -11), V(-3, 1.05, -26), V(-3, 1.05, -34), V(2, 1.05, -38), V(14, 1.05, -38)];
export const POS_MANGAS = [-40, 0, 40];
export const POS_SCANNERS = [8, 16, 24];

const fNormal = (hex, em = 1.6) => new THREE.MeshStandardMaterial({ color: 0x000000, emissive: hex, emissiveIntensity: em, roughness: .5 });

export function construirMundo(scene) {
  const base = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .72, metalness: .05, side: THREE.DoubleSide });
  const res = { interactivos: [], animar: [], materiales: {} };
  terreno(scene, base);
  edificio(scene, base, res);
  mostradores(scene, base, res);
  const cinta = cintaEquipaje(scene, base, res);
  scanners(scene, base, res);
  mangas(scene, base, res);
  ups(scene, base, res);
  mobiliario(scene, base);
  res.tablero = tableroVuelos(scene);
  res.curvaCinta = cinta;
  return res;
}

function terreno(scene, base) {
  const suelo = new THREE.Mesh(new THREE.CircleGeometry(1900, 48), new THREE.MeshStandardMaterial({ color: 0x2c4230, roughness: 1 }));
  suelo.rotation.x = -Math.PI / 2; suelo.position.y = -.08; suelo.receiveShadow = true;
  scene.add(suelo);
  const l = new Lote();
  const plano = (an, pr, x, z, hex, y = 0, rot = 0) => l.caja(an, .04, pr, x, y, z, hex, rot);
  plano(460, 84, -10, -64, '#8d9299');                 // plataforma
  plano(960, 44, 0, -130, '#3d4148', .01);             // pista
  plano(720, 18, -30, -95, '#50555c', .02);            // calle de rodaje
  plano(250, 26, -10, 40, '#34383e', 0);               // acceso vehicular
  plano(250, 6, -10, 25, '#b5bac1', 0);                // vereda
  for (let x = -460; x < 460; x += 34) plano(18, .9, x, -130, '#f2f2f2', .07);
  for (let i = -5; i <= 5; i++) { plano(30, 1.6, -440, -130 + i * 3.5, '#f2f2f2', .07); plano(30, 1.6, 440, -130 + i * 3.5, '#f2f2f2', .07); }
  plano(960, .6, 0, -109.6, '#f2f2f2', .07); plano(960, .6, 0, -150.4, '#f2f2f2', .07);
  plano(720, .5, -30, -95, '#ffcf33', .07);
  for (const x of POS_MANGAS) {
    plano(.5, 34, x, -62, '#ffcf33', .07); plano(44, .4, x, -46, '#ffffff', .07); plano(.4, 40, x - 22, -62, '#d94141', .07); plano(.4, 40, x + 22, -62, '#d94141', .07);
  }
  for (let x = -115; x <= 115; x += 14) plano(5, .35, x, 40, '#8f949b', .05);

  // Torre de control y hangar
  const tx = 96, tz = -84;
  l.cilindro(3, 4.4, 34, tx, 0, tz, '#d7dbe1', 16);
  l.cilindro(7, 4, 3.4, tx, 34, tz, '#9aa4b1', 16).cilindro(8.2, 7, 1, tx, 44, tz, '#7e8895', 16);
  l.caja(62, 22, 40, 188, 0, -56, '#b8bfc9').caja(62, 3, 42, 188, 22, -56, '#cf2a2a');
  scene.add(l.malla(base));

  const cabina = new THREE.Mesh(new THREE.CylinderGeometry(8, 7, 6.8, 16, 1, true), new THREE.MeshStandardMaterial({ color: 0x16273a, roughness: .08, metalness: .9, emissive: 0x4ec5ff, emissiveIntensity: .35 }));
  cabina.position.set(tx, 40.4, tz); scene.add(cabina);

  // Árboles del acceso
  const copa = new THREE.InstancedMesh(new THREE.ConeGeometry(2.6, 7, 7), new THREE.MeshStandardMaterial({ color: 0x2f7a43, roughness: .9, flatShading: true }), 90);
  const m = new THREE.Matrix4();
  for (let i = 0; i < 90; i++) {
    const x = -160 + (i * 37) % 320, z = 66 + (i * 13) % 80;
    m.makeScale(1, 1 + (i % 5) * .15, 1).setPosition(x, 4, z);
    copa.setMatrixAt(i, m);
  }
  copa.castShadow = true; scene.add(copa);

  // Horizonte urbano con ventanas que se encienden de noche
  const ventanas = texturaCanvas(128, 256, (c, an, al) => {
    c.fillStyle = '#000'; c.fillRect(0, 0, an, al);
    for (let y = 6; y < al; y += 12) for (let x = 6; x < an; x += 12) { c.fillStyle = Math.random() > .55 ? '#ffd28a' : '#000'; c.fillRect(x, y, 6, 7); }
  });
  const edifMat = new THREE.MeshStandardMaterial({ color: 0x4b5a70, roughness: .8, emissive: 0xffffff, emissiveMap: ventanas, emissiveIntensity: 0 });
  const ciudad = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), edifMat, 170);
  for (let i = 0; i < 170; i++) {
    const a = i * 2.399, r = 980 + (i * 83) % 620, al = 28 + (i * 41) % 130;
    m.makeScale(26 + (i * 7) % 34, al, 26 + (i * 11) % 34).setPosition(Math.cos(a) * r, al / 2, Math.abs(Math.sin(a)) * r * .9 + 80);
    ciudad.setMatrixAt(i, m);
  }
  scene.add(ciudad);
  terreno.ciudad = edifMat;

  // Balizas de pista y rodaje (reciben bloom)
  const puntos = [];
  for (let x = -470; x <= 470; x += 20) puntos.push([x, -109, '#fff4d6'], [x, -151, '#fff4d6']);
  for (let x = -380; x <= 320; x += 18) puntos.push([x, -85.5, '#4fb6ff'], [x, -104.5, '#4fb6ff']);
  const balizas = new THREE.InstancedMesh(new THREE.SphereGeometry(.42, 6, 5), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), puntos.length);
  const c = new THREE.Color();
  puntos.forEach(([x, z, hex], i) => { m.makeTranslation(x, .5, z); balizas.setMatrixAt(i, m); balizas.setColorAt(i, c.set(hex).multiplyScalar(5)); });
  scene.add(balizas);
  terreno.balizas = balizas;
}

function edificio(scene, base, res) {
  const piso = new THREE.Mesh(new THREE.BoxGeometry(124, .3, 46), new THREE.MeshStandardMaterial({
    roughness: .22, metalness: .15,
    map: texturaCanvas(1024, 512, (c, an, al) => {
      c.fillStyle = '#aab3bf'; c.fillRect(0, 0, an, al);
      c.strokeStyle = 'rgba(70,84,104,.16)'; c.lineWidth = 1;
      for (let x = 0; x <= an; x += 32) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, al); c.stroke(); }
      for (let y = 0; y <= al; y += 32) { c.beginPath(); c.moveTo(0, y); c.lineTo(an, y); c.stroke(); }
      c.fillStyle = 'rgba(212,0,0,.22)'; c.fillRect(0, 248, an, 16);
    }),
  }));
  piso.position.set(0, -.14, 0); piso.receiveShadow = true; scene.add(piso);

  const l = new Lote();
  const altura = (x) => 14 + 3.4 * Math.cos(x / 62 * Math.PI);      // techo ondulado
  // Parantes de fachada y muro trasero bajo
  for (let x = -60; x <= 60; x += 5) { l.caja(.18, 8.5, .18, x, 0, 23, '#aeb8c6'); l.caja(.18, 8.5, .18, x, 0, -23, '#aeb8c6'); }
  l.caja(120, .25, .25, 0, 8.5, 23, '#aeb8c6').caja(120, .25, .25, 0, 8.5, -23, '#aeb8c6');
  l.caja(52, 3.2, .4, -33, 0, -23, '#59677a').caja(58, 3.2, .4, 31, 0, -23, '#59677a');
  scene.add(l.malla(base));

  const vidrio = new THREE.MeshStandardMaterial({ color: 0x4c8fbd, roughness: .08, metalness: .6, transparent: true, opacity: .1, side: THREE.DoubleSide, depthWrite: false, envMapIntensity: .35 });
  const techo = new THREE.PlaneGeometry(120, 46, 48, 20);
  const p = techo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), s = p.getY(i) / 23;
    const h = altura(x) + 2.2;
    p.setXYZ(i, x, 8.5 + (h - 8.5) * (1 - s * s), s * 23);
  }
  techo.computeVertexNormals();
  const malla = new THREE.Mesh(techo, vidrio); malla.renderOrder = 5; scene.add(malla);
  res.techo = vidrio;
  for (const z of [-23, 23]) { const f = new THREE.Mesh(new THREE.PlaneGeometry(120, 8.5), vidrio); f.position.set(0, 4.25, z); f.renderOrder = 4; scene.add(f); }

  // Tiras de luz interior: bloom de noche
  const luz = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xfff0d8, emissiveIntensity: 1 });
  const tiras = new Lote();
  for (let x = -55; x <= 55; x += 10) for (const z of [-10, 0, 10]) tiras.caja(6.5, .08, .35, x, 11, z, '#ffffff');
  const mtiras = tiras.malla(luz, false); scene.add(mtiras);
  res.materiales.luz = luz;

  // La luz real del interior y los reflectores de plataforma (sin sombras: son baratos)
  res.lucesInterior = [-36, 0, 36].map((x) => {
    const l2 = new THREE.PointLight(0xfff0dc, 320, 70, 1.25); l2.position.set(x, 10, 2); scene.add(l2); return l2;
  });
  res.reflectores = [-26, 34].map((x) => {
    const l2 = new THREE.PointLight(0xd8e6ff, 0, 130, 1.1); l2.position.set(x, 24, -62); scene.add(l2); return l2;
  });
  autos(scene, res);
}

function autos(scene, res) {
  const N = 26;
  const cuerpo = new THREE.InstancedMesh(new THREE.BoxGeometry(4.2, 1.3, 1.9), new THREE.MeshStandardMaterial({ roughness: .35, metalness: .3 }), N);
  const faros = new THREE.InstancedMesh(new THREE.BoxGeometry(.15, .25, 1.6), new THREE.MeshBasicMaterial({ toneMapped: false }), N);
  const c = new THREE.Color(), m = new THREE.Matrix4();
  const lista = [];
  for (let i = 0; i < N; i++) {
    const sentido = i % 2 ? 1 : -1;
    lista.push({ x: -125 + i * 19.5, z: 40 + sentido * 3.6 + (i % 4 ? 0 : sentido * 3.4), sentido, v: 11 + (i * 7) % 8 });
    cuerpo.setColorAt(i, c.set(['#f4c430', '#e8e8ee', '#1d2a3a', '#b53838', '#3d6fa8'][i % 5]));
    faros.setColorAt(i, c.set(sentido > 0 ? '#ff5a5a' : '#fff1c9').multiplyScalar(4));
  }
  cuerpo.frustumCulled = false; faros.frustumCulled = false; cuerpo.castShadow = true;
  scene.add(cuerpo, faros);
  res.animar.push((dt, sim) => {
    for (let i = 0; i < N; i++) {
      const a = lista[i];
      a.x += a.sentido * a.v * dt * sim;
      if (a.x > 125) a.x = -125; else if (a.x < -125) a.x = 125;
      m.makeTranslation(a.x, 1, a.z); cuerpo.setMatrixAt(i, m);
      m.makeTranslation(a.x + a.sentido * -2.15, 1.05, a.z); faros.setMatrixAt(i, m);
    }
    cuerpo.instanceMatrix.needsUpdate = true; faros.instanceMatrix.needsUpdate = true;
  });
}

function mostradores(scene, base, res) {
  const g = new THREE.Group(); g.name = 'mostrador';
  const l = new Lote();
  const pantallas = new Lote();
  for (let i = 0; i < 8; i++) {
    const x = -50 + i * 6;
    l.caja(4.4, 1.15, 1.4, x, 0, -3, '#2b3a4e').caja(4.6, .1, 1.6, x, 1.15, -3, '#e9edf2');
    l.caja(.14, 2.9, .14, x, 1.25, -3.6, '#7c8896');
    pantallas.caja(3.8, 1.1, .12, x, 3.2, -3.6, '#ffffff');
    l.caja(1.3, .5, .9, x + 3, .05, -3.2, '#55626f');   // balanza
  }
  l.caja(50, 6, .3, -29, 0, -5.3, '#233044');
  const cuerpo = l.malla(base); g.add(cuerpo);
  const mp = fNormal(0x3fc1ff, 1.3);
  const mpm = pantallas.malla(mp, false); g.add(mpm);
  scene.add(g);
  res.materiales.pantallas = mp;

  // Letrero de la aerolínea
  const letrero = new THREE.Mesh(new THREE.PlaneGeometry(30, 3.4), new THREE.MeshBasicMaterial({ toneMapped: false, map: texturaCanvas(1024, 116, (c, an, al) => {
    c.fillStyle = '#c20d17'; c.fillRect(0, 0, an, al);
    c.fillStyle = '#fff'; c.font = '700 66px ui-sans-serif, -apple-system, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText('Check-in  ·  ZBX Air', an / 2, al / 2 + 4);
  }) }));
  letrero.position.set(-29, 6.1, -5.1); g.add(letrero);
  res.interactivos.push({ id: 'mostrador', objeto: g, escenario: 'pasajes-error', ancla: V(-29, 8.6, -4), etiqueta: (e) => ['Mostradores', e.kpi.errores_pct > 20 ? `Pasajes ${Math.round(e.kpi.errores_pct)} % error` : `p95 ${e.kpi.latencia_ms} ms`], falla: (e) => e.activos.includes('pasajes-error') || e.activos.includes('pasajes-lentos') });
}

function cintaEquipaje(scene, base, res) {
  const curva = new THREE.CatmullRomCurve3(CINTA_PUNTOS, false, 'catmullrom', .2);
  const g = new THREE.Group(); g.name = 'cinta';
  const l = new Lote();
  const n = 110, q = new THREE.Quaternion(), s = V(1, 1, 1), adelante = V(0, 0, 1);
  const pts = curva.getSpacedPoints(n);
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[i + 1], t = b.clone().sub(a).normalize();
    q.setFromUnitVectors(adelante, t);
    const m = new THREE.Matrix4().compose(a.clone().lerp(b, .5), q, s);
    l.agregar(new THREE.BoxGeometry(1.25, .1, a.distanceTo(b) * 1.08), '#1e2329', m);
    for (const lado of [-.72, .72]) {
      const mL = new THREE.Matrix4().compose(a.clone().lerp(b, .5).add(V(t.z * lado, .08, -t.x * lado)), q, s);
      l.agregar(new THREE.BoxGeometry(.14, .3, a.distanceTo(b) * 1.08), '#d4a017', mL);
    }
    if (i % 4 === 0) l.caja(1.4, .95, .16, a.x, 0, a.z, '#4b5663', Math.atan2(t.x, t.z));
  }
  g.add(l.malla(base));
  const motor = new Lote();
  motor.caja(2.4, 2.1, 2.2, -8, 0, -9.4, '#3d5a80').cilindro(.55, .55, 1.8, -8, 2.1, -9.4, '#657a94');
  g.add(motor.malla(base));
  scene.add(g);
  const led = fNormal(0x38d996, 2.5);
  const foco = new THREE.Mesh(new THREE.SphereGeometry(.3, 12, 10), led); foco.position.set(-8, 4.2, -9.4); g.add(foco);
  res.materiales.ledCinta = led;
  res.interactivos.push({ id: 'cinta', objeto: g, escenario: 'cinta', ancla: V(-8, 5.2, -9.4), etiqueta: (e) => ['Cinta', `${e.ot.cinta.corriente.toFixed(1)} A · ${e.kpi.valijas_h} val/h`], falla: (e) => e.activos.includes('cinta') });
  res.posMotor = V(-8, 2.8, -9.4);
  return curva;
}

function scanners(scene, base, res) {
  POS_SCANNERS.forEach((x, i) => {
    const n = i + 1, g = new THREE.Group(); g.name = `scanner-${n}`;
    const l = new Lote();
    l.caja(2.3, 2, 4, x, 0, -4, '#d6dbe2').caja(1.1, 1.4, .1, x, .4, -1.97, '#1f2733').caja(1.1, 1.4, .1, x, .4, -6.03, '#1f2733');
    l.caja(.9, .7, 8.4, x, 0, -4, '#2a313c');
    l.caja(.22, 2.7, .3, x - 1.05, 0, -9.2, '#c2c9d3').caja(.22, 2.7, .3, x + 1.05, 0, -9.2, '#c2c9d3').caja(2.3, .32, .3, x, 2.7, -9.2, '#c2c9d3');
    g.add(l.malla(base));
    const mat = fNormal(0x38d996, 3);
    const haz = new THREE.Mesh(new THREE.BoxGeometry(1.9, .08, .14), mat); haz.position.set(x, 2.5, -9.2); g.add(haz);
    const luz = new THREE.Mesh(new THREE.BoxGeometry(1.5, .16, .16), mat); luz.position.set(x, 2.1, -2); g.add(luz);
    scene.add(g);
    res.interactivos.push({
      id: g.name, objeto: g, escenario: g.name, ancla: V(x, 4.4, -4),
      etiqueta: (e) => [`Scanner ${n}`, e.ot.scanners[i].ok ? 'En servicio' : 'FUERA DE SERVICIO'], falla: (e) => !e.ot.scanners[i].ok,
      alEstado: (e) => { mat.emissive.set(e.ot.scanners[i].ok ? 0x38d996 : 0xff2233); },
    });
  });
}

function mangas(scene, base, res) {
  POS_MANGAS.forEach((x, i) => {
    const n = i + 1, g = new THREE.Group(); g.name = `manga-${n}`;
    const l = new Lote();
    const a = V(x, 4.7, -23), b = V(x + 4, 4.7, -46);
    const largo = a.distanceTo(b), rot = Math.atan2(b.x - a.x, b.z - a.z), c = a.clone().lerp(b, .5);
    l.caja(2.6, 2.6, largo, c.x, a.y - 1.3, c.z, '#c6ccd6', rot);
    l.caja(2.7, .35, largo * 1.01, c.x, a.y + 1.3, c.z, '#8e98a7', rot);
    l.cilindro(.55, .7, 3.4, b.x, 0, b.z + 2, '#59657a', 10).caja(3, .5, 1.4, b.x, 3.1, b.z + 2, '#3d4757');
    l.caja(4.2, 3, 3, x, 3.2, -23, '#a4aebd');
    g.add(l.malla(base));
    const mat = fNormal(0x38d996, 2.6);
    const faro = new THREE.Mesh(new THREE.SphereGeometry(.34, 12, 10), mat); faro.position.set(b.x, 7.2, b.z); g.add(faro);
    scene.add(g);
    res.interactivos.push({
      id: g.name, objeto: g, escenario: g.name, ancla: V(b.x, 8.6, b.z),
      etiqueta: (e) => [`Manga ${n}`, e.ot.mangas[i].ok ? 'Conectada' : 'SIN CONEXIÓN'], falla: (e) => !e.ot.mangas[i].ok,
      alEstado: (e) => { mat.emissive.set(e.ot.mangas[i].ok ? 0x38d996 : 0xff2233); },
    });
  });
}

function ups(scene, base, res) {
  const g = new THREE.Group(); g.name = 'ups';
  const l = new Lote();
  l.caja(10, .3, 14, -67, 0, -7, '#7c8794').caja(10, 3.6, .2, -67, .3, -14, '#566273').caja(.2, 3.6, 14, -72, .3, -7, '#566273');
  for (let i = 0; i < 4; i++) l.caja(1.4, 2.5, 1.5, -70.2, .3, -11.5 + i * 2.5, '#20262f');
  g.add(l.malla(base));
  const led = fNormal(0x38d996, 3);
  const leds = new Lote();
  for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) leds.caja(.05, .12, .3, -69.47, 1.2 + j * .42, -11.8 + i * 2.5, '#ffffff');
  g.add(leds.malla(led, false));
  scene.add(g);
  res.interactivos.push({
    id: 'ups', objeto: g, escenario: 'ups', ancla: V(-68, 5.4, -7),
    etiqueta: (e) => ['UPS T1', e.ot.ups.en_bateria ? `En batería · ${e.ot.ups.bateria} %` : `${e.ot.ups.bateria} %`], falla: (e) => e.ot.ups.en_bateria,
    alEstado: (e) => { led.emissive.set(e.ot.ups.en_bateria ? 0xffa020 : 0x38d996); },
  });
}

function mobiliario(scene, base) {
  const l = new Lote();
  // Kioscos de check-in
  for (let i = 0; i < 7; i++) l.caja(.9, 1.6, .7, -50 + i * 6.6, 0, 17.5, '#223249').caja(.72, .9, .08, -50 + i * 6.6, 1, 17.12, '#59c9ff');
  // Separadores de filas
  for (let z = 2.7; z < 14; z += 2.8) { for (let x = -50; x <= -10; x += 2.5) l.cilindro(.05, .05, 1, x, 0, z, '#8c97a5', 6); l.caja(40, .05, .05, -30, .95, z, '#2c6fd0'); }
  for (let z = 2.7; z < 16; z += 2.8) { for (let x = 3; x <= 29; x += 2.5) l.cilindro(.05, .05, 1, x, 0, z, '#8c97a5', 6); l.caja(26, .05, .05, 16, .95, z, '#2c6fd0'); }
  // Salas de embarque
  for (let x = 35; x < 58; x += 3.4) for (let z = -6; z <= 16; z += 4.4) { l.caja(2.8, .42, .75, x, 0, z, '#374a64').caja(2.8, .7, .12, x, .42, z - .34, '#435a79'); }
  // Maceteros
  for (const [x, z] of [[-56, 14], [-2, 16], [32, 18], [32, -8], [58, -14]]) { l.cilindro(.9, .7, .9, x, 0, z, '#6d6256', 10); l.agregar(new THREE.IcosahedronGeometry(1.5, 1), '#2f8048', new THREE.Matrix4().setPosition(x, 2.4, z)); }
  // Vehículos de plataforma fijos
  for (const x of [-20, 20, 62]) { l.caja(3.6, 1.4, 2, x, .3, -36, '#f0b429').caja(1.6, 1, 1.8, x - .8, 1.7, -36, '#2a3340'); }
  scene.add(l.malla(base));
  const pasajerosSentados = new THREE.InstancedMesh(new THREE.CapsuleGeometry(.3, .7, 2, 8), new THREE.MeshStandardMaterial({ roughness: .8 }), 90);
  const m = new THREE.Matrix4(), c = new THREE.Color();
  for (let i = 0; i < 90; i++) {
    const x = 35.6 + ((i * 31) % 7) * 3.4 + ((i % 3) - 1) * .9, z = -5.9 + ((i * 17) % 6) * 4.4;
    m.makeTranslation(x, 1, z); pasajerosSentados.setMatrixAt(i, m);
    pasajerosSentados.setColorAt(i, c.setHSL((i * .137) % 1, .5, .48));
  }
  scene.add(pasajerosSentados);
}

function tableroVuelos(scene) {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 512;
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  const panel = new THREE.Mesh(new THREE.PlaneGeometry(30, 15), new THREE.MeshBasicMaterial({ map: t, toneMapped: false, color: 0xb8b8b8 }));
  panel.position.set(4, 13.5, -14); scene.add(panel);
  const marco = new THREE.Mesh(new THREE.BoxGeometry(31, 16, .4), new THREE.MeshStandardMaterial({ color: 0x141a24 }));
  marco.position.set(4, 13.5, -14.25); scene.add(marco);
  return (est) => {
    const x = c.getContext('2d');
    x.fillStyle = '#05101d'; x.fillRect(0, 0, 1024, 512);
    x.fillStyle = '#ffb020'; x.font = '700 40px ui-monospace, Menlo, monospace'; x.fillText('SALIDAS', 26, 50);
    x.fillStyle = '#7fa0c7'; x.font = '26px ui-monospace, Menlo, monospace';
    x.fillText('HORA  VUELO   DESTINO         PTA  ESTADO', 26, 92);
    est.vuelos.forEach((v, i) => {
      const y = 140 + i * 45;
      x.fillStyle = '#e8f1fb'; x.font = '30px ui-monospace, Menlo, monospace';
      x.fillText(`${v.hora} ${v.codigo.padEnd(6)} ${v.destino.padEnd(13).slice(0, 13)} ${v.puerta.padEnd(4)}`, 26, y);
      x.fillStyle = v.estado === 'Demorado' ? '#ff4a55' : v.estado === 'Embarcando' ? '#49d98e' : '#9cc9ff';
      x.fillText(v.estado.toUpperCase(), 690, y);
    });
    t.needsUpdate = true;
  };
}

export const ciudadMat = () => terreno.ciudad;
export const balizasMesh = () => terreno.balizas;
