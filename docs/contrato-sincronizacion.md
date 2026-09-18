# Contrato de sincronización tablet ↔ servidor

**Versión del contrato: `1`** · Implementado en T-07 · Ampliado con folios en T-14
· Ampliado con el tipo `prospecto` y el catálogo de tipos de negocio en T-40
· Última revisión: 2026-09-14

Este documento es la referencia legible del contrato. Las definiciones
normativas están en el código:

| Dónde | Qué |
|---|---|
| `apps/backend/src/modules/sincronizacion/contrato.ts` | **Fuente de verdad** de los tipos |
| `apps/tablet/src/sincronizacion/contrato.ts` | Copia del lado de la tablet (ver *Duplicación* abajo) |
| `apps/backend/test/sincronizacion.e2e-spec.ts` | Lo que de verdad está garantizado |

Contexto de negocio: `20-Arquitectura/Sincronización offline.md` y
`30-Decisiones/ADR-0006 Contrato de sincronización de la tablet.md` en el vault.

---

## 1. En una frase

La tablet trabaja **sin red toda la jornada**. Al alcanzar el WiFi del negocio
hace una pasada de sincronización: **renueva su sesión**, **baja** (`pull`) los
catálogos de su sucursal y las notas por cobrar, y **sube** (`push`) por lotes
la operación capturada. Reenviar un lote nunca duplica nada.

```
┌─────────┐   1. POST /auth/app/refresh   ┌──────────┐
│ Tablet  │ ────────────────────────────► │ Servidor │   corre la ventana
│         │   2. GET  /sync/pull?desde=…  │          │   offline de 72 h
│ SQLite  │ ◄──────────────────────────── │ Postgres │
│         │   3. POST /sync/push          │          │
└─────────┘ ────────────────────────────► └──────────┘
```

El orden **no es negociable**. Ver §7.

---

## 2. Autenticación y alcance

Los dos endpoints van detrás de **`@SoloApp()`** (T-06):

- exigen `Authorization: Bearer <access token>` con claim `tipo: 'vendedor'`;
- **un token del portal no entra**, ni como cookie ni como `Bearer`;
- un vendedor desactivado o dado de baja con un token todavía vivo recibe 401.

**El cliente propone, el servidor dispone** (doctrina de T-09, misma función
`resolverAlcance()`):

| Situación | Respuesta |
|---|---|
| `?sucursal=` ausente o `=todas` | Se usa la del vendedor |
| `?sucursal=` la suya | Se usa la suya |
| `?sucursal=` **otra** | **403** |
| Operación de `push` con `vendedor_id` de otro | **403 para todo el lote**, no se guarda nada |
| Operación de `push` con `cliente_id` de otra sucursal | **Rechazo por operación** (ver §6) |

Los dos últimos casos se tratan distinto a propósito. Escribir en nombre de otro
vendedor es un cliente que no debería estar mandando eso. Un `cliente_id` fuera
de alcance es un **snapshot viejo**: el portal pudo mover o dar de baja al
cliente mientras el vendedor estaba en ruta, y eso no es culpa suya.

Qué alcanza cada dirección:

- **Pull = su sucursal.** Los clientes y sus notas por cobrar son de la
  sucursal, no del vendedor: a un mismo cliente lo pueden visitar varios
  vendedores (premisa registrada en `10-Dominio/Entidades/Cliente.md`), así que
  el que pasa hoy tiene que poder cobrar una nota que vendió otro. En cambio,
  de `vendedores` solo baja **su propia ficha**.
- **Push = él mismo.** Todo lo que sube queda atribuido al vendedor del
  **token**, nunca a lo que diga el cuerpo.

---

## 3. Versionado del contrato

Tablet y servidor **se despliegan por separado** y van a desincronizarse: hay
tablets que pueden pasar semanas sin actualizarse. Por eso cada petición lleva
`contrato` (entero) y cada respuesta lo devuelve.

| Caso | Respuesta |
|---|---|
| `contrato` ausente o no entero | `400` |
| `contrato` > el del servidor | `409` + `codigo: "contrato-incompatible"` · *"Actualiza el servidor"* |
| `contrato` < el mínimo aceptado | `409` + `codigo: "contrato-incompatible"` · *"Actualiza la app"* |

El mensaje dice **cuál de los dos lados se quedó atrás**, porque quien lo va a
leer está en el negocio con una tablet en la mano.

### Regla de evolución

- **Cambio aditivo** — campo opcional nuevo, `tipo` de operación nuevo,
  colección nueva en el `pull` → **no sube la versión**. Los dos lados ignoran
  lo que no conocen. Un `tipo` desconocido se rechaza **por operación**, así que
  una tablet nueva que ya captura ventas puede seguir subiendo su jornada contra
  un servidor viejo.
- **Cambio incompatible** — campo obligatorio nuevo, renombrar, cambiar el
  significado de un valor → sube `CONTRATO_ACTUAL`, y `CONTRATO_MINIMO` solo si
  de verdad rompe.

### Duplicación de los tipos

`apps/tablet/src/sincronizacion/contrato.ts` es una **copia deliberada**: la
tablet no puede importar del backend (Metro empaqueta ese workspace y arrastrar
código de NestJS revienta el bundle). Un paquete compartido lo resolvería, pero
añadiría un cuarto workspace y una capa de build a un monorepo que hoy no la
tiene, por ~150 líneas de tipos. **Si tocas uno, toca el otro y este documento
en el mismo commit** — y si aun así divergen, el `409` lo dice en voz alta en
vez de fallar de forma rara.

