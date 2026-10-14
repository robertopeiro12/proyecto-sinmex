# T-75 · Camino en la app hasta el prospecto: venderle desde que se captura (spec)

**Fecha:** 2026-10-14 · **Estado:** aprobado en diálogo con Mario, pendiente de revisión del texto.
**Issue:** #126. **Depende de:** T-37 ✅, T-74 ✅ (PRs #125 y #130).
**Origen:** hallazgo de la aceptación de T-74: la bienvenida al prospecto está construida pero solo se alcanza por enlace directo. Mario amplió el alcance el 2026-10-14: el vendedor debe poder **venderle al prospecto en cuanto lo captura**, sin esperar a que suba y baje del servidor.
**Vault:** [[T-40 Registro de Prospectos]], [[Promociones]], [[Cliente]], [[Rutas]], [[App Tablet]]. Las notas se actualizan con este spec (ver "Memoria").

## Por qué cambia

Hoy un prospecto capturado en la app recorre este camino: la tablet guarda una fila en su tabla local `prospecto`; el push la sube; el servidor crea una fila en `cliente` con `tipo = 'prospecto'` **y otro id**; el pull la baja a la tabla local `cliente`. Hasta ese último paso no existe en la tablet un cliente al que colgarle una venta, y aun cuando baja, nada en la app lleva a su ficha:

- "Todos los clientes" filtra `tipo = 'cliente'` (T-16).
- "Prospectos de hoy" lista las filas locales de `prospecto` y no enlaza a nada.
- "Agregar a mi ruta" rechaza prospectos (T-37), y el servidor también (`cliente-inexistente`).

La ficha del prospecto, en cambio, **ya funciona**: muestra la bienvenida (T-74, D7), permite la venta de solo regalo y la visita. El servidor acepta esa venta: no distingue tipos al vender, admite una línea con 0 piezas cobradas y N regaladas, y rechaza piezas cobradas a $0. Lo que falta es el camino y el momento.

## Lo que NO cambia (principio que Mario pidió revisar)

**El vendedor no crea clientes; crea prospectos. Convertirlos sigue siendo un acto del administrador en el portal.** La tabla `cliente` guarda ambos tipos desde T-40, y "Convertir a cliente" actualiza **la misma fila** (`tipo = 'cliente'`, con domicilio y lista de precios ya capturados por la oficina); el id no cambia en la conversión y el sentido es uno solo. Este spec no toca el portal ni esa regla. Lo que cambia es *cuándo* existe el espejo local del prospecto y *qué id* lleva.

## Decisiones

**D1 · El prospecto nace como cliente local al guardarlo (tablet).** `prospectos.registrar()` inserta, en la misma transacción que la fila de `prospecto`, una fila en `cliente` con **el mismo id**: `tipo = 'prospecto'`, `nombre`, `telefono`, `encargado`, `domicilio = null`, `lat`/`lng`, `sucursal_id`, `activo = 1`, `primera_venta_en = null`, `pct_comision`/`plazo_credito_dias` nulos, `saldo_favor_centavos = 0`, `sincronizado_en = ahora`. Desde ese momento tiene ficha, bienvenida y venta de solo regalo, sin red. Sin precios (`cliente_precio` vacío): la pantalla de venta ya dice "no tiene precio para este cliente: solo puede ir como regalo". Cuando el pull baje la fila del servidor, el upsert la pisa por id sin duplicar.

**D2 · El servidor adopta el id de la tablet (backend).** `crearProspecto` inserta el `cliente` con `id = clave` de la operación. La clave de idempotencia es texto y `cliente.id` es `uuid`: `prepararProspecto` valida que la clave sea un UUID (misma `RE_UUID` de la venta) y si no lo es rechaza con `datos-invalidos` y motivo "la clave de un prospecto debe ser un uuid: es el id con el que la tablet ya lo registró". Si el `insert` choca con un id existente (23505), el rechazo es `datos-invalidos` con motivo que lo diga, nunca un 500. Un reenvío con la misma clave sigue cayendo en `duplicada` por el buzón, antes de llegar aquí. **Sin cambio en el cable ni en `CONTRATO_ACTUAL`**: la regla se documenta en `contrato.ts` y en `docs/contrato-sincronizacion.md` (§6, operación `prospecto`).

**D3 · Orden del push: prospectos antes que ventas.** El servidor comprueba el alcance de los clientes **una vez por lote**, antes de aplicar las operaciones: una venta al prospecto en el mismo lote que su alta sería rechazada con `cliente-fuera-de-alcance`. Las fuentes del push pasan de `jornadas → ventas → prospectos → cobranzas → rutas` a **`jornadas → prospectos → ventas → cobranzas → rutas`**. Cada fuente manda sus lotes en requests separados, así que el alta ya está aplicada cuando llega su venta. El comentario de `proveedor-sesion.tsx` que explica el orden se actualiza con esta razón.

