// Multitud con instancing: la longitud de las filas sigue los valores que manda la simulación.
import * as THREE from 'three';
import { POS_SCANNERS } from './mundo.js';

const MAX = 460;
const VEL = 3.4;
const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), eje = new THREE.Vector3(0, 1, 0), col = new THREE.Color();
const ROPA = ['#d8504f', '#3b82c4', '#e8a33d', '#4aa56f', '#8a64c9', '#e8e8ee', '#2f3b4f', '#c44f8d', '#3fb4b4', '#b7763d'];
const PIEL = ['#f0c9a4', '#d8a47c', '#a9744f', '#7c5235'];

// Filas en zigzag: posición de la persona n dentro de cada cola
const FILA_C = { cab: [-12, 1.4], ancho: 38, paso: .88, sep: 2.8, dir: -1, x0: -12 };
const FILA_S = { cab: [29, 1.4], ancho: 26, paso: .88, sep: 2.8, dir: -1, x0: 29 };
function puesto(f, n) {
  const porFila = Math.floor(f.ancho / f.paso);
  const fila = Math.floor(n / porFila), r = n - fila * porFila;
  const avance = (fila % 2 === 0 ? r : porFila - 1 - r) * f.paso;
  return [f.x0 + f.dir * avance, f.cab[1] + fila * f.sep];
}