---

## 4. Dinero, fechas y zona horaria

### Dinero: centavos enteros en todo el cable

Postgres guarda `numeric(12,2)` y el driver `pg` lo entrega como **cadena**. La
tablet guarda **centavos enteros** (ADR-0004: el corte de caja cuadra contra
efectivo físico). La conversión vive en
`apps/backend/src/modules/sincronizacion/dinero.ts`, trabaja sobre el texto y
tiene pruebas: `Number('10.10') * 100` da `1010.0000000000001`.

### La jornada del vendedor NO es un día UTC

> La operación es de **Tijuana**. A las 18:00 hora de Tijuana, en UTC ya es el
> día siguiente.

Cada operación viaja con **dos** campos temporales, y no son intercambiables:

| Campo | Tipo | Quién lo calcula | Para qué |
|---|---|---|---|
| `fecha_operacion` | `AAAA-MM-DD` | **La tablet**, con su reloj local (`reloj.hoy()`) | El **día de trabajo**: corte del día, y el contador de folios que reinicia diario por vendedor (ADR-0001) |
| `ocurrido_en` | ISO-8601 con zona | La tablet | El instante exacto. Transporte y auditoría |

**El servidor no re-deriva el día de trabajo del instante.** Si lo hiciera con
`date_trunc` en UTC, cada jornada quedaría partida en dos y el corte del día
daría números distintos según la hora a la que se capturó cada operación.

Lo único que el servidor hace con la zona horaria es una **comprobación de
cordura**: rechaza `fecha_operacion` más de **1 día** por delante de hoy en
`America/Tijuana`, para que un reloj de tablet mal puesto no meta operaciones en
el futuro. Un día de margen y no cero, porque una jornada puede cerrarse pasada
la medianoche y la tablet no tiene NTP garantizado en ruta. **No hay límite
hacia atrás**: una tablet que estuvo dos semanas sin WiFi tiene que poder subir
esas dos semanas.

Los cursores del `pull`, en cambio, son **instantes UTC**: eso es transporte, no
negocio, y ahí UTC es exactamente lo correcto.

---

## 5. `GET /sync/pull`

### Petición

```
GET /sync/pull?contrato=1&desde=2026-08-07T14:59:55.000Z&sucursal=TJ
Authorization: Bearer <access token de vendedor>
```

| Parámetro | Oblig. | Qué es |
|---|---|---|
| `contrato` | sí | Versión que habla la tablet |
| `desde` | no | El `cursor` del pull anterior. **Ausente = volcado completo** |
| `sucursal` | no | Código que *propone* el cliente. Manda el servidor (§2) |

Un `desde` ilegible es **400**, no un volcado completo silencioso: tratarlo como
completo escondería un bug del cliente detrás de una sincronización lenta que
nadie relacionaría con nada.

### Respuesta `200`

```jsonc
{
  "contrato": 1,
  "servidor_en": "2026-08-07T21:00:00.000Z",   // reloj del servidor
  "desde": "2026-08-07T14:59:55.000Z",          // eco (null = completo)
  "completo": false,
  "cursor": "2026-08-07T20:59:55.000Z",         // el `desde` del próximo pull
  "vendedor":  { "id": "…", "login": "aperez", "nombre": "Abraham Pérez",
                  "folio_segmento": "AP" },
  "sucursal":  { "id": "…", "codigo": "TJ", "nombre": "Tijuana" },
  "catalogos": {
    "sucursales":     [{ "id": "…", "codigo": "TJ", "nombre": "Tijuana", "activo": 1 }],
    "vendedores":     [{ "id": "…", "login": "…", "nombre": "…", "sucursal_id": "…",
                         "folio_segmento": "AP", "activo": 1 }],
    "vehiculos":      [{ "id": "…", "nombre": "…", "sucursal_id": "…", "activo": 1 }],
    "productos":      [{ "id": "…", "nombre": "Jamaica", "activo": 1 }],
    "presentaciones": [{ "id": "…", "producto_id": "…", "volumen": "1 L", "activo": 1 }],
    "clientes":       [{ "id": "…", "nombre": "…", "domicilio": "…", "telefono": "…",
                         "encargado": null, "tipo": "cliente", "pct_comision": 3.5,
                         "promocion": "10+1", "plazo_credito_dias": 7,
                         "lat": 32.5149, "lng": -117.0382, "sucursal_id": "…",
                         "saldo_favor_centavos": 0, "activo": 1 }],
    "tipos_negocio":  [{ "id": "…", "nombre": "Abarrotes", "activo": 1 }],
    "precios":        [{ "id": "<clienteId>:<presentacionId>", "cliente_id": "…",
                         "presentacion_id": "…", "precio_centavos": 800,
                         "vigente_desde": "2026-02-01", "activo": 1 }]
  },
  "notas_pendientes": [{ "id": "…", "folio": "TJ260801AP01", "num_nota": "1234",
                          "fecha": "2026-08-01", "cliente_id": "…", "status": "abonado",
                          "monto_total_centavos": 25000, "saldo_centavos": 15000,
                          "abonos": [{ "fecha_pago": "2026-08-03", "monto_centavos": 10000,
                                       "metodo_pago": "efectivo" }],
                          "activo": 1 }]
}
```

