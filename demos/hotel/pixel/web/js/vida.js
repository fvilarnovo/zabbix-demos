// Lo que pasa en el lobby: huéspedes, ascensores, empleados y su reacción a cada acto.
// Los personajes son ilustrativos; los datos reales son el estado de los actos y las reservas del jugador.
import { ELEVADORES } from "./escena.js";
import { LOOKS, Persona, buscarRuta, esperar, lookAzar } from "./personajes.js";
import { sonido } from "./audio.js";

const azar = (a, b) => a + Math.random() * (b - a);
const uno = (lista) => lista[Math.floor(Math.random() * lista.length)];

const DESTINOS_PASEO = [[6, 6], [8, 6], [3, 7], [6, 11], [9, 5], [12, 4], [14, 4], [3, 3], [7, 10], [10, 7], [15, 6], [8, 12]];
const ASIENTOS = [
  { x: 2.0, y: 10.72, z: 3, mira: "SO", acceso: [2, 12] },
  { x: 3.4, y: 10.72, z: 3, mira: "SO", acceso: [4, 12] },
  { x: 4.42, y: 12.0, z: 3, mira: "SE", acceso: [5, 11] },
];
const QUEJAS_PAGO = ["¡No pasó mi tarjeta!", "¿Otra vez error?", "Me voy a otro hotel.", "¡Llevo tres intentos!"];

export class Ascensor {
  constructor(i, g) {
    this.i = i;
    this.g = g;
    this.o = 0;
    this.estado = "cerrado";
    this.t = azar(2, 6);
    this.piso = 1 + Math.floor(azar(0, 12));
    this.destino = this.piso;
    this.func = true;
    this.pedido = false;
    this.pasajero = false;
    this.grito = azar(2, 6);
    this.atrapado = false;
    this.subeBaja = 0;
  }

  actualizar(dt, funciona, mundo) {
    if (this.func && !funciona) {
      // Quedó parado: si estaba viajando, hay alguien adentro
      this.atrapado = this.piso !== 1 || this.estado === "cerrado";
      this.pedido = false;
    }
    if (!this.func && funciona) this.atrapado = false;
    this.func = funciona;
    if (!funciona) {
      this.o = Math.max(0, this.o - dt * 0.8);
      this.estado = "cerrado";
      this.subeBaja = 0;
      if (this.atrapado && (this.grito -= dt) <= 0) {
        this.grito = azar(6, 10);
        mundo.alCarteles(this);
      }
      return;
    }
    if (this.estado === "cerrado") {
      if (this.pedido) this.destino = 1;
      if (this.piso !== this.destino) {
        this.subeBaja = Math.sign(this.destino - this.piso);
        this.t -= dt;
        if (this.t <= 0) {
          this.piso += this.subeBaja;
          this.t = 0.55;
        }
      } else {
        this.subeBaja = 0;
        if (this.piso === 1 && (this.pedido || this.pasajero)) {
          this.estado = "abriendo";
        } else if ((this.t -= dt) <= 0) {
          this.destino = Math.random() < 0.6 ? 1 : 1 + Math.floor(azar(1, 12));
          this.pasajero = this.destino === 1 && Math.random() < 0.55 && mundo.quiereSalirGente();
          this.t = azar(3, 8);
        }
      }
    } else if (this.estado === "abriendo") {
      this.o = Math.min(1, this.o + dt * 1.5);
      if (this.o >= 1) {
        this.estado = "abierto";
        this.t = 2.6;
        sonido.campana();
        if (this.pasajero) {
          mundo.saleDelAscensor(this);
          this.pasajero = false;
        }
      }
    } else if (this.estado === "abierto") {
      this.t -= dt;
      this.pedido = false;
      if (this.t <= 0) this.estado = "cerrando";
    } else if (this.estado === "cerrando") {
      this.o = Math.max(0, this.o - dt * 1.5);
      if (this.o <= 0) {
        this.estado = "cerrado";
        this.t = azar(2, 5);
        this.destino = 1 + Math.floor(azar(1, 12));
      }
    }
  }
}

