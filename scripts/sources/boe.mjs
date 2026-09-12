/**
 * Sumario diario del BOE (API de datos abiertos).
 *   https://boe.es/datosabiertos/api/boe/sumario/AAAAMMDD   (Accept: application/json)
 *
 * El recorrido es deliberadamente generico: bajamos por las claves
 * seccion / departamento / epigrafe / item alla donde aparezcan, en vez de
 * asumir una ruta fija. Asi da igual que la API devuelva un objeto o una
 * lista, y podemos caer al XML con el mismo codigo si el JSON falla.
 */

import { bajar, comoAAAAMMDD, comoISO } from '../lib/red.mjs';
import { parsearXML } from '../lib/xml.mjs';
import { importeEnTexto, limpiarTitulo, jergaEn, nombrePropio, conArticuloOrganismo, conArticuloMayus } from '../lib/texto.mjs';
import { senalesDeBOE } from '../lib/senales.mjs';

const BASE = 'https://boe.es';
const API = `${BASE}/datosabiertos/api/boe/sumario`;

const lista = (v) => (v === null || v === undefined ? [] : Array.isArray(v) ? v : [v]);

/** El texto de un campo que puede venir como cadena o como objeto. */
function valorTexto(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') return v.trim() || null;
  if (typeof v === 'number') return String(v);
  if (typeof v === 'object') {
    for (const clave of ['texto', 'text', '#text', '_', '$', 'valor']) {
      if (typeof v[clave] === 'string' && v[clave].trim()) return v[clave].trim();
    }
  }
  return null;
}

function urlAbsoluta(v) {
  const t = valorTexto(v);
  if (!t) return null;
  if (t.startsWith('http')) return t;
  return BASE + (t.startsWith('/') ? t : '/' + t);
}

/** Codigo de seccion normalizado: "II.A" / "2A" / "2.A" -> "2A". */
function codigoSeccion(seccion) {
  const bruto = (valorTexto(seccion.codigo) || valorTexto(seccion.num) || '').toUpperCase().replace(/[.\s-]/g, '');
  const romanos = { I: '1', II: '2', III: '3', IV: '4', V: '5' };
  const conRomano = bruto.match(/^(I{1,3}|IV|V)([ABC])?$/);
  if (conRomano) return romanos[conRomano[1]] + (conRomano[2] || '');
  return bruto;
}

/**
 * Que es esto y si nos interesa. Devuelve null para lo que no mueve dinero
 * ni puestos (edictos de justicia, anuncios de particulares...).
 */
function clasificar(codigo, nombreSeccion, titulo) {
  const nombre = (nombreSeccion || '').toLowerCase();
  const t = (titulo || '').toLowerCase();

  const esNombramientos = codigo.startsWith('2A') || /nombramiento/.test(nombre);
  const esEmpleo = codigo.startsWith('2B') || /oposicion|oposición|concurso/.test(nombre);
  if (esNombramientos) {
    if (/libre designaci[oó]n/.test(t)) return { categoria: 'personas', subtipo: 'libre-designacion-resuelta' };
    if (/\bcese\b|\bcesa\b/.test(t)) return { categoria: 'personas', subtipo: 'cese' };
    if (/jubilaci[oó]n|excedencia|servicios especiales|reingreso|situaci[oó]n de/.test(t)) {
      return { categoria: 'personas', subtipo: 'situacion' };
    }
    return { categoria: 'personas', subtipo: 'nombramiento' };
  }
  if (esEmpleo) {
    return {
      categoria: 'personas',
      subtipo: /libre designaci[oó]n/.test(t) ? 'libre-designacion' : 'empleo',
    };
  }

  if (codigo.startsWith('5A') || /contrataci[oó]n del sector/.test(nombre)) {
    return { categoria: 'contratos', subtipo: 'anuncio' };
  }

  if (codigo.startsWith('3')) {
    if (/subvenci|ayudas?\b|becas?\b|premios?\b|convenio|aportaci[oó]n|transferencia/.test(t)) {
      return { categoria: 'subvenciones', subtipo: /convenio/.test(t) ? 'convenio' : 'subvencion' };
    }
    return null;
  }

  if (codigo.startsWith('1')) {
    if (/cr[eé]dito extraordinario|suplemento de cr[eé]dito|presupuest|financiaci[oó]n|se conceden/.test(t)) {
      return { categoria: 'presupuesto', subtipo: 'norma' };
    }
    return null;
  }

  return null;
}

