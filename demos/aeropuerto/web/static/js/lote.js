// Une muchas piezas estáticas en una sola malla con colores por vértice: pocas llamadas de dibujo en la notebook.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const color = new THREE.Color();

export class Lote {
  constructor() { this.piezas = []; }

  agregar(geo, hex, matriz) {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    if (!g.attributes.normal) g.computeVertexNormals();
    for (const nombre of Object.keys(g.attributes)) if (nombre !== 'position' && nombre !== 'normal') g.deleteAttribute(nombre);
    if (matriz) g.applyMatrix4(matriz);
    color.set(hex);
    const n = g.attributes.position.count, datos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) datos.set([color.r, color.g, color.b], i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(datos, 3));
    this.piezas.push(g);
    return this;
  }

  caja(an, al, pr, x, y, z, hex, rotY = 0) {
    const m = new THREE.Matrix4().makeRotationY(rotY).setPosition(x, y + al / 2, z);
    return this.agregar(new THREE.BoxGeometry(an, al, pr), hex, m);
  }

  cilindro(rt, rb, al, x, y, z, hex, seg = 12) {
    return this.agregar(new THREE.CylinderGeometry(rt, rb, al, seg), hex, new THREE.Matrix4().setPosition(x, y + al / 2, z));
  }

  malla(material, sombras = true) {
    const m = new THREE.Mesh(mergeGeometries(this.piezas, false), material);
    m.castShadow = sombras;
    m.receiveShadow = true;
    this.piezas.length = 0;
    return m;
  }
}

export function texturaCanvas(an, al, dibujar) {
  const c = document.createElement('canvas');
  c.width = an; c.height = al;
  dibujar(c.getContext('2d'), an, al);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
