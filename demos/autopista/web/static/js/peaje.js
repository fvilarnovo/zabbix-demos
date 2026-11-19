// App de control de peajes: plazas y carriles en vivo, transacciones reales, mapa de servicios con los datos que
// Zabbix calcula de las trazas, simulación de problemas y lo que Zabbix detecta (con el CEP).
import { tablaProblemas, esc, fmt } from './zabbix.js';

const $ = (s) => document.querySelector(s);
const compacto = new URLSearchParams(location.search).has('compacto');
if (compacto) document.body.classList.add('compacto');

const FALLAS = [
  ['bd-recaudo', 'BD de recaudo con bloqueos', 'Latencia y errores en el registro'],
  ['operador-tag', 'Operador TAG caído', 'Interoperabilidad sin respuesta'],
  ['gateway-memoria', 'Fuga de memoria del gateway', 'Pausas de GC y reinicios'],
  ['energia-vegachi', 'Vegachí sin energía', 'UPS, planta y carriles cerrados'],
  ['fibra-uf2', 'Corte de fibra UF-2', 'Vegachí en contingencia'],
  ['barrera-pbe', 'Barrera atascada', 'Puerto Berrío, carril A3'],
];
const NIVELES_APP = new Set(['apm', 'infra']);
const PROBLEMAS_PLAZA = new Set(['cola_peaje', 'tag_rechazado', 'contingencia', 'sin_enlace', 'sin_energia', 'barrera_falla',
  'carriles_cerrados', 'ups_baja', 'planta_emergencia']);
const CAT = { 1: 'I', 2: 'II', 3: 'III', 4: 'IV', 5: 'V', 6: 'VI', 7: 'VII' };

let activos = [];
const vistas = new Set();

function armarFallas() {
  $('#fallas').innerHTML = FALLAS.map(([id, n, d]) => `<button data-id="${id}">${esc(n)}<small>${esc(d)}</small></button>`).join('');
  $('#fallas').onclick = async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const on = activos.includes(b.dataset.id);
    const r = await fetch(`/api/escenario/${b.dataset.id}${on ? '/apagar' : ''}`, { method: 'POST' });
    const j = await r.json().catch(() => ({}));
    $('#aviso').textContent = r.ok ? j.mensaje : `No se pudo: ${j.detail || j.mensaje || r.status}`;
    sondear();
  };
}

function kpi(id, valor, nivel = '') {
  const el = $(id);
  el.querySelector('b').textContent = valor;
  el.className = `k ${nivel}`;
}

function plazas(lista) {
  $('#plazas').innerHTML = lista.map((p) => {
    const chip = p.modo === 'sin_sistema' ? '<span class="chip mal">sin sistema · operación manual</span>'
      : p.modo === 'contingencia' ? `<span class="chip ojo">contingencia · ${p.pendientes} pendientes</span>` : '<span class="chip">en línea</span>';
    const energia = p.red ? `red OK · UPS ${p.ups}%` : `SIN RED · UPS ${p.ups}%${p.planta === 2 ? ' · planta no arrancó' : ''}`;
    const carril = (c) => `<div class="carril ${c.estado}"><b>${c.id}</b><span class="tipo ${c.tipo}">${c.tipo}</span><br>
      <span class="placa">${c.caseta ? `${esc(c.caseta)} · ${CAT[c.cat] || ''}` : '&nbsp;'}</span><br>
      <span class="cola ${c.cola > 6 ? 'larga' : ''}">cola ${c.cola}</span>
      <span class="barrera ${c.falla ? 'falla' : ''}" style="transform:rotate(${-c.barrera * 80}deg)"></span></div>`;
    const A = p.carriles.filter((c) => c.id[0] === 'A'), B = p.carriles.filter((c) => c.id[0] === 'B');
    return `<div class="plaza ${p.modo}"><h3>${esc(p.nombre)} ${chip} <small>${energia} · enlace CCO ${p.enlace ? 'OK' : 'caído'}</small></h3>
      <div class="carriles">${A.map(carril).join('')}<span></span>${B.map(carril).join('')}</div></div>`;
  }).join('');
}

