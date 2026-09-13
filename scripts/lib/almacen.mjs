/**
 * El almacén: la trastienda donde se acumula todo lo que publica la Plataforma.
 *
 * La app NO lee de aquí. Sigue sirviéndose de los JSON estáticos de data/, que
 * es lo que hace que abra al instante y funcione sin cobertura. Esto existe
 * porque un año de contratación no cabe en ficheros dentro del repositorio y
 * porque los indicadores que de verdad valen —concentración en una empresa,
 * troceo de un gasto en contratos pequeños, desviación entre presupuesto y
 * precio final— necesitan meses de datos para poder calcularse.
 *
 * Se habla con PostgREST a pelo, con fetch. Ni una dependencia, como el resto
 * de la casa.
 *
 * Si no hay credenciales configuradas, no pasa nada: se avisa y la ingesta
 * sigue su curso. Publicar los JSON es lo primero; guardar el histórico no
 * puede tumbar la publicación del día.
 *
 *   SUPABASE_URL          https://<ref>.supabase.co
 *   SUPABASE_SERVICE_KEY  clave de servicio (solo en los secretos de Actions,
 *                         nunca en el repositorio)
 */

/** Filas por llamada. Ni tan pocas que sean mil viajes ni tanto que reviente. */
const POR_LOTE = 500;
const INTENTOS = 3;

export function credenciales() {
  const url = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  const clave = process.env.SUPABASE_SERVICE_KEY || '';
  return url && clave ? { url, clave } : null;
}

async function llamar(ruta, cuerpo, { url, clave }) {
  let ultimoError = null;
  for (let intento = 1; intento <= INTENTOS; intento += 1) {
    try {
      const respuesta = await fetch(`${url}/rest/v1/${ruta}`, {
        method: 'POST',
        headers: {
          apikey: clave,
          Authorization: `Bearer ${clave}`,
          'Content-Type': 'application/json',
          Prefer: 'return=representation',
        },
        body: JSON.stringify(cuerpo),
        signal: AbortSignal.timeout(120000),
      });
      if (!respuesta.ok) {
        const detalle = (await respuesta.text()).slice(0, 300);
        throw new Error(`${respuesta.status} ${detalle}`);
      }
      return await respuesta.json();
    } catch (error) {
      ultimoError = error;
      if (intento < INTENTOS) await new Promise((r) => setTimeout(r, 2000 * 2 ** (intento - 1)));
    }
  }
  throw ultimoError;
}

/**
 * Lo que se guarda de cada contrato. Los de detalle van enteros; del resto se
 * dejan fuera los textos largos, que son el 40% del peso, pero se conservan
 * fecha, organismo, importe, CPV y adjudicatario: son la mayoría de contratos
 * y son donde se ve si un gasto grande se ha troceado en muchos pequeños.
 */
export function comoFila(contrato, detalle) {
  const fila = {
    id: contrato.id,
    fecha: contrato.fecha,
    organismo: contrato.organismo || null,
    nivel: contrato.nivel || null,
    ccaa: contrato.ccaa || null,
    provincia: contrato.provincia || null,
    estatal: Boolean(contrato.estatal),
    viaLocalizacion: contrato.viaLocalizacion || null,
    importe: contrato.importe ?? null,
    importeAdjudicado: contrato.importeAdjudicado ?? null,
    valorEstimado: contrato.valorEstimado ?? null,
    importeNoVerificado: contrato.importeNoVerificado ?? null,
    procedimiento: contrato.procedimiento || null,
    estado: contrato.estado || null,
    resultado: contrato.resultado || null,
    tipoContrato: contrato.tipoContrato || contrato.tipo || null,
    sector: contrato.sector || null,
    cpv: contrato.cpv || [],
    ofertas: contrato.ofertas ?? null,
    plazoOfertas: contrato.plazoOfertas || null,
    esMenor: Boolean(contrato.esMenor),
    adjudicatario: contrato.adjudicatario || null,
    adjudicatarioId: contrato.adjudicatarioId || null,
    detalle: Boolean(detalle),
  };
  if (detalle) {
    fila.titulo = contrato.titulo || contrato.objeto || null;
    fila.url = contrato.url || null;
    fila.expediente = contrato.expediente || null;
  }
  return fila;
}

/**
 * Guarda los contratos. Devuelve el recuento, o null si no hay credenciales.
 * Nunca lanza hacia arriba: el histórico es un extra, la publicación no.
 */
export async function guardar(contratos, { detalleDesde = 0, fuente = 'placsp', registro = console } = {}) {
  const acceso = credenciales();
  if (!acceso) {
    registro.log?.('  Almacén: sin credenciales (SUPABASE_URL / SUPABASE_SERVICE_KEY), no se guarda histórico.');
    return null;
  }
  if (!contratos.length) return { filas: 0, nuevas: 0 };

  const filas = contratos.map((c) => {
    const importe = c.importeAdjudicado ?? c.importe ?? 0;
    return comoFila(c, typeof importe === 'number' && importe >= detalleDesde);
  });

  let filasEscritas = 0;
  let nuevas = 0;
  const errores = [];

  for (let i = 0; i < filas.length; i += POR_LOTE) {
    const lote = filas.slice(i, i + POR_LOTE);
    try {
      const resultado = await llamar('rpc/guardar_contratos', { lote }, acceso);
      filasEscritas += Number(resultado?.filas) || 0;
      nuevas += Number(resultado?.nuevas) || 0;
    } catch (error) {
      errores.push(String(error.message || error));
      registro.warn?.(`  ⚠ Almacén: lote ${i / POR_LOTE + 1} no se pudo guardar — ${error.message || error}`);
    }
  }

  const fechas = contratos.map((c) => c.fecha).filter(Boolean).sort();
  try {
    await llamar('cargas', {
      fuente,
      desde: fechas[0] || null,
      hasta: fechas[fechas.length - 1] || null,
      filas: filasEscritas,
      nuevas,
      mensaje: errores.length ? errores.slice(0, 3).join(' · ') : null,
    }, acceso);
  } catch {
    // El apunte de la carga es contabilidad interna: que falle no es motivo
    // para dar por mala una ingesta que sí ha escrito los contratos.
  }

  registro.log?.(`  Almacén: ${filasEscritas} contratos guardados (${nuevas} nuevos)${errores.length ? `, ${errores.length} lotes con error` : ''}`);
  return { filas: filasEscritas, nuevas, errores };
}
