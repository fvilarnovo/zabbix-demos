// Sonidos cortos de consola portátil, sintetizados. Se activan con el primer clic; M los silencia.
let ctx = null;
export let silencio = false;

export function activarAudio() {
  if (!ctx) {
    const Contexto = window.AudioContext || window.webkitAudioContext;
    if (Contexto) ctx = new Contexto();
  }
  if (ctx && ctx.state === "suspended") ctx.resume();
}

export function alternarSilencio() { silencio = !silencio; return silencio; }

function nota(freq, inicio, duracion, volumen = 0.05, tipo = "square") {
  if (!ctx || silencio) return;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  const t = ctx.currentTime + inicio;
  o.type = tipo;
  o.frequency.setValueAtTime(freq, t);
  g.gain.setValueAtTime(volumen, t);
  g.gain.exponentialRampToValueAtTime(0.0008, t + duracion);
  o.connect(g).connect(ctx.destination);
  o.start(t);
  o.stop(t + duracion);
}

function secuencia(notas, paso, volumen, tipo) {
  notas.forEach((f, i) => f && nota(f, i * paso, paso * 1.5, volumen, tipo));
}

export const sonido = {
  letra: () => nota(880, 0, 0.025, 0.012),
  mover: () => nota(660, 0, 0.05, 0.03),
  elegir: () => secuencia([660, 990], 0.06, 0.04),
  campana: () => secuencia([1320, 1760], 0.14, 0.03, "triangle"),
  exito: () => secuencia([523, 659, 784, 1047, 784, 1047], 0.1, 0.05),
  error: () => secuencia([220, 196, 165], 0.16, 0.06),
  apagon: () => { secuencia([180, 120, 70, 45], 0.11, 0.1, "sawtooth"); },
  arranque: () => secuencia([60, 0, 70, 0, 60, 0, 55], 0.09, 0.07, "sawtooth"),
  vuelveLuz: () => secuencia([392, 523, 659, 784], 0.09, 0.05),
  alerta: () => secuencia([880, 0, 880], 0.12, 0.035),
  moneda: () => secuencia([1319, 1976], 0.05, 0.02),
};