**D4 · Alta rechazada: todo se reintenta solo.** Si el alta del prospecto es rechazada por `tipo-negocio-inexistente`, su venta cae por alcance y las dos quedan en `error`; se reintentan en la siguiente sincronización cuando el administrador arregle el catálogo, como hoy. La **ficha** del prospecto muestra la pastilla del alta (por subir / subiendo / subido / rechazado, con el motivo), leída de la fila local de `prospecto` con el mismo id, para que el vendedor entienda por qué su venta no sube. Un prospecto cuya fila `prospecto` no existe localmente (bajó de otra tablet) no muestra pastilla.

**D5 · El prospecto no entra a la ruta.** Se le atiende desde su ficha. "Agregar a mi ruta" sigue listando solo `tipo = 'cliente'` (`listarClientes` no cambia) y la tablet y el servidor siguen rechazando prospectos. Cuando la oficina lo convierta, la tablet lo baja como cliente, con precios, y entonces sí puede ir a la ruta y comprar con cobro.

**D6 · Caminos en la app.**
- **"Prospectos"** (alta): al guardar, la tarjeta "Listo" ofrece el botón **"Abrir su ficha"**; cada fila de "Prospectos de hoy" es tocable y abre `/(jornada)/operacion/[clienteId]` con `clienteId = prospecto.id`, **solo si** existe `cliente` local con ese id (`obtenerCliente(p.id) !== null`). Prospectos capturados antes de esta versión tienen id de servidor distinto: su fila se muestra como hoy, sin enlace, y se alcanzan por la pestaña Prospectos.
- **"Todos los clientes"**: dos pestañas, **Clientes | Prospectos**, con la misma ficha. La pestaña Prospectos usa una consulta nueva `listarProspectos(sucursalId)` (`tipo = 'prospecto' and activo = 1`, por nombre). La descripción de cada fila usa `primeraLineaDomicilio(cliente.domicilio)` en vez de `${cliente.domicilio}`, que hoy imprime "null" en un prospecto. El subtítulo cuenta lo que lista la pestaña activa.
- **Ficha de un prospecto**: botones **Vender** (destacado) y **Visita**; **sin Cobrar** (un prospecto no tiene notas) y sin "Merma, promoción, consumo y gasto" mientras siga siendo prospecto. La tarjeta de Promociones ya muestra la bienvenida (T-74); se añade la pastilla del alta (D4).

**D7 · "Atendidos fuera de ruta" en la ruta del día.** La pantalla principal de la jornada añade, después de "Fuera de ruta", la sección **"Atendidos fuera de ruta"**: los clientes y prospectos con **venta del día** grabada en esta tablet que no están en la ruta de hoy (ni viva ni dada de baja con visita). Cada fila: nombre, pastilla "prospecto" si lo es, y el estado de subida de sus ventas (misma regla que la ficha: error > pendiente > listo). Toca y abre la ficha. Función pura `atendidosFueraDeRuta(filasRuta, ventasDelDia, clientes)` en `ruta-del-dia.ts`, con pruebas. Consulta nueva `ventas.delDiaDelVendedor(vendedorId, fecha)`.

**D8 · El corte no depende de la ruta.** Una venta se atribuye al vendedor y a la fecha de operación, no a la parada. La venta al prospecto cuenta en las ventas y piezas regaladas del día, suma $0 y nada a la comisión, lleva folio y queda como nota en $0 pagada. **Efectividad de ruta** = clientes vendidos / clientes asignados: el prospecto no está asignado y no entra ni arriba ni abajo. Se anota en la vault ([[Rutas]], [[T-40 Registro de Prospectos]]); no hay código de corte que cambiar (T-33 pendiente).

