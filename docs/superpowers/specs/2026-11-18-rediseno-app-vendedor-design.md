# Rediseño de la app del vendedor — diseño

Fecha: 2026-11-18 · Tablet (casi todo), backend, portal y base de datos (piezas 3, 4, 6 y 7) · Pedido por Mario el
2026-11-17, con comentarios de revisión del 2026-11-18.

Maquetas de todas las pantallas (27, con datos de ejemplo):
`docs/superpowers/specs/2026-11-18-rediseno-app-vendedor/maquetas.html`. Se abre sola en el navegador. Los números de
pantalla que cita este documento (M1 a M27) son los de esa página. **Las maquetas mandan en acomodo y textos; este
documento manda en reglas.** Si se contradicen, gana este documento.

## 1. Para qué

La app ya hace casi todo lo que el vendedor necesita, pero pieza por pieza y pensada como formularios. Mario quiere una
app **intuitiva y sencilla**: el vendedor entra, ve su ruta, y todo lo que hace en el día está a uno o dos toques, con
el mismo orden en que lo vive: empieza la ruta, acepta su inventario, visita clientes, hace su corte.

Los vendedores la usan sobre todo en **celular Android**, al sol y con prisa. Todas las maquetas están dibujadas a
ancho de celular (el tramo "compacto" de `src/ui/responsivo.ts`, menos de 600dp); en tablet se ensancha con las reglas
que ya existen.

**No es una app nueva.** Se conserva lo que ya funciona por dentro: trabajo sin red y sincronización, catálogos,
precios desde el catálogo local, promociones calculadas por la app, folios, reparto de cobros entre notas, notas
asignadas con su condición, visita sin venta, prospectos, gastos. Cambia la experiencia encima, y se agregan las piezas
que hoy no existen (sección 13).

## 2. Metas, lo que no entra y lo que sería un fracaso

**Metas**
- Lo primero después de entrar es la ruta del día. Todo lo demás cuelga de un menú lateral.
- Vender es una lista y cantidades, nada más.
- Cada venta, cobro o abono termina en papel impreso.
- El corte lo hace el vendedor en la app, apartado por apartado.

**No entra** (queda anotado en la bóveda, nota *App Tablet*, "Pendientes para siguientes versiones")
- Que solo aparezcan los vehículos libres y que el elegido desaparezca para los demás (obligaría a empezar la ruta con
  internet).
- Avisar al encargado en el portal de las discrepancias del corte.
- Cerrar el corte en el servidor con lo que captura el vendedor: **la información del sistema es la que manda**, no la
  que el vendedor corrobora.
- Mapa de la ruta y GPS continuo (T-41). La entrada "Ruta y GPS" sale del menú.

**Sería un fracaso aunque funcione**
- Que vender le cueste al vendedor más toques o más búsqueda que hoy.
- Que aparezca en la lista de venta un producto que no trae.
- Emojis o símbolos de texto como iconos. **Todos los iconos son SVG.**
- Que se pierda una regla de negocio que hoy sí se cumple (precios, promociones, condición de la nota, folios).

## 3. Reglas generales

1. **Iconos SVG siempre.** Hoy `BotonIcono` y varios botones reciben un `glifo` de texto (☰ + ↻ × ✓ ← →). Se cambian por
   iconos SVG con `react-native-svg`, que ya está instalado. Ningún emoji en textos.
2. Se mantiene el sistema de diseño actual (`src/ui/tokens.ts`: papel cálido, tinta, naranja de señal, bordes en vez de
   sombras, alto contraste). No se agregan colores sin medir contraste.
3. Toda pantalla principal (las del menú) lleva arriba a la izquierda el botón de menú. Las pantallas de un flujo
   (vender, cobranza, merma) llevan "atrás".
4. Lo grabado no se edita ni se anula en la app, como hoy.

## 4. Entrar y empezar la ruta (M1, M2)

