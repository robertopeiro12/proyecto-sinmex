# Ruta Semanal y Ruta Diaria (parte 1) — diseño

Fecha: 2026-11-10 · Portal (Roberto) + backend · La tablet es de Mario (sección 9).

## 1. Para qué

Cada mañana el jefe de ventas le asigna a cada vendedor una de las rutas fijas del día, la ajusta solo para ese día, le
pone el vehículo y le da las notas que debe cobrar. Hoy el portal nuevo no puede hacer nada de eso: la Ruta Semanal es un
"Pronto", la Ruta Diaria es una lista de clientes suelta (sin nombre de ruta, sin vehículo, sin recados) y no existe la
idea de "nota asignada". Es la pieza 6 del MVP.

**Regla de Roberto:** que el flujo **se parezca al del sistema viejo** y contenga **todo** lo que pidió el tío, sin sus
fallas (lento, recarga la página, la pestaña de clientes escondida, solo flecha hacia arriba).

Fuentes:
- Respuestas del tío: vault `90-Fuentes/Respuestas del cliente 2026-11-10 Rutas (fuente).md` (citadas abajo como R-1.1,
  R-3.4, etc., por el número de pregunta).
- Revisión en vivo del sistema viejo: vault `10-Dominio/Sistema viejo del cliente.md`, sección "Rutas Semanales y Ruta
  Diaria a detalle (revisión del 2026-11-10)".
- Decisiones de Roberto: vault `40-Equipo/Bitácora/2026-11-10.md`.

## 2. El flujo completo (para ubicar las partes)

1. **Ruta Semanal** (casi no cambia): rutas con nombre por día de la semana, cada una con su lista de clientes, **sin
   vendedor**.
2. **Cada mañana (o un día antes)**, en Ruta Diaria, el jefe de ventas:
   1. le escoge a cada vendedor una ruta del día (no se arma sola: los vendedores faltan mucho, R-2.1);
   2. ajusta esa ruta solo para ese día: agrega o quita clientes, ordena (↑ ↓) y deja recados (R-2.2, R-1.3);
   3. le asigna el vehículo (R-4.1);
   4. le asigna las notas que debe cobrar y le entrega los papeles (R-3.1).
3. **En la calle**, el vendedor ve su ruta en ese orden (sugerido, no obligatorio), cobra **solo** las notas asignadas y
   puede cambiar el vehículo (tablet, Mario).
4. **En la tarde**, el corte: Administración recibe el dinero y los papeles de las notas asignadas que no se cobraron y de
   las ventas a crédito del día (R-3.3). **Parte 2.**
5. **Al día siguiente**, el tío revisa en el Flujo diario las tres listas de notas. **Parte 2.**

Esta parte 1 cubre los pasos 1 y 2, lo que la tablet necesita recibir para el paso 3 y el nombre de la ruta en el
Dashboard y el Flujo diario.

## 3. Alcance

**Entra (parte 1):**
- Pantalla **Ruta Semanal** (nueva).
- Pantalla **Ruta Diaria** rehecha: lista de vendedores del día y la pantalla de un vendedor (ruta, clientes, orden,
  recados, vehículo).
- **Notas por cobrar**: asignar, quitar y pasar notas a un vendedor.
- Que un cambio en la Ruta Semanal llegue a las rutas del día ya armadas.
- Backend, migración y las colecciones nuevas del pull (aditivas) para que Mario las use.
- "Ruta asignada" con el **nombre de la ruta** en el Dashboard y el Flujo diario (lo pidió el tío, R-5.1).

**No entra (parte 2, otro diseño):**
- El corte: recibir los papeles de las notas asignadas no cobradas (lista con todo palomeado, se quita la palomita a lo
  que falta).
