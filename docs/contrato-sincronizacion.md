# Contrato de sincronización tablet ↔ servidor

**Versión del contrato: `1`** · Implementado en T-07 · Última revisión: 2026-08-07

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
  "vendedor":  { "id": "…", "login": "aperez", "nombre": "Abraham Pérez" },
  "sucursal":  { "id": "…", "codigo": "TJ", "nombre": "Tijuana" },
  "catalogos": {
    "sucursales":     [{ "id": "…", "codigo": "TJ", "nombre": "Tijuana", "activo": 1 }],
    "vendedores":     [{ "id": "…", "login": "…", "nombre": "…", "sucursal_id": "…", "activo": 1 }],
    "vehiculos":      [{ "id": "…", "nombre": "…", "sucursal_id": "…", "activo": 1 }],
    "productos":      [{ "id": "…", "nombre": "Jamaica", "activo": 1 }],
    "presentaciones": [{ "id": "…", "producto_id": "…", "volumen": "1 L", "activo": 1 }],
    "clientes":       [{ "id": "…", "nombre": "…", "domicilio": "…", "telefono": "…",
                         "encargado": null, "tipo": "cliente", "pct_comision": 3.5,
                         "promocion": "10+1", "plazo_credito_dias": 7,
                         "lat": 32.5149, "lng": -117.0382, "sucursal_id": "…", "activo": 1 }],
    "precios":        [{ "id": "<clienteId>:<presentacionId>", "cliente_id": "…",
                         "presentacion_id": "…", "precio_centavos": 800,
                         "vigente_desde": "2026-02-01", "activo": 1 }]
  },
  "notas_pendientes": [{ "id": "…", "folio": "TJ260801AP01", "num_nota": "1234",
                          "fecha": "2026-08-01", "cliente_id": "…", "status": "abonado",
                          "monto_total_centavos": 25000, "saldo_centavos": 15000,
                          "activo": 1 }]
}
```

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

### `saldo_centavos` — pendiente de confirmar

Sale del `saldo_pendiente` del **último abono** de la nota (y del monto total si
aún no tiene ninguno). `10-Dominio/Entidades/Cobranza-Abono.md` deja abierto si
ese saldo debería ser almacenado o derivado (`monto − Σ abonos`); **T-20 lo
cerrará**. Aquí se lee lo que hay, no se inventa un cálculo.

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
      "tipo": "jornada",                  // jornada|venta|cobranza|gasto|merma|ruta
      "fecha_operacion": "2026-08-07",   // día de trabajo (§4)
      "ocurrido_en": "2026-08-07T14:03:22.000-07:00",
      "cliente_id": "…",                  // opcional; se valida el alcance
      "vendedor_id": "…",                 // opcional; si no es el del token → 403
      "datos": { "km_inicial": 120345, "km_final": 120589 }
    }
  ]
}
```

Máximo **500 operaciones** por lote; pasarse es `400`. Un lote vacío también es
`400`. **La tablet trocea sola** en lotes de 500 (`motor.ts`): sin eso, un día
con muchas operaciones recibiría un 400 que el cliente traduce a "sin red", y
reintentaría ese lote para siempre en silencio.

Un `cliente_id` que no sea un **uuid válido** se rechaza por operación, antes de
llegar a la base. No es cosmético: `where id in ('abc')` no devuelve cero filas,
hace que Postgres reviente con `invalid input syntax for type uuid`, y eso
saldría como **500 para todo el lote** — el todo-o-nada que este contrato promete
no hacer.

`datos` es **libre en esta versión**. Ventas, cobranza, gastos, merma y ruta son
T-16/T-20/T-27/T-33/T-39 y todavía no existen: T-07 define por dónde viajan y
las guarda tal cual. Su forma la fijará el ticket de cada módulo, y eso es un
cambio **aditivo** que no sube la versión del contrato.

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
| `datos-invalidos` | `datos` no es un objeto (o la operación entera no lo es) |
| `cliente-fuera-de-alcance` | El `cliente_id` no existe, no es de su sucursal, o no es un uuid válido |

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

### Cómo convive con el folio cuando llegue T-14

Los folios (`10-Dominio/Reglas/Folios.md` y `ADR-0001` en el vault) los genera
T-14 y **todavía no existen**. Además, un folio es un identificador de
**negocio** que solo se puede emitir una vez, así que no sirve como clave de
reintento: emitirlo dos veces sería el bug, no la solución.

Cuando T-14 llegue:

1. `sync_operacion` seguirá siendo el buzón de entrada, con su clave del cliente.
2. El **folio se emitirá al proyectar** la operación a su tabla de negocio, una
   sola vez, y el id de la fila creada quedará en `sync_operacion.entidad_id`.
3. Un reenvío encuentra el unique, **no vuelve a proyectar** y devuelve el mismo
   `entidad_id` — y con él, el mismo folio.

Es decir: la clave del cliente y el folio conviven en **capas distintas**. La
clave identifica el *transporte*; el folio identifica el *hecho de negocio*. La
primera la pone la tablet y no cambia; el segundo lo pone el servidor y no se
repite.

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
| Folios | **T-14** |
| Forma de `datos` para venta / cobranza / gasto / merma / ruta | **T-16 / T-20 / T-27 / T-33 / T-39** |
| Proyección de `sync_operacion` a las tablas de negocio | Los mismos |
| Permisos granulares en estos endpoints | **T-8** |

El envelope está diseñado para que todo eso **quepa encima sin romper la
versión 1**: los `tipo` nuevos y los campos nuevos dentro de `datos` son
cambios aditivos.