/** Para que hace falta el dinero, si el titulo lo dice con claridad. */
function paraQue(titulo) {
  const m = titulo.match(/\bpara (?:la |el |los |las )?([^.;:,]{6,90})/i);
  if (!m) return null;
  const texto = m[1].trim().replace(/\s+(de|del|la|el|y|en|con|a)$/i, '');
  return texto.length >= 6 ? texto : null;
}

/** Reescritura a lenguaje llano. Si no estamos seguros, devolvemos null. */
export function fraseLlana(titulo, subtipo, organismo) {
  const t = limpiarTitulo(titulo);
  const quien = organismo ? nombrePropio(organismo) : null;
  const conArticulo0 = conArticuloOrganismo(organismo);
  const Quien = conArticuloMayus(organismo);

  if (subtipo === 'nombramiento') {
    const persona1 = t.match(/se nombra\s+a\s+(?:don|doña|dª|d\.)?\s*([^,]{3,80}?),?\s+(?:como\s+)?([^.]{3,120})\.?$/i);
    if (persona1) return `Nombran a ${persona1[1].trim()} ${conArticulo(persona1[2])}.`;
    const persona2 = t.match(/se nombra\s+([^.]{3,120}?)\s+a\s+(?:don|doña|dª|d\.)\s+([^.]{3,80})\.?$/i);
    if (persona2) return `Nombran a ${persona2[2].trim()} ${conArticulo(persona2[1])}.`;
  }

  if (subtipo === 'libre-designacion-resuelta') {
    if (/se declara desierta/.test(t)) {
      return `${Quien || 'Un organismo del Estado'} deja sin cubrir un puesto de libre designación.`;
    }
    if (/se resuelve|se adjudica/.test(t)) {
      return `${Quien || 'Un organismo del Estado'} ya ha elegido a quien ocupa un puesto de libre designación.`;
    }
    return `${Quien || 'Un organismo del Estado'} mueve un puesto de libre designación.`;
  }

  if (subtipo === 'situacion') {
    const jubilacion = t.match(/se declara la jubilaci[oó]n[^.]*?\b(?:de|del|de la)\s+(?:[Mm]agistrad[oa]|[Jj]uez|[Ff]iscal|[Ll]etrad[oa]|[Ss]ecretari[oa]|[Dd]on|[Dd]oña|[Dd]ª|[Dd]\.)\s*([^.,]{3,70})/);
    if (jubilacion) return `Se jubila ${limpiarPersona(jubilacion[1])}.`;
    if (/excedencia/.test(t)) return `${Quien || 'Un organismo del Estado'} concede una excedencia.`;
    if (/servicios especiales/.test(t)) return `Alguien pasa a servicios especiales${conArticulo0 ? ` en ${conArticulo0}` : ''}.`;
    return null;
  }

  if (subtipo === 'cese') {
    const cese = t.match(/se dispone el cese\s+(?:de\s+)?(?:don|doña|dª|d\.)?\s*([^,]{3,80}?)(?:,|\s+como|\s+en el cargo)/i);
    if (cese) return `Cesa ${cese[1].trim()}${conArticulo0 ? ` en ${conArticulo0}` : ''}.`;
  }

  if (subtipo === 'libre-designacion') {
    return `${Quien || 'Un organismo del Estado'} cubre puestos por libre designación: elige el cargo, sin baremo de méritos.`;
  }

  if (subtipo === 'empleo') {
    const plazas = t.match(/(\d{1,5})\s+plazas?/i);
    if (plazas && Quien) return `${Quien} convoca ${plazas[1]} plazas.`;
    if (/relaci[oó]n de (personas )?aprobad/i.test(t) && Quien) return `${Quien} publica quién ha aprobado.`;
    if (/lista[s]? (provisional |definitiva )?de (personas )?(admitid|aspirante|excluid)/i.test(t) && Quien) {
      return `${Quien} publica la lista de admitidos de un proceso selectivo.`;
    }
    if (/se resuelve (el|la) concurso|adjudicaci[oó]n de destinos|se adjudican destinos/i.test(t) && Quien) {
      return `${Quien} reparte destinos entre quienes ganaron un concurso.`;
    }
    if (/se convoca (el )?concurso/i.test(t) && Quien) return `${Quien} saca puestos a concurso de méritos.`;
    if (/proceso selectivo|se convocan?\b/i.test(t) && Quien) return `${Quien} abre un proceso para cubrir plazas.`;
  }

  if (subtipo === 'subvencion' || subtipo === 'convenio') {
    const destino = paraQue(t);
    const verbo = subtipo === 'convenio' ? 'firma un convenio' : 'reparte ayudas';
    if (Quien && destino) return `${Quien} ${verbo} para ${destino}.`;
    if (Quien) return `${Quien} ${verbo}.`;
  }

  if (subtipo === 'anuncio') {
    const objeto = t.match(/objeto:?\s*([^.;]{6,90})/i);
    if (Quien && objeto) return `${Quien} saca a concurso: ${objeto[1].trim()}.`;
    if (Quien) return `${Quien} saca un contrato a concurso.`;
  }

  if (subtipo === 'norma') {
    if (/cr[eé]dito extraordinario|suplemento de cr[eé]dito/i.test(t)) {
      const destino = t.match(/\bal\s+(Ministerio[^.,]{3,70})/i);
      const receptor = destino ? conArticuloOrganismo(destino[1].trim()) : null;
      return `Se aprueba dinero extra fuera del presupuesto${receptor ? ` para ${receptor}` : ''}.`;
    }
  }

  return null;
}