- En el Flujo diario, la columna "Notas de ventas" con las tres listas y sus nombres nuevos ("Notas Asignadas
  Cobradas", "Notas Asignadas NO cobradas por Entregar", "Notas Nuevas x Cobrar Entregadas") y "Notas de Ventas NO
  Entregadas".
- La notificación "Ruta Diaria" (cliente sin ningún día en la Ruta Semanal).
- El mapa de la ruta (T-41).

**Lo hace Mario en la tablet:** sección 9.

## 4. Ruta Semanal

*Operación → Ruta Semanal* (`/operacion/ruta-semanal`, hoy un `Placeholder` con `pronto: true`). Permiso
`ruta_semanal.gestionar` (ya existe en el catálogo).

**Lista (como el viejo):**
- Pestañas **Lunes a Sábado** (`Pestanas`). El tío confirmó "rutas fijas de lunes a sábado"; el viejo tiene Domingo y
  solo con una ruta de prueba. *Decisión del agente:* sin Domingo.
- Arriba "Crear ruta" (botón). **Sin "Buscar ruta"** (lo pidió quitar, R-5.1).
- Tabla: **Ruta** · **Clientes** (cuántos) · acciones **Editar** y **Eliminar**.
- Cada ruta es **de un solo día**: "RUTA 1 (OTAY)" del martes y la del jueves son rutas distintas, como en el viejo.
- Una ruta es de **una sucursal** (la del selector global; con "Todas" se pide elegir sucursal, `EstadoPantalla`).

**Crear:** una `Ventana` corta con solo el **Nombre** (como el viejo, "Día: Martes"). Nombre obligatorio, único entre
las rutas vivas del mismo día y sucursal (sin distinguir mayúsculas ni espacios de más). Al crear, se abre su edición.

**Editar** (pantalla completa con "← Volver a Ruta Semanal", regla de la Etapa 1 del portal para formularios de varios
bloques; el viejo lo hace en una ventana que se corta con el zoom):
- El nombre se puede cambiar.
- Dos columnas, como el viejo: a la izquierda **todos los clientes** de la sucursal con buscador (sin acentos) y botón
  agregar; a la derecha **Clientes de la ruta: N** con quitar. Mismo patrón que `CarteraRuta` / `ListaRutaDiaria`.
- **Sin flechas de orden** (como el viejo; el tío solo pidió el orden en la diaria). El orden es el **orden en que se
  agregaron**, y en ese orden pasan a la ruta del día.
- Un cliente puede estar en varias rutas y varios días (R-1.2): no se impide.
- Solo clientes vivos de tipo `cliente` (no prospectos), de la sucursal de la ruta.
- **Guardar** manda la lista completa (reemplazo, como la diaria de T-37) y **no recarga la página**. Salir con cambios
  sin guardar pregunta con `useConfirmar`.

**Eliminar:** con `useConfirmar`. **No se puede** si la ruta está asignada a algún vendedor **hoy o un día futuro**
(409 con el motivo "Esta ruta está asignada a Ricardo el martes 10 de noviembre."). En el viejo una ruta en uso hoy no
tiene bote. Baja lógica: las rutas del día pasadas conservan su nombre.

**Un cambio a la Ruta Semanal llega a las rutas del día ya armadas** (R-1.4 + decisión de Roberto, opción A), en la
**misma transacción** del guardado, para cada ruta del día de esa ruta semanal con fecha **hoy o futura** (hoy de
Tijuana):
- **Cliente agregado** a la semanal → se agrega **al final** de la ruta del día, **salvo** que ese día la oficina lo haya
  quitado a mano o ya esté en la ruta (por ejemplo, porque el vendedor se lo agregó).
- **Cliente quitado** de la semanal → se quita de la ruta del día **solo si llegó de la semanal** (`origen = semanal`). Si
  la oficina o el vendedor lo pusieron a mano ese día, se queda.
- Lo demás de la ruta del día (orden, recados, vehículo, notas) no se toca, salvo las notas asignadas del cliente que
  sale (sección 5.4, "Si un cliente sale de la ruta").
- Un día pasado nunca cambia.
- Un cliente que ya no es válido (dado de baja, vuelto prospecto o de otra sucursal) **no se copia** a la ruta del día y
  no hace fallar el guardado. *Decisión del agente.* La pantalla de la Ruta Semanal lo muestra marcado ("dado de baja")
  para que la oficina lo quite.
- **Renombrar** una ruta semanal cambia `nombre_ruta` de sus rutas del día de **hoy en adelante**; las pasadas conservan
  el nombre que tenían. *Decisión del agente.*

## 5. Ruta Diaria

*Operación → Ruta Diaria* (`/operacion/ruta-diaria`). Permiso `ruta_diaria.gestionar` (ya existe). Reemplaza la pantalla
de T-37.

### 5.1 La lista del día (como el viejo)

- Arriba: **Día** (por omisión hoy de Tijuana; se puede escoger mañana, pasado mañana o cualquier fecha, R-1 tabla).
  *Decisión del agente:* un **día pasado se ve en solo lectura** (cambiar la historia descuadra el Flujo diario).
- Sin "Buscar ruta" (R-5.1). Sin "Clientes para hoy | Otros" del viejo (no se sabe qué cuenta; *decisión del agente*).
- Un renglón **por vendedor activo** de la sucursal, con las columnas que pidió el tío (R-5.1):

| Columna | Contenido |
|---|---|
| Vendedor | nombre |
| Ruta asignada | **nombre de la ruta** o "Sin ruta" |
| Clientes asignados | cuántos clientes tiene su ruta de ese día |
| Notas pendientes por cobrar | cuántas notas con saldo tienen los clientes de su ruta, y botón para asignar (5.4) |
| Notas asignadas por cobrar | cuántas notas se le asignaron ese día, y botón para verlas |
| Vehículo | el asignado, o "Sin vehículo" |
| Acciones | **Asignar ruta** (si no tiene) · **Editar** · **Quitar ruta** |

- La tabla tiene que caber a 1366 px (regla del portal: `table-fixed`, `colgroup`, medir en navegador).
- Nada de lo que se haga en la pantalla recarga la página (queja del tío: "es muy lento").

### 5.2 La ruta de un vendedor (Asignar / Editar)

Pantalla completa "Ruta de Ricardo · martes 10 de noviembre" con "← Volver a Ruta Diaria" (el viejo usa una ventana con
la pestaña de clientes escondida; el tío pidió arreglar eso, R-5.1). Tres bloques:

1. **Ruta del día:** una lista con las rutas semanales **del día de la semana de esa fecha**. Una ruta que ya tiene otro
   vendedor ese día sale deshabilitada con "(la trae Juan)": **la misma ruta no se asigna a dos vendedores el mismo
   día** (decisión de Roberto; el viejo lo permite). Al escoger una ruta, **sus clientes se copian** a la lista de abajo
   en su orden (los que ya no son válidos se saltan, sección 4). Cambiar de ruta con clientes ya puestos pregunta si se
   reemplazan: salen los de la ruta anterior que llegaron de la semanal (no los agregados a mano ni los del vendedor) y
   entran los de la nueva.
2. **Vehículo:** lista de los vehículos activos de la sucursal, o "Sin vehículo". Un vehículo que ya tiene otro vendedor
   ese día sale con "(lo trae Juan)" pero **sí se puede** escoger (*decisión del agente*: a veces se intercambian; solo se
   avisa).
3. **Clientes de la ruta: N**, en orden. Por cliente:
   - **↑ y ↓** para ordenar (el tío pidió la flecha hacia abajo y dudó entre flechas y arrastrar; *decisión del agente*:
     flechas, son más fáciles de atinar y funcionan con teclado).
   - **Recado**: un campo de texto corto que ve el vendedor en la app (ej. "Vender solo de contado", "SOLAMENTE
     COBRAR"; R-1 tabla, R-3.2). Hasta 200 caracteres (*decisión del agente*). Se muestra debajo del nombre.
   - **Quitar**. Lo que agregó el vendedor desde la tablet no se puede quitar, solo reordenar (regla vigente de T-37).
   - Arriba de la lista, **Agregar cliente**: buscador sobre **todos** los clientes de la sucursal (R-1 tabla: "viene todo
     el universo de clientes"), para agregar uno que no está en la ruta. Se agrega al final. No cambia la semanal.
- **Guardar** guarda todo junto (ruta, vehículo, clientes en orden y recados) en una transacción y regresa a la lista.
  Salir con cambios sin guardar pregunta con `useConfirmar`.
- Se puede armar la ruta **sin escoger una ruta semanal** (solo clientes agregados a mano): "Ruta asignada" dice "Sin
  ruta · N clientes". *Decisión del agente*: así no se rompe una ruta que el vendedor se arme solo en la tablet.

**Quitar ruta** (desde la lista, con `useConfirmar`): da de baja la ruta del día del vendedor, sus clientes puestos por la
oficina o la semanal, su vehículo y **sus notas asignadas de ese día**. Los clientes que agregó el vendedor se quedan.

**"Copiar de ayer" desaparece**: con la Ruta Semanal ya no hace falta (*decisión del agente*).

### 5.3 Clientes que agregó el vendedor desde la tablet

Siguen como en T-37 (`ruta-alta`): se suman al final de su ruta del día con `origen = vendedor`. Si el vendedor no tenía
ruta ese día, su lista sale como "Sin ruta · N clientes".

### 5.4 Notas por cobrar

Desde la lista del día, el botón de **Notas pendientes por cobrar** abre una `Ventana` amplia "Notas para Ricardo ·
martes 10 de noviembre":

- **Buscar por folio** (como el viejo).
- Las notas con saldo de **los clientes de su ruta de ese día** (R-3.2: para darle una nota de un cliente que no está en
  su ruta, primero se agrega el cliente a la ruta), agrupadas por cliente **en el orden de la ruta**.
- Columnas: **Cliente** · **Folio** · **Fecha** · **Saldo** · **Días de atraso** (el mismo cálculo que Cuentas por
  Cobrar, `reglas-cuentas-por-cobrar.ts`; el viejo no muestra fecha ni días) · acción.
- Acción por nota:
  - **Asignar** si nadie la trae ese día.
  - **Quitar** si ya es de este vendedor.
  - **"La trae Juan · Pasársela"** si ya es de otro vendedor ese día: un clic se la quita a Juan y se la pone a Ricardo
    en una transacción (decisión de Roberto, R-3.4: una nota la trae un solo vendedor).
- **Cada clic se guarda al momento** (*decisión del agente*: sin botón "Guardar", no se pierde lo marcado).
- Qué es "nota con saldo": venta viva a **crédito**, con saldo > 0, en `pendiente` o `abonado`, que no esté en cuenta
  perdida. **Incluye las notas hechas ese mismo día**: el caso del dueño con tres negocios (le venden en la mañana y otro
  vendedor le cobra en la tarde) necesita asignar a media jornada una nota recién hecha. La tablet la recibe en su
  siguiente sincronización.
- Una nota asignada que se termina de pagar (por la tablet o la oficina) deja de salir en "pendientes" pero **sigue
  contando como asignada** ese día (la parte 2 la necesita para "Notas Asignadas Cobradas").

El botón de **Notas asignadas por cobrar** abre la lista de las asignadas ese día (Cliente · Folio · Fecha · Saldo), con
**Quitar**.

**La asignación es de un día.** Una nota que no se cobró no pasa sola al día siguiente: hay que volverla a asignar
(R-3.3).

**Si un cliente sale de la ruta del día** (la oficina lo quita, cambia la ruta o un cambio de la semanal lo saca), sus
notas asignadas a ese vendedor ese día **se dan de baja** en la misma transacción: una nota se asigna desde la ruta
(R-3.2). Si la oficina lo quita y tiene notas asignadas, la pantalla avisa antes de guardar ("Tacos Pancho tiene 2 notas
asignadas; se le quitarán"). *Decisión del agente.*

## 6. Datos

Migración nueva (revisar `ls supabase/migrations` por timestamps únicos). Aditiva salvo lo marcado.

- **`ruta_semanal`**: `id`, `sucursal_id`, `dia_semana` (1 = lunes … 6 = sábado, check), `nombre`, `created_at`,
  `updated_at`, `deleted_at`. Único vivo `(sucursal_id, dia_semana, lower(btrim(nombre)))`.
- **`ruta_semanal_cliente`**: `id`, `ruta_semanal_id`, `cliente_id`, `orden`, tiempos y `deleted_at`. Único vivo
  `(ruta_semanal_id, cliente_id)`.
- **`ruta_dia`** (el encabezado que hoy no existe): `id`, `vendedor_id`, `fecha`, `ruta_semanal_id` (nulo = sin ruta),
  `vehiculo_id` (nulo = sin vehículo), `nombre_ruta` (copia del nombre al asignar, para que la historia no cambie si la
  renombran; *decisión del agente*), tiempos, `deleted_at`, `actualizado_por_usuario_id`.
  - Único vivo `(vendedor_id, fecha)`.
  - Único vivo `(ruta_semanal_id, fecha)` donde `ruta_semanal_id` no es nulo: **la misma ruta no va a dos vendedores el
    mismo día** (decisión de Roberto).
  - Las rutas diarias de T-37 que ya existen no tienen encabezado: se tratan como "Sin ruta" y el encabezado se crea al
    guardar.
- **`ruta`** (los clientes de la ruta del día, T-37):
  - `origen` admite además **`semanal`** (copiado de la ruta semanal). Cambia el check `ck_ruta_origen`.
  - **El `origen` lo decide el servidor, no el portal** (el `PUT` sigue mandando solo ids, en orden, con su recado):
    una fila que ya existe **conserva** su origen (reordenar no lo cambia); una nueva es `semanal` si el cliente está en
    la ruta semanal asignada ese día y `oficina` si no. Un cliente que la oficina agrega a mano y que también está en la
    semanal queda `semanal` (da igual: está en los dos lados). Esto **cambia** la regla de T-37 que pasaba a `oficina`
    todo lo que venía en el `PUT`: una fila del vendedor que la oficina guarda sigue siendo `vendedor`.
  - `recado text` nulo (≤ 200).
  - **Quitar** = `deleted_at` con `quitado_por`: `oficina` (la oficina lo quitó a mano: un cambio de la semanal **no**
    lo vuelve a poner ese día, sección 4) o `cambio_ruta` (salió porque se cambió o se quitó la ruta: **no** bloquea; si
    se vuelve a asignar esa ruta ese día, entra otra vez).
  - La fila vieja `tipo = 'semanal'` nunca se usó: se deja; todo lo nuevo es `tipo = 'diaria'`.
- **`nota_asignada`**: `id`, `venta_nota_id`, `vendedor_id`, `fecha`, `asignada_por_usuario_id`, `created_at`,
  `deleted_at`, `quitada_por_usuario_id`. Único vivo `(venta_nota_id, fecha)`: **un solo vendedor por nota y día**.
  Pasar = baja de la de Juan + alta de la de Ricardo en una transacción. Toca `updated_at` para el pull.
- Los guardados de una ruta del día se serializan bloqueando la fila del vendedor (`for no key update`, como T-37) y los
  de una ruta semanal bloqueando su fila.

## 7. Backend

Módulo `rutas/` (donde ya viven la ruta diaria y los vehículos). Alcance de sucursal como el resto: otra sucursal = 404.

- `GET/POST/PATCH/DELETE /rutas/semanales` y `PUT /rutas/semanales/:id/clientes` (reemplazo), permiso
  `ruta_semanal.gestionar`. El `PUT` aplica el cambio a las rutas del día de hoy en adelante (sección 4) en su
  transacción.
- `GET /rutas/diaria/dia?fecha&sucursal`: la lista del día (5.1) con los conteos.
- `GET/PUT /rutas/diaria?vendedorId&fecha`: amplía el de T-37 con `rutaSemanalId`, `vehiculoId` y `recado` por cliente.
  Rechaza (409) una ruta semanal que ya trae otro vendedor ese día y una de otro día de la semana (400). Fecha pasada =
  400.
- `DELETE /rutas/diaria?vendedorId&fecha`: Quitar ruta (5.2).
- `GET /rutas/diaria/notas?vendedorId&fecha`: pendientes de su ruta + asignadas, con quién las trae.
- `PUT /rutas/diaria/notas/:ventaNotaId` (asignar o pasar, con `vendedorId` y `fecha`) y `DELETE` (quitar). Permiso
  `ruta_diaria.gestionar` (*decisión del agente*: lo hace el jefe de ventas en la misma pantalla; no se crea un permiso
  nuevo).
- Las reglas puras (aplicar un cambio de la semanal a una ruta del día, armar la lista de notas) van en archivos
  `reglas-*.ts` con pruebas, como el resto del backend.
- e2e de: la misma ruta a dos vendedores (409), pasar una nota, cambio de la semanal sin deshacer lo quitado a mano, y
  quitar ruta.

## 8. Dashboard y Flujo diario

- "Ruta asignada" pasa de "Ruta del día · N clientes" a **"RUTA 5 (BLV 2000) · N clientes"** (el nombre de `ruta_dia`;
  "Sin ruta · N clientes" si no tiene). Los tipos duplicados de `lib/flujo-diario.ts` y `reglas-flujo-diario.ts` cambian
  juntos.
- Vehículo en el Dashboard: el de la **jornada** (el que usó). *Decisión del agente*: si es distinto del asignado, se
  muestra "Nissan 02 (asignado: Nissan 01)", así la oficina ve el cambio (R-4.1).

## 9. Lo que necesita la tablet (Mario)

El backend deja lista la información en el pull, **aditiva** (`CONTRATO_ACTUAL` sigue en 1; una tablet vieja la ignora).
Los tipos se copian en los dos `contrato.ts` y en `docs/contrato-sincronizacion.md` en el mismo commit:
- **`RutaPull.origen` sigue siendo `oficina | vendedor`**: el pull traduce `semanal` → `oficina`. El SQLite de la tablet
  tiene `check (origen in ('oficina','vendedor'))` (migración local 011) y un valor nuevo tumbaría el pull de todas las
  tablets. A la tablet solo le importa si lo puso el vendedor o no.
- `RutaPull.recado` (texto o nulo).
- Colección **`rutas_dia`**: `fecha`, `nombre_ruta`, `vehiculo_id`, `activo`, del vendedor del token desde ayer en
  adelante (misma ventana que `rutas`).
- Colección **`notas_asignadas`**: `venta_nota_id`, `fecha`, `activo`, del vendedor del token desde ayer en adelante.

Lo que hace Mario con eso (va como nota en el PR):
- Marcar en la ruta los clientes con notas **asignadas** y mostrar de cada una cliente, folio, fecha, cuánto debe y días
  de vencimiento (R-3.8).
- **Cobrar solo las notas asignadas** (R-3.6). *El servidor no lo rechaza* (la cobranza se captura sin red y la oficina
  pudo asignarla después; mismo criterio que D9 de T-21).
- Mostrar el recado del cliente en la ruta.
- Proponer el vehículo asignado al abrir la jornada y dejar cambiarlo (R-4.1).
- Kilometraje inicial mayor o igual al último kilometraje final de **ese vehículo** (R-4.1). La validación del servidor
  en `cerrarJornada` también es de esa pieza.
- Reimprimir el ticket "LIQUIDADA" / "ABONADO" y pedir firma al abonar (R-3.6, R-3.7).

## 10. Lo que decidió el agente (para revisar)

Marcado arriba como *decisión del agente*: sin Domingo; día pasado en solo lectura; sin el contador "Clientes para hoy |
Otros"; vehículo repetido se avisa pero se permite; flechas en vez de arrastrar; recado de 200 caracteres; ruta del día
sin ruta semanal; quitar "Copiar de ayer"; copia del nombre de la ruta en `ruta_dia`; cada clic de notas se guarda al
momento; mismo permiso para notas; vehículo usado vs. asignado en el Dashboard; clientes no válidos de la semanal se
saltan; renombrar cambia hoy y el futuro; al salir un cliente de la ruta se le quitan sus notas asignadas; el servidor
decide el `origen` (y deja de pasar a `oficina` lo del vendedor); `semanal` baja a la tablet como `oficina`.