### `domicilio` puede venir `null` en un prospecto (T-40)

Un **prospecto que dio de alta un vendedor desde la app** no trae domicilio: el
cliente dictó que lo que se captura es la **ubicación** (`lat`/`lng`), no la
dirección — el vendedor está parado enfrente del negocio, al sol, con una
tablet en la mano. En Postgres la columna se relajó y la obligatoriedad se
conserva solo para `tipo = 'cliente'`
(`ck_cliente_domicilio_obligatorio`). Lo mismo con `lista_precio_id`, que no
viaja en el `pull`: el precio es del administrador a propósito.

> [!warning] Es un cambio de significado y aun así NO subió la versión
> El §3 dice que cambiar el significado de un valor sube `CONTRATO_ACTUAL`. Aquí
> se decidió no subirla, y el motivo es que **subirla no protegería a nadie**:
> `CONTRATO_MINIMO` seguiría en 1, así que una tablet vieja se seguiría
> atendiendo y seguiría recibiendo el `null`. Lo único que la protegería es
> subir `CONTRATO_MINIMO`, y eso es dejar sin servicio a tablets en la calle por
> una rotura que **hoy no puede ocurrir**: la app no se ha publicado nunca y las
> dos mitades salen del mismo monorepo. Es el mismo criterio con el que
> `folio_segmento` (T-14) y el folio obligatorio de la venta (T-16) tampoco la
> subieron.
>
> **Al publicar la primera tablet hay que revisarlo.** Donde toca resolverlo de
> verdad es en **T-43** (versión por fila).

La base local de la tablet relajó la misma columna (migración local
`005-prospecto-campos-opcionales`). Sin eso, el `insert` del snapshot fallaría
y, como se aplica todo en una transacción, **la tablet dejaría de sincronizar
del todo** — y le pasaría a un compañero de sucursal que no dio de alta nada.

### `tipos_negocio`: el catálogo del desplegable de prospectos (T-40)

Colección **nueva** y por tanto aditiva (§3). Baja completa (no por sucursal:
`tipo_negocio` no tiene sucursal) e incremental por `updated_at` como los demás
catálogos, con la baja como `activo: 0`. Es el desplegable *Tipo de negocio* de
la pantalla de prospectos; sin ella la tablet no tendría de dónde sacar la lista
y tendría que dejar que el vendedor escribiera texto libre, que es exactamente
lo que T-12 evitó al resolverlo con un catálogo.

Una tablet vieja la ignora y sigue funcionando: es lo que el §3 pide de un
cambio aditivo.

### La baja viaja como bandera, nunca como ausencia

Es la **política de purga** que quedó abierta en T-04 (ADR-0004).

La tablet aplica el snapshot con **upsert, no con reemplazo**: borrar y
reinsertar revienta la llave foránea cuando el vendedor ya abrió el día — que es
exactamente el momento del refresco de media mañana. Con upsert, una fila que
desapareciera del snapshot se quedaría en la tablet para siempre.

Como el portal **nunca borra físico** (`deleted_at`), dar de baja es un `update`
y el trigger `set_updated_at` la hace aparecer en el pull incremental con
`activo: 0`. La tablet la refleja y deja de ofrecerla, **sin borrar** filas que
su operación local todavía referencie.

`activo` combina `deleted_at is null` con la columna `activo`/`activa` de la
entidad, donde exista.

### El cursor va unos segundos por detrás del reloj del servidor

Una transacción que ya fijó su `updated_at` pero **todavía no había hecho
commit** no es visible en la lectura del pull. Con un cursor exactamente igual a
`now()`, esa fila quedaría para siempre por debajo del corte y no se
descargaría nunca. Con el retraso (5 s) vuelve a caer dentro de la siguiente
ventana. **El solape es inofensivo** porque la tablet aplica upsert.

> T-43 sustituirá esto por una versión por fila.

### Los precios llegan ya resueltos

El portal maneja listas historizadas por sucursal más un override por cliente
(`10-Dominio/Reglas/Lista de precios.md`). El `pull` **resuelve la fórmula** y
manda el precio efectivo por cliente y presentación: la tablet no resuelve
listas en campo.

- `id` es **sintético** (`clienteId:presentacionId`). La fila de origen puede ser
  de `precio` —compartida por todos los clientes de esa lista— y usar su id
  colisionaría en la llave primaria de la tablet.
- La colección de precios es **completa o vacía, nunca parcial**. El precio
  efectivo depende de tres tablas (`precio`, `cliente_precio` y la lista asignada
  al cliente), así que un cursor por fila sobre el resultado del join se
  perdería cambios. Se manda todo si alguna de las tres se movió desde `desde`,
  y nada si ninguna lo hizo.

### Notas pendientes: saldo derivado, abonos y notas cerradas (T-20)

- **`saldo_centavos` es derivado:** `monto_total − Σ abonos vivos`, nunca negativo. La columna
  `cobranza_abono.saldo_pendiente` es una foto del saldo tras cada fila y no se lee como fuente.
- **`abonos`** trae los abonos vivos de la nota (`fecha_pago`, `monto_centavos`, `metodo_pago`),
  por fecha de pago, para mostrar los pagos previos al cobrar.