/** Quita tratamientos delante de un nombre: "don Juan Pérez" -> "Juan Pérez". */
function limpiarPersona(nombre) {
  return nombre
    .trim()
    .replace(/^(don|doña|dª|d\.|sr\.|sra\.|excmo\.?|ilmo\.?)\s+/i, '')
    .replace(/\s+/g, ' ');
}

/** Limpia el cargo de muletillas ("como Director General" -> "Director General"). */
function conArticulo(cargo) {
  return cargo.trim().replace(/^(como|en el cargo de|para el puesto de)\s+/i, '');
}

function itemNormalizado(bruto, contexto) {
  const id = valorTexto(bruto.identificador) || valorTexto(bruto.id);
  const titulo = limpiarTitulo(valorTexto(bruto.titulo) || valorTexto(bruto.title) || '');
  if (!id || !titulo) return null;

  const clase = clasificar(contexto.codigo, contexto.seccionNombre, titulo);
  if (!clase) return null;

  const dinero = importeEnTexto(titulo);
  const organismo = contexto.organismo ? nombrePropio(contexto.organismo) : null;

  const item = {
    id,
    fuente: 'BOE',
    fecha: contexto.fecha,
    categoria: clase.categoria,
    subtipo: clase.subtipo,
    seccion: contexto.codigo,
    seccionNombre: contexto.seccionNombre || null,
    epigrafe: contexto.epigrafe || null,
    organismo,
    titulo,
    importe: dinero ? dinero.importe : null,
    url: `${BASE}/diario_boe/txt.php?id=${encodeURIComponent(id)}`,
    urlPdf: urlAbsoluta(bruto.url_pdf ?? bruto.urlPdf),
    jerga: jergaEn(titulo),
  };
  item.frase = fraseLlana(titulo, clase.subtipo, contexto.organismo);
  item.senales = senalesDeBOE({ ...item, categoria: clase.categoria });
  return item;
}

