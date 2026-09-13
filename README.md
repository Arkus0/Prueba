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
| **Hoy** | Cuánto se ha publicado, **dónde** (mapa por comunidades), en qué se gasta y cómo se decide. Debajo, el día a día con el importe y el enlace al documento |
| **Contratos** | Quién adjudica, a qué empresa, por cuánto y con qué procedimiento |
| **Empleo** | Qué oposiciones tienen el plazo abierto: plazas, requisitos, tasa y hasta cuándo puedes apuntarte |
| **Cargos** | Quién entra y quién sale, y si el puesto se cubre por concurso o por libre designación |
| **Reparto** | A dónde va el dinero publicado: qué comunidades, qué sectores, qué organismos, qué empresas, con qué procedimientos |

## Reglas de la casa

1. **No se inventa una cifra.** Todo dato sale de una descarga real. Si una fuente
   falla ese día, la app lo dice en pantalla en vez de rellenar el hueco.
2. **Siempre el original a un toque.** Cada tarjeta enlaza a su documento oficial.
3. **Las señales describen, no acusan.** "Sin concurso abierto" o "libre designación"
   son procedimientos legales y habituales: se marcan para que te fijes, y cada una
   explica qué significa y qué no.
4. **Sin jerga suelta.** Los términos oficiales se tocan y se explican.
5. **Lo que no se sabe, se dice.** El territorio de un contrato no viene en un
   campo limpio: se deduce. Lo que no se puede deducir con certeza se queda
   fuera del mapa y se cuenta aparte, en pantalla. Un hueco es mejor que una
   comunidad mal pintada.

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
- **Instituto Geográfico Nacional**, vía [es-atlas](https://github.com/martgnz/es-atlas)
  (MIT) — la cartografía de las comunidades y las provincias, con los códigos del
  **INE**, y el listado de los 8.213 municipios. De ahí salen las formas del mapa
  y la tabla con la que se localiza cada contrato.
- **INE, Cifras de Población a 1 de enero de 2025** — la población de cada
  comunidad, solo para el «por habitante» del mapa. Redondeada al millar y
  etiquetada como aproximada.
- **CPV** (Reglamento CE 213/2008) — el vocabulario europeo de contratación, que
  ya viene en cada contrato. Se traduce a doce sectores en cristiano para poder
  decir «sanidad» u «obras» en vez de «Servicios».

## Cómo funciona

La app no tiene servidor ni base de datos, y eso no ha cambiado. Una tarea
programada lee las fuentes una vez al día y deja el resultado como JSON estático
en `data/`; el frontend es HTML, CSS y JavaScript sin dependencias ni build. Eso
hace que abra al instante en el móvil, gaste pocos datos y siga funcionando
aunque el BOE se caiga.

Detrás sí hay una base de datos, pero el móvil nunca habla con ella: es la
trastienda donde la ingesta acumula el histórico completo de contratación, que no
cabe en ficheros dentro del repositorio. Ver [El almacén](#el-almacén).

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
  lib/territorio.mjs   de qué comunidad es cada contrato, y con qué certeza
  lib/cpv.mjs          del código CPV al sector, en cristiano
  lib/almacen.mjs      guarda el histórico completo en la base de datos
  sources/oposiciones.mjs  baja el texto de cada convocatoria y saca plazo y plazas
  mapa.mjs             genera el mapa y las tablas del INE (a mano, no en la ingesta)
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

### De dónde es cada contrato

La Plataforma no publica un campo de territorio que se pueda usar tal cual, así
que la comunidad se deduce, por este orden y parando en la primera pista que sea
concluyente:

1. La dirección del propio CODICE, si viene: código NUTS, código postal o municipio.
2. El nombre de una provincia dentro del nombre del organismo.
3. Un municipio del INE dentro del nombre («Ayuntamiento de Vinarós» → Castellón).
   Los nombres que existen en dos provincias se descartan: mejor sin localizar
   que mal localizado.
4. Un ente autonómico conocido que no lleva el sitio en el nombre («Servicio
   Andaluz de Salud», «Sergas», «Osakidetza»). Da comunidad, no provincia.
5. El dominio de la plataforma autonómica en la que publica. `contrataciondelestado.es`
   **no** cuenta: es la plataforma central y la usa media España.
6. Organismo de ámbito estatal (Adif, Correos, un ministerio): no le corresponde
   ninguna provincia, y decirlo es la respuesta correcta.

Con los datos de hoy eso localiza el **85%** de los contratos; un 7% es de ámbito
estatal y un 8% se queda sin localizar. Los tres números salen en pantalla, y
`npm run check` avisa si la cobertura baja del 70%, que sería la señal de que la
Plataforma ha cambiado algo.

Importa el matiz: el mapa dice **quién publica** el contrato, no dónde acaba el
dinero. Una comunidad puede licitar obras en cualquier punto de su territorio.

Cada acierto guarda en `viaLocalizacion` cuál de las seis pistas lo resolvió, para
poder auditarlo después sin volver a descargar nada.

### El mapa

`node scripts/mapa.mjs` baja el atlas del IGN, lo simplifica y escribe
`js/mapa-espana.js` (las formas, 18 KB) y `scripts/lib/territorio-datos.mjs` (las
tablas). Se ejecuta a mano cuando haga falta, no en la ingesta diaria, y lo que
genera se sube al repositorio: el móvil no descarga cartografía ni ejecuta
ninguna librería de mapas.

### El almacén

En los ficheros del repositorio solo caben los últimos meses y solo los contratos
de 50.000 € para arriba: la Plataforma publica del orden de **mil cien contratos
al día** de toda España, que son unos 400.000 al año. Pero sin histórico no se
pueden calcular los indicadores que de verdad valen —concentración de
adjudicaciones en una misma empresa, troceo de un gasto grande en muchos
contratos pequeños, desviación entre presupuesto y precio final— ni saber si un
importe es raro, porque «raro» solo significa algo comparado con los contratos
parecidos de los meses anteriores.

Así que la ingesta, además de escribir los JSON, guarda **todo** lo que lee en una
base de datos Postgres (Supabase). Se guarda en dos niveles para que un año entero
quepa sin pagar servidor:

- **Fila completa** para los contratos de 50.000 € o más, con título, enlace y
  expediente. Unos 70.000 al año.
- **Fila mínima** para el resto: sin los textos largos, que son el 40% del peso,
  pero conservando fecha, organismo, importe, CPV y adjudicatario. Son la mayoría
  y son justo donde se ve el troceo, así que tirarlos sería tirar lo interesante.

Un año así ocupa unos 150 MB. El cliente (`scripts/lib/almacen.mjs`) habla con
PostgREST por `fetch`, sin dependencias, en lotes de 500 contratos por llamada.

Para no empezar en blanco, `node scripts/build.mjs --reconstruir` aprovecha el
paseo por los ficheros de `data/dias/` para mandar al almacén los contratos que ya
están bajados.

Se configura con dos variables de entorno, que en producción son secretos de
GitHub Actions y **nunca** están en el repositorio:

```bash
SUPABASE_URL=https://<ref>.supabase.co
SUPABASE_SERVICE_KEY=<la clave de servicio>

npm run almacen:probar   # comprueba la conexión sin escribir nada
```

Si no están configuradas, la ingesta lo dice en el log y sigue su curso. Publicar
los datos del día es lo que no puede fallar; guardar el histórico es un extra que
no puede tumbar lo primero. Por el mismo motivo, si un lote no se puede guardar se
anota y se continúa con los demás.

En la base, la lectura es pública —son datos que publica el Estado— y escribir
requiere la clave de servicio: las políticas RLS solo permiten `select`, y ni el
permiso de escritura directa ni el de ejecutar la función de guardado están
concedidos a nadie más.

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
npm run almacen:probar   # comprueba la conexión con la base de datos histórica

node scripts/build.mjs --reconstruir   # rehace data/index.json con lo que ya hay
                                       # en disco, sin pedirle nada a las fuentes.
                                       # Pone al día los ficheros de días antiguos
                                       # cuando cambia el formato y, si el almacén
                                       # está configurado, le manda de paso los
                                       # contratos ya bajados.
node scripts/mapa.mjs                  # regenera el mapa y las tablas del INE
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
datos acumulados, y acumularlos es justo lo que hace ya [el almacén](#el-almacén):
el cimiento que faltaba está puesto, queda esperar a que se llene.

Se nota lo que falta en la señal «Importe que no cuadra». Hoy es una red de
seguridad con topes fijos por nivel de administración, que es lo único defendible
con ocho días de datos. Con un año, la pregunta correcta deja de ser «¿supera este
tope?» y pasa a ser «¿cuánto se sale este contrato de lo que cuestan los contratos
parecidos?», que es más justo y no necesita que nadie elija un número a ojo.

Queda pendiente el relleno del año hacia atrás. La sindicación Atom es rodante, así
que hay que tirar de los ficheros históricos que publica la Plataforma, y está por
comprobar que quepan en el tiempo y el disco de una GitHub Action.

El listón se mantiene: describir hechos verificables con su enlace, nunca insinuar.