- **Con `desde`, bajan también las notas a crédito que dejaron de estar pendientes** (pagadas,
  canceladas, borradas) con `activo: 0`. Así la tablet deja de ofrecer una nota que liquidó otro
  dispositivo o el portal. Una nota cerrada viaja con `status` `abonado` si tiene abonos y
  `pendiente` si no: una tablet anterior a T-20 guarda esta tabla con un CHECK de esos dos valores
  y, con otro, perdería el pull entero.
- **`saldo_favor_centavos`** de cada cliente es la suma de sus movimientos vivos de saldo a favor.
  Un cobro que deja saldo a favor le toca `updated_at` al cliente, así que vuelve a bajar en el
  pull incremental (y con él, la colección de precios completa: es su regla de siempre).
- Los tres campos son **aditivos**: una tablet vieja los ignora.

---

## 6. `POST /sync/push`

### Petición

```jsonc
{
  "contrato": 1,
  "dispositivo": "tablet-tj-03",        // opcional, solo diagnóstico
  "sucursal": "TJ",                      // opcional; manda el servidor (§2)
  "operaciones": [
    {
      "clave": "9e0b…-4a1f",             // OBLIGATORIA. Ver idempotencia
      "tipo": "jornada",                  // jornada|venta|cobranza|gasto|merma|ruta|prospecto
      "fecha_operacion": "2026-08-07",   // día de trabajo (§4)
      "ocurrido_en": "2026-08-07T14:03:22.000-07:00",
      "cliente_id": "…",                  // opcional; se valida el alcance
      "vendedor_id": "…",                 // opcional; si no es el del token → 403
      "folio": "TJ260807AP01",           // opcional; T-14. La jornada no lleva
      "datos": { "km_inicial": 120345, "km_final": 120589 }
    }
  ]
}
```

Un lote tiene **dos topes, y manda el primero que se alcance**:

| Tope | Valor | Quién lo aplica |
|---|---|---|
| Operaciones por lote | **500** (`MAX_OPERACIONES_POR_LOTE`) | La tablet trocea; pasarse es `400` |
| Bytes del lote | **1 MB** (`MAX_BYTES_POR_LOTE`) | La tablet trocea; el servidor acepta hasta **5 MB** |

Un lote vacío es `400`. **La tablet trocea sola** (`trocearLotes` en
`src/sincronizacion/lotes.ts`): cierra el lote cuando la siguiente operación lo
haría pasar de 1 MB —sumando el JSON de cada operación en UTF-8— o de 500
operaciones. Una operación que ella sola pase de 1 MB **viaja sola en su lote**,
nunca se descarta.

El tope por cantidad no bastaba: 500 ventas pesan **218–754 kB** según cuántas
líneas traiga cada una, y el parser del servidor venía con el default de 100 kB.
El lote salía con `413` antes de llegar a la aplicación, el cliente lo leía como
"sin red" y reenviaba **exactamente el mismo lote** en cada sincronización, para
siempre y en silencio. Hoy el cliente distingue el `413` (motivo `lote-grande`,
que sí llega a la pantalla del vendedor) y el servidor acepta 5 MB, cinco veces
el tope de la tablet: **un `413` en producción es un bug de troceo, no un límite
de negocio**.

Un `cliente_id` que no sea un **uuid válido** se rechaza por operación, antes de
llegar a la base. No es cosmético: `where id in ('abc')` no devuelve cero filas,
hace que Postgres reviente con `invalid input syntax for type uuid`, y eso
saldría como **500 para todo el lote** — el todo-o-nada que este contrato promete
no hacer.

`datos` lo fija el ticket de cada módulo, y fijarlo es un cambio **aditivo** que
no sube la versión del contrato. Hoy tienen forma fija **`venta`** (T-16),
**`prospecto`** (T-40) y **`cobranza`** (T-20), los tres abajo; gastos, merma y
ruta siguen libres hasta T-27/T-33/T-39, y el servidor las guarda tal cual.

### `datos` de una venta (T-16)

```jsonc
{
  "clave": "uuid de la venta local",
  "tipo": "venta",
  "fecha_operacion": "2026-09-14",
  "ocurrido_en": "2026-09-14T11:32:05.000-07:00",
  "cliente_id": "uuid",              // obligatorio en venta
  "folio": "TJ260914AP03",           // obligatorio en venta
  "datos": {
    "num_nota": "2346",              // obligatorio, ≤ 30, se recorta
    "contado_credito": "credito",    // contado | credito
    "factura": "N/A",                // N/A | pendiente; la tablet siempre lo manda
    "comentarios": null,             // null si no hay; ≤ 500
    "lineas": [                      // 1..50, sin presentación repetida
      { "presentacion_id": "uuid", "cantidad": 24, "cantidad_promocion": 2, "precio_centavos": 1350 }
      // enteros ≥ 0; cantidad + cantidad_promocion > 0;
      // precio_centavos siempre presente, > 0 si cantidad > 0 (0 solo en líneas de pura promoción)
    ]
  }
}
```

- `cliente_id` y `folio` viajan **en el sobre**, no dentro de `datos`, y en una venta son
  **obligatorios**: sin cualquiera de los dos → `datos-invalidos`.
- **Robustez del servidor.** Si faltara `factura` la toma como `N/A`, y si faltara `comentarios`,
  como `null`. El contrato, sin embargo, los exige: la tablet siempre los manda.
