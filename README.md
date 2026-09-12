# Dinero público

En qué se gasta el Estado tu dinero, explicado en cristiano y pensado para el móvil.

Cada día el Estado publica cientos de decisiones que mueven dinero: contratos,
ayudas, nombramientos, créditos extraordinarios. Están todas disponibles y son
públicas, pero repartidas entre PDFs del BOE y ficheros XML en formato CODICE que
no lee nadie que no cobre por leerlos. Esta app los baja, los traduce a frases
normales y los enseña en el móvil.

## Qué se ve

| Pestaña | Qué responde |
|---|---|
| **Hoy** | Qué se ha decidido hoy, día a día, con el importe y el enlace al documento |
| **Contratos** | Quién adjudica, a qué empresa, por cuánto y con qué procedimiento |
| **Empleo** | Qué oposiciones tienen el plazo abierto: plazas, requisitos, tasa y hasta cuándo puedes apuntarte |
| **Cargos** | Quién entra y quién sale, y si el puesto se cubre por concurso o por libre designación |
| **Reparto** | A dónde va el dinero publicado: qué organismos, qué empresas, con qué procedimientos |

## Reglas de la casa

1. **No se inventa una cifra.** Todo dato sale de una descarga real. Si una fuente
   falla ese día, la app lo dice en pantalla en vez de rellenar el hueco.
2. **Siempre el original a un toque.** Cada tarjeta enlaza a su documento oficial.
3. **Las señales describen, no acusan.** "Sin concurso abierto" o "libre designación"
   son procedimientos legales y habituales: se marcan para que te fijes, y cada una
   explica qué significa y qué no.
4. **Sin jerga suelta.** Los términos oficiales se tocan y se explican.

## Fuentes

- **[BOE, datos abiertos](https://www.boe.es/datosabiertos/)** — sumario diario:
  `https://boe.es/datosabiertos/api/boe/sumario/AAAAMMDD`. De ahí salen nombramientos
  y ceses (sección II.A), oposiciones y convocatorias de libre designación (II.B),
  ayudas y convenios (III), anuncios de contratación (V.A) y las normas que reparten
  dinero (I).
- **[Plataforma de Contratación del Sector Público](https://contrataciondelsectorpublico.gob.es/wps/portal/DatosAbiertos)** —
  sindicación Atom diaria con los datos estructurados en CODICE 2.07.
- **Presupuestos Generales del Estado** — mejor esfuerzo vía el catálogo de
  datos.gob.es. Hacienda no publica una API estable de partidas, así que si no se
  puede leer, la app lo dice y enlaza al portal oficial.

## Cómo funciona

No hay servidor ni base de datos. Una tarea programada lee las fuentes una vez al
día y deja el resultado como JSON estático en `data/`; el frontend es HTML, CSS y
JavaScript sin dependencias ni build. Eso hace que abra al instante en el móvil,
gaste pocos datos y siga funcionando aunque el BOE se caiga.

```
scripts/
  build.mjs            orquesta la ingesta y escribe data/
  check.mjs            valida lo generado antes de publicarlo
  sources/boe.mjs      sumario del BOE
  sources/placsp.mjs   contratos (Atom + CODICE)
  sources/pge.mjs      presupuesto por partidas (mejor esfuerzo)
  lib/xml.mjs          lector de XML por nombre local, sin dependencias
  lib/texto.mjs        números, jerga y frases en lenguaje llano
  lib/senales.mjs      las señales y su explicación
  sources/oposiciones.mjs  baja el texto de cada convocatoria y saca plazo y plazas
data/
  index.json           resumen, agregados y estado de cada fuente
  dias/AAAA-MM-DD.json lo publicado ese día
  oposiciones.json     convocatorias de empleo público con su plazo
```

### Sobre las oposiciones

El sumario del BOE solo trae el titular. Lo que de verdad necesita quien quiere
presentarse —cuántas plazas, qué titulación piden, la tasa y hasta cuándo hay
plazo— está dentro del documento, así que de cada convocatoria se descarga el
texto completo y se extrae. La fecha tope se calcula contando desde el día
siguiente a la publicación y saltando sábados y domingos; los festivos cambian
según dónde presentes la solicitud, así que se muestra como aproximada y
siempre junto al enlace al texto oficial.

### Relleno del pasado

`node scripts/build.mjs --desde=2025-07-01 --solo=boe` lee el sumario día a día
hacia atrás y lo funde con lo que ya hay. La tarea *Relleno histórico del BOE*
hace lo mismo desde Actions, o tocando `.github/relleno.txt`.

Los contratos son otra escala: la Plataforma publica del orden de mil al día de
toda España, así que el histórico completo no cabe en ficheros JSON dentro del
repositorio y pediría una base de datos. De momento se guardan en detalle los
últimos meses y el agregado diario de todo lo demás.

## Desarrollo

```bash
npm test                 # pruebas de los lectores contra ficheros de ejemplo
npm run demo             # genera data/ con datos de EJEMPLO, para ver la interfaz
npm run ingest           # ingesta real (necesita salida a boe.es y a la Plataforma)
npm run check            # valida data/
npm run dev              # sirve la app en http://localhost:8080
```

También hay un endpoint de comprobación, `/api/diagnostico`, que pregunta a las
fuentes en el momento y responde si siguen vivas y si seguimos entendiendo lo que
devuelven (`?fuente=boe&dias=2`, `?fuente=placsp&paginas=2`). Sirve para no tener
que esperar al cron cuando algo huele raro.

`npm run demo` marca los datos como de ejemplo y la app lo avisa en la cabecera.
No subas esos datos al repositorio: los reales los escribe la tarea programada
(`.github/workflows/ingesta.yml`), que corre cada día y también a mano desde la
pestaña Actions.

## Lo siguiente

La capa de señales (`scripts/lib/senales.mjs`) está pensada para crecer hacia
indicadores de riesgo calculados sobre el histórico: concentración de adjudicaciones
en una misma empresa, desviación entre presupuesto y precio final, troceo de un
gasto en contratos menores, plazos anormalmente cortos. Todo eso necesita meses de
datos acumulados, así que primero toca acumularlos. El listón se mantiene:
describir hechos verificables con su enlace, nunca insinuar.