- Después del login aparece **Ruta**: los clientes del día en el orden que definió el portal. **El vendedor no puede
  cambiar el orden** (hoy sí puede arrastrar; se quita el arrastre y deja de usarse `ruta_orden_local`).
- Arriba de la lista, una tarjeta para **empezar ruta**: vehículo y kilometraje inicial. Sustituye a la pantalla
  aparte `abrir-dia`. **Por omisión viene elegido el vehículo que el portal asignó** a ese vendedor ese día
  (`ruta_dia.vehiculo_id`, que ya baja en el pull y hoy nadie lee); si no hay asignado, el primero de la sucursal como
  hoy. Puede cambiarlo.
- Mientras no empiece la ruta, los clientes se ven atenuados y no se pueden abrir.
- Cabecera de Ruta: a la izquierda menú; a la derecha **agregar cliente a la ruta** y **sincronizar** (con el globito
  de cuántos datos faltan por subir, como hoy).
- En la fila de cada cliente, del lado derecho, **un número con icono de nota: cuántas notas por cobrar trae el
  vendedor de ese cliente**. Son las notas asignadas de hoy que siguen con saldo, más las notas a crédito o con abono
  que él mismo generó hoy con ese cliente. Si es cero no se pinta nada.
- **Con vehículo pero sin inventario aceptado**: la tarjeta cambia a un aviso con el acceso directo "Ir a inventario",
  y los clientes siguen sin poder abrirse. *(Decisión de diseño: si la sucursal tiene apagado el control de
  inventario, este paso no aplica y los clientes se abren al empezar la ruta.)*

## 5. Menú lateral (M3)

Opciones, en este orden: **Ruta, Inventario, Sugerido de carga, Ventas / Cobranza, Merma / Cambios, Gastos, Corte,
Prospectos, Seleccionar impresora, Cerrar sesión.**

- **Corte** sale con candado y "faltan N clientes" mientras haya clientes por visitar.
- Después de las opciones, el **indicador de datos sin sincronizar**: cuántos faltan por subir y hace cuánto fue la
  última sincronización.
- Al final: **vendedor, vehículo** (cuando ya lo eligió) **y sucursal**.
- Salen del menú las entradas actuales "Todos los clientes", "Prospectos capturados", "Merma y consumo", "Ruta y GPS"
  y "Cerrar el día"; lo que hacían queda repartido en las opciones nuevas.
- **Sugerido de carga: pendiente de definir** (sección 14). Hasta entonces la opción abre la pantalla "pendiente" que
  ya existe (`pantalla-pendiente.tsx`).

## 6. Ruta en curso y acciones del cliente (M6, M7)

- Con ruta empezada e inventario aceptado, la lista se parte en **Por visitar** y **Visitados**.
- **La primera acción sobre un cliente lo manda a Visitados**: venta, visita sin venta, cobro, merma o cambio. (Hoy
  cuentan venta, cobro, visita y comentario de no cobro; se agregan merma y cambio del cliente.) En Visitados se ve
  debajo del nombre un resumen de lo hecho, y **el cliente se puede volver a abrir** y hacerle más acciones.
- Al tocar un cliente sube una hoja con: nombre, **encargado y su teléfono**, y el botón **Ir**, que abre Google Maps
  con la dirección ya puesta (`urlMapa`, que ya existe).
- Botones: **Vender**, **Visita** (la visita sin venta), **Merma y cambios**, y **Cobrar** cuando el cliente tiene
  nota por cobrar. *(Decisión de diseño: Cobrar aparece si el cliente tiene cualquier nota pendiente; si además hay
  asignada, el botón lo dice y se pinta como acción principal.)*
- **Condición de la nota**: si una nota asignada trae condición del portal (`liquidar` o `abonar`), **Vender sale
  apagado** con el motivo corto, hasta que se grabe el cobro que la cumple. Las reglas son las de
  `notas-asignadas-reglas.ts`; no cambian.
