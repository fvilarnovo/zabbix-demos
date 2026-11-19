// Paneles con el estilo de Zabbix 8.0, dibujados con los datos reales que entrega /api/zabbix (problem.get con los
// tags del CEP, item.get e history.get). Los usan el centro de mando (/cco) y la app de peajes (/peaje).
export const SEV = {
  0: { n: 'Sin clasificar', c: '#97AAB3' }, 1: { n: 'Información', c: '#7499FF' }, 2: { n: 'Advertencia', c: '#FFC859' },
  3: { n: 'Media', c: '#FFA059' }, 4: { n: 'Alta', c: '#E97659' }, 5: { n: 'Desastre', c: '#E45959' },
};
export const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const edad = (clock) => {
  const s = Math.max(0, Date.now() / 1000 - clock);
  return s < 60 ? `${Math.round(s)}s` : s < 3600 ? `${Math.floor(s / 60)}m ${Math.round(s % 60)}s` : `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
};

// Causas primero, cada una seguida de sus síntomas (cause_eventid del CEP).
export function ordenarCep(lista) {
  const hijos = new Map();
  for (const p of lista) if (p.sintoma) hijos.set(p.de, [...(hijos.get(p.de) || []), p]);
  const raices = lista.filter((p) => !p.sintoma || !lista.some((q) => q.id === p.de)).sort((a, b) => b.severidad - a.severidad || b.desde - a.desde);
  const out = [];
  for (const r of raices) {
    out.push({ ...r, nivelCep: r.sintoma ? 1 : 0 });
    for (const h of hijos.get(r.id) || []) out.push({ ...h, nivelCep: 1 });
  }
  return out;
}

export function tablaProblemas(el, lista, { max = 40, vacio = 'Sin problemas' } = {}) {
  const filas = ordenarCep(lista).slice(0, max);
  if (!filas.length) { el.innerHTML = `<div class="zbx-vacio">${esc(vacio)}</div>`; return; }
  el.innerHTML = `<table class="zbx-tabla"><thead><tr><th></th><th>Hora</th><th>Problema</th><th>Duración</th><th>Tags</th></tr></thead><tbody>${filas.map((p) => {
    const t = p.tags || {};
    const chips = [
      t.incidente ? `<span class="zbx-tag inc">incidente: ${esc(t.incidente)}</span>` : '',
      p.causa ? '<span class="zbx-tag causa">causa</span>' : '',
      t.causa_raiz ? `<span class="zbx-tag raiz">causa_raiz: ${esc(t.causa_raiz)}</span>` : '',
      t.zona ? `<span class="zbx-tag">zona: ${esc(t.zona)}</span>` : '',
      t.responsable && !p.nivelCep ? `<span class="zbx-tag">${esc(t.responsable)}</span>` : '',
    ].join('');
    const hora = new Date(p.desde * 1000).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    return `<tr class="${p.nivelCep ? 'sint' : ''}"><td class="zbx-sev" style="background:${SEV[p.severidad].c}" title="${SEV[p.severidad].n}"></td>
      <td class="zbx-hora">${hora}</td><td class="zbx-nombre">${p.nivelCep ? '<span class="zbx-flecha">↳</span>' : ''}${esc(p.nombre)}</td>
      <td class="zbx-dur">${edad(p.desde)}</td><td>${chips}</td></tr>`;
  }).join('')}</tbody></table>`;
}

export function severidades(el, cuenta) {
  el.innerHTML = [5, 4, 3, 2].map((s) => `<div class="zbx-sevbox ${cuenta[s] ? 'con' : ''}" style="--c:${SEV[s].c}"><b>${cuenta[s] || 0}</b><span>${SEV[s].n}</span></div>`).join('');
}

const fmt = (v, u) => {
  if (v === null || v === undefined) return '—';
  if (u === 'COP') return v >= 1e6 ? `$${(v / 1e6).toFixed(1)} M` : `$${Math.round(v).toLocaleString('es-CO')}`;
  if (u === 's') return v < 1 ? `${Math.round(v * 1000)} ms` : `${v.toFixed(2)} s`;
  return `${Math.abs(v) < 10 ? v.toFixed(1) : Math.round(v).toLocaleString('es-CO')}${u ? ' ' + u : ''}`;
};
export { fmt };

// Gráfico de línea tipo "Graph (classic)" de Zabbix con el historial de una serie.
export function grafico(canvas, serie, color = '#4F9FDE') {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  canvas.width = w * dpr; canvas.height = h * dpr;
  const g = canvas.getContext('2d');
  g.scale(dpr, dpr);
  g.clearRect(0, 0, w, h);
  const pts = serie?.puntos || [];
  g.strokeStyle = 'rgba(255,255,255,.07)'; g.lineWidth = 1;
  for (let i = 1; i < 4; i++) { g.beginPath(); g.moveTo(0, (h * i) / 4); g.lineTo(w, (h * i) / 4); g.stroke(); }
  if (pts.length < 2) { g.fillStyle = '#768d99'; g.font = '12px sans-serif'; g.fillText('Recolectando historial…', 8, h / 2); return; }
  const t0 = pts[0][0], t1 = pts[pts.length - 1][0];
  let max = Math.max(...pts.map((p) => p[1])), min = Math.min(0, ...pts.map((p) => p[1]));
  if (max === min) max = min + 1;
  const X = (t) => ((t - t0) / Math.max(1, t1 - t0)) * (w - 4) + 2, Y = (v) => h - 4 - ((v - min) / (max - min)) * (h - 18);
  g.beginPath(); g.moveTo(X(pts[0][0]), h);
  for (const [t, v] of pts) g.lineTo(X(t), Y(v));
  g.lineTo(X(t1), h); g.closePath();
  const grad = g.createLinearGradient(0, 0, 0, h); grad.addColorStop(0, color + '66'); grad.addColorStop(1, color + '05');
  g.fillStyle = grad; g.fill();
  g.beginPath(); pts.forEach(([t, v], i) => (i ? g.lineTo(X(t), Y(v)) : g.moveTo(X(t), Y(v))));
  g.strokeStyle = color; g.lineWidth = 2; g.stroke();
  g.fillStyle = '#9fb0bc'; g.font = '11px sans-serif'; g.fillText(fmt(max, serie.unidad), 4, 12);
}