function transacciones(lista) {
  const filas = lista.slice().reverse();
  $('#tx').innerHTML = filas.map((t) => {
    const clave = `${t.t}${t.placa}`;
    const nuevo = !vistas.has(clave);
    vistas.add(clave);
    const [cls, est] = !t.ok ? ['mal', 'FALLA · contingencia'] : t.rechazado ? ['ojo', 'TAG rechazado → efectivo'] : t.contingencia ? ['ojo', 'contingencia'] : ['', 'aprobada'];
    return `<tr class="${cls} ${nuevo ? 'nuevo' : ''}"><td>${new Date(t.t * 1000).toLocaleTimeString('es-CO')}</td><td>${t.plaza}</td><td>${t.carril}</td>
      <td class="mono">${esc(t.placa)}</td><td>${CAT[t.cat]}</td><td>${t.medio === 'tag' ? 'TAG' : 'Efectivo'}</td><td>$${t.valor.toLocaleString('es-CO')}</td>
      <td>${t.ms == null ? '—' : `${t.ms.toLocaleString('es-CO')} ms`}</td><td><span class="est ${cls}">${est}</span></td><td class="mono">${t.traza ? t.traza.slice(0, 8) : '—'}</td></tr>`;
  }).join('');
  if (vistas.size > 500) vistas.clear();
}

// Mapa de servicios: cada nodo toma su estado de los ítems de Zabbix (Telemetry query + plataforma).
function mapa(items) {
  const v = (k) => items[k]?.valor;
  const est = (rojo, ambar) => (rojo ? 'mal' : ambar ? 'ojo' : 'ok');
  const svc = (k) => ({ p95: v(`arm.apm.${k}.p95`), err: v(`arm.apm.${k}.error_pct`), tot: v(`arm.apm.${k}.total`) });
  const gw = svc('gateway'), va = svc('validacion'), op = svc('operador'), tr = svc('transacciones');
  const heap = v('arm.gateway.heap_pct'), bloq = v('arm.bd.bloqueos'), pool = v('arm.bd.conexiones_pct'), enlace = v('arm.interop.enlace');
  const det = (s) => `p95 ${fmt(s.p95, 's')} · ${s.err == null ? '—' : s.err.toFixed(0)}% err · ${s.tot == null ? '—' : Math.round(s.tot)}/min`;
  const nodos = {
    carriles: { x: 10, y: 120, t: 'Carriles (3 plazas)', d: '18 carriles TAG/manual', e: 'ok' },
    gateway: { x: 150, y: 120, t: 'peaje-gateway', d: det(gw), d2: `heap ${heap == null ? '—' : heap.toFixed(0)}%`, e: est(gw.p95 > 2 || gw.err > 5 || heap > 85, gw.p95 > 1 || heap > 75) },
    tarifas: { x: 330, y: 18, t: 'tarifas', d: 'consulta por categoría', e: 'ok' },
    validacion: { x: 330, y: 120, t: 'validacion-tag', d: det(va), e: est(va.err > 20, va.p95 > 2) },
    registro: { x: 330, y: 222, t: 'transacciones', d: det(tr), e: est(tr.p95 > 1 || tr.err > 10, tr.p95 > 0.6) },
    externo: { x: 455, y: 120, t: 'operador-tag', d: enlace === 0 ? 'SIN RESPUESTA' : `p95 ${fmt(op.p95, 's')}`, e: est(enlace === 0 || op.p95 > 2.5, op.p95 > 1), ext: true },
    bd: { x: 455, y: 222, t: 'BD recaudo', d: `bloq. ${bloq ?? '—'} · pool ${pool == null ? '—' : pool.toFixed(0)}%`, e: est(bloq > 10, pool > 80) },
  };
  const W = { carriles: 120, gateway: 150, tarifas: 150, validacion: 115, registro: 115, externo: 102, bd: 102 };
  const aristas = [['carriles', 'gateway'], ['gateway', 'tarifas'], ['gateway', 'validacion'], ['gateway', 'registro'], ['validacion', 'externo'], ['registro', 'bd']];
  const c = (k) => [nodos[k].x + W[k] / 2, nodos[k].y + 30];
  let svg = aristas.map(([a, b]) => {
    const [x1, y1] = c(a), [x2, y2] = c(b);
    const e = nodos[b].e === 'mal' ? 'mal' : nodos[b].e === 'ojo' ? 'ojo' : '';
    return `<path class="arista ${e}" d="M${x1 + W[a] / 2 - 4},${y1} C${(x1 + x2) / 2 + 30},${y1} ${(x1 + x2) / 2 - 30},${y2} ${x2 - W[b] / 2 + 4},${y2}"/>`;
  }).join('');
  svg += Object.entries(nodos).map(([k, n]) => `<g class="nodo ${n.e} ${n.ext ? 'externo' : ''}" transform="translate(${n.x},${n.y})">
    <rect width="${W[k]}" height="${n.d2 ? 72 : 60}"/><text class="t" x="8" y="20">${esc(n.t)}</text>
    <text class="det" x="8" y="38">${esc(n.d.split(' · ').slice(0, 2).join(' · '))}</text>
    <text class="det" x="8" y="53">${esc(n.d.split(' · ').slice(2).join(' · '))}</text>
    ${n.d2 ? `<text class="det" x="8" y="67">${esc(n.d2)}</text>` : ''}</g>`).join('');
  $('#mapa').innerHTML = svg;
}

