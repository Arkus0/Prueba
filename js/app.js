/**
 * Arranque, navegación y eventos. Una sola página, cuatro pestañas,
 * todo pintado desde los JSON que deja la ingesta diaria.
 */

import { arrancar, estado, itemsCargados, cargarOposiciones } from './datos.js';
import { abrirFicha, abrirFichaOposicion, abrirGlosario, abrirAyuda, cerrarHoja, ICONOS, esc } from './ui.js';
import { vistaPortada, vistaContratos, vistaEmpleo, vistaPersonas, vistaReparto, filtros } from './vistas.js';

const VISTAS = {
  portada: { titulo: 'Hoy', icono: ICONOS.hoy, pintar: vistaPortada },
  contratos: { titulo: 'Contratos', icono: ICONOS.contratos, pintar: vistaContratos },
  empleo: { titulo: 'Empleo', icono: ICONOS.empleo, pintar: vistaEmpleo },
  personas: { titulo: 'Cargos', icono: ICONOS.personas, pintar: vistaPersonas },
  reparto: { titulo: 'Reparto', icono: ICONOS.reparto, pintar: vistaReparto },
};

const principal = () => document.getElementById('principal');
let vistaActual = 'hoy';

/** Rutas de versiones anteriores que se mantienen vivas por los enlaces guardados. */
const ALIAS = { hoy: 'portada' };