export class Mundo {
  constructor(escena) {
    this.esc = escena;
    this.bloqueo = escena.bloqueo;
    this.d = null;
    this.gente = [];
    this.cola = [];
    this.ascensores = ELEVADORES.map((g, i) => new Ascensor(i, g));
    this.particulas = [];
    this.asientos = ASIENTOS.map((a) => ({ ...a, libre: true }));
    this.tSpawn = 0;
    this.ordenLooks = 0;
    this.puertaAbierta = 0;
    this.gritos = [];
    this.tecnico = null;
    this.gerente = null;
    this.avisos = [];

    this.recep1 = this.fijo(LOOKS.recepcion, 4.5, 1.5, "SO");
    this.recep2 = this.fijo(LOOKS.recepcionista, 7.5, 1.5, "SO");
    this.pianista = this.fijo(LOOKS.pianista, 12.5, 11.92, "NE", { pose: "sentado", z: 6 });
    this.analista = this.fijo(LOOKS.analista, 14, 7.12, "NE", { pose: "sentado", z: 5 });
    this.tNota = 0;
    this.tMoneda = 0;
    this.gasto = 0.24;
    // Las personas fijas siguen vivas en todos los modos: no pasan por el reparto de huéspedes
    this.fijos = [this.recep1, this.recep2, this.pianista, this.analista];
  }

  fijo(look, x, y, mirando, extra = {}) {
    const p = new Persona(look, x, y);
    p.mirando = mirando;
    Object.assign(p, extra);
    return p;
  }

  avisar(texto) { this.avisos.push(texto); }
  alCarteles(a) { this.gritos.push({ a, t: 2.4, texto: "¡Auxilio!" }); }

  quiereSalirGente() { return this.gente.length < this.objetivo() && !this.d.corte; }

  objetivo() {
    const d = this.d;
    if (d.corte) return 0;
    if (d.promo) return 16;
    if (d.pagosMal || d.pagosLentos) return 12;
    return 9;
  }

  saleDelAscensor(a) {
    const p = this.nuevoHuesped(a.g + 0.5, 0.5);
    p.co = salirDeElevador(p, this);
  }

  nuevoHuesped(x, y) {
    const p = new Persona(lookAzar(this.ordenLooks++ % 40), x, y);
    p.vel = azar(1.9, 2.8);
    p.ox = azar(-0.14, 0.14);
    p.oy = azar(-0.14, 0.14);
    this.gente.push(p);
    return p;
  }

  entraPorPuerta() {
    const y = uno([7.5, 8.5]);
    const p = this.nuevoHuesped(0.5, y);
    p.co = rutina(p, this);
    return p;
  }

  sembrar(cantidad) {
    const libres = [];
    for (let y = 1; y < 13; y++) for (let x = 1; x < 17; x++) if (!this.bloqueo[y][x]) libres.push([x, y]);
    for (let i = 0; i < cantidad; i++) {
      const [x, y] = uno(libres);
      const p = this.nuevoHuesped(x + 0.5, y + 0.5);
      p.co = rutina(p, this);
    }
  }

  // Un acto cambió: reacción de la gente
  entrarEnApagon() {
    this.cola = [];
    for (const a of this.asientos) a.libre = true;
    for (const p of this.gente) {
      p.co = panico(p, this);
      p.pose = "pie";
      p.z = 0;
      p.ruta = [];
    }
    this.recep1.mostrar("!", 2);
    this.recep2.mostrar("!", 2);
    this.pianista.mostrar("!", 2);
    this.analista.mostrar("!", 2);
    this.recep1.linterna = true;
    this.recep2.linterna = true;
    this.analista.tipeando = false;
    if (!this.tecnico) this.traerTecnico(2.5, "corte");
  }

  salirDeApagon() {
    this.recep1.linterna = false;
    this.recep2.linterna = false;
    this.recep1.mostrar("♥", 2);
    this.recep2.mostrar("♥", 2);
    for (const p of this.gente) {
      p.linterna = false;
      p.sudor = false;
      p.mostrar("♪", 2);
      p.co = rutina(p, this);
    }
  }

  traerTecnico(demora, motivo) {
    const t = new Persona(LOOKS.tecnico, 1.5, 0.5);
    t.vel = 3.4;
    t.linterna = this.d.corte;
    t.oculto = true;
    this.tecnico = t;
    t.co = motivo === "corte" ? tecnicoCorte(t, this, demora) : tecnicoElevador(t, this, demora);
  }