- **No hay monto ni status.** El servidor calcula `monto_total = Σ (cantidad × precio_centavos)`
  (las piezas de promoción no suman) y decide el status: contado → `pagada`, crédito →
  `pendiente`, monto 0 → `promocion`. `semana` (ISO-8601) y `mes` salen de `fecha_operacion`
  **tal cual llegó**, nunca de `ocurrido_en`.
- **Vale el precio de la nota firmada.** El servidor guarda el `precio_centavos` que manda la
  tablet y **no lo compara** con su catálogo. Solo comprueba que la presentación se venda
  (`presentacion-inactiva`) y que el cliente tenga **algún** precio vigente para ella cuando la
  línea lleva cantidad (`precio-no-asignado`). Una línea de pura promoción no exige precio de lista: manda `precio_centavos: 0`.
  Esa comprobación cuenta los precios vigentes en `fecha_operacion` **y los asignados después,
  hasta hoy**: el portal da de alta los precios con vigencia desde hoy, así que asignar el precio
  en el portal y volver a sincronizar recupera una venta de un día anterior. La fecha de la venta,
  su `semana`, su `mes` y su folio no cambian.
- Cada venta se aplica en **su propia transacción** junto con su fila del buzón: si se rechaza,
  no queda ni la venta ni la operación (§7).

### `tipo: "prospecto"` — el alta de un prospecto (T-40)

Es el **único** tipo que crea una fila de *catálogo* (`cliente` con
`tipo = 'prospecto'`) en vez de una de operación. La proyecta
`cartera-clientes/ClientesService.crearProspecto` (ADR-0009 §2.1).

```jsonc
{
  "clave": "7f2c…-91ab",
  "tipo": "prospecto",
  "fecha_operacion": "2026-09-14",
  "ocurrido_en": "2026-09-14T11:03:22.000-07:00",
  // NO lleva `cliente_id` (lo está creando) ni `folio` (no es una nota firmada)
  "datos": {
    "nombre": "Tacos Aarón",          // nombre del negocio. Obligatorio
    "telefono": "6641112233",          // obligatorio
    "encargado": "Don Aarón",          // o null
    "tipo_negocio_id": "…",            // del catálogo `tipos_negocio`, o null
    "comentarios": "Quiere probar jamaica",  // o null
    "lat": 32.514900, "lng": -117.038200,    // las dos o las dos null
    "foto": null                       // reservado, siempre null por ahora
  }
}
```

Los campos son los que **dictó el cliente** en agosto de 2026 (ver
`10-Dominio/Entidades/Cliente.md` en el vault). Lo que **no** viaja:

- **`domicilio`**: no se captura. Lo sustituye la ubicación, y en Postgres la
  columna dejó de ser obligatoria para un prospecto.
- **`lista_precio_id`, `pct_comision`, `promocion`, `plazo_credito_dias`**: son
  decisiones del administrador. El vendedor no puede dar de alta clientes
  justamente porque el control del precio no es suyo (cambio v2.0).

Tres reglas que se rechazan **por operación**, todas como `datos-invalidos`:

| Qué llega | Por qué se rechaza |
|---|---|
| Un `folio` | `sync_operacion.folio` tiene un `unique` **global**: un folio pegado a un prospecto consumiría un número del espacio de las ventas, y una venta legítima con ese número se rechazaría después como `folio-duplicado` — un fallo que aparece en otra operación, días después |
| Un `cliente_id` | El prospecto **es** el cliente que se está creando |
| Media coordenada | No ubica nada y en el portal se vería como un punto en el meridiano cero: parece un dato bueno |

**Sin ubicación es un caso normal**, no un error: el vendedor pudo negar el
permiso o no haber señal, y eso no le impide registrar al prospecto.

> [!info] La foto está diferida, y el campo ya viaja
> El cliente la quiere (2026-08-23) *"si esto no se hace lento"*. Falta decidir
> **dónde se guarda el archivo** — el candidato es Supabase Storage, y el alcance
> de Supabase es justo lo que `ADR-0002` dejó abierto. `foto: null` viaja ya para
> que ese ticket no tenga que cambiar el sobre ni la versión del contrato; el
> servidor lo ignora. Ver `10-Dominio/Modulos/T-40 Registro de Prospectos.md`.

> [!success] Con esto se cumple la notificación **Prospectos** (T-56), por dato
> La notificación del portal muestra, los lunes, **qué vendedor registró qué
> prospecto el día anterior**. Al proyectarse, el prospecto queda en `cliente`
> con `tipo = 'prospecto'` y su fila del buzón queda con
> `entidad_tabla = 'cliente'` / `entidad_id`, `vendedor_id` y
> `fecha_operacion`. **Es `sync_operacion.fecha_operacion` y no
> `cliente.created_at`** lo que la notificación tiene que usar: `created_at` es
> cuando el servidor lo *recibió*, y un prospecto capturado el sábado que
> sincroniza el lunes tendría `created_at` del lunes — justo el caso del fin de
> semana que esa notificación describe. T-56 no se construye aquí.

### `datos` de una cobranza (T-20)

