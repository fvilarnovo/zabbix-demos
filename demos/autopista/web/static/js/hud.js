// HUD: KPI, problemas de Zabbix (causas con sus síntomas, incidentes y causa raíz del CEP), peajes, bitácora y controles.
const $ = (s) => document.querySelector(s);
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const cop = (n) => (n >= 1e6 ? `$${(n / 1e6).toLocaleString('es-CO', { maximumFractionDigits: 1 })} M` : `$${Math.round(n).toLocaleString('es-CO')}`);
const TECLAS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'q'];

export class Hud {
  constructor({ alEscenario, alApagar, alReset, alVelocidad }) {
    this.cb = { alEscenario, alApagar, alReset, alVelocidad };
    this.armado = false;
    this.claveProblemas = '';
    this.claveBitacora = '';
    this.claveBotones = '';
  }

  armar(estado) {
    if (this.armado) return;
    this.armado = true;
    const cont = $('#escenarios');
    Object.entries(estado.catalogo).forEach(([id, nombre], i) => {
      const b = document.createElement('button');
      b.dataset.esc = id;
      b.title = nombre;
      b.innerHTML = `<kbd>${TECLAS[i] || ''}</kbd>${esc(nombre.split(/[:(]/)[0].replace('Base de datos', 'BD').slice(0, 34))}`;
      b.onclick = () => (b.classList.contains('activo') ? this.cb.alApagar(id) : this.cb.alEscenario(id));
      cont.appendChild(b);
    });
    const r = document.createElement('button');
    r.className = 'reset'; r.innerHTML = '<kbd>0</kbd>Reset'; r.onclick = () => this.cb.alReset();
    cont.appendChild(r);
    const vel = $('#velocidad');
    for (const v of estado.velocidades) {
      const b = document.createElement('button');
      b.dataset.vel = v; b.textContent = `${v}×`; b.onclick = () => this.cb.alVelocidad(v);
      vel.appendChild(b);
    }
    document.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'SELECT' || e.metaKey || e.ctrlKey) return;
      if (e.key === '0') return this.cb.alReset();
      const i = TECLAS.indexOf(e.key.toLowerCase());
      const id = Object.keys(estado.catalogo)[i];
      if (id) document.querySelector(`[data-esc="${id}"]`).click();
    });
    if (!estado.controles) cont.querySelectorAll('button').forEach((b) => (b.disabled = true));
  }

  kpis(k, estado) {
    const fijar = (clave, html, nivel = '') => {
      const el = document.querySelector(`.kpi[data-k="${clave}"]`);
      el.querySelector('strong').innerHTML = html;
      el.className = `kpi ${nivel}`;
    };
    fijar('vehiculos', k.vehiculos.toLocaleString('es-CO'));
    fijar('flujo_h', k.flujo_h.toLocaleString('es-CO'));
    fijar('velocidad', `${k.velocidad.toFixed(0)}<small>km/h</small>`, k.velocidad < 35 ? 'critico' : k.velocidad < 45 ? 'alto' : '');
    fijar('cola_km', `${k.cola_km.toFixed(1)}<small>km</small>`, k.cola_km > 1 ? 'critico' : k.cola_km > 0.4 ? 'alto' : '');
    fijar('recaudo_hoy', cop(k.recaudo_hoy));
    $('#fuente-recaudo').textContent = k.fuente_recaudo === 'zabbix' ? 'Recaudo hoy (Zabbix, desde trazas)' : 'Recaudo hoy (simulador)';
    fijar('tag_pct', `${k.tag_pct.toFixed(0)}<small>%</small>`);
    fijar('latencia_ms', `${k.latencia_ms.toLocaleString('es-CO')}<small>ms · ${k.errores_pct}% err</small>`,
      k.latencia_ms > 2000 || k.errores_pct > 5 ? 'critico' : k.latencia_ms > 800 ? 'alto' : '');
    const d = new Date((estado.t_sim - 5 * 3600) * 1000);
    $('#reloj').textContent = `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
    $('#conexion').textContent = estado.zabbix_ok ? 'conectado a Zabbix' : estado.ensayo ? 'modo ensayo' : 'sin Zabbix';
    const dash = $('#dashboard');
    if (estado.dashboard) { dash.href = estado.dashboard; dash.hidden = false; }
  }

  botones(estado) {
    const clave = estado.activos.join(',') + '|' + estado.velocidad;
    if (clave === this.claveBotones) return;
    this.claveBotones = clave;
    document.querySelectorAll('[data-esc]').forEach((b) => b.classList.toggle('activo', estado.activos.includes(b.dataset.esc)));
    document.querySelectorAll('[data-vel]').forEach((b) => b.classList.toggle('sel', Number(b.dataset.vel) === estado.velocidad));
  }

  problemas(lista) {
    const clave = lista.map((p) => p.id + p.nombre + (p.tags?.incidente || '') + (p.tags?.causa_raiz || '') + p.de).join('|');
    if (clave === this.claveProblemas) return;
    this.claveProblemas = clave;
    $('#n-problemas').textContent = lista.length;
    const ul = $('#lista-problemas');
    if (!lista.length) { ul.innerHTML = '<li class="vacio">Sin problemas: operación normal</li>'; return; }
    // causas primero, cada una seguida de sus síntomas (cause_eventid del CEP)
    const hijos = new Map();
    for (const p of lista) if (p.sintoma) hijos.set(p.de, [...(hijos.get(p.de) || []), p]);
    const raices = lista.filter((p) => !p.sintoma || !lista.some((q) => q.id === p.de)).sort((a, b) => b.severidad - a.severidad || b.desde - a.desde);
    const fila = (p, sintoma) => {
      const t = p.tags || {};
      const marca = t.incidente ? '<span class="inc">INCIDENTE CEP</span>' : p.causa ? '<span class="causa">CAUSA</span>' : '';
      const raiz = t.causa_raiz ? `<span class="raiz">↳ causa raíz: ${esc(t.causa_raiz.replace(/_/g, ' '))}</span>` : '';
      const resp = !sintoma && t.responsable ? `<span class="resp">${esc(t.responsable)}</span>` : '';
      return `<li class="s${p.severidad} ${sintoma ? 'sintoma' : ''} ${t.incidente ? 'incidente' : ''}">${t.zona ? `<span class="zona">${esc(t.zona)}</span>` : ''}${marca}${esc(p.nombre)}${raiz}${resp}</li>`;
    };
    const html = [];
    for (const r of raices.slice(0, 14)) {
      html.push(fila(r, r.sintoma));
      for (const h of (hijos.get(r.id) || []).slice(0, 8)) html.push(fila(h, true));
    }
    ul.innerHTML = html.join('');
  }

  plazas(lista) {
    const html = lista.map((p) => {
      const car = (sentido) => p.carriles.filter((c) => c.id[0] === sentido)
        .map((c) => `<span class="carril ${c.estado} ${c.cola > 6 ? 'cola' : ''}" title="${c.id} ${c.tipo} · ${c.estado}">${c.tipo === 'TAG' ? 'T' : 'M'}${c.cola}</span>`).join('');
      const modo = p.modo === 'normal' ? `UPS ${p.ups}%` : p.modo === 'contingencia' ? `contingencia · ${p.pendientes} pend.` : 'sin sistema';
      return `<div class="plaza ${p.modo}"><div><b>${esc(p.nombre.replace('Peaje ', ''))}</b><small>${modo}</small></div>
        <div class="carriles">${car('A')}<span class="carril sep"></span>${car('B')}</div></div>`;
    }).join('');
    $('#lista-plazas').innerHTML = html;
  }

  bitacora(lista) {
    const clave = lista.length ? lista[lista.length - 1].t + lista[lista.length - 1].txt : '';
    if (clave === this.claveBitacora) return;
    this.claveBitacora = clave;
    $('#lista-bitacora').innerHTML = lista.slice().reverse().slice(0, 26).map((e) => {
      const h = new Date(e.t * 1000);
      return `<li class="${e.tipo}"><time>${String(h.getHours()).padStart(2, '0')}:${String(h.getMinutes()).padStart(2, '0')}:${String(h.getSeconds()).padStart(2, '0')}</time>${esc(e.txt)}</li>`;
    }).join('');
  }

  aviso(texto) {
    const a = $('#aviso');
    a.textContent = texto;
    a.classList.add('ver');
    clearTimeout(this.tAviso);
    this.tAviso = setTimeout(() => a.classList.remove('ver'), 2600);
  }
}