**D9 · La foto se liga por id.** Con el id compartido, `fotoLocalDe` busca primero por `id` del prospecto y cae a nombre + teléfono solo para los prospectos de antes de esta versión. T-78 (#129) hereda el id estable; su ticket se anota.

**D10 · Sin migración local ni de servidor.** La tabla local `cliente` ya admite `domicilio` nulo (005) y `primera_venta_en` (012); `prospecto` no cambia. En el servidor no hay DDL: `cliente.id` ya es `uuid` y solo cambia quién lo elige.

## Flujo completo (aceptación)

1. Con jornada abierta y sin red, el vendedor captura un prospecto y pulsa "Guardar prospecto". La tarjeta "Listo" ofrece "Abrir su ficha"; la fila de "Prospectos de hoy" también la abre.
2. La ficha muestra la tarjeta de Promociones con la bienvenida ("En tu primera compra te regalamos …") y la pastilla "por subir" del alta. Botones: Vender y Visita; no hay Cobrar.
3. Pulsa Vender. La pantalla calcula los regalos de la bienvenida; cada línea solo admite piezas de regalo y lo dice. Confirma: folio, nota en $0, `venta_promocion` con la bienvenida.
4. De vuelta en la ficha, la bienvenida ya no aparece (hay venta local). En la pantalla de la jornada, el prospecto sale en "Atendidos fuera de ruta" con "por subir".
5. Sincroniza: sube primero el alta (el servidor crea el `cliente` con el id de la tablet), luego la venta (aplicada), luego la foto. El pull posterior baja el cliente con el mismo id y `primera_venta_en` puesto. La pastilla del alta dice "subido".
6. En "Todos los clientes" › Prospectos aparece; en Clientes no; "Agregar a mi ruta" no lo ofrece.
7. En el portal, el administrador le captura domicilio y lista de precios y lo convierte. Tras sincronizar, la tablet lo muestra en Clientes, con precios, y "Agregar a mi ruta" lo ofrece.
8. Caso de error: alta con tipo de negocio dado de baja → alta y venta en "rechazado"/error, con motivo visible en la ficha; al corregir el catálogo y sincronizar, ambas entran.
9. Prospecto capturado por **otra** tablet y bajado por pull: sale en la pestaña Prospectos, su ficha vende y no muestra pastilla de alta.

## Pruebas

- **Tablet (Jest, funciones puras y repositorios con SQLite en memoria):** `prospectos.registrar` crea el `cliente` gemelo con el mismo id y campos; `listarProspectos` excluye clientes e inactivos; `fotoLocalDe` por id y el fallback; `atendidosFueraDeRuta` (en ruta viva → fuera; baja con visita → fuera; venta a cliente sin ruta → dentro; prospecto → dentro con marca; orden por nombre); orden de fuentes del push (`proveedor-sesion` o el motor: prospectos antes que ventas); `delDiaDelVendedor`.
- **Backend (Jest unitario + e2e):** `prepararProspecto` rechaza clave no UUID; `crearProspecto` inserta con `id = clave`; e2e: push de `prospecto` + `venta` de solo regalo en **dos** lotes consecutivos → aplicadas, `cliente.id = clave`, `primera_venta_en` puesto; mismo lote → la venta cae por alcance (documenta D3); reenvío → `duplicada` sin segunda fila; clave repetida con cliente existente → `datos-invalidos`.
- **pgTAP:** no hay DDL; no se añade.
- **Aceptación manual en el emulador:** el flujo de arriba, con capturas.

## Riesgos y lo que cuesta si está mal

- **D2 (id adoptado).** Si otra tablet reenviara una clave ajena no pasa nada: la unicidad del buzón es por vendedor y el choque de `cliente.id` es rechazo con motivo. Costo si está mal: un prospecto que no entra y lo dice.
- **D3 (orden).** Si alguien vuelve a poner ventas antes que prospectos, la venta de bienvenida cae por alcance en la primera sincronización y entra en la segunda: molesto, no destructivo. La prueba del orden lo protege.
- **D1 (espejo local).** El pull pisa la fila local con la del servidor; si el portal edita nombre o teléfono antes de que la tablet sincronice, gana el portal, que es lo que pasa hoy con cualquier cliente.

## Fuera de alcance

- Prospecto en la ruta (D5). Si el negocio lo pide, es otro ticket: toca servidor, contrato y la tarjeta de ruta sin domicilio.
- Corte del día (T-33) y efectividad (T-46): solo se anota cómo cuenta el prospecto.
- Portal: sin cambios.
- Migrar los prospectos capturados antes de esta versión para que enlacen desde "Prospectos de hoy".

## Memoria

- Vault: [[T-40 Registro de Prospectos]] (camino completo, D1–D4, D8), [[Promociones]] (la bienvenida ya es alcanzable; enmienda a la nota de T-74), [[Rutas]] (D5, D7, D8), [[App Tablet]] (pestañas, sección nueva, orden del push), [[Cliente]] (id compartido, conversión misma fila), Estado del proyecto y bitácora.
- `CLAUDE.md` del repo: bloque T-75 (orden de fuentes, id adoptado, sin migración).
- `docs/contrato-sincronizacion.md`: §6 `prospecto`, regla del id; nota de D3.
- Issues: #126 (este), #129 T-78 (id estable).
