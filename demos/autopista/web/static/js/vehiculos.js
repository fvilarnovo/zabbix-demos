// Vehículos del corredor: tres InstancedMesh por variante (carrocería con el color de cada vehículo, detalles y luces),
// interpolados sobre el estado que manda el simulador. Cada vehículo llega como
// [id, s_km, lat_m, v_m/s (con signo del sentido), categoría, modo]; entre sondeos se extrapola con su velocidad
// (y la velocidad de la simulación) y se corrige suave hacia el último dato.
import * as THREE from 'three';
import { VARIANTES, PINTURA } from './modelos.js';

const Y = 0.35;
const MAX = 900;
const PUNTO = { 1: 0xffffff, 2: 0x49c6ff, 3: 0xffd166, 4: 0xffd166, 5: 0xffa94d, 6: 0xff7b54, 7: 0xff7b54 };

export class Vehiculos {
  constructor(scene, cor) {
    this.cor = cor;
    this.variantes = {};
    const pintura = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.38, metalness: 0.35, envMapIntensity: 0.9 });
    const detalle = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0.15, envMapIntensity: 0.6 });
    const luz = new THREE.MeshBasicMaterial({ vertexColors: true });
    for (const lista of Object.values(VARIANTES)) {
      for (const [nombre, fabricar] of lista) {
        const g = fabricar();
        const capa = (geo, mat) => {
          const im = new THREE.InstancedMesh(geo, mat, MAX);
          im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
          im.frustumCulled = false;
          im.count = 0;
          scene.add(im);
          return im;
        };
        this.variantes[nombre] = { carroceria: capa(g.carroceria, pintura), detalles: capa(g.detalles, detalle), luces: capa(g.luces, luz) };
      }
    }
    // vista lejana: un punto por vehículo
    this.pPos = new Float32Array(MAX * 3 * 3);
    this.pCol = new Float32Array(MAX * 3 * 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.pCol, 3).setUsage(THREE.DynamicDrawUsage));
    this.puntos = new THREE.Points(g, new THREE.PointsMaterial({ size: 4, sizeAttenuation: false, vertexColors: true, depthTest: false, transparent: true }));
    this.puntos.frustumCulled = false;
    this.puntos.renderOrder = 5;
    scene.add(this.puntos);
    this.v = new Map();
    this.o = new THREE.Object3D();
    this.c = new THREE.Color();
    this.m = {};
  }

  elegir(id, cat) {
    const lista = VARIANTES[cat] || VARIANTES[1];
    let r = ((id * 2654435761) % 1000) / 1000, nombre = lista[0][0];
    for (const [n, , peso] of lista) { if (r < peso) { nombre = n; break; } r -= peso; }
    const paleta = PINTURA[nombre];
    return { variante: nombre, color: paleta[(id * 7919) % paleta.length] };
  }

  actualizar(lista) {
    const vivos = new Set();
    for (const [id, s, lat, v, cat, modo] of lista) {
      vivos.add(id);
      let e = this.v.get(id);
      if (!e) {
        e = { s, lat, v, cat, ds: 0, dl: 0, ss: s, ll: lat, ...this.elegir(id, cat) };
        this.v.set(id, e);
      }
      // error entre lo que mostramos y el dato nuevo: se absorbe en ~0,5 s
      e.ds = e.ss - s; e.dl = e.ll - lat;
      if (Math.abs(e.ds) > 0.15) e.ds = 0;
      e.s = s; e.lat = lat; e.v = v; e.modo = modo;
    }
    for (const id of this.v.keys()) if (!vivos.has(id)) this.v.delete(id);
  }

  dibujar(dt, velocidad, lejos, noche = 0) {
    const cuenta = {};
    for (const k in this.variantes) cuenta[k] = 0;
    const amort = Math.exp(-dt * 5);
    let p = 0;
    for (const e of this.v.values()) {
      e.s += (e.v * dt * velocidad) / 1000;
      e.ds *= amort; e.dl *= amort;
      e.ss = e.s + e.ds; e.ll = e.lat + e.dl;
      const f = this.cor.marco(e.ss, e.ll, this.m);
      if (!lejos) {
        const capas = this.variantes[e.variante], i = cuenta[e.variante]++;
        this.o.position.set(f.x, Y, f.z);
        this.o.rotation.set(0, f.rumbo + (e.v < 0 || (e.v === 0 && e.ll < 0) ? Math.PI : 0), 0);
        this.o.updateMatrix();
        capas.carroceria.setMatrixAt(i, this.o.matrix);
        capas.detalles.setMatrixAt(i, this.o.matrix);
        capas.luces.setMatrixAt(i, this.o.matrix);
        capas.carroceria.setColorAt(i, this.c.set(e.color));
        // luces: tenues de día, encendidas de noche; los stops se encienden con el vehículo detenido
        const brillo = Math.abs(e.v) < 1 ? 1 : 0.35 + 0.65 * noche;
        capas.luces.setColorAt(i, this.c.setScalar(brillo));
      }
      this.pPos[p * 3] = f.x; this.pPos[p * 3 + 1] = 6; this.pPos[p * 3 + 2] = f.z;
      this.c.set(PUNTO[e.cat] || 0xffffff).toArray(this.pCol, p * 3);
      p++;
    }
    for (const [k, capas] of Object.entries(this.variantes)) {
      for (const im of Object.values(capas)) {
        im.count = lejos ? 0 : cuenta[k];
        im.instanceMatrix.needsUpdate = true;
        if (im.instanceColor) im.instanceColor.needsUpdate = true;
      }
    }
    this.puntos.geometry.setDrawRange(0, p);
    this.puntos.geometry.attributes.position.needsUpdate = true;
    this.puntos.geometry.attributes.color.needsUpdate = true;
    this.puntos.visible = lejos;
  }
}

