/**
 * Los gráficos. Todos se dibujan a mano en SVG o con CSS: ni una librería, que
 * es lo que permite que esto abra al instante en un móvil con mala cobertura.
 *
 * Reglas que siguen todos:
 *  - Una sola serie y un solo color. Cuando hay que distinguir tramos se usa
 *    la rampa secuencial (más oscuro = más dinero), nunca colores sueltos.
 *  - El porcentaje se mide siempre contra lo que enseña ese gráfico, jamás
 *    contra un total que está en otra pantalla.
 *  - Lo que no se sabe se dice debajo del gráfico. No se reparte ni se rellena.
 *  - Nada depende solo del color: siempre hay número, etiqueta o leyenda.
 */

import { euros, eurosExacto } from './formato.js';
import { esc } from './ui.js';
import { VISTA, RECUADRO, REGIONES } from './mapa-espana.js';

/** Cuántos tramos tiene la rampa. Coincide con --serie-1..5 del CSS. */
const TRAMOS = 5;

/* --------------------------------- Barras --------------------------------- */

/**
 * Una sola serie, un solo color, valores escritos al lado de cada barra.
 * `datos` son {clave, valor, nota}; el porcentaje se mide contra lo que enseña
 * este gráfico, nunca contra un total de otro sitio.
 */
export function barras(datos, opciones = {}) {
  if (!datos?.length) return '<p class="vacio">Sin datos suficientes todavía.</p>';
  const enEuros = opciones.formato !== 'numero';
  const maximo = Math.max(...datos.map((d) => d.valor)) || 1;
  const suma = datos.reduce((s, d) => s + d.valor, 0) || null;
  const escribir = (v) => (enEuros ? euros(v) : new Intl.NumberFormat('es-ES').format(v));
  const exacto = (v) => (enEuros ? eurosExacto(v) : String(v));

  return `<div class="barras">${datos
    .map((d) => {
      const ancho = Math.max(1.5, (d.valor / maximo) * 100);
      const parte = suma && !opciones.sinPorcentaje ? Math.round((d.valor / suma) * 100) : null;
      const nota = [d.nota, parte !== null ? `${parte}% de lo mostrado` : null].filter(Boolean).join(' · ');
      const eti = opciones.buscable ? 'button' : 'div';
      const extra = opciones.buscable ? ` type="button" data-buscar="${esc(d.clave)}"` : '';
      return `<${eti} class="barra-fila"${extra} aria-label="${esc(`${d.clave}: ${exacto(d.valor)}`)}">
          <span class="barra-cabeza">
            <span class="barra-nombre">${esc(d.clave)}</span>
            <span class="barra-valor cifra">${esc(escribir(d.valor))}</span>
          </span>
          <span class="barra-pista"><span class="barra-relleno" style="width:${ancho.toFixed(1)}%"></span></span>
          ${nota ? `<span class="barra-nota">${esc(nota)}</span>` : ''}
        </${eti}>`;
    })
    .join('')}</div>`;
}

/* ---------------------------------- Mapa ---------------------------------- */

/**
 * Cortes por cuantiles, no a partes iguales: en contratación pública Madrid y
 * Cataluña se llevan tanto que con cortes lineales el resto del mapa saldría
 * del mismo color y no se vería nada.
 */
function cortes(valores) {
  const ordenados = valores.filter((v) => v > 0).sort((a, b) => a - b);
  if (!ordenados.length) return [];
  const limites = [];
  for (let i = 1; i < TRAMOS; i += 1) {
    const posicion = (ordenados.length * i) / TRAMOS;
    limites.push(ordenados[Math.min(ordenados.length - 1, Math.floor(posicion))]);
  }
  // Si hay pocos valores distintos, los cortes repetidos sobran.
  return [...new Set(limites)];
}

const tramoDe = (valor, limites) => {
  if (!(valor > 0)) return null;
  let tramo = 0;
  while (tramo < limites.length && valor > limites[tramo]) tramo += 1;
  return tramo + 1;
};

/**
 * Mapa de España por comunidades.
 *
 *   filas: [{ clave, nombre, n, importe, poblacion }]
 *   opciones: { modo: 'total' | 'habitante', territorio, activa }
 *
 * Cada comunidad es tocable y lleva su cifra en el nombre accesible, así que
 * el dato no depende de distinguir tonos de verde.
 */
