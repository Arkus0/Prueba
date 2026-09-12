/**
 * Piezas visuales: tarjetas, señales, fichas y hojas explicativas.
 * Todo lo que se pinta pasa por esc(): los textos vienen de fuentes oficiales,
 * pero no son nuestros y no se inyectan crudos.
 */

import { estado, glosarioDe, senalDe } from './datos.js';
import {
  euros, eurosExacto, porHabitante, fechaCorta, fechaLarga, recortar,
  diasHasta, cuentaAtras, NOMBRES_CATEGORIA, NOMBRES_SUBTIPO,
} from './formato.js';

export function esc(texto) {
  return String(texto ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export const ICONOS = {
  hoy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>',
  contratos: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h9l5 5v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M14 3v6h6M9 14h6M9 17.5h4"/></svg>',
  personas: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.2"/><path d="M3.5 20a5.5 5.5 0 0 1 11 0M16 11.2a3 3 0 0 0 0-5.4M17.5 20a5 5 0 0 0-2.2-3.6"/></svg>',
  reparto: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19V9M10 19V5M16 19v-7M22 19H2"/></svg>',
  empleo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M3 12h18"/></svg>',
  aviso: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round"><path d="M12 8v5M12 16.5v.5"/><circle cx="12" cy="12" r="9.2"/></svg>',
  bueno: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6.5 9.5 17 4 11.5"/></svg>',
  info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round"><path d="M12 11v5.5M12 7.5v.5"/><circle cx="12" cy="12" r="9.2"/></svg>',
  buscar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.2-3.2"/></svg>',
  cerrar: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  enlace: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4h6v6M20 4l-8.5 8.5"/><path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4"/></svg>',
};

const ICONO_TONO = { aviso: ICONOS.aviso, bueno: ICONOS.bueno, info: ICONOS.info, neutro: ICONOS.info };

/** Señales que usamos para ordenar pero no pintamos: la cifra ya se ve. */
const SENALES_OCULTAS = new Set(['importe-alto']);
const visibles = (claves = []) => claves.filter((c) => !SENALES_OCULTAS.has(c));

/** Insignias de señal: siempre icono + texto, nunca solo color. */
function senalesHTML(claves = []) {
  if (!claves.length) return '';
  const insignias = visibles(claves)
    .map((clave) => {
      const senal = senalDe(clave);
      if (!senal) return '';
      const tono = senal.tono || 'neutro';
      return `<span class="senal senal-${tono}">${ICONO_TONO[tono] || ICONOS.info}${esc(senal.etiqueta)}</span>`;
    })
    .join('');
  return insignias ? `<div class="senales">${insignias}</div>` : '';
}

function importeDe(item) {
  return item.importeAdjudicado ?? item.importe ?? null;
}

/** Una tarjeta del feed. Es un botón: toda ella abre la ficha. */
export function tarjetaHTML(item, opciones = {}) {
  const categoria = item.categoria || 'contratos';
  const etiqueta = item.tipo === 'boe' && NOMBRES_SUBTIPO[item.subtipo]
    ? NOMBRES_SUBTIPO[item.subtipo]
    : NOMBRES_CATEGORIA[categoria] || 'Documento';

  const importe = importeDe(item);
  const corto = euros(importe);
  const escala = porHabitante(importe);
  // Sin frase llana enseñamos el título oficial, pero recortado: algunos
  // ocupan un párrafo entero y la tarjeta deja de leerse de un vistazo.
  const frase = item.frase || recortar(item.titulo, 150) || 'Documento oficial';
  const mostrarOrganismo = item.organismo && !frase.includes(item.organismo);

  return `
    <button class="tarjeta" type="button" data-id="${esc(item.id)}" data-fecha="${esc(item.fecha)}">
      <span class="tarjeta-cinta">
        <span class="etiqueta etiqueta-${esc(categoria)}"><span class="punto punto-${esc(categoria)}"></span>${esc(etiqueta)}</span>
        ${opciones.sinFecha ? '' : `<time datetime="${esc(item.fecha)}">${esc(fechaCorta(item.fecha))}</time>`}
      </span>
      <span class="tarjeta-frase">${esc(frase)}</span>
      ${mostrarOrganismo ? `<span class="tarjeta-organismo">${esc(item.organismo)}</span>` : ''}
      ${corto ? `<span class="tarjeta-dinero"><span class="importe cifra">${esc(corto)}</span>${escala ? `<span class="importe-nota">≈ ${esc(escala)}</span>` : ''}</span>` : ''}
      ${senalesHTML(item.senales)}
    </button>`;
}

/** Tarjeta de una convocatoria de empleo público: manda el plazo. */
export function tarjetaOposicionHTML(convocatoria) {
  const dias = diasHasta(convocatoria.limite);
  const cuenta = cuentaAtras(convocatoria.limite);
  const tono = convocatoria.abierta ? (dias !== null && dias <= 5 ? 'aviso' : 'bueno') : 'neutro';
  const detalles = [
    convocatoria.sistema,
    convocatoria.grupo ? `Subgrupo ${convocatoria.grupo}` : null,
    ...(convocatoria.acceso || []),
  ].filter(Boolean);

  return `
    <button class="tarjeta" type="button" data-oposicion="${esc(convocatoria.id)}">
      <span class="tarjeta-cinta">
        <span class="etiqueta etiqueta-personas"><span class="punto punto-personas"></span>Empleo público</span>
        <time datetime="${esc(convocatoria.fecha)}">${esc(fechaCorta(convocatoria.fecha))}</time>
      </span>
      <span class="tarjeta-frase">${esc(convocatoria.frase || recortar(convocatoria.titulo, 150))}</span>
      ${convocatoria.plazas ? `<span class="tarjeta-dinero"><span class="importe cifra">${convocatoria.plazas}</span><span class="importe-nota">${convocatoria.plazas === 1 ? 'plaza' : 'plazas'}</span></span>` : ''}
      ${detalles.length ? `<span class="tarjeta-organismo">${esc(detalles.join(' · '))}</span>` : ''}
      ${cuenta ? `<span class="senales"><span class="senal senal-${tono}">${tono === 'bueno' ? ICONOS.bueno : ICONOS.aviso}${esc(cuenta)}</span></span>`
        : '<span class="senales"><span class="senal senal-neutro">' + ICONOS.info + 'Plazo no publicado en el texto</span></span>'}
    </button>`;
}

export function listaHTML(items, vacio = 'No hay nada aquí con ese filtro.', opciones = {}) {
  if (!items.length) return `<p class="vacio">${esc(vacio)}</p>`;
  return items.map((item) => tarjetaHTML(item, opciones)).join('');
}

/* ------------------------------ Hojas ------------------------------ */

const capa = () => document.getElementById('capa');

export function cerrarHoja() {
  const c = capa();
  c.hidden = true;
  c.innerHTML = '';
  document.body.style.overflow = '';
}

function abrirHoja(titulo, cuerpoHTML) {
  const c = capa();
  c.innerHTML = `
    <section class="hoja" role="dialog" aria-modal="true" aria-label="${esc(titulo)}">
      <header class="hoja-cabeza">
        <h2>${esc(titulo)}</h2>
        <button class="boton-icono" type="button" data-cerrar aria-label="Cerrar">${ICONOS.cerrar}</button>
      </header>
      <div class="hoja-cuerpo">${cuerpoHTML}</div>
    </section>`;
  c.hidden = false;
  document.body.style.overflow = 'hidden';
  c.querySelector('.hoja').scrollTop = 0;
  c.querySelector('[data-cerrar]').focus();
}

function fila(etiqueta, valor) {
  if (valor === null || valor === undefined || valor === '') return '';
  return `<div class="dato"><dt>${esc(etiqueta)}</dt><dd>${valor}</dd></div>`;
}

/** Ficha completa de un item: qué es, quién paga, quién cobra y el original. */
export function abrirFicha(item) {
  const importe = importeDe(item);
  const esContrato = item.tipo === 'contrato';

  const filas = [
    fila('Quién paga', item.organismo ? esc(item.organismo) : null),
    esContrato ? fila('Quién cobra', item.adjudicatario ? esc(item.adjudicatario) : '<em>Aún sin adjudicar</em>') : '',
    fila('Cuánto', importe !== null
      ? `<span class="cifra">${esc(eurosExacto(importe))}</span>${porHabitante(importe) ? `<br><span class="importe-nota">≈ ${esc(porHabitante(importe))}</span>` : ''}`
      : null),
    esContrato && item.importe !== null && item.importeAdjudicado !== null && item.importe !== item.importeAdjudicado
      ? fila('Presupuesto de salida', `<span class="cifra">${esc(eurosExacto(item.importe))}</span>`)
      : '',
    esContrato ? fila('Valor máximo', item.valorEstimado ? `<span class="cifra">${esc(eurosExacto(item.valorEstimado))}</span>` : null) : '',
    esContrato ? fila('Cómo se decidió', item.procedimiento ? esc(item.procedimiento) : null) : '',
    esContrato ? fila('Ofertas recibidas', item.ofertas ? String(item.ofertas) : null) : '',
    esContrato ? fila('Situación', item.resultado || item.estado ? esc(item.resultado || item.estado) : null) : '',
    esContrato ? fila('Tipo', item.tipoContrato ? esc(item.tipoContrato) : null) : '',
    esContrato ? fila('Plazo de ofertas', item.plazoOfertas ? esc(item.plazoOfertas) : null) : '',
    esContrato ? fila('Expediente', item.expediente ? esc(item.expediente) : null) : '',
    fila('Publicado', esc(fechaLarga(item.fecha))),
  ].join('');

  const explicaciones = visibles(item.senales || [])
    .map((clave) => {
      const senal = senalDe(clave);
      if (!senal) return '';
      return `<div class="explicacion"><strong>${esc(senal.etiqueta)}.</strong> ${esc(senal.explica)}</div>`;
    })
    .join('');

  const terminos = (item.jerga || [])
    .filter((clave) => glosarioDe(clave))
    .map((clave) => `<button class="chip" type="button" data-glosario="${esc(clave)}">${esc(glosarioDe(clave).termino)}</button>`)
    .join('');

  const enlace = item.url || item.urlPdf;

  abrirHoja(NOMBRES_CATEGORIA[item.categoria] || 'Documento', `
    <p class="hoja-frase">${esc(item.frase || item.titulo)}</p>
    ${item.frase && item.titulo && item.frase !== item.titulo
      ? `<div class="explicacion" style="margin-top:14px"><strong>Texto oficial.</strong> ${esc(item.titulo)}</div>`
      : ''}
    <dl class="datos">${filas}</dl>
    ${explicaciones ? `<h3 class="seccion-titulo" style="margin-top:20px">Qué conviene saber</h3>${explicaciones}` : ''}
    ${terminos ? `<h3 class="seccion-titulo" style="margin-top:20px">Palabras que usa el documento</h3><div class="senales">${terminos}</div>` : ''}
    ${enlace ? `<a class="boton" href="${esc(enlace)}" target="_blank" rel="noopener noreferrer">Ver el documento oficial ${ICONOS.enlace}</a>` : ''}
    ${item.urlPdf && item.urlPdf !== enlace ? `<a class="boton boton-secundario" href="${esc(item.urlPdf)}" target="_blank" rel="noopener noreferrer">Abrir el PDF del BOE ${ICONOS.enlace}</a>` : ''}
  `);
}

/** Ficha de una convocatoria: todo lo que hace falta para presentarse. */
export function abrirFichaOposicion(c) {
  const dias = diasHasta(c.limite);
  const filas = [
    fila('Plazas', c.plazas ? `<span class="cifra">${c.plazas}</span>` : null),
    fila('Quién convoca', c.organismo ? esc(c.organismo) : null),
    fila('Cómo se entra', c.sistema ? esc(c.sistema) : null),
    fila('Turno', (c.acceso || []).length ? esc(c.acceso.join(' · ')) : null),
    fila('Grupo', c.grupo ? `${esc(c.grupo)} <span class="importe-nota">(nivel del cuerpo)</span>` : null),
    fila('Titulación', c.titulacion ? esc(c.titulacion) : null),
    fila('Tasa', c.tasa ? `${esc(c.tasa)} €` : null),
    fila('Plazo', c.plazo ? `${c.plazo.dias} días ${esc(c.plazo.tipo)} desde el día siguiente a su publicación` : null),
    fila('Fecha tope', c.limite
      ? `<strong>${esc(fechaLarga(c.limite))}</strong> <span class="importe-nota">(aprox.)</span>${dias !== null ? `<br><span class="importe-nota">${esc(cuentaAtras(c.limite))}</span>` : ''}`
      : null),
    fila('Publicado', esc(fechaLarga(c.fecha))),
  ].join('');

  abrirHoja('Convocatoria de empleo público', `
    <p class="hoja-frase">${esc(c.frase || c.titulo)}</p>
    ${c.comoApuntarse ? `<div class="explicacion" style="margin-top:14px"><strong>Cómo apuntarse.</strong> ${esc(c.comoApuntarse)}</div>` : ''}
    <dl class="datos">${filas}</dl>
    ${c.limite ? `<div class="explicacion"><strong>Sobre la fecha tope.</strong> La calculamos contando desde el día siguiente a la publicación,
      sin contar sábados ni domingos. Los festivos cambian según dónde presentes la solicitud, así que puede bailar un día o dos:
      confirma el plazo exacto en el texto oficial antes de dejarlo para el final.</div>` : ''}
    <div class="explicacion"><strong>Texto oficial.</strong> ${esc(c.titulo)}</div>
    ${c.url ? `<a class="boton" href="${esc(c.url)}" target="_blank" rel="noopener noreferrer">Leer la convocatoria completa ${ICONOS.enlace}</a>` : ''}
    ${c.urlPdf ? `<a class="boton boton-secundario" href="${esc(c.urlPdf)}" target="_blank" rel="noopener noreferrer">Abrir el PDF del BOE ${ICONOS.enlace}</a>` : ''}
  `);
}

/** Ficha de un término del glosario. */
export function abrirGlosario(clave) {
  const termino = glosarioDe(clave);
  if (!termino) return;
  abrirHoja(termino.termino, `
    <p class="hoja-frase">${esc(termino.breve)}</p>
    <div class="explicacion" style="margin-top:14px">${esc(termino.largo)}</div>
  `);
}

/** "¿Qué es esto?": de dónde salen los datos y cómo se leen. */
export function abrirAyuda() {
  const indice = estado.indice || {};
  const fuentes = (indice.fuentes || [])
    .map((f) => {
      const etiqueta = f.estado === 'ok' ? 'funciona' : f.estado === 'error' ? 'no respondió' : 'sin datos automáticos';
      return `<li class="dato"><dt>${esc(f.nombre || f.clave)}</dt><dd>${esc(etiqueta)}${f.registros ? ` · ${f.registros} registros` : ''}${f.url ? `<br><a href="${esc(f.url)}" target="_blank" rel="noopener noreferrer">fuente oficial</a>` : ''}</dd></li>`;
    })
    .join('');

  const listaGlosario = Object.entries(estado.glosario)
    .map(([clave, t]) => `<button class="chip" type="button" data-glosario="${esc(clave)}">${esc(t.termino)}</button>`)
    .join('');

  abrirHoja('Qué es esto', `
    <p class="hoja-frase">Todo lo que ves aquí lo publica el Estado cada día. Nosotros solo lo traducimos.</p>
    <div class="explicacion" style="margin-top:14px">
      <strong>De dónde sale.</strong> Del Boletín Oficial del Estado y de la Plataforma de Contratación del Sector Público,
      leídos automáticamente una vez al día. Cada tarjeta enlaza a su documento original: si algo te chirría, compruébalo allí.
    </div>
    <div class="explicacion">
      <strong>Qué no hacemos.</strong> No inventamos ni estimamos cifras. Si una fuente oficial falla ese día, lo decimos
      en pantalla en vez de rellenar el hueco. Las señales (“sin concurso abierto”, “libre designación”) describen
      procedimientos legales y habituales: sirven para fijarse, no para acusar a nadie.
    </div>
    <div class="explicacion">
      <strong>Las oposiciones.</strong> De cada convocatoria bajamos el texto completo para sacar las plazas, los requisitos y el plazo.
      La fecha tope se calcula contando días hábiles sin festivos locales, así que es aproximada: confírmala en el BOE antes de dejarlo para el final.
    </div>
    <div class="explicacion">
      <strong>Los importes.</strong> En contratación se publican normalmente sin IVA, y son lo previsto o lo adjudicado,
      no siempre lo pagado al final. El “por persona” divide entre unos 49 millones de habitantes: sirve para hacerse
      una idea de la escala, nada más.
    </div>
    <dl class="datos">${fuentes}</dl>
    <p class="seccion-titulo" style="margin-top:22px">Diccionario</p>
    <div class="senales">${listaGlosario}</div>
  `);
}