/** Recorre el arbol del sumario acumulando items ya normalizados. */
export function recorrerSumario(nodo, contexto, salida) {
  if (!nodo || typeof nodo !== 'object') return salida;
  if (Array.isArray(nodo)) {
    for (const hijo of nodo) recorrerSumario(hijo, contexto, salida);
    return salida;
  }

  for (const [clave, valor] of Object.entries(nodo)) {
    if (clave === 'seccion') {
      for (const seccion of lista(valor)) {
        recorrerSumario(seccion, {
          ...contexto,
          codigo: codigoSeccion(seccion),
          seccionNombre: valorTexto(seccion.nombre) || valorTexto(seccion.titulo),
        }, salida);
      }
    } else if (clave === 'departamento') {
      for (const dep of lista(valor)) {
        recorrerSumario(dep, { ...contexto, organismo: valorTexto(dep.nombre) || contexto.organismo }, salida);
      }
    } else if (clave === 'epigrafe') {
      for (const epi of lista(valor)) {
        recorrerSumario(epi, { ...contexto, epigrafe: valorTexto(epi.nombre) }, salida);
      }
    } else if (clave === 'item') {
      for (const it of lista(valor)) {
        const normalizado = itemNormalizado(it, contexto);
        if (normalizado) salida.push(normalizado);
      }
    } else if (valor && typeof valor === 'object' && clave !== 'metadatos') {
      recorrerSumario(valor, contexto, salida);
    }
  }
  return salida;
}

/** Convierte el XML del sumario al mismo arbol de objetos que da el JSON. */
function xmlAObjeto(nodo) {
  const salida = {};
  const propio = nodo.texto.replace(/\s+/g, ' ').trim();
  for (const hijo of nodo.hijos) {
    const valor = hijo.hijos.length ? xmlAObjeto(hijo) : (hijo.texto.replace(/\s+/g, ' ').trim() || null);
    const conAtributos = hijo.hijos.length || Object.keys(hijo.attrs).length === 0
      ? valor
      : { ...hijo.attrs, texto: valor };
    if (salida[hijo.nombre] === undefined) salida[hijo.nombre] = conAtributos;
    else if (Array.isArray(salida[hijo.nombre])) salida[hijo.nombre].push(conAtributos);
    else salida[hijo.nombre] = [salida[hijo.nombre], conAtributos];
  }
  if (propio && Object.keys(salida).length === 0) return propio;
  if (propio) salida.texto = propio;
  return salida;
}

/** Lee el sumario de un dia. Devuelve [] si ese dia no hubo boletin. */
export async function sumarioDelDia(fecha, registro = console) {
  const url = `${API}/${comoAAAAMMDD(fecha)}`;
  const iso = comoISO(fecha);
  let arbol = null;

  try {
    arbol = await bajar(url, { tipo: 'json', cabeceras: { Accept: 'application/json' }, intentos: 2 });
  } catch (errorJson) {
    try {
      const xml = await bajar(url, { cabeceras: { Accept: 'application/xml' }, intentos: 2 });
      arbol = xmlAObjeto(parsearXML(xml));
    } catch (errorXml) {
      const mensaje = String(errorXml.message || errorXml);
      if (/HTTP 404/.test(mensaje)) return { fecha: iso, items: [], sinBoletin: true };
      throw new Error(`BOE ${iso}: ${mensaje}`);
    }
  }

  const items = recorrerSumario(arbol, { fecha: iso, codigo: '', seccionNombre: null }, []);
  registro.log?.(`  BOE ${iso}: ${items.length} documentos de interés`);
  return { fecha: iso, items, sinBoletin: items.length === 0 };
}
