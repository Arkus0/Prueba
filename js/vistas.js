/**
 * Las cuatro pantallas: Hoy, Contratos, Personas y Reparto.
 * Cada una recibe el contenedor y lo pinta entero; el estado que sobrevive
 * entre pinturas (filtros, búsqueda) vive en este módulo.
 */

import {
  estado, cargarUltimos, cargarDia, fechasDisponibles, itemsCargados,
  diasCargados, fuentesConProblema,
} from './datos.js';
import {
  euros, eurosExacto, porHabitante, tituloDeDia, paraBuscar, normalizarBusqueda,
} from './formato.js';
import { esc, listaHTML, ICONOS } from './ui.js';

export const filtros = {
  categoria: 'todo',
  subtipo: 'todo',
  orden: 'relevancia',
  busqueda: '',
  diasVisibles: 3,
};

const DIAS_POR_TANDA = 3;

/* ------------------------------- Utilidades ------------------------------- */

function avisoFuentes() {
  const rotas = fuentesConProblema();
  if (!rotas.length) return '';
  const nombres = rotas.map((f) => f.nombre || f.clave).join(' y ');
  return `<div class="aviso-fuente">${ICONOS.aviso}<span>Hoy no hemos podido leer <strong>${esc(nombres)}</strong>.
    Lo que ves puede estar incompleto; no rellenamos el hueco con estimaciones.</span></div>`;
}

function chipsHTML(opciones, activa, atributo) {
  return `<div class="chips" role="group">${opciones
    .map(([valor, texto, punto]) => `
      <button class="chip" type="button" data-${atributo}="${esc(valor)}" aria-pressed="${valor === activa}">
        ${punto ? `<span class="punto punto-${esc(punto)}"></span>` : ''}${esc(texto)}
      </button>`)
    .join('')}</div>`;
}

function pie() {
  const i = estado.indice || {};
  const actualizado = i.generado ? new Date(i.generado).toLocaleString('es-ES', { dateStyle: 'long', timeStyle: 'short' }) : '—';
  return `<footer class="pie">
    Datos del <a href="https://www.boe.es/datosabiertos/" target="_blank" rel="noopener noreferrer">BOE</a> y de la
    <a href="https://contrataciondelsectorpublico.gob.es/wps/portal/DatosAbiertos" target="_blank" rel="noopener noreferrer">Plataforma de Contratación del Sector Público</a>.
    Última actualización: ${esc(actualizado)}.<br>
    Esto no es una web oficial: es una lectura automática de datos abiertos. Ante cualquier duda, manda el documento original.
  </footer>`;
}

function filtrarPorCategoria(items) {
  if (filtros.categoria === 'todo') return items;
  return items.filter((i) => i.categoria === filtros.categoria);
}

/* ---------------------------------- Hoy ---------------------------------- */

export async function vistaHoy(cont) {
  cont.innerHTML = `${avisoFuentes()}<div class="cargando"></div><div class="cargando"></div><div class="cargando"></div>`;
  await cargarUltimos(filtros.diasVisibles);

  const fechas = fechasDisponibles().slice(0, filtros.diasVisibles);
  const hayMas = fechasDisponibles().length > filtros.diasVisibles;

  const bloques = fechas.map((fecha) => {
    const dia = estado.dias.get(fecha);
    if (!dia) return '';
    const items = filtrarPorCategoria(dia.items);
    const gastado = dia.items.reduce((t, i) => t + (Number(i.importeAdjudicado ?? i.importe) || 0), 0);
    return `
      <section class="seccion">
        <h2 class="seccion-titulo">${esc(tituloDeDia(fecha))}</h2>
        ${gastado > 0 ? `<p class="seccion-intro">Se publicaron <strong>${esc(euros(gastado))}</strong> en contratos, ayudas y partidas.${
          dia.omitidos ? ` Y otros ${dia.omitidos} documentos pequeños que no listamos uno a uno.` : ''
        }</p>` : ''}
        ${listaHTML(items, 'Ese día no hubo nada de esta categoría.', { sinFecha: true })}
      </section>`;
  }).join('');

  cont.innerHTML = `
    ${avisoFuentes()}
    ${chipsHTML([
      ['todo', 'Todo'],
      ['contratos', 'Contratos', 'contratos'],
      ['personas', 'Personas', 'personas'],
      ['subvenciones', 'Ayudas', 'subvenciones'],
      ['presupuesto', 'Presupuesto', 'presupuesto'],
    ], filtros.categoria, 'categoria')}
    ${bloques || '<p class="vacio">Todavía no hay datos descargados. La ingesta corre una vez al día.</p>'}
    ${hayMas ? '<button class="mas" type="button" data-mas-dias>Ver días anteriores</button>' : ''}
    ${pie()}`;
}

