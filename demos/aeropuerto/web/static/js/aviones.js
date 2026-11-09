// Aviones low-poly construidos por código y sus recorridos de despegue y aterrizaje.
import * as THREE from 'three';
import { Lote } from './lote.js';
import { POS_MANGAS } from './mundo.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

function geometriaAvion() {
  const l = new Lote();
  const perfil = [[.05, -19], [.5, -18], [1.1, -15], [2.0, -10], [2.3, -6], [2.3, 10], [2.2, 13], [1.8, 15.5], [1.1, 17.4], [.45, 18.5], [.02, 18.9]].map(([r, y]) => new THREE.Vector2(r, y));
  const fuselaje = new THREE.LatheGeometry(perfil, 18); fuselaje.rotateX(Math.PI / 2);
  l.agregar(fuselaje, '#f4f5f8');
  const ala = new THREE.Shape([[1.8, 4.5], [18.5, -6.2], [18.5, -8.3], [1.8, -3.2]].map(([a, b]) => new THREE.Vector2(a, b)));
  const opts = { depth: .28, bevelEnabled: false };
  const gAla = new THREE.ExtrudeGeometry(ala, opts); gAla.rotateX(Math.PI / 2); gAla.translate(0, -.9, 0);
  l.agregar(gAla, '#d6dbe3');
  const espejo = gAla.clone(); espejo.scale(-1, 1, 1); l.agregar(espejo, '#d6dbe3');
  for (const lado of [-1, 1]) {
    const motor = new THREE.CylinderGeometry(1.05, .85, 4.2, 14); motor.rotateX(Math.PI / 2);
    l.agregar(motor, '#c7cdd6', new THREE.Matrix4().setPosition(lado * 7.2, -1.9, 1.2));
    const boca = new THREE.CylinderGeometry(.88, .88, .1, 14); boca.rotateX(Math.PI / 2);
    l.agregar(boca, '#20252c', new THREE.Matrix4().setPosition(lado * 7.2, -1.9, 3.3));
    l.caja(.3, 2, .6, lado * 2.2, -3.4, -.4, '#3a4048');
  }
  const deriva = new THREE.ExtrudeGeometry(new THREE.Shape([[-19, 1.5], [-13, 1.5], [-16.4, 8.8], [-18.8, 8.8]].map(([a, b]) => new THREE.Vector2(a, b))), opts);
  deriva.rotateY(-Math.PI / 2); deriva.translate(.14, 0, 0);
  l.agregar(deriva, '#d40000');
  const estab = new THREE.Shape([[.6, -14.4], [7.6, -18.6], [7.6, -19.8], [.6, -18.4]].map(([a, b]) => new THREE.Vector2(a, b)));
  const gE = new THREE.ExtrudeGeometry(estab, opts); gE.rotateX(Math.PI / 2); gE.translate(0, 1.3, 0);
  l.agregar(gE, '#d6dbe3');
  const gE2 = gE.clone(); gE2.scale(-1, 1, 1); l.agregar(gE2, '#d6dbe3');
  const franja = new THREE.CylinderGeometry(2.32, 2.32, 26, 18, 1, true, Math.PI * .95, Math.PI * .1 + .3); franja.rotateX(Math.PI / 2);
  l.agregar(franja, '#d40000', new THREE.Matrix4().setPosition(0, 0, 0));
  l.caja(.25, 2.8, .25, 0, -3.4, 13, '#3a4048');
  return l;
}

const luzSprite = (() => {
  let t = null;
  return () => {
    if (t) return t;
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const x = c.getContext('2d'), g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(.25, 'rgba(255,255,255,.75)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.fillRect(0, 0, 64, 64);
    t = new THREE.CanvasTexture(c); return t;
  };
})();

function luz(padre, hex, tam, x, y, z) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: luzSprite(), color: hex, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
  s.scale.setScalar(tam); s.position.set(x, y, z); padre.add(s); return s;
}

let plantilla = null, ventanas = null;

export function crearAvion(base) {
  if (!plantilla) {
    plantilla = geometriaAvion().malla(base).geometry;
    const v = new Lote();
    for (let z = -11; z <= 13; z += 1.15) for (const lado of [-1, 1]) v.caja(.08, .34, .55, lado * 2.28, .5, z, '#ffffff');
    v.caja(3.1, .55, 1.3, 0, .7, 15.8, '#ffffff');
    ventanas = v.malla(new THREE.MeshBasicMaterial()).geometry;
  }
  const g = new THREE.Group();
  const cuerpo = new THREE.Mesh(plantilla, base); cuerpo.castShadow = true; g.add(cuerpo);
  const matV = new THREE.MeshStandardMaterial({ color: 0x121a26, emissive: 0xffdf9e, emissiveIntensity: .25, roughness: .2 });
  g.add(new THREE.Mesh(ventanas, matV));
  const roja = luz(g, 0xff2030, 5, 0, 2.9, 0);
  const izq = luz(g, 0xff2030, 4, -18.5, -.8, -7.2), der = luz(g, 0x30ff70, 4, 18.5, -.8, -7.2);
  const frente = luz(g, 0xfff4d0, 14, 0, -1.2, 18); frente.visible = false;
  g.userData = { matV, roja, izq, der, frente };
  return g;
}

