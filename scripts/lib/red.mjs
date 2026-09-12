/** Descargas con reintentos y tiempo limite. Nada de dependencias. */

const AGENTE = 'DineroPublico/1.0 (+https://github.com/Arkus0/Prueba) datos abiertos';

export async function bajar(url, opciones = {}) {
  const {
    intentos = 3,
    esperaMs = 1500,
    tiempoLimiteMs = 45000,
    cabeceras = {},
    tipo = 'texto',
  } = opciones;

  let ultimoError = null;
  for (let intento = 1; intento <= intentos; intento++) {
    const corte = AbortSignal.timeout(tiempoLimiteMs);
    try {
      const respuesta = await fetch(url, {
        signal: corte,
        redirect: 'follow',
        headers: { 'User-Agent': AGENTE, 'Accept-Language': 'es-ES,es', ...cabeceras },
      });
      if (!respuesta.ok) {
        throw new Error(`HTTP ${respuesta.status} en ${url}`);
      }
      if (tipo === 'json') return await respuesta.json();
      if (tipo === 'buffer') return Buffer.from(await respuesta.arrayBuffer());
      return await respuesta.text();
    } catch (error) {
      ultimoError = error;
      if (intento < intentos) {
        await new Promise((r) => setTimeout(r, esperaMs * intento));
      }
    }
  }
  throw ultimoError;
}

/** Fecha en formato AAAAMMDD, que es el que pide la API del BOE. */
export function comoAAAAMMDD(fecha) {
  const a = fecha.getUTCFullYear();
  const m = String(fecha.getUTCMonth() + 1).padStart(2, '0');
  const d = String(fecha.getUTCDate()).padStart(2, '0');
  return `${a}${m}${d}`;
}

/** Fecha en formato AAAA-MM-DD. */
export function comoISO(fecha) {
  return fecha.toISOString().slice(0, 10);
}

/** Los ultimos N dias, del mas reciente al mas antiguo. */
export function ultimosDias(n, desde = new Date()) {
  const dias = [];
  for (let i = 0; i < n; i++) {
    const d = new Date(Date.UTC(desde.getUTCFullYear(), desde.getUTCMonth(), desde.getUTCDate() - i));
    dias.push(d);
  }
  return dias;
}
