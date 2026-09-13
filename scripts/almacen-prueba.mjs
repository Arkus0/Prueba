/**
 * Comprueba que se puede hablar con el almacén. No escribe ningún contrato.
 *
 *   SUPABASE_URL=... SUPABASE_SERVICE_KEY=... npm run almacen:probar
 *
 * Existe porque el cableado HTTP no se puede probar desde cualquier sitio: hace
 * falta salida a la red hacia Supabase. Un comando que responde sí o no evita
 * descubrir el problema a las seis y media de la mañana, cuando corre la tarea.
 */

import { credenciales, guardar } from './lib/almacen.mjs';

const acceso = credenciales();
if (!acceso) {
  console.error('Faltan SUPABASE_URL o SUPABASE_SERVICE_KEY.');
  console.error('La clave de servicio se saca del panel de Supabase, en Project Settings → API.');
  console.error('No la pongas en el repositorio: va en los secretos de GitHub Actions.');
  process.exit(1);
}

console.log(`Almacén: ${acceso.url}`);

const consulta = async (ruta) => {
  const respuesta = await fetch(`${acceso.url}/rest/v1/${ruta}`, {
    headers: {
      apikey: acceso.clave,
      Authorization: `Bearer ${acceso.clave}`,
      Prefer: 'count=exact',
      Range: '0-0',
    },
    signal: AbortSignal.timeout(30000),
  });
  if (!respuesta.ok) throw new Error(`${respuesta.status} ${(await respuesta.text()).slice(0, 200)}`);
  return respuesta.headers.get('content-range') || '?';
};

try {
  for (const tabla of ['contratos', 'organismos', 'empresas', 'cargas']) {
    const rango = await consulta(`${tabla}?select=*`);
    console.log(`  ${tabla.padEnd(11)} ${(rango.split('/')[1] || '?').padStart(8)} filas`);
  }
  // Un lote vacío ejercita la función entera sin escribir nada.
  const resultado = await guardar([], { registro: { log() {}, warn() {} } });
  console.log(`  escritura    ${resultado ? 'OK' : 'sin credenciales'}`);
  console.log('\nTodo correcto: la ingesta podrá guardar el histórico.');
} catch (error) {
  console.error(`\nNo se ha podido hablar con el almacén: ${error.message || error}`);
  console.error('Revisa la URL, la clave y que la salida a Supabase no esté capada.');
  process.exit(1);
}