/* ------------------------------- Contratos ------------------------------- */

export async function vistaContratos(cont) {
  cont.innerHTML = '<div class="cargando"></div><div class="cargando"></div>';
  await cargarUltimos(Math.max(filtros.diasVisibles, 7));

  const consulta = normalizarBusqueda(filtros.busqueda);
  let items = itemsCargados().filter((i) => i.tipo === 'contrato');
  if (consulta) items = items.filter((i) => paraBuscar(i).includes(consulta));

  if (filtros.orden === 'importe') {
    items = [...items].sort((a, b) => (b.importeAdjudicado ?? b.importe ?? 0) - (a.importeAdjudicado ?? a.importe ?? 0));
  } else if (filtros.orden === 'sin-competencia') {
    items = items.filter((i) => (i.senales || []).includes('sin-competencia'));
  }

  const total = items.reduce((t, i) => t + (Number(i.importeAdjudicado ?? i.importe) || 0), 0);

  cont.innerHTML = `
    ${avisoFuentes()}
    <div class="buscador">
      ${ICONOS.buscar}
      <input type="search" id="busqueda" placeholder="Buscar empresa, ministerio, expediente…"
             value="${esc(filtros.busqueda)}" autocomplete="off" enterkeyhint="search" aria-label="Buscar en los contratos">
    </div>
    ${chipsHTML([
      ['relevancia', 'Lo más relevante'],
      ['importe', 'Los más caros'],
      ['sin-competencia', 'Sin concurso'],
    ], filtros.orden, 'orden')}
    <p class="seccion-intro"><strong>${items.length}</strong> contratos${consulta ? ` con “${esc(filtros.busqueda)}”` : ''}
      en los últimos ${esc(String(diasCargados()))} días publicados · <strong>${esc(euros(total) || '0 €')}</strong></p>
    ${listaHTML(items.slice(0, 120), 'Ningún contrato encaja con esa búsqueda.')}
    ${items.length > 120 ? `<p class="vacio">Mostramos los 120 primeros de ${items.length}. Afina la búsqueda para ver el resto.</p>` : ''}
    ${pie()}`;
}

/* -------------------------------- Personas -------------------------------- */