// Grúas, ambulancia, inspección vial y técnicos: van por la berma con balizas.
export class Unidades {
  constructor(scene, cor) {
    this.cor = cor;
    this.scene = scene;
    this.u = new Map();
    this.m = {};
    this.t = 0;
  }

  crear(u) {
    const g = new THREE.Group();
    const color = { grua: 0xf2a900, ambulancia: 0xffffff, inspeccion: 0xf2f2f2, tecnico: 0x2f80ed }[u.tipo] || 0xffffff;
    const largo = u.tipo === 'grua' ? 7.5 : 5.2;
    const cuerpo = new THREE.Mesh(new THREE.BoxGeometry(2.1, 2.1, largo), new THREE.MeshLambertMaterial({ color }));
    cuerpo.position.y = 1.4; g.add(cuerpo);
    if (u.tipo === 'grua') {
      const pluma = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.35, 4.5), new THREE.MeshLambertMaterial({ color: 0x333333 }));
      pluma.position.set(0, 3.2, -2.2); pluma.rotation.x = 0.35; g.add(pluma);
    }
    if (u.tipo === 'ambulancia') {
      const cruz = new THREE.Mesh(new THREE.BoxGeometry(2.15, 0.5, 1.4), new THREE.MeshLambertMaterial({ color: 0xd03b3b }));
      cruz.position.y = 1.9; g.add(cruz);
    }
    const balizas = [0xff8c00, u.tipo === 'ambulancia' ? 0xff2020 : 0xffd000].map((c, i) => {
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.35, 8, 6), new THREE.MeshBasicMaterial({ color: c }));
      b.position.set(i ? 0.6 : -0.6, 2.75, largo / 2 - 1); g.add(b); return b;
    });
    this.scene.add(g);
    return { g, balizas, s: u.s, dir: 1 };
  }

  actualizar(lista) {
    for (const u of lista) {
      let e = this.u.get(u.id);
      if (!e) { e = this.crear(u); this.u.set(u.id, e); }
      e.dir = u.s > e.s + 1e-4 ? 1 : u.s < e.s - 1e-4 ? -1 : e.dir;
      e.meta = u.s; e.estado = u.estado; e.nombre = u.nombre; e.tipo = u.tipo;
    }
  }

  dibujar(dt) {
    this.t += dt;
    for (const e of this.u.values()) {
      e.s += (e.meta - e.s) * Math.min(1, dt * 2);
      const enBase = e.estado === 'en base';
      e.g.visible = !enBase;
      if (enBase) continue;
      const f = this.cor.marco(e.s, e.dir > 0 ? 6.2 : -6.2, this.m);
      e.g.position.set(f.x, 0.3, f.z);
      e.g.rotation.y = f.rumbo + (e.dir > 0 ? 0 : Math.PI);
      const on = Math.floor(this.t * 4) % 2 === 0;
      e.balizas[0].visible = on; e.balizas[1].visible = !on;
    }
  }
}