export function mapa(filas = [], opciones = {}) {
  const porHab = opciones.modo === 'habitante';
  const datos = new Map();
  for (const fila of filas) {
    const valor = porHab
      ? (fila.poblacion ? fila.importe / fila.poblacion : 0)
      : fila.importe;
    datos.set(fila.clave, { ...fila, valor });
  }

  const limites = cortes([...datos.values()].map((d) => d.valor));
  const escribir = (v) => (porHab
    ? `${new Intl.NumberFormat('es-ES', { maximumFractionDigits: v < 10 ? 1 : 0 }).format(v)} € por habitante`
    : euros(v) || '0 €');

  const formas = REGIONES.map((region) => {
    const dato = datos.get(region.codigo);
    const tramo = dato ? tramoDe(dato.valor, limites) : null;
    const clase = `mapa-region${tramo ? ` mapa-t${tramo}` : ' mapa-sin'}`
      + (opciones.activa === region.codigo ? ' mapa-activa' : '');
    const cuanto = dato && dato.valor > 0
      ? `${escribir(dato.valor)}, ${dato.n} ${dato.n === 1 ? 'contrato' : 'contratos'}`
      : 'sin contratos publicados en este periodo';
    const etiqueta = esc(`${region.nombre}: ${cuanto}`);
    const comun = `class="${clase}" data-ccaa="${esc(region.codigo)}" role="button" tabindex="0"`
      + ` aria-label="${etiqueta}"`;
    const titulo = `<title>${etiqueta}</title>`;

    return region.marcador
      ? `<circle ${comun} cx="${region.marcador[0]}" cy="${region.marcador[1]}" r="9">${titulo}</circle>`
      : `<path ${comun} d="${region.d}">${titulo}</path>`;
  }).join('');

  const leyenda = limites.length
    ? `<div class="leyenda" aria-hidden="true">
        <span class="leyenda-punta">menos</span>
        ${Array.from({ length: limites.length + 1 }, (_, i) => `<span class="leyenda-caja mapa-t${i + 1}"></span>`).join('')}
        <span class="leyenda-punta">más</span>
        <span class="leyenda-corte cifra">hasta ${esc(escribir(limites[0]))} · desde ${esc(escribir(limites[limites.length - 1]))}</span>
      </div>`
    : '';

  const t = opciones.territorio || {};
  const fuera = [
    t.estatales ? `${t.estatales} de ámbito estatal` : null,
    t.sinLocalizar ? `${t.sinLocalizar} sin localizar` : null,
  ].filter(Boolean).join(' y ');

  return `
    <div class="mapa-caja">
      <svg class="mapa" viewBox="${esc(VISTA)}" role="img"
           aria-label="Contratos publicados por comunidad autónoma">
        ${RECUADRO ? `<rect class="mapa-recuadro" x="${RECUADRO.x}" y="${RECUADRO.y}" width="${RECUADRO.ancho}" height="${RECUADRO.alto}" rx="6"/>` : ''}
        ${formas}
      </svg>
      ${leyenda}
      <p class="mapa-nota">Es <strong>quién lo publica</strong>, no dónde se gasta:
        un contrato de una comunidad puede ser para obras en cualquier punto de ella.
        ${fuera ? `Fuera del mapa quedan ${esc(fuera)}, que no se reparten entre comunidades.` : ''}</p>
    </div>`;
}

/* --------------------------------- Anillo --------------------------------- */

const RADIO = 52;
const PERIMETRO = 2 * Math.PI * RADIO;

/**
 * Un anillo para una proporción y nada más: el trozo que importa en color, el
 * resto en gris, y el número escrito en el centro para no depender del área,
 * que es justo lo que peor se estima a ojo.
 */
export function anillo(parte, total, opciones = {}) {
  if (!total || parte === null || parte === undefined) {
    return '<p class="vacio">Sin datos suficientes todavía.</p>';
  }
  const proporcion = Math.max(0, Math.min(1, parte / total));
  const porcentaje = Math.round(proporcion * 100);

  return `
    <div class="anillo-caja">
      <svg class="anillo" viewBox="0 0 130 130" role="img"
           aria-label="${esc(`${porcentaje}% ${opciones.etiqueta || ''}`.trim())}">
        <circle class="anillo-pista" cx="65" cy="65" r="${RADIO}"/>
        <circle class="anillo-arco" cx="65" cy="65" r="${RADIO}"
                stroke-dasharray="${(proporcion * PERIMETRO).toFixed(1)} ${PERIMETRO.toFixed(1)}"
                transform="rotate(-90 65 65)"/>
        <text class="anillo-cifra cifra" x="65" y="65" text-anchor="middle" dominant-baseline="central">${porcentaje}%</text>
      </svg>
      ${opciones.etiqueta ? `<p class="anillo-pie">${esc(opciones.etiqueta)}</p>` : ''}
    </div>`;
}

/* ------------------------------ Barra apilada ----------------------------- */

/**
 * Una barra al 100%. Los tramos van de más a menos con la rampa secuencial,
 * así que el orden se ve en el color, y cada uno lleva su etiqueta debajo: el
 * color acompaña, no es el que lleva el dato.
 */
