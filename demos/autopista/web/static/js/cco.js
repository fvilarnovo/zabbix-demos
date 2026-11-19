// Centro de mando: video wall con el corredor 3D, los paneles de Zabbix (problemas con CEP e historial), la app de
// peajes y la operación (KPI, fallas, bitácora). Todo con datos reales de /api/estado y /api/zabbix.
import { tablaProblemas, severidades, grafico, fmt, esc } from './zabbix.js';

const $ = (s) => document.querySelector(s);
const COLORES = ['#4F9FDE', '#E45959', '#FFA059', '#59DB8F', '#B5179E', '#FFC859'];
let armado = false, activos = [];

function armar(e) {
  if (armado) return;
  armado = true;
  $('#fallas').innerHTML = Object.entries(e.catalogo).map(([id, n]) => `<button data-id="${id}" title="${esc(n)}">${esc(n.split(/[:(]/)[0].slice(0, 30))}</button>`).join('')
    + '<button class="reset" data-id="__reset">Reset</button>';
  $('#fallas').onclick = async (ev) => {
    const b = ev.target.closest('button');
    if (!b) return;
    const ruta = b.dataset.id === '__reset' ? '/api/reset' : `/api/escenario/${b.dataset.id}${activos.includes(b.dataset.id) ? '/apagar' : ''}`;
    await fetch(ruta, { method: 'POST' });
    sondear();
  };
}

function kpis(e, items) {
  const v = (k) => items[k]?.valor;
  const k = e.kpi;
  const lista = [
    ['Vehículos en el corredor', k.vehiculos.toLocaleString('es-CO')],
    ['Velocidad media', `${k.velocidad.toFixed(0)} km/h`, k.velocidad < 35 ? 'mal' : ''],
    ['Cola máxima', `${k.cola_km.toFixed(1)} km`, k.cola_km > 1 ? 'mal' : k.cola_km > 0.4 ? 'alto' : ''],
    ['Recaudo hoy (Zabbix)', fmt(v('arm.kpi[recaudo_hoy]') ?? k.recaudo_hoy, 'COP')],
    ['Gateway p95 (APM)', fmt(v('arm.apm.gateway.p95'), 's'), v('arm.apm.gateway.p95') > 2 ? 'mal' : v('arm.apm.gateway.p95') > 1 ? 'alto' : ''],
    ['Problemas abiertos', String(e.problemas.length), e.problemas.length ? 'alto' : ''],
  ];
  $('#kpis').innerHTML = lista.map(([n, val, c = '']) => `<div class="kpi ${c}"><span>${n}</span><b>${val}</b></div>`).join('');
}

async function sondear() {
  try {
    const [e, z] = await Promise.all([fetch('/api/estado', { cache: 'no-store' }).then((r) => r.json()), fetch('/api/zabbix', { cache: 'no-store' }).then((r) => r.json())]);
    armar(e);
    activos = e.activos;
    const d = new Date((e.t_sim - 5 * 3600) * 1000);
    $('#reloj').textContent = `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
    $('#estado').textContent = z.ok ? '● Zabbix conectado' : '○ sin Zabbix';
    $('#estado').style.color = z.ok ? '#59db8f' : '#ff4d5a';
    if (z.dashboard) { $('#dash').href = z.dashboard; $('#dash').hidden = false; }
    $('#zbx-t').textContent = z.t ? `actualizado ${new Date(z.t * 1000).toLocaleTimeString('es-CO')}` : '';
    severidades($('#sevs'), z.severidades || {});
    tablaProblemas($('#problemas'), z.problemas || [], { max: 22, vacio: 'Sin problemas: operación normal' });
    kpis(e, z.items || {});
    $('#activos').textContent = activos.length ? `${activos.length} falla(s) activa(s)` : 'operación normal';
    document.querySelectorAll('#fallas button[data-id]').forEach((b) => b.classList.toggle('activo', activos.includes(b.dataset.id)));
    $('#bit').innerHTML = e.bitacora.slice().reverse().slice(0, 18).map((x) => `<li class="${x.tipo}"><time>${new Date(x.t * 1000).toLocaleTimeString('es-CO')}</time>${esc(x.txt)}</li>`).join('');
    const graf = $('#graf');
    const series = z.series || [];
    if (graf.children.length !== series.length) graf.innerHTML = series.map((s) => `<div class="g"><h4>${esc(s.titulo)} <b></b></h4><canvas></canvas></div>`).join('');
    series.forEach((s, i) => {
      const g = graf.children[i];
      const ult = s.puntos.length ? s.puntos[s.puntos.length - 1][1] : null;
      g.querySelector('b').textContent = fmt(ult, s.unidad);
      grafico(g.querySelector('canvas'), s, COLORES[i % COLORES.length]);
    });
  } catch (err) { /* reintenta */ }
}

sondear();
setInterval(sondear, 2500);
window.addEventListener('message', (ev) => { if (ev.data?.lugar) $('#lugar').textContent = ev.data.lugar; });