- **Visita sin venta no cambia**: se queda la pantalla actual.
- El resto de lo que hoy muestra la ficha del cliente (recado de la oficina, saldo a favor, promociones, foto) no se
  dibujó; se conserva debajo de los botones de la hoja o en un "ver más", a criterio de quien construye, sin estorbar
  los botones.

## 7. Inventario (M4, M5)

- **Aceptar una carga o recarga es un checklist de productos**: "Seleccionar todos" o uno por uno. El botón dice
  cuántos acepta ("Aceptar 6 de 8"); también hay "Rechazar todo".
- **Se puede aceptar todo, una parte o nada. No se pide motivo en ningún caso.** Lo no palomeado no entra al
  inventario del vendedor. Es por producto completo: no se captura "me dieron 40 de 48".
- El portal ve qué renglones aceptó y cuáles no; no hay aviso ni notificación.
- Sigue necesitando red, como hoy.
- Ya aceptado, la pantalla muestra el **resumen**: por producto, cargado, lo que salió y lo que le queda (la cuenta de
  `inventario-reglas.ts`). Las recargas llegan aquí mismo con un aviso arriba.

Esto cambia el modelo: hoy la respuesta es por carga completa y el rechazo exige motivo (`carga.estado`,
`ck_carga_motivo`, `reglas-carga.ts`, `CargasService.responder`; `carga_detalle` no tiene estado por renglón). Todo lo
que hoy cuenta "cargas aceptadas" (existencia para venta, corte de mercancía, rejilla de Recarga del portal) pasa a
contar **renglones aceptados**.

## 8. Vender (M8, M9, M10)

### Antes de la lista: Promociones (M8), primer paso al tocar Vender

En la app y en las pantallas se dice **promociones** / "piezas de promoción", nunca "regalos".

- Flujo: botón **Vender** del cliente → **Promociones** → lista de Vender → Cobranza.
- Sale **solo si el cliente tiene promociones** hoy (propias, generales no desplazadas y, si es prospecto sin primera
  venta, la de bienvenida; reglas T-74). Si no tiene, se va directo a la lista de Vender.
- Las promociones salen como **checklist**, cada una con su frase (`textoPromocion`), **todas palomeadas** de entrada,
  con "Seleccionar todas" arriba. Quitar la palomita quita la promoción (`descartados`); volver a palomearla la agrega.
- Solo se palomean o quitan las que le tocan al cliente: no se inventan otras ni se cambian cantidades.
- Si la promoción da un producto con varias presentaciones, **aquí elige cuál se entrega** (D16). *(Decisión de
  diseño: viene elegida la primera del catálogo; "Continuar a vender" no se apaga.)*
- **Continuar a vender** abre la lista. Al regresar desde Vender no se pierde lo que se quitó ni lo elegido.
- Las piezas de promoción salen del inventario del vendedor (cuentan contra "te quedan") y van en la nota en $0.00 con
  la frase de la promoción.

### La lista (M9, M10)

- **Una sola lista.** Cada renglón es un producto con su presentación ("Jamaica · 1 L"), en **orden alfabético**, con
  precio y "te quedan N". A la derecha, la cantidad.
- **Solo aparece lo que el vendedor tiene disponible** (existencia mayor a cero). Lo que se acaba desaparece. Nunca
  sale un renglón agotado. (Hoy salen todas las presentaciones activas del catálogo.)
- El vendedor desliza hacia abajo o hacia arriba y va poniendo cantidades. Los renglones con cantidad se pintan.
- *(Decisión de diseño)* Al tocar una cantidad sale un teclado propio de números grandes; "Siguiente" baja al renglón
  de abajo sin cerrar el teclado. No se puede capturar más de lo que le queda.
- Sin buscador, sin filtros, sin pasos intermedios. Se pidió expresamente que fuera así de simple.
- Abajo: piezas, cuántas van de promoción, total e **Ir a cobranza**. Las piezas de promoción las pone la app sola
  (`calcularRegalos`) con lo capturado y las promociones que quedaron en el paso Promociones.
- *(Decisión de diseño)* Con el control de inventario apagado en la sucursal no hay existencia que consultar: la lista
  muestra todas las presentaciones activas, sin "te quedan".

