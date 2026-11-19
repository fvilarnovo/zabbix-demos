// Pantallas de la sala de control dentro del 3D (canvas → textura): problemas de Zabbix con el CEP, gráficos con el
// historial de Zabbix y el estado de la app de peajes. Mismos datos que /cco, dibujados para verse lejos.
import { SEV, ordenarCep } from './zabbix.js';

const FONDO = '#0e1621', BARRA = '#1f2c3a', ROJO_ZBX = '#d40000';

function marco(g, w, h, titulo) {
  g.fillStyle = FONDO; g.fillRect(0, 0, w, h);
  g.fillStyle = BARRA; g.fillRect(0, 0, w, 58);
  g.fillStyle = ROJO_ZBX; g.fillRect(14, 12, 74, 34);
  g.fillStyle = '#fff'; g.font = 'bold 22px sans-serif'; g.textBaseline = 'middle'; g.fillText('ZABBIX', 19, 30);
  g.fillStyle = '#e8eef4'; g.font = 'bold 26px sans-serif'; g.fillText(titulo, 104, 30);
  g.textBaseline = 'alphabetic';
}

export function problemas(g, w, h, z) {
  marco(g, w, h, 'Problemas · CEP (causa y síntomas)');
  const s = z?.severidades || {};
  [5, 4, 3, 2].forEach((sv, i) => {
    g.fillStyle = s[sv] ? SEV[sv].c : '#2a3644'; g.fillRect(14 + i * 250, 70, 236, 62);
    g.fillStyle = s[sv] ? '#111' : '#8aa0b2'; g.font = 'bold 34px sans-serif'; g.fillText(String(s[sv] || 0), 28 + i * 250, 114);
    g.font = '20px sans-serif'; g.fillText(SEV[sv].n, 80 + i * 250, 110);
  });
  const filas = ordenarCep(z?.problemas || []).slice(0, 11);
  g.font = '23px sans-serif';
  if (!filas.length) { g.fillStyle = '#59db8f'; g.font = 'bold 30px sans-serif'; g.fillText('✓ Sin problemas: operación normal', 30, 220); return; }
  filas.forEach((p, i) => {
    const y = 150 + i * 38, x = p.nivelCep ? 52 : 14;
    g.fillStyle = SEV[p.severidad].c; g.fillRect(x, y, 10, 30);
    g.fillStyle = p.tags?.incidente ? '#ff8ad8' : p.nivelCep ? '#c4d0da' : '#ffffff';
    g.font = p.causa || p.tags?.incidente ? 'bold 23px sans-serif' : '22px sans-serif';
    const pre = p.tags?.incidente ? '◆ ' : p.causa ? 'CAUSA · ' : p.nivelCep ? '↳ ' : '';
    g.fillText((pre + p.nombre).slice(0, 78), x + 20, y + 23);
  });
}

export function graficos(g, w, h, z) {
  marco(g, w, h, 'Gráficos · historial 30 min');
  const series = (z?.series || []).slice(0, 4);
  const colores = ['#4F9FDE', '#E45959', '#FFA059', '#59DB8F'];
  series.forEach((s, i) => {
    const cx = 14 + (i % 2) * (w / 2 - 4), cy = 72 + Math.floor(i / 2) * ((h - 80) / 2), cw = w / 2 - 24, ch = (h - 80) / 2 - 12;
    g.fillStyle = '#16212d'; g.fillRect(cx, cy, cw, ch);
    g.fillStyle = '#c9d6e0'; g.font = 'bold 21px sans-serif'; g.fillText(s.titulo, cx + 12, cy + 28);
    const pts = s.puntos || [];
    if (pts.length < 2) return;
    const t0 = pts[0][0], t1 = pts[pts.length - 1][0];
    let max = Math.max(...pts.map((p) => p[1])), min = Math.min(0, ...pts.map((p) => p[1]));
    if (max === min) max = min + 1;
    const X = (t) => cx + 10 + ((t - t0) / Math.max(1, t1 - t0)) * (cw - 20), Y = (v) => cy + ch - 10 - ((v - min) / (max - min)) * (ch - 52);
    g.beginPath(); pts.forEach(([t, v], k) => (k ? g.lineTo(X(t), Y(v)) : g.moveTo(X(t), Y(v))));
    g.strokeStyle = colores[i]; g.lineWidth = 4; g.stroke();
    const ult = pts[pts.length - 1][1];
    g.fillStyle = colores[i]; g.font = 'bold 26px sans-serif'; g.textAlign = 'right';
    g.fillText(`${ult < 10 ? ult.toFixed(2) : Math.round(ult).toLocaleString('es-CO')} ${s.unidad}`, cx + cw - 12, cy + 30);
    g.textAlign = 'left';
  });
}

export function peajes(g, w, h, estado) {
  marco(g, w, h, 'App de recaudo · plazas y transacciones');
  if (!estado) return;
  (estado.plazas || []).forEach((p, i) => {
    const y = 76 + i * 64;
    g.fillStyle = p.modo === 'normal' ? '#e8eef4' : '#ffb020'; g.font = 'bold 23px sans-serif';
    g.fillText(p.nombre.replace('Peaje ', ''), 14, y + 26);
    g.fillStyle = '#8aa0b2'; g.font = '17px sans-serif'; g.fillText(p.modo === 'normal' ? `UPS ${p.ups}%` : p.modo.replace('_', ' '), 14, y + 48);
    p.carriles.forEach((c, k) => {
      const x = 200 + k * 134 + (k >= 3 ? 20 : 0);
      g.fillStyle = c.estado === 'cerrado' ? '#7a1f27' : c.estado === 'contingencia' ? '#7a5a12' : '#1d5a3f';
      g.fillRect(x, y + 4, 124, 50);
      g.fillStyle = '#fff'; g.font = 'bold 19px sans-serif'; g.fillText(`${c.id} ${c.tipo}`, x + 8, y + 26);
      g.font = '17px sans-serif'; g.fillText(`cola ${c.cola}`, x + 8, y + 47);
    });
  });
  const tx = (estado.transacciones || []).slice(-6).reverse();
  g.font = '19px monospace';
  tx.forEach((t, i) => {
    const y = 290 + i * 30;
    g.fillStyle = !t.ok ? '#ff5b66' : t.rechazado ? '#ffb020' : '#c9d6e0';
    const estadoTx = !t.ok ? 'FALLA' : t.rechazado ? 'TAG RECH.' : t.contingencia ? 'CONTING.' : 'OK';
    g.fillText(`${new Date(t.t * 1000).toLocaleTimeString('es-CO')}  ${t.plaza}-${t.carril}  ${t.placa}  ${t.medio.padEnd(8)} ${String(t.ms ?? '—').padStart(5)} ms  ${estadoTx}`, 14, y);
  });
}
