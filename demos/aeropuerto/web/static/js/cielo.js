// Cielo, sol y ciclo día/noche, más las partículas de la falla.
import * as THREE from 'three';

const C = (h) => new THREE.Color(h);
const P = {
  noche: { cenit: C(0x050a18), horiz: C(0x121c33), sol: C(0x6d83b0), hemi: C(0x24324f) },
  alba: { cenit: C(0x2b4a7d), horiz: C(0xffa56a), sol: C(0xffb07a), hemi: C(0x8a7f90) },
  dia: { cenit: C(0x2f7fd6), horiz: C(0xbfe0f5), sol: C(0xfff3df), hemi: C(0xb9d4ee) },
};

export class Cielo {
  constructor(scene) {
    this.u = {
      cenit: { value: C(0x2f7fd6) }, horiz: { value: C(0xbfe0f5) }, solDir: { value: new THREE.Vector3(0, 1, 0) }, solCol: { value: C(0xffffff) },
    };
    const domo = new THREE.Mesh(new THREE.SphereGeometry(3400, 32, 18), new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, uniforms: this.u, fog: false,
      vertexShader: 'varying vec3 d; void main(){ d = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }',
      fragmentShader: `varying vec3 d; uniform vec3 cenit, horiz, solDir, solCol;
        void main(){ float h = clamp(d.y,0.,1.); vec3 c = mix(horiz, cenit, pow(h,.55));
          float s = max(dot(normalize(d), solDir),0.); c += solCol*(pow(s,800.)*6. + pow(s,16.)*.22);
          gl_FragColor = vec4(c,1.); }`,
    }));
    domo.frustumCulled = false; scene.add(domo);

    const n = 1200, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, y = Math.random() * .95 + .04, r = Math.sqrt(1 - y * y);
      pos.set([Math.cos(a) * r * 3200, y * 3200, Math.sin(a) * r * 3200], i * 3);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.estrellas = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 2.1, sizeAttenuation: false, transparent: true, opacity: 0, toneMapped: false, fog: false, depthWrite: false }));
    scene.add(this.estrellas);

    this.hemi = new THREE.HemisphereLight(0xb9d4ee, 0x6b6456, 1.1); scene.add(this.hemi);
    const sol = new THREE.DirectionalLight(0xffffff, 3); sol.castShadow = true;
    sol.shadow.mapSize.set(2048, 2048); sol.shadow.bias = -.0004; sol.shadow.normalBias = .6;
    const c = sol.shadow.camera; c.left = -120; c.right = 120; c.top = 90; c.bottom = -110; c.near = 10; c.far = 620;
    scene.add(sol, sol.target); sol.target.position.set(0, 0, -20);
    this.sol = sol;
    this.scene = scene;
    this.dia = .715; this.modo = 'auto';     // arranca en la hora dorada
    this.noche = 0;
  }

  // valor: fracción del día; 0.25 amanecer, 0.5 mediodía, 0.75 atardecer
  actualizar(dt, mundo) {
    if (this.modo === 'auto') this.dia = (this.dia + dt / 320) % 1;
    else if (this.modo === 'noche') this.dia = THREE.MathUtils.lerp(this.dia, .96, Math.min(1, dt * .6));
    const a = (this.dia - .25) * Math.PI * 2, elev = Math.sin(a);
    const dir = new THREE.Vector3(Math.cos(a) * .85, Math.max(.05, elev), .42).normalize();
    const luna = elev < -.02;
    this.sol.position.copy(dir).multiplyScalar(300).add(this.sol.target.position);

    const d = THREE.MathUtils.smoothstep(elev, .02, .5), n = THREE.MathUtils.smoothstep(-elev, -.02, .34);
    const lerp = (k) => (n > 0 ? P.alba[k].clone().lerp(P.noche[k], n) : P.alba[k].clone().lerp(P.dia[k], d));
    this.u.cenit.value.copy(lerp('cenit')); this.u.horiz.value.copy(lerp('horiz'));
    this.u.solCol.value.copy(lerp('sol'));
    this.u.solDir.value.copy(luna ? new THREE.Vector3(-dir.x, Math.abs(elev) + .1, dir.z).normalize() : dir);
    this.sol.color.copy(lerp('sol')); this.sol.intensity = luna ? .3 : .8 + 2.1 * d;
    this.hemi.color.copy(lerp('hemi')); this.hemi.intensity = .18 + .42 * d + (1 - n) * .14 + n * .3;
    this.noche = n;
    this.estrellas.material.opacity = n;
    this.scene.fog.color.copy(this.u.horiz.value);
    this.scene.environmentIntensity = .06 + .24 * d;
    mundo.materiales.luz.emissiveIntensity = .6 + n * 4.5;
    for (const l of mundo.lucesInterior) l.intensity = 34 + (1 - d) * 42;
    for (const l of mundo.reflectores) l.intensity = n * 240;
    mundo.ciudad.emissiveIntensity = n * 1.4;
    mundo.techo.opacity = .1 + (1 - d) * .03;
  }
}

export class Chispas {
  constructor(scene) {
    this.max = 220;
    this.pos = new Float32Array(this.max * 3); this.vel = new Float32Array(this.max * 3); this.vida = new Float32Array(this.max);
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.puntos = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffb648, size: .24, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    this.puntos.frustumCulled = false; this.puntos.visible = false; scene.add(this.puntos);
    this.alarma = new THREE.PointLight(0xff2233, 0, 34, 1.6); scene.add(this.alarma);
    this.t = 0;
  }

  actualizar(dt, origen) {
    this.t += dt;
    this.alarma.intensity = origen ? 42 * (.5 + .5 * Math.sin(this.t * 9)) : 0;
    if (origen) this.alarma.position.copy(origen).add(new THREE.Vector3(0, 2.5, 0));
    this.puntos.visible = !!origen || this.vida.some((v) => v > 0);
    if (!this.puntos.visible) return;
    for (let i = 0; i < this.max; i++) {
      if (this.vida[i] > 0) {
        this.vida[i] -= dt; this.vel[i * 3 + 1] -= 9 * dt;
        for (let k = 0; k < 3; k++) this.pos[i * 3 + k] += this.vel[i * 3 + k] * dt;
        if (this.pos[i * 3 + 1] < .05) { this.pos[i * 3 + 1] = .05; this.vel[i * 3 + 1] *= -.35; }
      } else if (origen && Math.random() < dt * 45) {
        this.vida[i] = .5 + Math.random() * .8;
        this.pos.set([origen.x, origen.y, origen.z], i * 3);
        this.vel.set([(Math.random() - .5) * 7, 2 + Math.random() * 5, (Math.random() - .5) * 7], i * 3);
      } else { this.pos[i * 3 + 1] = -50; }
    }
    this.puntos.geometry.attributes.position.needsUpdate = true;
  }
}