```jsonc
{
  "clave": "uuid del cobro local",
  "tipo": "cobranza",
  "fecha_operacion": "2026-09-14",
  "ocurrido_en": "2026-09-14T12:10:00.000-07:00",
  "cliente_id": "uuid",              // obligatorio en cobranza
  "folio": "TJ260914AP04",           // obligatorio en cobranza; mismo contador del día que la venta
  "datos": {
    "venta_nota_id": "uuid",         // la nota que eligió el vendedor (id del pull)
    "monto_centavos": 15000,         // entero, 1..999999999999; puede pasar del saldo
    "metodo_pago": "efectivo",       // efectivo | transferencia | cheque
    "fecha_pago": "2026-09-12"       // AAAA-MM-DD, no posterior a fecha_operacion
  }
}
```

- `cliente_id` y `folio` viajan **en el sobre** y son **obligatorios**: sin cualquiera de los dos →
  `datos-invalidos`.
- **El servidor reparte el pago**, en este orden: la nota elegida hasta su saldo; si sobra, las
  **otras notas pendientes/abonadas del mismo cliente, de la más vieja a la más nueva** (`fecha` y
  luego `folio`); lo que aún sobre queda como **saldo a favor** del cliente. Cada nota que recibe
  dinero gana una fila en `cobranza_abono` con el mismo folio; queda `pagada` si su saldo llega a 0
  y `abonado` si no.
- **El saldo es derivado**: `monto_total − Σ abonos vivos`, calculado por el servidor al proyectar.
- **Una nota ya pagada, cancelada o borrada no rechaza el cobro**: su saldo aplicable es 0 y todo el
  monto pasa a las otras notas y al saldo a favor. El dinero sí se cobró.
- El único rechazo del dominio es **`nota-no-encontrada`**: la nota no existe, su cliente no es de
  la sucursal del vendedor, o no es del `cliente_id` del sobre.
- `fecha_pago` es informativa: el corte cuenta el cobro en `fecha_operacion`.
- Cada cobranza se aplica en **su propia transacción** junto con su fila del buzón (§7).

### Respuesta `200` — parcial y honesta

```jsonc
{
  "contrato": 1,
  "recibido_en": "2026-08-07T21:00:01.000Z",
  "resumen": { "recibidas": 50, "aplicadas": 47, "duplicadas": 0, "rechazadas": 3 },
  "resultados": [
    { "clave": "…", "tipo": "jornada", "estado": "aplicada",  "id_servidor": "uuid" },
    { "clave": "…", "tipo": "venta",   "estado": "duplicada", "id_servidor": "uuid" },
    { "clave": "…", "tipo": "venta",   "estado": "rechazada",
      "codigo": "cliente-fuera-de-alcance", "motivo": "El cliente … no es de tu sucursal." }
  ]
}
```

- **`200` aunque haya rechazos.** El estado HTTP habla del lote (*lo recibí y lo
  procesé*); el detalle por operación va en el cuerpo. Un `4xx` obligaría a la
  tablet a adivinar si reintenta el lote entero, que es como se duplican
  operaciones.
- **`resultados` va en el orden del lote**, posición a posición.
- Nada de todo-o-nada silencioso ni de éxito falso: si 3 de 50 fallan, entran
  las 47 y la respuesta nombra las 3 con su motivo.

### Códigos de rechazo

Son un enum cerrado a propósito: la tablet tiene que poder decidir **sin leer
texto en español** si reintenta o si avisa al vendedor.

| `codigo` | Qué pasó |
|---|---|
| `tipo-desconocido` | El servidor no conoce ese `tipo` (la tablet es más nueva) |
| `clave-invalida` | `clave` ausente, vacía o de más de 100 caracteres |
| `clave-repetida-en-el-lote` | Dos operaciones del mismo envío traen la misma clave |
| `fecha-invalida` | `fecha_operacion` no es `AAAA-MM-DD` |
| `fecha-futura` | `fecha_operacion` más de 1 día por delante (§4) |
| `momento-invalido` | `ocurrido_en` no es ISO-8601 |
| `datos-invalidos` | `datos` no cumple la forma de su tipo (o la operación entera no es un objeto). En una venta, el `motivo` nombra el campo (`lineas[2].cantidad: …`). Es un bug de la tablet |
| `cliente-fuera-de-alcance` | El `cliente_id` no existe, no es de su sucursal, o no es un uuid válido |
| `folio-invalido` | El `folio` no tiene el formato de ADR-0001, o contradice a su propia operación (dice otra sucursal, otra fecha u otro vendedor) |
| `folio-duplicado` | **Colisión de folios**: otra operación ya subió ese folio |
| `presentacion-inactiva` | Una línea de venta nombra una presentación que no existe, está dada de baja o cuyo producto está inactivo. Se reintenta en la siguiente sincronización (T-16) |
| `precio-no-asignado` | Una línea con cantidad > 0 y el cliente no tiene **ningún** precio para esa presentación vigente a `fecha_operacion` ni asignado después, hasta hoy. Comprueba existencia, nunca valor. Se recupera cuando el portal asigna el precio y la tablet vuelve a sincronizar (T-16) |
| `tipo-negocio-inexistente` | El `tipo_negocio_id` de un alta de `prospecto` no existe o está dado de baja (T-40). **No es un bug de la tablet**: su catálogo se quedó viejo. Se reintenta solo en la siguiente sincronización, que además le baja el catálogo nuevo |
| `nota-no-encontrada` | La nota que se cobra no existe, su cliente no es de la sucursal del vendedor, o no es del `cliente_id` del sobre. Una nota ya pagada o cancelada **no** cae aquí: el cobro se acepta y va a otras notas o a saldo a favor. La tablet la reenvía en cada sincronización (T-20) |