export function barraApilada(filas = [], opciones = {}) {
  const conValor = filas.filter((f) => f.importe > 0);
  if (!conValor.length) return '<p class="vacio">Sin datos suficientes todavía.</p>';

  const tope = opciones.tope || 6;
  const ordenadas = [...conValor].sort((a, b) => b.importe - a.importe);
  const principales = ordenadas.slice(0, tope);
  const resto = ordenadas.slice(tope);
  // Nunca se genera un color nuevo para el que hace siete: se agrupa en "otros".
  if (resto.length) {
    principales.push({
      clave: `Otros ${resto.length} ${opciones.nombrePlural || 'sectores'}`,
      importe: resto.reduce((t, f) => t + f.importe, 0),
      n: resto.reduce((t, f) => t + (f.n || 0), 0),
    });
  }
  const suma = principales.reduce((t, f) => t + f.importe, 0) || 1;

  const tramos = principales.map((fila, i) => {
    const parte = (fila.importe / suma) * 100;
    const tono = Math.min(TRAMOS, i + 1);
    return `<span class="apilada-tramo serie-${tono}" style="flex:${parte.toFixed(2)}"
              title="${esc(`${fila.clave}: ${eurosExacto(fila.importe)}`)}"></span>`;
  }).join('');

  const etiquetas = principales.map((fila, i) => {
    const parte = Math.round((fila.importe / suma) * 100);
    const tono = Math.min(TRAMOS, i + 1);
    return `<li class="apilada-clave">
        <span class="apilada-punto serie-${tono}"></span>
        <span class="apilada-nombre">${esc(fila.clave)}</span>
        <span class="apilada-valor cifra">${esc(euros(fila.importe) || '0 €')} · ${parte}%</span>
      </li>`;
  }).join('');

  return `<div class="apilada">
      <div class="apilada-barra" role="img" aria-label="${esc(principales.map((f) => `${f.clave} ${euros(f.importe)}`).join(', '))}">${tramos}</div>
      <ul class="apilada-claves">${etiquetas}</ul>
    </div>`;
}

/* ---------------------------------- Serie --------------------------------- */

/**
 * El pulso de los últimos días. Columnas, no líneas: cada día es un dato
 * suelto, y los huecos de sábado y domingo son información, no un fallo.
 */
export function serie(dias = [], opciones = {}) {
  const valor = (d) => Number(opciones.campo ? d[opciones.campo] : d.importe) || 0;
  let datos = [...dias].reverse().slice(-(opciones.dias || 90));

  // Los contratos en detalle solo llegan hasta donde llega la Plataforma: el
  // relleno histórico del BOE no trae importes. Arrancar el gráfico en una
  // ristra de ceros no es más honesto, es solo menos legible, así que se
  // recorta por delante y se dice desde cuándo hay datos.
  const primero = datos.findIndex((d) => valor(d) > 0);
  if (primero > 0) datos = datos.slice(Math.max(0, primero - 2));
  if (datos.length < 2) return '<p class="vacio">Todavía no hay días suficientes para ver la evolución.</p>';

  const maximo = Math.max(...datos.map(valor)) || 1;
  const ALTO = 100;
  const ancho = 100 / datos.length;

  const columnas = datos.map((d, i) => {
    const alto = (valor(d) / maximo) * ALTO;
    const x = i * ancho;
    return `<rect class="serie-columna" x="${x.toFixed(3)}" y="${(ALTO - alto).toFixed(2)}"
        width="${(ancho * 0.72).toFixed(3)}" height="${Math.max(alto, valor(d) > 0 ? 0.6 : 0).toFixed(2)}"
      ><title>${esc(`${d.fecha}: ${euros(valor(d)) || '0 €'}`)}</title></rect>`;
  }).join('');

  const desde = datos[0]?.fecha || '';
  const hasta = datos[datos.length - 1]?.fecha || '';
  const pico = datos.reduce((mejor, d) => (valor(d) > valor(mejor) ? d : mejor), datos[0]);
  const conDato = datos.filter((d) => valor(d) > 0).length;

  return `<div class="serie-caja">
      <svg class="serie" viewBox="0 0 100 ${ALTO}" preserveAspectRatio="none" role="img"
           aria-label="${esc(`Importe publicado cada día entre el ${desde} y el ${hasta}. El día más alto fue el ${pico.fecha}, con ${euros(valor(pico))}.`)}">
        ${columnas}
      </svg>
      <div class="serie-pie">
        <span>${esc(desde)}</span>
        <span class="serie-pico">máximo: <strong class="cifra">${esc(euros(valor(pico)) || '0 €')}</strong></span>
        <span>${esc(hasta)}</span>
      </div>
      <p class="barra-nota">${conDato} de los ${datos.length} días mostrados traen algún importe publicado;
        el resto son fines de semana, festivos o días sin contratos en la Plataforma.</p>
    </div>`;
}

/* --------------------------------- Chispa --------------------------------- */

/** Línea diminuta para acompañar una cifra. Sin ejes: solo la forma. */
export function chispa(valores = []) {
  const datos = valores.filter((v) => Number.isFinite(v));
  if (datos.length < 3) return '';
  const maximo = Math.max(...datos) || 1;
  const paso = 100 / (datos.length - 1);
  const puntos = datos.map((v, i) => `${(i * paso).toFixed(2)},${(20 - (v / maximo) * 19).toFixed(2)}`).join(' ');
  return `<svg class="chispa" viewBox="0 0 100 20" preserveAspectRatio="none" aria-hidden="true">
      <polyline points="${puntos}"/>
    </svg>`;
}