export async function vistaPersonas(cont) {
  cont.innerHTML = '<div class="cargando"></div><div class="cargando"></div>';
  await cargarUltimos(Math.max(filtros.diasVisibles, 7));

  const todos = itemsCargados().filter((i) => i.categoria === 'personas');
  const consulta = normalizarBusqueda(filtros.busqueda);
  const porSubtipo = (clave) => todos.filter((i) => i.subtipo === clave);

  let items = filtros.subtipo === 'todo' ? todos : porSubtipo(filtros.subtipo);
  if (consulta) items = items.filter((i) => paraBuscar(i).includes(consulta));

  const aDedo = porSubtipo('libre-designacion').length;
  const nombramientos = porSubtipo('nombramiento').length;
  const ceses = porSubtipo('cese').length;
  const plazas = estado.indice?.totales?.plazas || 0;

  cont.innerHTML = `
    ${avisoFuentes()}
    <p class="seccion-intro">Quién entra, quién sale y cómo se eligen los puestos del Estado, según el BOE
      de los últimos ${esc(String(diasCargados()))} días publicados.</p>
    <div class="rejilla-cifras">
      <div class="panel destacado"><span class="destacado-cifra cifra">${aDedo}</span><span class="destacado-pie">por libre designación</span></div>
      <div class="panel destacado"><span class="destacado-cifra cifra">${nombramientos}</span><span class="destacado-pie">nombramientos</span></div>
      <div class="panel destacado"><span class="destacado-cifra cifra">${ceses}</span><span class="destacado-pie">ceses</span></div>
      <div class="panel destacado"><span class="destacado-cifra cifra">${plazas}</span><span class="destacado-pie">plazas convocadas</span></div>
    </div>
    <div class="buscador" style="margin-top:14px">
      ${ICONOS.buscar}
      <input type="search" id="busqueda" placeholder="Buscar persona, puesto u organismo…"
             value="${esc(filtros.busqueda)}" autocomplete="off" aria-label="Buscar en personas">
    </div>
    ${chipsHTML([
      ['todo', 'Todo'],
      ['libre-designacion', 'Libre designación'],
      ['nombramiento', 'Nombramientos'],
      ['cese', 'Ceses'],
      ['empleo', 'Oposiciones'],
    ], filtros.subtipo, 'subtipo')}
    ${listaHTML(items.slice(0, 120), 'No hay nada de esto en los días descargados.')}
    ${pie()}`;
}

/* -------------------------------- Reparto -------------------------------- */

function barras(datos, total, opciones = {}) {
  if (!datos?.length) return '<p class="vacio">Sin datos suficientes todavía.</p>';
  const maximo = Math.max(...datos.map((d) => d.importe)) || 1;
  // El porcentaje se mide contra lo que enseña este gráfico, no contra otro total.
  const suma = datos.reduce((s, d) => s + d.importe, 0) || null;
  total = suma;
  return `<div class="barras">${datos
    .map((d) => {
      const ancho = Math.max(1.5, (d.importe / maximo) * 100);
      const parte = total ? Math.round((d.importe / total) * 100) : null;
      const etiqueta = `${d.clave}: ${eurosExacto(d.importe)} en ${d.n} ${d.n === 1 ? 'registro' : 'registros'}`;
      const interactiva = opciones.buscable ? ` data-buscar="${esc(d.clave)}"` : '';
      const eti = opciones.buscable ? 'button' : 'div';
      return `<${eti} class="barra-fila"${interactiva} type="button" aria-label="${esc(etiqueta)}">
          <span class="barra-cabeza">
            <span class="barra-nombre">${esc(d.clave)}</span>
            <span class="barra-valor cifra">${esc(euros(d.importe))}</span>
          </span>
          <span class="barra-pista"><span class="barra-relleno" style="width:${ancho.toFixed(1)}%"></span></span>
          <span class="barra-nota">${d.n} ${d.n === 1 ? 'registro' : 'registros'}${parte !== null ? ` · ${parte}% de lo listado` : ''}</span>
        </${eti}>`;
    })
    .join('')}</div>`;
}