`clave-repetida-en-el-lote` no se resuelve como `duplicada`: un duplicado dentro
de un mismo envío no es un reintento, es un bug del cliente, y llamarlo
duplicada lo escondería.

---

## 7. Idempotencia

> **Reenviar el mismo lote no duplica operaciones.**
> La WiFi del negocio se cae a media subida y la tablet reintenta. Cobrar dos
> veces sería el peor fallo posible de este sistema.

### La clave

`clave` es el **`id` local de la fila en SQLite**: un uuid v4 generado en la
tablet **al capturar** la operación. No cambia nunca — ni entre reintentos, ni
entre versiones de la app.

La regla vive en un `unique (vendedor_id, clave_idempotencia)` de la tabla
`sync_operacion`, **no** en una comprobación del servicio: entre el `SELECT` y el
`INSERT` de esa comprobación cabe el segundo reintento del mismo lote, que es
exactamente lo que hay que evitar.

El unique es **por vendedor**: dos tablets no comparten espacio de nombres, así
que una no puede bloquear las operaciones de otra.

### Qué devuelve un reenvío

`estado: "duplicada"` y **el mismo `id_servidor`** que devolvió el primer envío.
La tablet lo trata como éxito: si lo tratara como error, reintentaría esa
operación para siempre.

### Una operación rechazada NO deja fila

Y por tanto **no consume su clave**. Si la consumiera, esa fila local quedaría
rechazada para siempre y el vendedor no podría reenviar una versión corregida.
El rechazo se recalcula en cada intento: es determinista y no necesita memoria.

### Una transacción por operación (T-16, ADR-0009)

Cuando un `tipo` tiene un módulo de dominio que lo proyecta (hoy solo `venta`),
cada operación del lote se aplica **en su propia transacción**:

1. `INSERT` en `sync_operacion` con `on conflict (vendedor_id, clave_idempotencia) do nothing`.
   Si no insertó, es `duplicada` y **no se vuelve a proyectar**.
2. El módulo dueño escribe sus tablas (`VentasService.registrarVenta` → `venta_nota` +
   `venta_nota_detalle`) y el buzón anota `entidad_tabla` / `entidad_id`.
3. `commit` → `aplicada`. Si el dominio rechaza (`presentacion-inactiva`,
   `precio-no-asignado`), `rollback`: no queda **ni** la venta **ni** la fila del buzón.

Los tipos sin módulo todavía (`jornada`, `cobranza`, `gasto`, `merma`, `ruta`) se
guardan en el buzón y quedan `aplicada` con `entidad_id` nulo, como hasta ahora.
Las operaciones se aplican **en el orden del lote**, y un error inesperado a mitad
de lote deja comprometidas las anteriores (cada una tuvo su `commit`): el reintento
de la tablet las recibe como `duplicada`.

Si Postgres elige víctima de un deadlock (`40P01`) o de una serialización (`40001`)
a la transacción de una operación, `push` la reintenta desde el principio hasta
**3 intentos en total** (`reintentarAnteConflicto`, `apps/backend/src/modules/sincronizacion/reintento.ts`,
con `esConflictoDeConcurrencia` en `database/errores-postgres.ts`); el perdedor de dos
reintentos simultáneos del mismo lote ya ve la fila confirmada y cae en
`on conflict do nothing` → `duplicada`.

> [!danger] La colisión de folio se clasifica DESPUÉS del rollback
> Un `unique_violation` aborta la transacción entera de Postgres: cualquier consulta
> posterior con esa misma transacción falla. Por eso el desempate (¿ya existe esa
> `clave` para el vendedor? → `duplicada`; si no → `folio-duplicado`) corre **fuera**
> de la transacción, con la conexión normal.

### Cómo convive con el folio (T-14, implementado)

> [!warning] Esto corrige lo que T-07 había escrito aquí
> T-07 anticipó que *"el folio se emitirá **al proyectar**… lo pone el
> **servidor**"*. **Es incorrecto y ADR-0001 manda.** Ese ADR **descarta
> explícitamente** generar el folio en el servidor (su opción 3): la tablet
> opera sin red toda la jornada y el folio se escribe en la **nota física que el
> cliente firma**, en campo — no puede esperar a la sincronización.
>
> T-07 acertó en la **capa** y erró en el **emisor**. Ver el ADR-0007 del vault.

**El folio lo emite la tablet, offline.** Viaja en el push como campo
**opcional** (`folio`), y el servidor no lo emite: lo **valida** y lo defiende.

1. `sync_operacion` sigue siendo el buzón de entrada, con su clave del cliente.
2. La tablet emite el folio al **capturar** la operación, con su contador local
   por vendedor + sucursal + día (`apps/tablet/src/datos/repositorios/folios.ts`).
3. El servidor lo comprueba en dos capas, y las dos hacen falta:
   - **Coherencia** — el folio repite la sucursal, el día y el vendedor, datos
     que el servidor ya conoce por su cuenta. Si no coinciden → `folio-invalido`.
   - **Colisión** — un `unique` **global** sobre `sync_operacion.folio`. Si otra
     operación ya lo usó → `folio-duplicado`, rechazo **por operación**.