function rutaActual() {
  const clave = (location.hash || '').replace(/^#\/?/, '');
  return VISTAS[clave] ? clave : (VISTAS[ALIAS[clave]] ? ALIAS[clave] : 'portada');
}

function pintarBarra() {
  document.getElementById('barra').innerHTML = Object.entries(VISTAS)
    .map(([clave, v]) => `
      <button type="button" data-vista="${clave}" ${clave === vistaActual ? 'aria-current="page"' : ''}>
        ${v.icono}<span>${esc(v.titulo)}</span>
      </button>`)
    .join('');
}

async function pintar() {
  vistaActual = rutaActual();
  pintarBarra();
  const cont = principal();
  try {
    await VISTAS[vistaActual].pintar(cont);
  } catch (error) {
    cont.innerHTML = `<p class="vacio">No hemos podido pintar esta pantalla.<br><small>${esc(error.message || error)}</small></p>`;
  }
  cont.focus({ preventScroll: true });
}

/** Vuelve a pintar sin perder el foco ni el texto del buscador. */
async function repintarConservandoBusqueda() {
  const activo = document.activeElement;
  const enBusqueda = activo && activo.id === 'busqueda';
  await VISTAS[vistaActual].pintar(principal());
  if (enBusqueda) {
    const nuevo = document.getElementById('busqueda');
    if (nuevo) {
      nuevo.focus();
      nuevo.setSelectionRange(nuevo.value.length, nuevo.value.length);
    }
  }
}

function itemPorId(id, fecha) {
  const dia = estado.dias.get(fecha);
  const desdeDia = dia?.items.find((i) => i.id === id);
  return desdeDia || itemsCargados().find((i) => i.id === id) || null;
}

function conectarEventos() {
  document.body.addEventListener('click', async (evento) => {
    const objetivo = (selector) => evento.target.closest(selector);

    if (objetivo('[data-cerrar]') || evento.target.id === 'capa') return cerrarHoja();

    const glosario = objetivo('[data-glosario]');
    if (glosario) return abrirGlosario(glosario.dataset.glosario);

    const ayuda = objetivo('#btn-ayuda');
    if (ayuda) return abrirAyuda();

    const vista = objetivo('[data-vista]');
    if (vista) {
      filtros.busqueda = '';
      filtros.ccaa = 'todo';
      location.hash = `#/${vista.dataset.vista}`;
      return;
    }

    const buscar = objetivo('[data-buscar]');
    if (buscar) {
      filtros.busqueda = buscar.dataset.buscar;
      filtros.orden = 'relevancia';
      location.hash = '#/contratos';
      return;
    }

    const oposicion = objetivo('[data-oposicion]');
    if (oposicion) {
      const convocatorias = await cargarOposiciones();
      const encontrada = convocatorias.find((c) => c.id === oposicion.dataset.oposicion);
      if (encontrada) abrirFichaOposicion(encontrada);
      return;
    }

    const tarjeta = objetivo('.tarjeta');
    if (tarjeta) {
      const item = itemPorId(tarjeta.dataset.id, tarjeta.dataset.fecha);
      if (item) abrirFicha(item);
      return;
    }

    const categoria = objetivo('[data-categoria]');
    if (categoria) {
      filtros.categoria = categoria.dataset.categoria;
      return repintarConservandoBusqueda();
    }

    const subtipo = objetivo('[data-subtipo]');
    if (subtipo) {
      filtros.subtipo = subtipo.dataset.subtipo;
      return repintarConservandoBusqueda();
    }

    const empleo = objetivo('[data-empleo]');
    if (empleo) {
      filtros.empleo = empleo.dataset.empleo;
      return repintarConservandoBusqueda();
    }

    const orden = objetivo('[data-orden]');
    if (orden) {
      filtros.orden = orden.dataset.orden;
      return repintarConservandoBusqueda();
    }

    const nivel = objetivo('[data-nivel]');
    if (nivel) {
      filtros.nivel = nivel.dataset.nivel;
      return repintarConservandoBusqueda();
    }

    // Tocar una comunidad en el mapa lleva a sus contratos. Volver a tocar la
    // que ya está elegida quita el filtro, que es lo que espera el dedo.
    const region = objetivo('[data-ccaa]');
    if (region) {
      const elegida = region.dataset.ccaa;
      filtros.ccaa = filtros.ccaa === elegida ? 'todo' : elegida;
      if (vistaActual === 'portada' && filtros.ccaa !== 'todo') {
        filtros.busqueda = '';
        location.hash = '#/contratos';
        return;
      }
      return repintarConservandoBusqueda();
    }

    const medida = objetivo('[data-mapa]');
    if (medida) {
      filtros.mapa = medida.dataset.mapa;
      return repintarConservandoBusqueda();
    }

    if (objetivo('[data-mas-dias]')) {
      filtros.diasVisibles += 3;
      return repintarConservandoBusqueda();
    }

    if (objetivo('[data-mas-busqueda]')) {
      filtros.diasBusqueda += 21;
      return repintarConservandoBusqueda();
    }
  });

  let temporizador = null;
  document.body.addEventListener('input', (evento) => {
    if (evento.target.id !== 'busqueda') return;
    filtros.busqueda = evento.target.value;
    clearTimeout(temporizador);
    temporizador = setTimeout(repintarConservandoBusqueda, 220);
  });

  document.addEventListener('keydown', (evento) => {
    if (evento.key === 'Escape' && !document.getElementById('capa').hidden) cerrarHoja();
    // Las comunidades del mapa son <path>, no <button>: el teclado hay que
    // atenderlo a mano para que se puedan usar sin ratón.
    if ((evento.key === 'Enter' || evento.key === ' ') && evento.target.dataset?.ccaa) {
      evento.preventDefault();
      evento.target.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    }
  });

  window.addEventListener('hashchange', pintar);
}

function pintarCabecera(indice) {
  const sub = document.getElementById('estado-datos');
  if (!indice) { sub.textContent = 'No hemos podido cargar los datos.'; return; }
  const fecha = indice.generado ? new Date(indice.generado) : null;
  const cuando = fecha
    ? fecha.toLocaleDateString('es-ES', { day: 'numeric', month: 'long' }) + ', ' +
      fecha.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
    : '—';
  const aviso = indice.demo ? ' · DATOS DE EJEMPLO' : '';
  sub.textContent = `Actualizado el ${cuando}${aviso}`;
}

async function inicio() {
  conectarEventos();
  try {
    const indice = await arrancar();
    pintarCabecera(indice);
  } catch (error) {
    pintarCabecera(null);
    principal().innerHTML = `<p class="vacio">Todavía no hay datos publicados.<br>
      <small>La ingesta diaria los deja en <code>data/</code>. ${esc(error.message || error)}</small></p>`;
    return;
  }
  await pintar();

  if ('serviceWorker' in navigator) {
    // Sin el update() explícito, una pestaña abierta desde antes podía tardar
    // en enterarse de que hay una versión nueva de la app (por ejemplo, de
    // Empleo) hasta el siguiente ciclo natural de comprobación del navegador.
    navigator.serviceWorker.register('sw.js')
      .then((registro) => registro.update())
      .catch(() => {});
  }
}

inicio();
