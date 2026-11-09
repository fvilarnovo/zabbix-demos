// Cuadro de diálogo al estilo de los RPG de Game Boy: texto letra por letra.
import { anchoTexto, partir, texto } from "./fuente.js";
import { sonido } from "./audio.js";

const CAJA = { x: 8, y: 284, w: 624, h: 68 };
const LETRAS_POR_LINEA = 50;
const LETRAS_POR_SEGUNDO = 46;

function marco(c, x, y, w, h) {
  c.fillStyle = "#181420";
  c.fillRect(x, y, w, h);
  c.fillStyle = "#f7f3e6";
  c.fillRect(x + 2, y + 2, w - 4, h - 4);
  c.fillStyle = "#181420";
  c.fillRect(x + 4, y + 4, w - 8, 1);
  c.fillRect(x + 4, y + h - 5, w - 8, 1);
  c.fillRect(x + 4, y + 4, 1, h - 8);
  c.fillRect(x + w - 5, y + 4, 1, h - 8);
}

export class Dialogo {
  constructor() {
    this.co = null;
    this.hablante = "";
    this.lineas = [];
    this.visibles = 0;
    this.esperandoA = false;
    this.t = 0;
    this.entrada = {};
  }

  get abierto() { return this.co !== null; }

  abrir(guion) {
    this.co = guion;
    this.co.next();
  }

  cerrar() {
    this.co = null;
    this.lineas = [];
  }

  actualizar(dt, entrada) {
    if (!this.co) return;
    this.t += dt;
    this.entrada = entrada;
    if (this.co.next(dt).done) this.cerrar();
  }

  // ---- comandos para los guiones (se usan con yield*)

  *decir(cadena, hablante = this.hablante) {
    this.hablante = hablante;
    const lineas = partir(cadena, LETRAS_POR_LINEA);
    for (let i = 0; i < lineas.length; i += 2) {
      yield* this.pagina(lineas.slice(i, i + 2), i + 2 >= lineas.length);
    }
  }

  *teclear() {
    const total = this.lineas.join("").length;
    let acumulado = 0;
    while (this.visibles < total) {
      const dt = yield;
      if (this.entrada.a) {
        this.visibles = total;
        this.entrada = {};
        return;
      }
      acumulado += dt * LETRAS_POR_SEGUNDO;
      while (acumulado >= 1 && this.visibles < total) {
        this.visibles++;
        acumulado--;
        if (this.visibles % 2 === 0) sonido.letra();
      }
    }
  }

  *pagina(lineas) {
    this.lineas = lineas;
    this.visibles = 0;
    this.esperandoA = false;
    yield* this.teclear();
    yield;
    this.esperandoA = true;
    while (!this.entrada.a && !this.entrada.b) yield;
    sonido.mover();
    this.esperandoA = false;
    yield;
  }

  // Espera una promesa mostrando puntos suspensivos animados
  *esperarPromesa(promesa, cadena, hablante = this.hablante) {
    this.hablante = hablante;
    let resultado;
    let listo = false;
    promesa.then((r) => { resultado = r; listo = true; });
    let t = 0;
    this.esperandoA = false;
    this.lineas = [cadena];
    this.visibles = 999;
    while (!listo) {
      t += yield;
      this.lineas = [cadena + ".".repeat(Math.floor(t * 3) % 4)];
      this.visibles = 999;
    }
    return resultado;
  }

  // ---- pintado

  pintar(c) {
    if (!this.co) return;
    const { x, y, w, h } = CAJA;
    if (this.hablante) {
      const anchoN = anchoTexto(this.hablante) + 12;
      marco(c, x + 8, y - 16, anchoN, 18);
      texto(c, this.hablante, x + 14, y - 10, "#181420");
    }
    marco(c, x, y, w, h);
    let restantes = this.visibles;
    this.lineas.forEach((linea, i) => {
      const parte = linea.slice(0, Math.max(0, restantes));
      restantes -= linea.length;
      texto(c, parte, x + 14, y + 13 + i * 22, "#181420", 2);
    });
    if (this.esperandoA && Math.floor(this.t * 3) % 2 === 0) {
      texto(c, "▼", x + w - 22, y + h - 18, "#c0392b", 2);
    }
  }
}

export const dinero = (n) => "$" + n.toLocaleString("en-US");