// Recorrido con velocidad en cada punto: la distancia avanzada se integra según esa velocidad
class Ruta {
  constructor(nodos) {
    this.curva = new THREE.CatmullRomCurve3(nodos.map((n) => n.p), false, 'centripetal');
    this.largo = this.curva.getLength();
    const L = this.curva.getLengths(600);
    this.nodos = nodos.map((n, i) => ({ ...n, d: L[Math.round(i / (nodos.length - 1) * 600)] }));
  }

  velocidad(d) {
    const n = this.nodos;
    for (let i = 0; i < n.length - 1; i++) {
      if (d <= n[i + 1].d) { const t = (d - n[i].d) / Math.max(.001, n[i + 1].d - n[i].d); return n[i].v + (n[i + 1].v - n[i].v) * t; }
    }
    return n[n.length - 1].v;
  }
}

const DESPEGUE = () => new Ruta([
  { p: V(188, 2.9, -56), v: 6 }, { p: V(188, 2.9, -82), v: 8 }, { p: V(170, 2.9, -95), v: 14 },
  { p: V(-250, 2.9, -95), v: 18 }, { p: V(-390, 2.9, -95), v: 12 }, { p: V(-425, 2.9, -112), v: 7 },
  { p: V(-415, 2.9, -130), v: 5, espera: true }, { p: V(-250, 2.9, -130), v: 42 }, { p: V(-40, 2.9, -130), v: 76 },
  { p: V(90, 16, -130), v: 88 }, { p: V(420, 110, -130), v: 96 }, { p: V(950, 270, -130), v: 100 },
]);
const ATERRIZAJE = () => new Ruta([
  { p: V(-1100, 190, -130), v: 90 }, { p: V(-620, 66, -130), v: 78 }, { p: V(-340, 14, -130), v: 70 },
  { p: V(-230, 2.9, -130), v: 60 }, { p: V(60, 2.9, -130), v: 22 }, { p: V(145, 2.9, -128), v: 12 },
  { p: V(178, 2.9, -106), v: 8 }, { p: V(188, 2.9, -82), v: 6 }, { p: V(188, 2.9, -56), v: 4 },
]);

const adelante = new THREE.Vector3();

export class Aviones {
  constructor(scene, base) {
    this.parados = POS_MANGAS.map((x) => {
      const a = crearAvion(base); a.position.set(x, 3.15, -64); scene.add(a); return a;
    });
    this.moviles = [
      { avion: crearAvion(base), ruta: DESPEGUE(), d: 0, pausa: 0 },
      { avion: crearAvion(base), ruta: ATERRIZAJE(), d: 0, pausa: 14 },
    ];
    for (const m of this.moviles) { m.avion.visible = false; scene.add(m.avion); }
    this.t = 0;
  }

  actualizar(dt, est, sim, noche) {
    this.t += dt;
    const parpadeo = Math.sin(this.t * 7) > .2 ? 1 : 0;
    const todos = [...this.parados, ...this.moviles.map((m) => m.avion)];
    for (const a of todos) {
      const u = a.userData;
      u.matV.emissiveIntensity = .15 + noche * 2.4;
      u.roja.material.opacity = parpadeo; u.izq.material.opacity = u.der.material.opacity = .5 + noche * .5;
    }
    for (const m of this.moviles) {
      if (m.pausa > 0) { m.pausa -= dt * sim; m.avion.visible = false; continue; }
      const v = m.ruta.velocidad(m.d);
      // Con vuelos demorados el avión queda retenido en la cabecera
      const nodoEspera = m.ruta.nodos.find((n) => n.espera);
      const retenido = nodoEspera && est.kpi.vuelos_demorados > 0 && m.d < nodoEspera.d && m.d > nodoEspera.d - 8;
      if (!retenido) m.d += v * dt * sim;
      if (m.d >= m.ruta.largo) { m.d = 0; m.pausa = 10 + Math.random() * 10; m.avion.visible = false; continue; }
      const u = THREE.MathUtils.clamp(m.d / m.ruta.largo, 0, 1);
      m.ruta.curva.getPointAt(u, m.avion.position);
      m.ruta.curva.getTangentAt(u, adelante);
      m.avion.lookAt(m.avion.position.x + adelante.x, m.avion.position.y + adelante.y, m.avion.position.z + adelante.z);
      m.avion.userData.frente.visible = noche > .3 || m.avion.position.y > 4;
      m.avion.visible = true;
    }
  }
}