  actualizar(dt, d, jugador) {
    this.d = d;
    this.ascensores.forEach((a) => a.actualizar(dt, d.elev[a.i], this));
    this.gritos = this.gritos.filter((g) => (g.t -= dt) > 0);

    for (const p of this.gente) p.actualizar(dt);
    for (const p of this.fijos) p.actualizar(dt);
    this.gente = this.gente.filter((p) => !p.salio);
    if (this.tecnico) {
      this.tecnico.actualizar(dt);
      if (this.tecnico.salio) this.tecnico = null;
    }
    if (this.gerente) {
      this.gerente.actualizar(dt);
      if (this.gerente.salio) this.gerente = null;
    }
    jugador.actualizar(dt);

    // Reparto de huéspedes según el modo
    this.tSpawn -= dt;
    if (this.tSpawn <= 0 && this.gente.length < this.objetivo()) {
      this.entraPorPuerta();
      this.tSpawn = d.promo ? azar(0.8, 1.8) : azar(2, 5);
    }

    // La puerta se abre sola, salvo sin energía
    const cerca = [...this.gente, jugador].some((p) => p.x < 2.6 && p.y > 6 && p.y < 10 && !p.oculto);
    const objetivoPuerta = cerca && !(d.corte && !d.ups) ? 1 : 0;
    this.puertaAbierta += Math.sign(objetivoPuerta - this.puertaAbierta) * Math.min(dt * 2.2, Math.abs(objetivoPuerta - this.puertaAbierta));

    // Empleados
    this.recep1.sudor = d.pagosMal || d.pagosLentos;
    this.recep2.sudor = d.pagosMal || d.pagosLentos;
    this.analista.tipeando = !d.corte;
    if ((d.pagosMal || d.pagosLentos) && Math.random() < dt * 0.25) (Math.random() < 0.5 ? this.recep1 : this.recep2).mostrar(d.pagosMal ? "sudor" : "…", 1.5);

    // Pianista: solo toca con luz
    if (!d.corte) {
      this.tNota -= dt;
      if (this.tNota <= 0) {
        this.tNota = azar(0.5, 1.2);
        this.particula("nota", 12.5, 10.8, 22, { vx: azar(-6, 6), vy: -12, vida: 1.8 });
      }
    }

    // Acto 3: la nube gasta y nadie en el lobby lo nota
    const anomalia = d.gcp || d.aws;
    const objetivoGasto = anomalia ? 0.86 : 0.24;
    this.gasto += (objetivoGasto - this.gasto) * Math.min(1, dt * (anomalia ? 0.22 : 0.6));
    if (anomalia) {
      this.tMoneda -= dt;
      if (this.tMoneda <= 0) {
        this.tMoneda = 0.11;
        this.particula("moneda", 14, 6.1, 22, { vida: 1.6 });
        if (Math.random() < 0.08) sonido.moneda();
      }
      if (!this.gerente && !this.gerenteListo) {
        this.gerenteListo = true;
        this.traerGerente();
      }
    } else {
      this.gerenteListo = false;
    }

    // Partículas
    this.particulas = this.particulas.filter((q) => {
      q.t += dt;
      q.x += (q.vx || 0) * dt;
      q.y += (q.vy || 0) * dt;
      return q.t < q.vida;
    });
    // Aire acondicionado: rayitas que caen de la rejilla
    if (d.chiller && Math.random() < dt * 5) this.particula("aire", 0, azar(0.6, 2), 55, { vx: 7, vy: 9, vida: 1 });
    // Calor: gotas sobre los huéspedes
    if (d.temp > 25.5 && Math.random() < dt * 1.2) {
      const p = uno(this.gente);
      if (p) p.mostrar("sudor", 1.2);
    }
  }

  traerGerente() {
    const g = new Persona(LOOKS.gerente, 1.5, 0.5);
    g.vel = 4.2;
    g.oculto = true;
    this.gerente = g;
    g.co = gerenteFactura(g, this);
  }

  particula(tipo, gx, gy, z, extra) {
    this.particulas.push({ tipo, gx, gy, z, x: 0, y: 0, t: 0, vida: 1, ...extra });
  }

  ruta(p, tx, ty, permitir) {
    const r = buscarRuta(this.bloqueo, p.tx, p.ty, tx, ty, permitir);
    if (r) p.ruta = r;
    return r !== null;
  }
}

// ---------------------------------------------------------------- corrutinas

