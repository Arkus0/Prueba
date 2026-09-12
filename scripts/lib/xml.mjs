/**
 * Lector de XML sin dependencias, suficiente para los formatos que usamos:
 * el Atom + CODICE de la Plataforma de Contratacion y el sumario del BOE.
 *
 * Trabaja siempre con el "nombre local" (sin prefijo de espacio de nombres),
 * porque las fuentes oficiales cambian los prefijos entre ficheros y no
 * queremos que el parser se rompa por eso.
 */

const ENTIDADES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
};

export function decodificar(texto) {
  if (!texto || texto.indexOf('&') === -1) return texto || '';
  return texto.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (entera, cuerpo) => {
    if (cuerpo[0] === '#') {
      const codigo = cuerpo[1] === 'x' || cuerpo[1] === 'X'
        ? parseInt(cuerpo.slice(2), 16)
        : parseInt(cuerpo.slice(1), 10);
      return Number.isFinite(codigo) ? String.fromCodePoint(codigo) : entera;
    }
    const valor = ENTIDADES[cuerpo.toLowerCase()];
    return valor === undefined ? entera : valor;
  });
}

function nombreLocal(nombre) {
  const corte = nombre.indexOf(':');
  return corte === -1 ? nombre : nombre.slice(corte + 1);
}

function leerAtributos(fuente) {
  const attrs = {};
  const re = /([\w:.-]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let m;
  while ((m = re.exec(fuente))) {
    attrs[nombreLocal(m[1])] = decodificar(m[3] !== undefined ? m[3] : m[4]);
  }
  return attrs;
}

function nodo(nombre, attrs) {
  return { nombre, attrs: attrs || {}, hijos: [], texto: '' };
}

/** Convierte una cadena XML en un arbol de nodos. Devuelve el nodo raiz. */
export function parsearXML(xml) {
  const raiz = nodo('#raiz', {});
  const pila = [raiz];
  let i = 0;
  const n = xml.length;

  while (i < n) {
    const abre = xml.indexOf('<', i);
    if (abre === -1) {
      anadirTexto(pila[pila.length - 1], xml.slice(i));
      break;
    }
    if (abre > i) anadirTexto(pila[pila.length - 1], xml.slice(i, abre));

    // Secciones que no son etiquetas
    if (xml.startsWith('<![CDATA[', abre)) {
      const fin = xml.indexOf(']]>', abre);
      const corte = fin === -1 ? n : fin;
      pila[pila.length - 1].texto += xml.slice(abre + 9, corte);
      i = fin === -1 ? n : fin + 3;
      continue;
    }
    if (xml.startsWith('<!--', abre)) {
      const fin = xml.indexOf('-->', abre);
      i = fin === -1 ? n : fin + 3;
      continue;
    }
    if (xml.startsWith('<?', abre)) {
      const fin = xml.indexOf('?>', abre);
      i = fin === -1 ? n : fin + 2;
      continue;
    }
    if (xml.startsWith('<!', abre)) {
      const fin = xml.indexOf('>', abre);
      i = fin === -1 ? n : fin + 1;
      continue;
    }

    const cierra = xml.indexOf('>', abre);
    if (cierra === -1) break;
    const cuerpo = xml.slice(abre + 1, cierra);
    i = cierra + 1;

    if (cuerpo[0] === '/') {
      // Cierre: subimos hasta la etiqueta correspondiente (tolerante a XML sucio)
      const cerrado = nombreLocal(cuerpo.slice(1).trim());
      for (let p = pila.length - 1; p > 0; p--) {
        if (pila[p].nombre === cerrado) { pila.length = p; break; }
      }
      continue;
    }

    const autocierre = cuerpo.endsWith('/');
    const limpio = autocierre ? cuerpo.slice(0, -1) : cuerpo;
    const espacio = limpio.search(/[\s]/);
    const etiqueta = nombreLocal((espacio === -1 ? limpio : limpio.slice(0, espacio)).trim());
    const attrs = espacio === -1 ? {} : leerAtributos(limpio.slice(espacio));
    const nuevo = nodo(etiqueta, attrs);
    pila[pila.length - 1].hijos.push(nuevo);
    if (!autocierre) pila.push(nuevo);
  }
  return raiz;
}

function anadirTexto(destino, trozo) {
  if (trozo) destino.texto += decodificar(trozo);
}

/** Hijos directos con ese nombre local. */
export function hijos(n, nombre) {
  if (!n) return [];
  return n.hijos.filter((h) => h.nombre === nombre);
}

/** Primer descendiente (en profundidad) con ese nombre local. */
export function buscar(n, nombre) {
  if (!n) return null;
  for (const h of n.hijos) {
    if (h.nombre === nombre) return h;
    const dentro = buscar(h, nombre);
    if (dentro) return dentro;
  }
  return null;
}

/** Todos los descendientes con ese nombre local. */
export function buscarTodos(n, nombre, acumulador = []) {
  if (!n) return acumulador;
  for (const h of n.hijos) {
    if (nombre === '*' || h.nombre === nombre) acumulador.push(h);
    buscarTodos(h, nombre, acumulador);
  }
  return acumulador;
}

/** Texto de un nodo, incluido el de sus descendientes, ya limpio. */
export function texto(n) {
  if (!n) return '';
  let salida = n.texto;
  for (const h of n.hijos) salida += ' ' + texto(h);
  return salida.replace(/\s+/g, ' ').trim();
}

/** Texto del primer descendiente con ese nombre, o null. */
export function textoDe(n, nombre) {
  const encontrado = buscar(n, nombre);
  if (!encontrado) return null;
  const t = texto(encontrado);
  return t === '' ? null : t;
}

/** Sigue una ruta de nombres locales bajando por el primer hijo que encaje. */
export function porRuta(n, ...ruta) {
  let actual = n;
  for (const paso of ruta) {
    if (!actual) return null;
    actual = actual.hijos.find((h) => h.nombre === paso) || null;
  }
  return actual;
}