## 9. Cobranza de la venta e impresión (M11, M12)

La pantalla se llama **Cobranza** (no "Pago").

- Arriba, **la nota** de lo que se vende: renglones, promoción en cero y total.
- Abajo, el apartado **Cobranza** con tres opciones: **Liquidar**, **Abonar**, **Crédito**.
  - **Liquidar**: se pone solo el total de la nota. Es la venta de contado de hoy.
  - **Abonar**: el vendedor captura cuánto; debe ser mayor a cero y menor al total. El resto queda a crédito.
  - **Crédito**: no paga nada; toda la nota queda pendiente.
- **Nombre de quien atiende** (Mario, 2026-11-23): en **toda venta**, de contado o a crédito, el vendedor escribe el
  nombre de la persona que lo atendió. Es **obligatorio** y **se imprime en la nota**. Se guarda con la venta (hoy
  existe `firma_nombre`, opcional; pasa a obligatorio y se usa para esto).
- **Ya no se firma en la app.** Se quita la captura de firma en pantalla (T-73, `recuadro-firma.tsx`) de la venta. El
  cliente firma **a mano la nota impresa**, que trae el espacio para la firma.
- Con Abonar o Crédito el cliente gana una nota por cobrar: su contador en la ruta sube en uno.
- Un solo botón graba y manda a imprimir. No hay paso de revisión aparte: la nota de arriba es la revisión.
- El abono al vender no existe hoy (solo contado completo o crédito completo). *(Sugerencia, a criterio de quien
  construye: grabarlo como venta a crédito más un cobro a esa misma nota en la misma transacción, para reutilizar el
  reparto y la proyección que ya existen.)*

> **Implementado así (pieza 2).** Liquidar viene preseleccionado; el abono al vender se grabó como campo de la venta
> (`abono_centavos`, abono `venta_contado` en efectivo sin cobro), no como cobro aparte, para que la venta siga editable
> en el portal (plan de la pieza 2). `num_nota`, `factura` y `comentarios` salieron de la pantalla y viajan con su valor
> por omisión. `nombre de quien atiende` es `venta.atendio` (`venta_nota.atendio_nombre`).

## 10. Cobrar una nota pendiente (M13)

- Abre con **la nota asignada al frente**: folio, fecha, total, abonos anteriores con fecha, lo que debe, y su
  condición si la tiene.
- Mismas leyendas que en la venta: **Liquidar** (se pone solo lo que debe) y **Abonar** (captura cuánto). No hay
  "Crédito": la nota ya es un crédito.
- Botón **Otras notas pendientes** con su número: abre las demás notas del cliente, asignadas o no, para cobrarlas
  igual. (El vendedor ya puede cobrar notas no asignadas; no cambia.)
- **No se firma en la app**: el cliente firma a mano la nota impresa.
- Al grabar, **se reimprime la nota** con su estado (sección 12).

Esto **sustituye** un punto de la spec `2026-11-13-notas-asignadas-tablet-condicion-venta-design.md`, que decía "sin
reimpresión de tickets al cobrar". Lo demás de esa spec sigue vigente (tampoco hay firma en pantalla al cobrar).

> **Implementado así (pieza 2).** Cobrar conserva los chips Efectivo / Transferencia / Cheque (efectivo por omisión) y
> la fecha de pago es hoy; Abonar exige monto > 0 y menor a lo que debe; no pide quien atiende.

## 11. Merma y cambios, registros, gastos, clientes y prospectos

**Merma y cambios (M14).** Un solo botón en el cliente; dentro, dos apartados separados:
- **Merma**: producto dañado o caducado que devuelve el cliente. Se pierde. Es la `merma_cliente` de hoy.
- **Cambios**: producto **en buen estado** que el cliente cambia por otro. Lo que entrega el cliente **regresa al
  inventario del vendedor** y se puede volver a vender. No existe hoy: es un tipo de movimiento nuevo.