function* ir(p, m, tx, ty, permitir) {
  if (!m.ruta(p, tx, ty, permitir)) return false;
  while (p.ruta.length) yield;
  return true;
}

function* rutina(p, m) {
  yield* esperar(azar(0, 1));
  while (true) {
    const d = m.d;
    const tirada = Math.random();
    const prob = d.promo ? 0.55 : d.pagosMal || d.pagosLentos ? 0.65 : 0.28;
    if (tirada < prob && m.cola.length < 6) {
      yield* reservar(p, m);
    } else if (tirada < prob + 0.2) {
      yield* paseo(p, m);
    } else if (tirada < prob + 0.34) {
      yield* sentarse(p, m);
    } else if (tirada < prob + 0.5) {
      if (yield* tomarElevador(p, m)) return;
    } else {
      yield* irse(p, m);
      return;
    }
  }
}

function* salirDeElevador(p, m) {
  yield* ir(p, m, p.tx, 1);
  p.mirando = "SO";
  p.co = rutina(p, m);
  yield;
}

function* paseo(p, m) {
  const [x, y] = uno(DESTINOS_PASEO);
  yield* ir(p, m, x, y);
  yield* esperar(azar(1, 3));
  if (Math.random() < 0.3) p.mostrar("♪");
}

function* sentarse(p, m) {
  const asiento = m.asientos.find((a) => a.libre);
  if (!asiento) return;
  asiento.libre = false;
  const llega = yield* ir(p, m, asiento.acceso[0], asiento.acceso[1]);
  if (llega) {
    const antes = [p.x, p.y];
    p.x = asiento.x;
    p.y = asiento.y;
    p.z = asiento.z;
    p.pose = "sentado";
    p.mirando = asiento.mira;
    yield* esperar(azar(6, 14));
    p.pose = "pie";
    p.z = 0;
    [p.x, p.y] = antes;
  }
  asiento.libre = true;
}

function* reservar(p, m) {
  m.cola.push(p);
  // Avanza en la fila, casilla por casilla, hasta el frente del mostrador
  let ultimo = -1;
  while (true) {
    const i = m.cola.indexOf(p);
    if (i < 0) return;
    if (i !== ultimo) {
      ultimo = i;
      m.ruta(p, 4, 3 + i);
    }
    if (i === 0 && !p.ruta.length && p.ty === 3) break;
    yield;
  }
  p.mirando = "NE";
  const d = m.d;
  yield* esperar(d.pagosLentos ? azar(5, 8) : azar(1.5, 3));
  m.recep1.mirando = "SO";
  const falla = m.d.pagosMal && Math.random() < 0.65;
  m.cola.shift();
  if (falla) {
    p.mostrar("ira", 2.2);
    p.decir(uno(QUEJAS_PAGO), 2.4);
    yield* esperar(1.6);
    yield* irse(p, m);
    p.salio = true;
    return;
  }
  p.mostrar("llave", 1.6);
  yield* esperar(0.8);
  if (!(yield* tomarElevador(p, m))) yield* paseo(p, m);
  else p.salio = true;
}

function* tomarElevador(p, m) {
  const sirven = m.ascensores.filter((a) => a.func);
  if (!sirven.length) {
    p.mostrar("?");
    return false;
  }
  const a = uno(sirven);
  const tx = a.g;
  yield* ir(p, m, tx, 1);
  p.mirando = "NE";
  a.pedido = true;
  let paciencia = 22;
  while (a.o < 0.85 || a.estado === "cerrando") {
    const dt = yield;
    paciencia -= dt;
    if (!a.func || paciencia <= 0) {
      p.mostrar("?");
      return false;
    }
    if (a.estado !== "abriendo" && a.estado !== "abierto") a.pedido = true;
  }
  a.t = Math.max(a.t, 1.2);
  p.ruta = [[tx + 0.5, 0.5]];
  while (p.ruta.length) yield;
  p.oculto = true;
  p.salio = true;
  return true;
}

function* irse(p, m) {
  yield* ir(p, m, 1, uno([7, 8]));
  const y = p.ty + 0.5;
  p.ruta = [[0.5, y]];
  while (p.ruta.length) yield;
  yield* esperar(0.2);
  p.oculto = true;
  p.salio = true;
}