4. Al proyectar, el folio se **copia** a `venta_nota.folio` (que ya nació
   `unique` en T-05). **No se re-emite.** Implementado en T-16 para `venta`
   (T-20 hará lo mismo con `cobranza`): un reenvío no vuelve a proyectar y
   devuelve el mismo `id_servidor`, y el buzón guarda en `entidad_tabla` /
   `entidad_id` a qué fila de negocio se convirtió la operación.

Lo que T-07 dejó bien y sigue en pie: la clave y el folio viven en **capas
distintas**. La clave identifica el *transporte* y no cambia entre reintentos;
el folio identifica el *hecho de negocio* y solo se emite una vez.

> [!danger] Ojo al desempatar el `23505`
> Un reenvío legítimo trae la **misma clave Y el mismo folio**, así que choca
> contra los dos uniques. Se mira **primero la clave**: si esa fila ya existe es
> `duplicada`, no colisión. Traducir cualquier `23505` a `folio-duplicado`
> dejaría los reintentos normales (la WiFi que se cae a media subida) marcados
> en error y la tablet los repetiría para siempre.

### El segmento de vendedor lo asigna el servidor

El 5º segmento del folio son las **iniciales del vendedor**, y el `pull` las
manda en `vendedor.folio_segmento`. **La tablet no las deriva de `nombre`**
aunque podría: dos vendedores con las mismas iniciales producirían el mismo
folio, y la tablet **no puede detectarlo** porque de `vendedores` solo baja **su
propia ficha** — no ve a sus compañeros. Solo el servidor tiene la visibilidad
global.

> [!success] Implementado — enmienda de ADR-0007 (T-62, 2026-09-12)
> Cómo desambiguar iniciales repetidas lo confirmó el cliente: el alta se
> **rechaza** (no se cede a la siguiente combinación) si las iniciales ya
> están tomadas por otro vendedor de la misma sucursal. La colisión se
> evalúa **por sucursal**, no globalmente. Ver `ADR-0007` (enmienda
> 2026-09-12) y `10-Dominio/Entidades/Vendedor.md` en el vault.

Es un campo **aditivo**: no sube la versión del contrato. Un servidor que no lo
mande deja a la tablet sin poder foliar, pero no rompe nada de lo que ya
funcionaba — y la tablet lo dice en voz alta en vez de inventarse las iniciales.
**T-16 lo hizo obligatorio para `venta` sin subir `CONTRATO_ACTUAL`:** una venta
sin folio es `datos-invalidos` **por operación**, y una tablet vieja —que no
captura ventas— no se entera del cambio.

### Limitación conocida: el buzón es de solo escritura

Una operación se guarda una vez y un reenvío no la modifica. Eso es lo que hace
segura la idempotencia, pero significa que **no hay forma de actualizar una
operación ya recibida**. Consecuencias hoy:

- La tablet solo sube **jornadas cerradas**: subirlas al abrirlas congelaría el
  kilometraje inicial y el final no llegaría nunca.
- La sincronización intermedia de las 11:00/14:00 (**T-44**) va a querer subir
  la jornada abierta, y eso necesita que el contrato admita actualizar una
  operación — que es justo lo que **T-43** tiene que resolver: una versión por
  operación, no solo una clave.

---

## 8. Renovar la sesión es el primer paso

**No es un detalle de implementación.** Desde T-06 la tablet solo opera **72 h
sin hablar con el servidor** (ADR-0005), y ese contador se reinicia con cada
contacto exitoso. El motor llama a `gestor.renovar()` (`POST /auth/app/refresh`)
**antes** del pull y del push.

Si sincronizara sin renovar, el vendedor podría descargar su día perfectamente y
aun así quedarse fuera de su app al día siguiente, sin ninguna pista de por qué.
Ese mismo refresh es además **el único camino** por el que una baja hecha en el
portal llega a la tablet: si el servidor lo rechaza, la app borra sus
credenciales locales.

El **pull va antes que el push**: si la conexión se corta a la mitad, es
preferible haber refrescado los catálogos (el vendedor puede seguir trabajando)
que haber subido el día y quedarse con datos viejos. Y lo que no subió no se
pierde: sigue en la cola, y reenviarlo no duplica nada.

### Cuándo se dispara

| Momento | Quién |
|---|---|
| Tras un login **en línea** | Automático. No se espera su resultado: si el pull no sale, el vendedor entra igual y trabaja con lo que ya tiene |
| Botón *"Sincronizar ahora"* de la jornada | El vendedor |
| 11:00 / 14:00 hora de Tijuana | **T-44**, todavía no |

Un login **sin red** (re-autenticación local) no dispara nada: no hay con quién
sincronizar.

---

## 9. Qué NO está en este contrato

| Tema | Ticket |
|---|---|
| Resolución de conflictos (portal y tablet tocan lo mismo) | **T-43** |
| Sincronización automática 11:00/14:00 | **T-44** |
| Forma de `datos` para cobranza / gasto / merma / ruta (la de venta ya está, §6) | **T-20 / T-27 / T-33 / T-39** |
| Proyección de `cobranza`, `gasto`, `merma`, `ruta` y `jornada` a sus tablas de negocio (la de `venta` ya existe, §7) | Los mismos, y **T-38** para `jornada` |
| Permisos granulares en estos endpoints | **T-8** |

El envelope está diseñado para que todo eso **quepa encima sin romper la
versión 1**: los `tipo` nuevos y los campos nuevos dentro de `datos` son
cambios aditivos.