- En los dos se captura "Me entregó el cliente" y "Le entregué". Los productos se eligen de lo que el vendedor trae.
- **Motivo de merma** (Mario, 2026-11-19): toda merma lleva un motivo obligatorio, elegido de una lista **predefinida
  en el portal**. Aplica a la **merma de cliente** y a la **merma de inventario del vehículo** (`merma_trayecto`); los
  cambios y el consumo no llevan motivo. Catálogo, pull, captura y validación van en **T-81 (#162)**.
- La opción **Merma / Cambios** del menú (M15) es el registro del día de estos movimientos, con filtros Todo, Merma y
  Cambios, y arriba el botón **Merma del vehículo**.
- **Merma del vehículo (M16)**: lo que se daña en la camioneta, sin cliente (`merma_trayecto`). Motivo de la lista del
  portal (obligatorio), producto y piezas de lo que el vendedor trae, y comentario opcional. Funciona sin red.
- *(Decisión de diseño)* El **consumo** propio se sigue capturando desde Merma / Cambios, con un botón secundario
  junto a Merma del vehículo; no lleva motivo.

**Ventas / Cobranza (M17, M18).** Registro del día, lo más nuevo arriba: hora, cliente, tipo y monto.
- Abajo, cuatro filtros: **Todo, Ventas del día, Cobranza, Notas pendientes**.
- Al abrir un movimiento: qué vendió o cobró, cuánto, a quién, a qué hora, los datos de la nota y la lista de
  productos si fue venta. Solo lectura, con botón **Reimprimir**.
- No existe hoy una pantalla así. Falta además una consulta de cobros del día por vendedor (hoy solo hay por cliente).

**Gastos (M19).** Crear gasto es elegir el **motivo** y poner la **cantidad**. Se quitan de la pantalla las
observaciones y la foto del ticket (el servidor ya las acepta vacías). Abajo, los gastos del día.

**Agregar cliente a la ruta (M20).** El botón de la cabecera de Ruta abre la lista de **todos los clientes de la
sucursal** con buscador, para agregar uno a la ruta de hoy. Funciona **con y sin internet** (como `agregar-a-ruta`
hoy). El agregado entra al final de "Por visitar" y **cuenta para el corte**.

**Prospectos (M21).** La opción del menú es **solo para dar de alta prospectos** y ver los capturados. El vendedor no
da de alta clientes. Los campos del alta son los ya definidos y no cambian.

## 12. La nota impresa (M25, M26, M27)

La impresión **no existe hoy** (ni dependencia, ni código, ni pantalla de impresora). Es la pieza de más riesgo: hay
que probar con la impresora térmica real antes de comprometer el formato.

- **Blanco y negro**, papel térmico.
- El **folio** es el de siempre (regla *Folios* de la bóveda, ADR-0001 y ADR-0007): sucursal + año + mes + día + iniciales del
  vendedor + consecutivo del día, 12 caracteres, por ejemplo `TJ261118JP05`. Lo emite la tablet al grabar; no cambia.
- Arriba: nombre del negocio, sucursal, "NOTA DE VENTA", folio, fecha y hora, cliente, **atendió** (el nombre que se escribió en la
  app) y vendedor.
- En medio: cantidad, producto, precio unitario e importe; promoción en cero ("PROMO") con la frase de su promoción
  debajo (la frase congelada en `venta_promocion.texto`); piezas y total.
- Al final, el estado en grande: **LIQUIDADA** o **ABONADO**.
- Con saldo: la lista de **todos los abonos con su fecha** y el **saldo pendiente**, y abajo un **espacio en blanco con
  raya** para que el cliente firme a mano ("Firma de quien recibe").
- Venta a Crédito: igual que con abono, sin abonos listados y con todo el total como saldo. *(Decisión de diseño: la
  leyenda es "CRÉDITO".)*
- **Cada cobro o abono a una nota la reimprime completa** con el abono nuevo, la fecha de reimpresión y quién cobró.
  Viene de lo que respondió el cliente el 2026-11-10 (R-3.6 y R-3.7 en la bóveda).
- **Seleccionar impresora** (menú): elegir y recordar la impresora del vendedor. Si no hay impresora o falla, lo
  grabado **no se pierde**: se avisa y se puede reimprimir desde Ventas / Cobranza.

## 13. Corte (M22, M23, M24)

- **Solo se puede entrar cuando todos los clientes de la ruta están en Visitados**, incluidos los agregados. Un cliente
  que no compró se cierra con Visita.
- Arriba, el **resumen del día**: ventas, cobranza, gastos, clientes visitados.
- Abajo, tres apartados entre los que se mueve: **Efectivo, Notas, Inventario**. Cada uno se **cierra por separado** y
  queda palomeado.
  - **Efectivo**: ve lo que debe traer según el sistema (ventas de contado más abonos y cobros, menos gastos) y captura
    cuánto trae.
  - **Notas**: palomea cada nota física que trae (asignadas con saldo y las que generó hoy).
  - **Inventario**: cada producto viene con la cantidad del sistema, incluida la merma; confirma o corrige.
- El botón **Corte** se enciende cuando los tres están cerrados, y envía el corte.
- **Lo que captura el vendedor se guarda y se sube como dato informativo. No modifica saldos, existencias ni el corte
  de mercancía de la oficina.** Comparar y avisar discrepancias es trabajo futuro.
- *(Decisión de diseño)* Al enviar el corte se pide el **kilometraje final** y se cierra la jornada, que es lo que hoy
  hace "Cerrar el día".

No existe corte en la tablet hoy (`cerrar-dia.tsx` solo pide kilometraje final). En la oficina existe el corte de
mercancía (`/produccion/corte`), que no se toca.

## 14. Qué se reutiliza y qué es nuevo

| Parte | Hoy | Trabajo |
|---|---|---|
| Vehículo y kilometraje | Pantalla `abrir-dia`; el vehículo asignado baja pero no se lee | Mover a tarjeta en Ruta; preseleccionar el asignado |
| Ruta | `app/(jornada)/index.tsx`, orden arrastrable, otras secciones | Orden fijo; Por visitar / Visitados; contador; bloqueo sin inventario |
| Menú | `menu-lateral.tsx`, otras entradas | Entradas nuevas, pie con vendedor/vehículo/sucursal, indicador |
| Hoja del cliente | Ficha completa en pantalla | Hoja con encargado, teléfono, Ir y 3 o 4 botones |
| Inventario | Aceptar o rechazar carga completa, motivo obligatorio | **Aceptación por renglón sin motivo: BD, backend, portal y tablet** |
| Vender | Todas las presentaciones, 3 pasos, firma siempre | **Paso Promociones (checklist) antes de la lista**; lista de lo disponible; sin paso de revisión; **sin firma en pantalla** |
| Cobranza de la venta | Contado o crédito | **Abono al vender**; nombre de quien atiende obligatorio |
| Cobrar nota | `cobranza.tsx`, sin firma | Leyendas, reimpresión |
| Merma | `merma_cliente`, `merma_trayecto`, `consumo` | **Tipo nuevo "cambio"** que regresa a existencia: BD, backend, tablet |
| Registros | No hay pantalla única | **Nueva**, más consulta de cobros por vendedor |
| Gastos | Con observaciones y foto | Quitar campos |
| Prospectos / agregar a ruta | Existen | Reacomodo |
| Corte | No existe en tablet | **Nuevo**: pantalla, operación de sync y dónde guardarlo |
| Impresión | No existe | **Nueva**: prueba con impresora real, formato, selector |
| Iconos | Glifos de texto | SVG |

## 15. Orden sugerido de construcción

Son varias piezas que se pueden planear y entregar por separado; cada una con su propio plan y su PR.

1. **Cáscara**: iconos SVG, menú, Ruta (orden fijo, secciones, contador, empezar ruta), hoja del cliente, agregar a
   ruta y Prospectos, Gastos simplificado. Solo tablet.
2. **Vender y Cobranza**: paso Promociones (checklist para quitar y volver a poner, presentación del regalo), lista de venta, Liquidar / Abonar / Crédito, nombre de quien atiende, quitar la firma en pantalla, Cobrar con las mismas
   leyendas.
3. **Inventario por renglón**: BD, backend, portal y tablet.
4. **Merma y cambios**: el tipo "cambio" de punta a punta.
5. **Registros**: Ventas / Cobranza y Merma / Cambios.
6. **Corte** en la tablet.
7. **Impresión**: prueba con impresora real, las tres notas, reimpresión, Seleccionar impresora. Hasta que exista, los
   botones dicen "Grabar" y no "Grabar e imprimir".
8. **Sugerido de carga**, cuando se defina.

## 16. Pendiente de definir con Mario

- **Sugerido de carga de inventario**: se pidió la opción en el menú "como está en la memoria Obsidian", pero no hay
  nada con ese nombre ni parecido en la bóveda, las fuentes del cliente, el código o las specs. Falta saber qué hace.

## 16-bis. Aclaraciones tras la revisión del documento

Todas son **decisiones de diseño** (no las dictó Mario); se pueden tumbar en la revisión del documento.

**Inventario y candado de clientes**
- El candado de la ruta es solo **antes de la primera respuesta a una carga del día**. Con control de inventario
  prendido, los clientes siguen cerrados (también Cobrar y Visita) mientras el vendedor no tenga inventario aceptado:
  si la oficina aún no captura carga, el aviso dice "Aún no te cargan"; si rechazó todo, sigue cerrado hasta que
  acepte una carga.
- Una **recarga a media ruta no vuelve a cerrar a los clientes**: se comporta como hoy (aviso, y la venta se bloquea
  mientras esté pendiente, por `bloqueoDeVenta`).
- **La aceptación parcial es definitiva.** Los renglones no aceptados quedan como no aceptados; si la oficina quiere
  volver a mandarlos, captura una recarga nueva. El estado vive por renglón; la carga queda "respondida".

**Reimpresión**
- La reimpresión es **la nota completa**, con sus renglones (M27). Para notas que no se vendieron en ese equipo, el
  pull de notas pendientes (`NotaPendientePull`) debe traer renglones, precios, promoción y vendedor original, y el
  nombre de quien atendió.

**Cambios**
- Un cambio es libre: no se exige que lo entregado y lo recibido coincidan en piezas ni en valor, y **no se cobra ni
  se abona diferencia de precio**.
- "Me entregó el cliente" se elige de **todo el catálogo activo** (puede devolver algo que el vendedor ya no trae);
  "Le entregué" solo de lo que el vendedor tiene.
- El corte de mercancía de la oficina y el aviso de "vendió más de lo cargado" **deben contar los cambios** (lo
  recibido suma existencia, lo entregado resta). Es el único ajuste a ese corte, y entra en la pieza 4.

**Prospectos**
- Se conserva la venta al prospecto (T-75): tocar un prospecto capturado en M21 abre su hoja de acciones. Exige ruta
  empezada e inventario aceptado, como cualquier cliente. Un prospecto atendido **no** cuenta para el candado del corte.

**Registros**
- El filtro **Notas pendientes** de Ventas / Cobranza lista las notas que el vendedor trae: las asignadas de hoy que
  siguen con saldo y las que generó hoy con saldo. Es la misma cuenta que el número en la ruta.

## 17. Lo que queda a criterio de quien construye

- Nombres de componentes, rutas de archivos y cómo se parte cada pieza en tareas.
- El dibujo exacto de los iconos SVG.
- Animaciones de la hoja del cliente y del menú.
- Cómo se ensancha cada pantalla en tablet, con las reglas de `responsivo.ts`.
- La forma de guardar el abono al vender y el corte, mientras se cumplan las reglas de arriba y el contrato de
  sincronización se actualice (`docs/contrato-sincronizacion.md`).