export async function vistaReparto(cont) {
  const i = estado.indice;
  if (!i) { cont.innerHTML = '<div class="cargando"></div>'; return; }

  const t = i.totales || {};
  const reparto = i.reparto || {};
  const totalContratos = t.importeAdjudicado || t.importeContratos || 0;
  const totalOrganismos = (reparto.porOrganismo || []).reduce((s, d) => s + d.importe, 0);
  const porcentajeSinConcurso = t.importeContratos
    ? Math.round((t.importeSinCompetencia / (t.importeAdjudicado || t.importeContratos)) * 100)
    : 0;

  const presupuesto = i.presupuesto || {};
  const bloquePGE = presupuesto.disponible
    ? `<section class="seccion">
        <h2 class="seccion-titulo">Presupuesto del Estado por partidas</h2>
        <p class="seccion-intro">Lo que el Estado tiene <em>previsto</em> gastar, según ${esc(presupuesto.fuente || 'la fuente oficial')}.</p>
        ${barras((presupuesto.partidas || []).slice(0, 15).map((p) => ({ clave: p.nombre, importe: p.importe, n: 1 })), presupuesto.total)}
        <p class="barra-nota" style="margin-top:10px"><a href="${esc(presupuesto.url)}" target="_blank" rel="noopener noreferrer">Fuente</a></p>
      </section>`
    : `<section class="seccion">
        <h2 class="seccion-titulo">Presupuesto del Estado por partidas</h2>
        <div class="aviso-fuente neutro">${ICONOS.info}<span>Todavía no podemos mostrar el presupuesto por partidas.
          ${esc(presupuesto.motivo || 'La fuente oficial no está disponible en un formato que podamos leer solos.')}
          Preferimos decirlo a enseñarte una cifra inventada.</span></div>
        <p class="seccion-intro"><a href="https://www.sepg.pap.hacienda.gob.es/sitios/sepg/es-ES/Presupuestos/Paginas/Presupuestos.aspx" target="_blank" rel="noopener noreferrer">Presupuestos Generales del Estado (web oficial)</a></p>
      </section>`;

  cont.innerHTML = `
    ${avisoFuentes()}
    <section class="seccion">
      <div class="panel destacado">
        <span class="destacado-cifra cifra">${esc(euros(totalContratos) || '0 €')}</span>
        <span class="destacado-pie">en contratos públicos publicados en los últimos ${esc(String(i.ventana?.dias || 7))} días.
          ${porHabitante(totalContratos) ? `Son unos <strong>${esc(porHabitante(totalContratos))}</strong>.` : ''}</span>
      </div>
      <div class="rejilla-cifras">
        <div class="panel destacado"><span class="destacado-cifra cifra">${esc(String(t.contratos || 0))}</span><span class="destacado-pie">contratos</span></div>
        <div class="panel destacado"><span class="destacado-cifra cifra">${porcentajeSinConcurso}%</span><span class="destacado-pie">del dinero, sin concurso abierto</span></div>
        <div class="panel destacado"><span class="destacado-cifra cifra">${esc(euros(t.importeSubvenciones) || '0 €')}</span><span class="destacado-pie">en ayudas y convenios</span></div>
        <div class="panel destacado"><span class="destacado-cifra cifra">${esc(String(t.libresDesignaciones || 0))}</span><span class="destacado-pie">puestos por libre designación</span></div>
      </div>
      <p class="seccion-intro" style="margin-top:12px">Esto es lo que se ha <strong>publicado</strong> en este periodo,
        no el gasto total del Estado. Sirve para ver a dónde va el dinero que sí se hace público cada día.</p>
    </section>

    <section class="seccion">
      <h2 class="seccion-titulo">Quién gasta</h2>
      <p class="seccion-intro">Toca un organismo para ver sus contratos.</p>
      ${barras((reparto.porOrganismo || []).slice(0, 12), totalOrganismos, { buscable: true })}
    </section>

    <section class="seccion">
      <h2 class="seccion-titulo">Quién cobra</h2>
      ${barras((reparto.empresas || []).slice(0, 10), totalContratos, { buscable: true })}
    </section>

    <section class="seccion">
      <h2 class="seccion-titulo">Cómo se decide</h2>
      ${barras((reparto.porProcedimiento || []).slice(0, 8), totalContratos)}
    </section>

    <section class="seccion">
      <h2 class="seccion-titulo">En qué</h2>
      ${barras((reparto.porTipo || []).slice(0, 6), totalContratos)}
    </section>

    ${bloquePGE}
    ${pie()}`;
}