function* panico(p, m) {
  yield* esperar(azar(0, 0.5));
  p.mostrar("!", 1.8);
  p.vel = azar(1.2, 2);
  yield* esperar(azar(1.2, 2.5));
  if (Math.random() < 0.7) p.linterna = true;
  while (true) {
    const d = m.d;
    if (Math.random() < 0.55) {
      const [x, y] = uno(DESTINOS_PASEO);
      yield* ir(p, m, x, y);
    }
    const r = Math.random();
    if (!d.wifi && r < 0.45) p.mostrar("wifi", 2);
    else if (d.temp > 25.5 && r < 0.65) p.mostrar("sudor", 1.5);
    else if (r < 0.4) p.mostrar("?", 1.4);
    yield* esperar(azar(1.5, 4));
  }
}

// ---- el técnico, durante el acto 2: comenta lo que pasa en el orden del simulador

function* tecnicoCorte(t, m, demora) {
  yield* esperar(demora);
  t.oculto = false;
  yield* ir(t, m, 1, 1);
  yield* ir(t, m, 2, 1);
  t.mirando = "NE";
  t.decir("¡Se fue la red eléctrica!", 3);
  const dichos = new Set();
  const decirUnaVez = (clave, condicion, texto) => {
    if (condicion && !dichos.has(clave)) {
      dichos.add(clave);
      t.decir(texto, 5);
    }
  };
  while (m.d.corte) {
    const d = m.d;
    decirUnaVez("ups", d.ups, "La UPS tomó la carga.");
    decirUnaVez("gen1", d.gen === 1, "Intento arrancar el generador...");
    decirUnaVez("gen3", d.gen === 3, "¡No arranca! Batería de arranque baja.");
    decirUnaVez("hvac", !d.chiller, "Se apagó el chiller. Sube la temperatura.");
    decirUnaVez("ele", !d.elev[1], "Elevadores 2 y 3 sin energía.");
    decirUnaVez("wifi", !d.wifi, "Se cayó el Wi-Fi: 12 de 48 AP.");
    decirUnaVez("ele1", d.elevadorFalla, "¡Ahora falla el elevador 1! ¿Será parte de lo mismo?");
    yield;
  }
  t.decir("¡Volvió la luz!", 3);
  t.linterna = false;
  yield* esperar(2);
  if (m.d.elevadorFalla) {
    yield* tecnicoElevador(t, m, 0);
    return;
  }
  yield* ir(t, m, 1, 1);
  yield* ir(t, m, 1, 0);
  t.oculto = true;
  t.salio = true;
}

function* tecnicoElevador(t, m, demora) {
  yield* esperar(demora);
  t.oculto = false;
  yield* ir(t, m, 1, 1);
  yield* ir(t, m, 11, 1);
  t.mirando = "NE";
  t.decir("Elevador 1 en falla. Voy a revisarlo.", 5);
  while (m.d.elevadorFalla) yield;
  t.decir("Elevador 1 reparado.", 3);
  yield* esperar(2);
  yield* ir(t, m, 1, 1);
  yield* ir(t, m, 1, 0);
  t.oculto = true;
  t.salio = true;
}

// ---- la gerente, durante el acto 3

function* gerenteFactura(g, m) {
  const activa = () => m.d.gcp || m.d.aws;
  yield* esperar(6);
  // Si la anomalía se quitó antes de que entrara, la gerente ni aparece
  if (!activa()) {
    g.salio = true;
    return;
  }
  g.oculto = false;
  g.factura = true;
  yield* ir(g, m, 1, 1);
  yield* ir(g, m, 12, 7);
  g.mirando = "SE";
  const pasos = [
    () => {
      m.analista.mostrar("!", 2);
      g.decir(m.d.gcp ? "¿Una consulta de BigQuery sin límite?" : "¿Quién levantó DR en EC2?", 5);
    },
    () => m.analista.decir(m.d.gcp ? "Era solo un SELECT * ..." : "Era solo una prueba...", 4),
    () => g.decir("Lo vemos hoy, no el día 30. Hay que frenarlo.", 5),
  ];
  for (const paso of pasos) {
    if (!activa()) break;
    paso();
    yield* esperar(5.2);
  }
  while (activa()) yield;
  g.decir("Listo. Volvió a la normalidad.", 3);
  g.factura = false;
  yield* esperar(2);
  g.vel = 2.6;
  yield* ir(g, m, 1, 1);
  yield* ir(g, m, 1, 0);
  g.oculto = true;
  g.salio = true;
}