export class Multitud {
  constructor(scene) {
    const materiales = new THREE.MeshStandardMaterial({ roughness: .75 });
    this.cuerpo = new THREE.InstancedMesh(new THREE.CapsuleGeometry(.31, .95, 3, 8), materiales, MAX);
    this.cabeza = new THREE.InstancedMesh(new THREE.SphereGeometry(.2, 8, 7), new THREE.MeshStandardMaterial({ roughness: .6 }), MAX);
    for (const o of [this.cuerpo, this.cabeza]) { o.frustumCulled = false; o.instanceMatrix.setUsage(THREE.DynamicDrawUsage); scene.add(o); }
    this.cuerpo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 3000);
    this.agentes = [];
    for (let i = 0; i < MAX; i++) {
      this.agentes.push({ i, activo: false, x: 0, z: 0, tx: 0, tz: 0, fase: 'libre', fase2: 0, t: Math.random() * 6, escala: 0, dest: null });
      this.cuerpo.setColorAt(i, col.set(ROPA[i % ROPA.length]));
      this.cabeza.setColorAt(i, col.set(PIEL[(i * 3) % PIEL.length]));
    }
    this.colaC = []; this.colaS = [];
    this.tNacer = 0; this.tC = 0; this.tS = 0;
    this.marcado = null;
    const aro = new THREE.Mesh(new THREE.RingGeometry(.55, .78, 28), new THREE.MeshBasicMaterial({ color: 0x49c6ff, side: THREE.DoubleSide, toneMapped: false, transparent: true, opacity: .95 }));
    aro.rotation.x = -Math.PI / 2; aro.visible = false; scene.add(aro); this.aro = aro;
  }

  libre() { return this.agentes.find((a) => !a.activo); }

  nacer() {
    const a = this.libre(); if (!a) return;
    a.activo = true; a.x = -46 + Math.random() * 36; a.z = 23.5; a.fase = 'colaC'; a.escala = .01;
    this.colaC.push(a); this.reordenar(this.colaC, FILA_C);
  }

  reordenar(cola, fila) { cola.forEach((a, n) => { const [x, z] = puesto(fila, n); a.tx = x; a.tz = z; }); }

  atenderC() {
    const a = this.colaC.shift(); if (!a) return;
    this.reordenar(this.colaC, FILA_C);
    a.fase = 'desk'; a.tx = -50 + Math.floor(Math.random() * 8) * 6; a.tz = -1.4; a.fase2 = 1.2 + Math.random();
  }

  haciaSeguridad(a) {
    if (this.colaS.length >= 150) { a.fase = 'salir'; return; }
    a.fase = 'colaS'; this.colaS.push(a); this.reordenar(this.colaS, FILA_S);
  }

  atenderS(est) {
    const libres = POS_SCANNERS.filter((_, i) => est.ot.scanners[i].ok);
    if (!libres.length) return;
    const a = this.colaS.shift(); if (!a) return;
    this.reordenar(this.colaS, FILA_S);
    a.fase = 'scan'; a.tx = libres[Math.floor(Math.random() * libres.length)]; a.tz = 0.2;
  }

  // Devuelve el agente bajo un instanceId, si está activo
  agente(id) { const a = this.agentes[id]; return a && a.activo ? a : null; }

  marcar(a) { this.marcado = a; this.aro.visible = !!a; }

  actualizar(dt, est, sim) {
    const k = est.kpi, simdt = dt * sim;
    const deseadoC = Math.min(170, Math.round(k.cola_checkin * 1.6));
    const deseadoS = Math.min(150, Math.round(k.cola_seguridad * 1.8));
    const bloqueado = est.activos.includes('pasajes-error') ? .08 : est.activos.includes('pasajes-lentos') ? .25 : est.activos.includes('cinta') ? .3 : 1;
    const oks = est.ot.scanners.filter((x) => x.ok).length;
    const capS = oks === 3 ? 1 : oks === 2 ? .32 : oks === 1 ? .14 : 0;

    this.tNacer -= simdt;
    if (this.tNacer <= 0 && this.colaC.length < deseadoC) { this.nacer(); this.tNacer = this.colaC.length < deseadoC - 8 ? .05 : .3; }
    this.tC -= simdt;
    if (this.tC <= 0 && this.colaC.length > 1 && (this.colaC.length > deseadoC - 2 || bloqueado === 1)) {
      this.atenderC();
      const base = 1.4 * bloqueado;
      this.tC = 1 / (this.colaC.length > deseadoC + 6 && bloqueado === 1 ? 6 : Math.max(base, .03));
    }
    this.tS -= simdt;
    if (this.tS <= 0 && this.colaS.length > 1 && capS > 0) {
      this.atenderS(est);
      this.tS = 1 / (this.colaS.length > deseadoS + 6 && capS === 1 ? 6 : Math.max(1.3 * capS, .03));
    }

    for (const a of this.agentes) {
      if (!a.activo) { if (a.escala !== -1) { this.fijar(a, 0); a.escala = -1; } continue; }
      if (a.escala < 1) a.escala = Math.min(1, a.escala + dt * 3);
      const dx = a.tx - a.x, dz = a.tz - a.z, d = Math.hypot(dx, dz);
      const paso = VEL * simdt;
      let mov = false;
      if (d > .06) { const v = Math.min(paso, d) / d; a.x += dx * v; a.z += dz * v; a.rot = Math.atan2(dx, dz); mov = true; }
      a.t += simdt * 8;
      if (d <= .35) this.llegada(a, simdt);
      this.fijar(a, a.escala, mov);
    }
    this.cuerpo.instanceMatrix.needsUpdate = true; this.cabeza.instanceMatrix.needsUpdate = true;
    if (this.marcado) { if (!this.marcado.activo) this.marcar(null); else this.aro.position.set(this.marcado.x, .07, this.marcado.z); }
  }

  llegada(a, dt) {
    switch (a.fase) {
      case 'desk': a.fase2 -= dt; if (a.fase2 <= 0) { a.tx = 0; a.tz = 9; a.fase = 'cruce'; } break;
      case 'cruce': this.haciaSeguridad(a); break;
      case 'scan': a.tz = -9.5; a.fase = 'pasar'; break;
      case 'pasar': a.tx = 36 + Math.random() * 20; a.tz = -14 - Math.random() * 6; a.fase = 'puerta'; break;
      case 'puerta': a.fase = 'salir'; a.fase2 = .5; break;
      case 'salir': a.fase2 -= dt; if (a.fase2 <= 0) { a.activo = false; a.fase = 'libre'; if (this.marcado === a) this.marcar(null); } break;
      default: break;
    }
  }

  fijar(a, esc, mov) {
    const paso = mov ? Math.abs(Math.sin(a.t)) * .05 : 0;
    q.setFromAxisAngle(eje, a.rot || 0);
    m.compose(p.set(a.x, .79 + paso, a.z), q, s.setScalar(esc || .0001)); this.cuerpo.setMatrixAt(a.i, m);
    m.compose(p.set(a.x, 1.72 + paso, a.z), q, s.setScalar(esc || .0001)); this.cabeza.setMatrixAt(a.i, m);
  }
}
