/**
 * De código CPV a "en qué se gasta", dicho como lo diría cualquiera.
 *
 * El CPV es el vocabulario común de contratación pública de la UE: ocho
 * dígitos donde los dos primeros son la división. Los contratos ya lo traen y
 * hasta ahora no se enseñaba ninguno, así que la pantalla solo podía decir
 * "Servicios" o "Suministros", que a un ciudadano no le dice absolutamente
 * nada. Con la división basta para contestar la pregunta de verdad: ¿esto es
 * un hospital, una carretera o un contrato de limpieza?
 *
 * Las 45 divisiones se agrupan en doce sectores. Cuando una división cabe en
 * dos sitios se elige el que entendería quien no trabaja en esto: el 34
 * (vehículos) va a Transporte, no a Industria.
 *
 * Reglamento (CE) 213/2008. https://simap.ted.europa.eu/es/web/simap/cpv
 */

const POR_DIVISION = {
  // Obra pública y vivienda
  45: 'Obras y carreteras',

  // Salud
  33: 'Sanidad y farmacia',
  85: 'Sanidad y farmacia',

  // Tecnología
  30: 'Informática y oficina',
  32: 'Informática y oficina',
  48: 'Informática y oficina',
  72: 'Informática y oficina',

  // Servicios urbanos
  90: 'Basuras, agua y limpieza',
  41: 'Basuras, agua y limpieza',

  // Energía
  9: 'Energía y combustible',
  31: 'Energía y combustible',
  65: 'Energía y combustible',

  // Movilidad
  34: 'Transporte y vehículos',
  60: 'Transporte y vehículos',
  63: 'Transporte y vehículos',

  // Estudios y proyectos
  71: 'Ingeniería y proyectos',
  73: 'Ingeniería y proyectos',

  // Mantenimiento
  50: 'Mantenimiento y reparaciones',
  51: 'Mantenimiento y reparaciones',

  // Gestión y administración
  66: 'Gestión y asesoría',
  75: 'Gestión y asesoría',
  79: 'Gestión y asesoría',
  98: 'Gestión y asesoría',

  // Personas
  80: 'Educación y formación',
  92: 'Cultura y deporte',
  55: 'Comida y hostelería',
  15: 'Comida y hostelería',
  3: 'Comida y hostelería',

  // Seguridad
  35: 'Seguridad y defensa',

  // Suministros varios
  14: 'Materiales y suministros',
  16: 'Materiales y suministros',
  18: 'Materiales y suministros',
  19: 'Materiales y suministros',
  22: 'Materiales y suministros',
  24: 'Materiales y suministros',
  37: 'Materiales y suministros',
  38: 'Materiales y suministros',
  39: 'Materiales y suministros',
  42: 'Materiales y suministros',
  43: 'Materiales y suministros',
  44: 'Materiales y suministros',
  64: 'Informática y oficina',
  70: 'Gestión y asesoría',
  76: 'Energía y combustible',
  77: 'Agricultura y medio ambiente',
  2: 'Agricultura y medio ambiente',
  5: 'Agricultura y medio ambiente',
};

/**
 * El sector de un contrato, a partir del primer CPV que sepamos traducir.
 * Si no hay CPV, o la división no está en la tabla, devuelve null: el contrato
 * cuenta igual en los totales, pero no se le inventa un sector.
 */
export function sectorDeCPV(cpv) {
  const codigos = Array.isArray(cpv) ? cpv : [cpv];
  for (const codigo of codigos) {
    const limpio = String(codigo || '').replace(/\D/g, '');
    if (limpio.length < 2) continue;
    const sector = POR_DIVISION[Number(limpio.slice(0, 2))];
    if (sector) return sector;
  }
  return null;
}

export const SECTORES = [...new Set(Object.values(POR_DIVISION))].sort();
