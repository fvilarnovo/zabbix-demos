// HUD: KPIs, problemas, bitácora, barra de escenarios y etiquetas flotantes.
export const ESCENARIOS = [
  ['1', 'cinta', 'Cinta'], ['2', 'pasajes-error', 'Pasajes error'], ['3', 'pasajes-lentos', 'Pasajes lento'], ['4', 'scanner-2', 'Scanner'],
  ['5', 'manga-2', 'Manga'], ['6', 'ups', 'UPS'], ['7', 'pico', 'Hora pico'], ['8', 'demoras', 'Demoras'], ['9', 'vuelo-sin-salida', 'Sin salida'],
];
const $ = (s) => document.querySelector(s);
const fmt = (n) => Number(n).toLocaleString('es-MX');
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const NIVELES = {
  cola_checkin: [80, 100], valijas_h: null, vuelos_demorados: [1, 2], latencia_ms: [1500, 3000],
};

export class Hud {
  constructor({ accion, reset, velocidad, vista, dia }) {
    const cont = $('#escenarios');
    this.botones = {};
    for (const [tecla, nombre, texto] of ESCENARIOS) {
      const b = document.createElement('button');
      b.innerHTML = `<kbd>${tecla}</kbd>${texto}`; b.onclick = () => accion(nombre);
      cont.appendChild(b); this.botones[nombre] = b;
    }
    const r = document.createElement('button'); r.className = 'reset'; r.innerHTML = '<kbd>0</kbd>Reset'; r.onclick = reset; cont.appendChild(r); this.btnReset = r;
    const v = $('#velocidad'); this.vels = {};
    for (const x of [0.5, 1, 2, 4]) { const b = document.createElement('button'); b.textContent = `${x}×`; b.onclick = () => velocidad(x); v.appendChild(b); this.vels[x] = b; }
    document.querySelectorAll('[data-vista]').forEach((b) => { b.onclick = () => vista(b.dataset.vista); });
    document.querySelectorAll('[data-dia]').forEach((b) => { b.onclick = () => dia(b.dataset.dia); });
    this.etiquetas = new Map();
    this.ultimaBitacora = ''; this.ultimosProblemas = '';
    window.addEventListener('keydown', (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === '0') reset();
      const f = ESCENARIOS.find(([t]) => t === e.key); if (f) accion(f[1]);
    });
  }

  aviso(texto) {
    const a = $('#aviso'); a.textContent = texto; a.classList.add('ver');
    clearTimeout(this.tAviso); this.tAviso = setTimeout(() => a.classList.remove('ver'), 2600);
  }

  actualizar(e) {
    document.querySelectorAll('.kpi').forEach((n) => {
      const k = n.dataset.k, val = e.kpi[k];
      n.querySelector('strong').textContent = k === 'latencia_ms' ? `${fmt(val)} ms` : fmt(val);
      const u = NIVELES[k];
      n.classList.toggle('alto', !!u && val >= u[0] && val < u[1]);
      n.classList.toggle('critico', !!u && val >= u[1]);
    });
    $('#conexion').textContent = e.zabbix_ok ? 'conectado a Zabbix' : e.ensayo ? 'ensayo sin Zabbix' : 'sin conexión';
    for (const [n, b] of Object.entries(this.botones)) { b.classList.toggle('activo', e.activos.includes(n)); b.disabled = !e.controles; }
    this.btnReset.disabled = !e.controles;
    for (const [x, b] of Object.entries(this.vels)) b.classList.toggle('sel', Number(x) === e.velocidad);

    const huellaP = JSON.stringify(e.problemas);
    if (huellaP !== this.ultimosProblemas) {
      this.ultimosProblemas = huellaP;
      $('#n-problemas').textContent = e.problemas.length;
      $('#lista-problemas').innerHTML = e.problemas.length
        ? e.problemas.slice(0, 11).map((p) => `<li class="s${p.severidad} ${p.sintoma ? 'sintoma' : ''}">${p.causa ? '<span class="causa">CAUSA</span>' : ''}${esc(p.nombre)}</li>`).join('')
        : '<li class="vacio">Operación normal</li>';
    }
    const huellaB = JSON.stringify(e.bitacora.slice(-18));
    if (huellaB !== this.ultimaBitacora) {
      this.ultimaBitacora = huellaB;
      $('#lista-bitacora').innerHTML = e.bitacora.slice(-18).reverse().map((b) => {
        const h = new Date(b.t * 1000).toLocaleTimeString('es-MX', { hour12: false });
        return `<li class="${esc(b.tipo)}"><time>${h}</time>${esc(b.txt)}</li>`;
      }).join('');
    }
  }

  etiqueta(id, partes, falla, foco) {
    let n = this.etiquetas.get(id);
    if (!n) { n = document.createElement('div'); n.className = 'etq'; $('#etiquetas').appendChild(n); this.etiquetas.set(id, n); }
    if (partes) n.innerHTML = `<small>${esc(partes[0])}</small>${esc(partes[1])}`;
    n.classList.toggle('falla', !!falla); n.classList.toggle('foco', !!foco);
    return n;
  }

  etiquetaPasajero(texto, mal) {
    let n = this.etiquetas.get('pax');
    if (!n) { n = document.createElement('div'); n.className = 'etq pax'; $('#etiquetas').appendChild(n); this.etiquetas.set('pax', n); }
    n.textContent = texto; n.classList.toggle('mal', !!mal);
    return n;
  }
}
