/**
 * Las cuatro pantallas: Hoy, Contratos, Personas y Reparto.
 * Cada una recibe el contenedor y lo pinta entero; el estado que sobrevive
 * entre pinturas (filtros, búsqueda) vive en este módulo.
 */

import {
  estado, cargarUltimos, cargarOposiciones, fechasDisponibles,
  itemsCargados, diasCargados, fuentesConProblema, nombreDeCCAA,
} from './datos.js';
import {
  euros, numero, porHabitante, tituloDeDia, paraBuscar, normalizarBusqueda,
} from './formato.js';
import { esc, listaHTML, tarjetaOposicionHTML, ICONOS } from './ui.js';
import { barras, mapa, anillo, barraApilada, serie, chispa } from './graficos.js';

export const filtros = {
  empleo: 'abiertas',
  ccaa: 'todo',
  mapa: 'total',
  categoria: 'todo',
  subtipo: 'todo',
  orden: 'relevancia',
  nivel: 'todo',
  busqueda: '',
  diasVisibles: 3,
  diasBusqueda: 7,
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

/** Botón para ampliar la ventana de búsqueda sin descargarlo todo de golpe. */
function masDias() {
  const disponibles = fechasDisponibles().length;
  if (filtros.diasBusqueda >= disponibles) {
    return `<p class="vacio">Ya estás viendo los ${disponibles} días descargados.</p>`;
  }
  return `<button class="mas" type="button" data-mas-busqueda>Buscar también en días anteriores
    (ahora: ${filtros.diasBusqueda} de ${disponibles})</button>`;
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

/* -------------------------------- Portada --------------------------------- */

/** El bloque del mapa, con su interruptor. Lo usan la portada y Reparto. */
function bloqueMapa(indice, opciones = {}) {
  const reparto = indice.reparto || {};
  const filas = reparto.porCCAA || [];
  if (!filas.length) {
    return `<div class="aviso-fuente neutro">${ICONOS.info}<span>Todavía no hay contratos
      localizados por comunidad. Aparecerán en cuanto la ingesta traiga contratos nuevos.</span></div>`;
  }
  return `
    <div class="conmutador" role="group" aria-label="Cómo se mide el mapa">
      <button type="button" data-mapa="total" aria-pressed="${filtros.mapa === 'total'}">En total</button>
      <button type="button" data-mapa="habitante" aria-pressed="${filtros.mapa === 'habitante'}">Por habitante</button>
    </div>
    ${mapa(filas, {
      modo: filtros.mapa,
      territorio: indice.territorio || {},
      activa: opciones.activa,
    })}`;
}

/** Las cifras de cabecera, con su chispa cuando hay serie que enseñar. */
function cifras(indice) {
  const t = indice.totales || {};
  const dias = [...(indice.dias || [])].reverse().slice(-40);
  const porcentajeSinConcurso = t.importeContratos
    ? Math.round((t.importeSinCompetencia / (t.importeAdjudicado || t.importeContratos)) * 100)
    : 0;

  const ficha = (cifra, pie, valores) => `
    <div class="panel destacado">
      <span class="destacado-cifra cifra">${esc(cifra)}</span>
      <span class="destacado-pie">${pie}</span>
      ${valores ? chispa(valores) : ''}
    </div>`;

  return `<div class="rejilla-cifras">
      ${ficha(numero(t.contratos), 'contratos publicados', dias.map((d) => d.contratos))}
      ${ficha(`${porcentajeSinConcurso}%`, 'del dinero, sin concurso abierto')}
      ${ficha(String(indice.oposiciones?.abiertas || 0), 'oposiciones con plazo abierto')}
      ${ficha(String(t.libresDesignaciones || 0), 'puestos por libre designación', dias.map((d) => d.personas))}
    </div>`;
}

export async function vistaPortada(cont) {
  const indice = estado.indice;
  if (!indice) { cont.innerHTML = '<div class="cargando"></div>'; return; }

  cont.innerHTML = `${avisoFuentes()}<div class="cargando"></div><div class="cargando"></div><div class="cargando"></div>`;
  await cargarUltimos(filtros.diasVisibles);

  const t = indice.totales || {};
  const reparto = indice.reparto || {};
  const total = t.importeAdjudicado || t.importeContratos || 0;
  const tuyo = porHabitante(total);
  const dias = indice.ventana?.dias || 7;

  // Lo más gordo de los días cargados: tres tarjetas, no la lista entera.
  const cargados = itemsCargados();
  const gordos = [...cargados]
    .filter((i) => Number(i.importeAdjudicado ?? i.importe) > 0)
    .sort((a, b) => (b.importeAdjudicado ?? b.importe) - (a.importeAdjudicado ?? a.importe))
    .slice(0, 3);

  const fechas = fechasDisponibles().slice(0, filtros.diasVisibles);
  const hayMas = fechasDisponibles().length > filtros.diasVisibles;

  // Un día movido puede traer varios cientos de contratos. Sin tope, "Día a
  // día" llegaba a pintar más de 400 tarjetas de una vez (~100.000 px de
  // scroll en el móvil). Se enseña lo más relevante y se cuenta el resto,
  // igual que ya se hace con los contratos que no llegan a tarjeta.
  const TOPE_POR_DIA = 20;
  const bloques = fechas.map((fecha) => {
    const dia = estado.dias.get(fecha);
    if (!dia) return '';
    const items = filtrarPorCategoria(dia.items);
    const visibles = items.slice(0, TOPE_POR_DIA);
    const sinListar = items.length - visibles.length + (dia.omitidos || 0);
    const gastado = dia.items.reduce((acumulado, i) => acumulado + (Number(i.importeAdjudicado ?? i.importe) || 0), 0);
    return `
      <section class="seccion">
        <h3 class="seccion-titulo">${esc(tituloDeDia(fecha))}</h3>
        ${gastado > 0 ? `<p class="seccion-intro">Se publicaron <strong>${esc(euros(gastado))}</strong> en contratos, ayudas y partidas.${
          sinListar ? ` Y otros ${sinListar} documentos que no listamos aquí.` : ''
        }</p>` : ''}
        ${listaHTML(visibles, 'Ese día no hubo nada de esta categoría.', { sinFecha: true })}
        ${items.length > TOPE_POR_DIA ? `<p class="vacio">Mostramos ${TOPE_POR_DIA} de ${items.length} de ese día.
          Para verlos todos, usa la pestaña Contratos.</p>` : ''}
      </section>`;
  }).join('');

  cont.innerHTML = `
    ${avisoFuentes()}

    <div class="titular">
      <span class="titular-cifra cifra">${esc(euros(total) || '0 €')}</span>
      <span class="titular-que">es lo que el Estado ha publicado en contratos en los últimos
        ${esc(String(dias))} días. No es todo lo que gasta: es lo que se hace público cada día,
        contrato a contrato.</span>
      ${tuyo ? `<span class="titular-tuyo">De eso te tocan <strong>${esc(tuyo)}</strong></span>` : ''}
    </div>

    <section class="seccion">
      <h2 class="seccion-titulo">Dónde</h2>
      <p class="seccion-intro">Toca tu comunidad para ver sus contratos.</p>
      ${bloqueMapa(indice)}
    </section>

    <section class="seccion">
      <h2 class="seccion-titulo">En números</h2>
      ${cifras(indice)}
    </section>

    <section class="seccion">
      <h2 class="seccion-titulo">En qué se gasta</h2>
      <p class="seccion-intro">Según el código europeo que lleva cada contrato, traducido.
        Últimos ${esc(String(reparto.dias || 30))} días publicados.</p>
      <div class="grafico">${barraApilada(reparto.porSector || [], { tope: 5 })}</div>
    </section>

    <section class="seccion">
      <h2 class="seccion-titulo">Cómo se decide</h2>
      <div class="grafico">
        ${anillo(t.importeSinCompetencia || 0, t.importeAdjudicado || t.importeContratos || 0, {
          etiqueta: 'del dinero se adjudica sin un concurso abierto. Es legal y habitual —negociados, emergencias, contratos menores—, pero conviene saber cuánto es.',
        })}
      </div>
    </section>

    <section class="seccion">
      <h2 class="seccion-titulo">El pulso</h2>
      <p class="seccion-intro">Lo que se ha publicado cada día, para ver si esto es un goteo
        constante o van a rachas.</p>
      <div class="grafico">${serie(indice.dias || [], { dias: 90 })}</div>
    </section>

    ${gordos.length ? `
    <section class="seccion">
      <h2 class="seccion-titulo">Lo más gordo estos días</h2>
      ${listaHTML(gordos, '')}
    </section>` : ''}

    <section class="seccion">
      <h2 class="seccion-titulo">Día a día</h2>
      ${chipsHTML([
        ['todo', 'Todo'],
        ['contratos', 'Contratos', 'contratos'],
        ['personas', 'Personas', 'personas'],
        ['subvenciones', 'Ayudas', 'subvenciones'],
        ['presupuesto', 'Presupuesto', 'presupuesto'],
      ], filtros.categoria, 'categoria')}
      ${bloques || '<p class="vacio">Todavía no hay datos descargados. La ingesta corre una vez al día.</p>'}
      ${hayMas ? '<button class="mas" type="button" data-mas-dias>Ver días anteriores</button>' : ''}
    </section>
    ${pie()}`;
}

/* ------------------------------- Contratos ------------------------------- */

export async function vistaContratos(cont) {
  cont.innerHTML = '<div class="cargando"></div><div class="cargando"></div>';
  await cargarUltimos(filtros.diasBusqueda);

  const consulta = normalizarBusqueda(filtros.busqueda);
  let items = itemsCargados().filter((i) => i.tipo === 'contrato');
  if (filtros.nivel !== 'todo') items = items.filter((i) => i.nivel === filtros.nivel);
  if (filtros.ccaa !== 'todo') items = items.filter((i) => i.ccaa === filtros.ccaa);
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
    ${chipsHTML([
      ['todo', 'Todas las administraciones'],
      ['estado', 'Estado'],
      ['autonomica', 'Comunidades'],
      ['local', 'Ayuntamientos'],
    ], filtros.nivel, 'nivel')}
    ${chipsHTML([
      ['todo', 'Toda España'],
      ...(estado.indice?.reparto?.porCCAA || []).map((c) => [c.clave, c.nombre]),
    ], filtros.ccaa, 'ccaa')}
    <p class="seccion-intro"><strong>${items.length}</strong> contratos${consulta ? ` con “${esc(filtros.busqueda)}”` : ''}${
      filtros.ccaa !== 'todo' ? ` publicados en ${esc(nombreDeCCAA(filtros.ccaa) || '')}` : ''}
      en los últimos ${esc(String(diasCargados()))} días publicados · <strong>${esc(euros(total) || '0 €')}</strong></p>
    ${listaHTML(items.slice(0, 120), 'Ningún contrato encaja con esa búsqueda.')}
    ${items.length > 120 ? `<p class="vacio">Mostramos los 120 primeros de ${items.length}. Afina la búsqueda para ver el resto.</p>` : ''}
    ${masDias()}
    ${pie()}`;
}

/* -------------------------------- Personas -------------------------------- */

export async function vistaPersonas(cont) {
  cont.innerHTML = '<div class="cargando"></div><div class="cargando"></div>';
  await cargarUltimos(filtros.diasBusqueda);

  const todos = itemsCargados().filter((i) => i.categoria === 'personas');
  const consulta = normalizarBusqueda(filtros.busqueda);
  const porSubtipo = (clave) => todos.filter((i) => i.subtipo === clave);

  const esLibreDesignacion = (i) => i.subtipo === 'libre-designacion' || i.subtipo === 'libre-designacion-resuelta';
  let items = filtros.subtipo === 'todo'
    ? todos
    : filtros.subtipo === 'libre-designacion'
      ? todos.filter(esLibreDesignacion)
      : porSubtipo(filtros.subtipo);
  if (consulta) items = items.filter((i) => paraBuscar(i).includes(consulta));

  const aDedo = todos.filter(esLibreDesignacion).length;
  const nombramientos = porSubtipo('nombramiento').length;
  const ceses = porSubtipo('cese').length;
  // Las plazas de verdad salen del texto de cada convocatoria, no del titular,
  // así que se cuentan en la pestaña Empleo.
  const oposicionesAbiertas = estado.indice?.oposiciones?.abiertas || 0;

  cont.innerHTML = `
    ${avisoFuentes()}
    <p class="seccion-intro">Quién entra, quién sale y cómo se eligen los puestos del Estado, según el BOE
      de los últimos ${esc(String(diasCargados()))} días publicados.</p>
    <div class="rejilla-cifras">
      <div class="panel destacado"><span class="destacado-cifra cifra">${aDedo}</span><span class="destacado-pie">por libre designación</span></div>
      <div class="panel destacado"><span class="destacado-cifra cifra">${nombramientos}</span><span class="destacado-pie">nombramientos</span></div>
      <div class="panel destacado"><span class="destacado-cifra cifra">${ceses}</span><span class="destacado-pie">ceses</span></div>
      <div class="panel destacado"><span class="destacado-cifra cifra">${oposicionesAbiertas}</span><span class="destacado-pie">oposiciones abiertas</span></div>
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
      ['situacion', 'Otros cambios'],
    ], filtros.subtipo, 'subtipo')}
    ${listaHTML(items.slice(0, 120), 'No hay nada de esto en los días descargados.')}
    ${masDias()}
    ${pie()}`;
}

/* --------------------------- Empleo público ------------------------------ */

export async function vistaEmpleo(cont) {
  cont.innerHTML = '<div class="cargando"></div><div class="cargando"></div>';
  const convocatorias = await cargarOposiciones();

  const consulta = normalizarBusqueda(filtros.busqueda);
  const abiertas = convocatorias.filter((c) => c.abierta);
  const plazasAbiertas = abiertas.reduce((t, c) => t + (c.plazas || 0), 0);

  let lista = filtros.empleo === 'abiertas' ? abiertas : convocatorias;
  if (consulta) {
    lista = lista.filter((c) => normalizarBusqueda(`${c.frase} ${c.titulo} ${c.organismo} ${c.grupo || ''}`).includes(consulta));
  }

  cont.innerHTML = `
    ${avisoFuentes()}
    <section class="seccion">
      <div class="panel destacado">
        <span class="destacado-cifra cifra">${abiertas.length}</span>
        <span class="destacado-pie">convocatorias con el plazo abierto ahora mismo${plazasAbiertas ? `, con <strong>${plazasAbiertas.toLocaleString('es-ES')} plazas</strong> en total` : ''}.</span>
      </div>
      <p class="seccion-intro">Todo lo que el Estado saca a concurso para trabajar en él: cuántas plazas,
        qué hace falta para presentarse y hasta cuándo puedes apuntarte.</p>
    </section>

    <div class="buscador">
      ${ICONOS.buscar}
      <input type="search" id="busqueda" placeholder="Buscar cuerpo, ministerio, grupo…"
             value="${esc(filtros.busqueda)}" autocomplete="off" aria-label="Buscar convocatorias">
    </div>
    ${chipsHTML([
      ['abiertas', 'Abiertas ahora'],
      ['todas', 'Todas las publicadas'],
    ], filtros.empleo, 'empleo')}

    ${lista.length
      ? lista.slice(0, 100).map(tarjetaOposicionHTML).join('')
      : `<p class="vacio">${convocatorias.length
          ? 'Ninguna convocatoria encaja con lo que buscas.'
          : 'Todavía no hemos leído ninguna convocatoria. Aparecen aquí en cuanto el BOE publique la siguiente.'}</p>`}
    ${lista.length > 100 ? `<p class="vacio">Mostramos 100 de ${lista.length}. Afina la búsqueda para ver el resto.</p>` : ''}
    ${pie()}`;
}

/* -------------------------------- Reparto -------------------------------- */

/** Los agregados del índice vienen como {clave, n, importe}. */
const comoBarras = (filas = []) => filas.map((d) => ({
  clave: d.clave,
  valor: d.importe,
  nota: `${d.n} ${d.n === 1 ? 'registro' : 'registros'}`,
}));

const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const nombreDeMes = (mes) => {
  const [anio, m] = mes.split('-');
  return `${MESES_CORTOS[Number(m) - 1]} ${anio.slice(2)}`;
};

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

  const historico = (i.historico || []).slice(0, 14).reverse();
  const conHistorico = historico.length > 1;
  const presupuesto = i.presupuesto || {};
  const bloquePGE = presupuesto.disponible
    ? `<section class="seccion">
        <h2 class="seccion-titulo">Presupuesto del Estado por partidas</h2>
        <p class="seccion-intro">Lo que el Estado tiene <em>previsto</em> gastar, según ${esc(presupuesto.fuente || 'la fuente oficial')}.</p>
        ${barras((presupuesto.partidas || []).slice(0, 15).map((p) => ({ clave: p.nombre, valor: p.importe })))}
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
        <div class="panel destacado"><span class="destacado-cifra cifra">${numero(t.contratos)}</span><span class="destacado-pie">contratos</span></div>
        <div class="panel destacado"><span class="destacado-cifra cifra">${porcentajeSinConcurso}%</span><span class="destacado-pie">del dinero, sin concurso abierto</span></div>
        <div class="panel destacado"><span class="destacado-cifra cifra">${t.importeSubvenciones ? esc(euros(t.importeSubvenciones)) : esc(String(t.subvenciones || 0))}</span><span class="destacado-pie">${t.importeSubvenciones ? 'en ayudas y convenios' : 'ayudas y convenios publicados'}</span></div>
        <div class="panel destacado"><span class="destacado-cifra cifra">${esc(String(t.libresDesignaciones || 0))}</span><span class="destacado-pie">puestos por libre designación</span></div>
      </div>
      <p class="seccion-intro" style="margin-top:12px">Esto es lo que se ha <strong>publicado</strong> en este periodo,
        no el gasto total del Estado. Sirve para ver a dónde va el dinero que sí se hace público cada día.
        ${i.cobertura?.desde ? `Tenemos datos desde el ${esc(i.cobertura.desde)}.` : ''}</p>
    </section>

    <section class="seccion">
      <h2 class="seccion-titulo">Por comunidades</h2>
      <p class="seccion-intro">El mismo mapa de la portada, pero aquí puedes compararlo por habitante,
        que es la única forma de que Madrid y Cataluña no se lo coman todo solo por ser las más pobladas.</p>
      ${bloqueMapa(i, { activa: filtros.ccaa !== 'todo' ? filtros.ccaa : null })}
      ${barras((reparto.porCCAA || []).slice(0, 8).map((c) => ({
        clave: c.nombre,
        valor: c.importe,
        nota: `${c.n} ${c.n === 1 ? 'contrato' : 'contratos'}`,
      })))}
    </section>

    <section class="seccion">
      <h2 class="seccion-titulo">En qué se gasta</h2>
      <p class="seccion-intro">Traducido del código CPV que lleva cada contrato.</p>
      ${barras(comoBarras((reparto.porSector || []).slice(0, 10)))}
    </section>

    <section class="seccion">
      <h2 class="seccion-titulo">Quién gasta</h2>
      <p class="seccion-intro">Últimos ${esc(String(reparto.dias || 30))} días publicados. Toca un organismo para ver sus contratos.</p>
      ${barras(comoBarras((reparto.porOrganismo || []).slice(0, 12)), { buscable: true })}
    </section>

    <section class="seccion">
      <h2 class="seccion-titulo">Quién cobra</h2>
      ${barras(comoBarras((reparto.empresas || []).slice(0, 10)), { buscable: true })}
    </section>

    <section class="seccion">
      <h2 class="seccion-titulo">Qué administración</h2>
      ${barras(comoBarras(reparto.porNivel || []))}
    </section>

    <section class="seccion">
      <h2 class="seccion-titulo">Cómo se decide</h2>
      ${barras(comoBarras((reparto.porProcedimiento || []).slice(0, 8)))}
    </section>

    <section class="seccion">
      <h2 class="seccion-titulo">En qué</h2>
      ${barras(comoBarras((reparto.porTipo || []).slice(0, 6)))}
    </section>

    ${conHistorico ? `
    <section class="seccion">
      <h2 class="seccion-titulo">Mes a mes</h2>
      <p class="seccion-intro">Puestos cubiertos por libre designación, según el BOE de cada mes.</p>
      ${barras(historico.map((h) => ({ clave: nombreDeMes(h.mes), valor: h.libresDesignaciones, nota: `${h.documentos} documentos` })), { formato: 'numero', sinPorcentaje: true })}
    </section>` : ''}

    ${bloquePGE}
    ${pie()}`;
}
