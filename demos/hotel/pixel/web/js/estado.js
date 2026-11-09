// Trae el estado de la demo y lo pasa a lo que necesita la escena.

const VACIO = {
  ensayo: false, web_ok: true, modo: "normal", ocupadas: null, total: 320, libres: null,
  ot: { corte_s: null, elevador_s: null, red: 1, voltaje: 127, ups_bateria: 0, ups_pct: 100, ups_min: 45, gen: 0, gen_bat: 12.6,
    chiller: 1, temp_lobby: 23, elev: [1, 1, 1], aps: 48, clientes: 220 },
  nube: { gcp: false, aws: false },
};

export function derivar(s, conectado = true) {
  const o = s.ot;
  return {
    conectado,
    ensayo: s.ensayo,
    controles: Boolean(s.controles),
    web: s.web_ok,
    modo: s.modo,
    ocupadas: s.ocupadas,
    total: s.total,
    libres: s.libres,
    corte: o.red === 0,
    corteS: o.corte_s,
    voltaje: o.voltaje,
    ups: o.ups_bateria === 1,
    upsPct: o.ups_pct,
    upsMin: o.ups_min,
    gen: o.gen,
    genBat: o.gen_bat,
    chiller: o.chiller === 1,
    temp: o.temp_lobby,
    elev: o.elev.map((e) => e === 1),
    elevadorFalla: o.elevador_s !== null,
    wifi: o.aps >= 48,
    aps: o.aps,
    clientes: o.clientes,
    gcp: s.nube.gcp,
    aws: s.nube.aws,
    pagosMal: s.modo === "pagos-error",
    pagosLentos: s.modo === "pagos-lentos",
    promo: s.modo === "promo",
  };
}

export const estadoInicial = () => derivar(VACIO);

export class Sondeo {
  constructor(alCambiar) {
    this.alCambiar = alCambiar;
    this.ultimo = VACIO;
    this.fallas = 0;
  }

  iniciar() {
    const paso = async () => {
      try {
        const r = await fetch("/api/estado", { cache: "no-store" });
        if (!r.ok) throw new Error(String(r.status));
        this.ultimo = await r.json();
        this.fallas = 0;
        this.alCambiar(derivar(this.ultimo, true));
      } catch {
        // Un corte breve de la red de escenario no debe cambiar la historia: se avisa recién a los 3 intentos
        if (++this.fallas >= 3) this.alCambiar(derivar(this.ultimo, false));
      }
      setTimeout(paso, 1000);
    };
    paso();
  }
}

// Si es posible atender en el mostrador ahora mismo. Las fallas de pago no bloquean: el intento es real y puede fallar.
export function atencion(d) {
  if (!d.conectado) return { puede: false, razon: "No es posible reservar. Perdimos la conexión con el sistema del hotel." };
  if (d.corte && !d.ups) return { puede: false, razon: "No es posible reservar. Se fue la luz y el sistema está apagado." };
  if (!d.wifi) return { puede: false, razon: "No es posible reservar. Sin Wi-Fi, la terminal no tiene conexión." };
  if (!d.web) return { puede: false, razon: "No es posible reservar. El sistema de reservas no responde." };
  return { puede: true };
}

export async function reservar(tipo, noches) {
  try {
    const r = await fetch("/api/reservar", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tipo, noches }),
    });
    return await r.json();
  } catch {
    return { ok: false, motivo: "caida", mensaje: "El sistema de reservas no responde." };
  }
}

export function entrarAlLobby() {
  fetch("/api/entrar", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }).catch(() => {});
}

export function ordenar(orden) {
  fetch("/api/control", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orden }) }).catch(() => {});
}