async function sondear() {
  try {
    const [e, z] = await Promise.all([fetch('/api/estado', { cache: 'no-store' }).then((r) => r.json()), fetch('/api/zabbix', { cache: 'no-store' }).then((r) => r.json())]);
    activos = e.activos;
    const it = z.items || {}, v = (k) => it[k]?.valor;
    const d = new Date((e.t_sim - 5 * 3600) * 1000);
    $('#reloj').textContent = `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')} · ${z.ok ? 'Zabbix conectado' : 'sin Zabbix'}`;
    kpi('#k-recaudo', fmt(v('arm.kpi[recaudo_hoy]') ?? e.kpi.recaudo_hoy, 'COP'));
    kpi('#k-tx', Math.round(v('arm.kpi[transacciones_hoy]') ?? e.kpi.transacciones_hoy).toLocaleString('es-CO'));
    kpi('#k-lat', `${e.kpi.latencia_ms.toLocaleString('es-CO')} ms`, e.kpi.latencia_ms > 2000 ? 'mal' : e.kpi.latencia_ms > 800 ? 'alto' : '');
    kpi('#k-tag', `${Math.round(e.kpi.tag_pct)} %`);
    const fall = v('arm.kpi[fallidas_15m]'), rech = v('arm.kpi[tag_rechazados_15m]');
    kpi('#k-fallidas', fall == null ? '—' : Math.round(fall), fall > 0 ? 'mal' : '');
    kpi('#k-rech', rech == null ? '—' : Math.round(rech), rech > 3 ? 'alto' : '');
    plazas(e.plazas);
    transacciones(e.transacciones || []);
    mapa(it);
    document.querySelectorAll('#fallas button').forEach((b) => b.classList.toggle('activo', activos.includes(b.dataset.id)));
    const delApp = (z.problemas || []).filter((p) => NIVELES_APP.has(p.tags?.nivel) || p.tags?.recaudo === 'si' || PROBLEMAS_PLAZA.has(p.tags?.problema));
    // un síntoma de la app cuya causa no es de la app igual se muestra con su causa
    const ids = new Set(delApp.map((p) => p.id));
    for (const p of z.problemas || []) if (!ids.has(p.id) && delApp.some((q) => q.de === p.id)) delApp.push(p);
    tablaProblemas($('#zbx'), delApp, { vacio: 'Zabbix no ve problemas en la app ni en las plazas' });
    $('#zbx-estado').innerHTML = z.dashboard ? `<a href="${z.dashboard}" target="_blank" rel="noopener">Abrir dashboard ↗</a>` : '';
  } catch (err) { /* reintenta en el próximo ciclo */ }
}

armarFallas();
sondear();
setInterval(sondear, 1500);
