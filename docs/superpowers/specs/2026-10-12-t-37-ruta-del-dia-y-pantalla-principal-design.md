# T-37 · Ruta del día y pantalla principal de la tablet — backend + portal + tablet (spec)

**Fecha:** 2026-10-12 · **Rama:** `feature/t-37-ruta-diaria` desde `main` `e225182` (PR #113)
**Origen:** rediseño de la app de tablet pedido por Mario el 2026-10-12 (brainstorm en sesión; pieza 1 de 7).
**Decisiones:** las D1…D16 se acordaron con Mario en el brainstorm. Las que llevan *(agente)* las propuso el agente y Mario las aceptó; cada una dice qué cuesta si está mal.

## Por qué cambia la pantalla principal

Hoy la jornada abre en un menú de cuatro botones (`app/(jornada)/index.tsx`) y el vendedor llega al cliente por una lista plana del catálogo (`operacion/index.tsx`). El negocio trabaja por **ruta**: la oficina decide a quién se visita cada día y en qué orden (vault, [[Rutas]]), y la efectividad se mide contra esa asignación. La tabla `ruta` existe en Postgres desde la migración transaccional (`cliente_id`, `vendedor_id`, `fecha`, `orden`, `tipo in ('diaria','semanal')`), el permiso `ruta_diaria.gestionar` está sembrado y el portal tiene la página `operacion/ruta-diaria` como marcador de posición, pero **nadie escribe ni lee esa tabla**: ni el portal, ni el pull, ni la tablet.

Este spec hace que la jornada abra en la ruta del día, que la oficina la arme desde el portal y que el vendedor la complemente desde la tablet sin generar conflictos.

## El rediseño completo, en piezas

Acordado con Mario (2026-10-12). Cada pieza lleva su spec, su plan y su PR.

| Pieza | Qué | Estado |
|---|---|---|
| 1 | **Ruta del día y pantalla principal, con la ficha del cliente ampliada** | este spec |
| 3 | Visita sin venta (T-39): catálogo de motivos editable en el portal con casilla "exige foto", pantalla con motivo, observaciones, hora, GPS y foto; canal de foto generalizado; descarga de fotos del servidor a la tablet | siguiente |
| 4 | Prospecto con coordenada o dirección; geocodificación con Google en el servidor al proyectar | después de 3 |
| 6 | Gastos de la ruta (T-30/T-31): tipos de gasto en el portal, bajan en el pull, pantalla de gasto | después de 4 |
| 7 | Firma del cliente en la nota al vender; bloquea la nota en la tablet (el portal sigue editando) | después de 6 |
| — | Inventario a media jornada (recarga, devolución) y merma: T-24/T-27, fuera del rediseño | pendiente |

Pendientes para versiones futuras (vault, [[App Tablet]]): notificaciones al cliente de "vendedor en camino" y panel web para el cliente.

## Decisiones de producto

**D1 · La ruta la arma la oficina en el portal.** La pantalla de Ruta Diaria entra en esta pieza. El vendedor no depende de ella para trabajar (D3).

**D2 · El vendedor puede reordenar su ruta y agregarle clientes; no puede quitar los de la oficina.** Un cliente que la oficina asignó y el vendedor no visitó se queda en la lista sin palomita: esa ausencia es información para la oficina (efectividad, T-46).

**D3 · Sin ruta asignada, la tablet funciona igual.** La lista sale vacía con el aviso *"La oficina no ha asignado ruta para hoy"* y la hora de la última sincronización; el vendedor agrega clientes a mano y trabaja. En el portal esa ruta se ve con la etiqueta *"armada por el vendedor"*.

**D4 · Las altas suben, el orden se queda local** *(agente)*. Cada cliente agregado a mano sube como operación `ruta-alta` y el servidor lo proyecta a `ruta` con `origen = 'vendedor'`. El orden que el vendedor arrastra **no sube**: lo que la oficina quiere saber es el orden en que de verdad hicieron la ruta, y eso sale de las horas de venta, cobranza y visita. Se descartó "todo sube y baja" (gana el último que escribe: es lo que T-43 existe para hacer seguro) y "todo local" (el portal no vería los clientes agregados y la efectividad contaría mal). *Si está mal:* el orden local se puede subir después como operación aditiva; no hay que deshacer nada.

**D5 · "Visitado" se deriva, no se guarda** *(agente)*. Un cliente de la ruta está visitado si **hoy** tiene en la tablet una venta o una cobranza (y, desde la pieza 3, una visita). Ni refrescar ni reordenar pueden borrar la marca porque no existe como dato. *Si está mal:* agregar una columna después es aditivo.

**D6 · Refrescar la ruta es sincronizar.** El botón "Refrescar" de la barra es el "Sincronizar ahora" de siempre (pull → push → fotos → pull posterior), movido de lugar. No hay un segundo camino de red.

**D7 · El vendedor solo da de alta prospectos, nunca clientes.** Confirmado por Mario; es lo que ya hace T-40. "Agregar a mi ruta" elige entre clientes **existentes** de la sucursal.

**D8 · La foto en la ficha del cliente, por ahora solo la que tomó esta tablet** *(agente)*. El servidor sirve fotos solo al portal (`rutaParaPortal`) y `ClientePull` no dice si hay foto. La descarga a la tablet entra en la pieza 3, donde el canal de foto se generaliza de todos modos. *Si está mal:* es un botón que aparece en más casos; nada que deshacer.

**D9 · Menú hamburguesa como hoja modal** *(agente)*. La app no trae `react-native-gesture-handler` ni `react-native-reanimated`; un cajón lateral nativo obligaría a agregar las dos y recompilar. Una hoja modal con `Modal` de React Native no agrega dependencias. *Si está mal:* se cambia por un drawer en una rama aparte; las entradas del menú son las mismas.

**D10 · Reordenar con mantener presionado y arrastrar, sin librería nueva** *(agente)*. Se implementa con `PanResponder` sobre una lista propia (la ruta tiene decenas de filas, no miles). Si en la implementación resulta frágil en el emulador, el plan prevé el respaldo: botones subir/bajar por fila. *Si está mal:* el respaldo cumple la función con menos elegancia.

## Servidor

**D11 · Migración aditiva sobre `ruta`.** Archivo nuevo con timestamp posterior a `20261010120000`:
- `alter table ruta add column origen text not null default 'oficina' check (origen in ('oficina','vendedor'))`.
- `create unique index uq_ruta_diaria_vendedor_fecha_cliente on ruta (vendedor_id, fecha, cliente_id) where deleted_at is null and tipo = 'diaria'`.
- `create index idx_ruta_vendedor_fecha on ruta (vendedor_id, fecha) where deleted_at is null`.
- Sin grants ni RLS nuevos (ninguna tabla del repo los tiene; mismo criterio que T-38). pgTAP propio: columna, check, unicidad entre vivas, que dos filas con `deleted_at` sí conviven.
- La ruta **semanal** (`tipo = 'semanal'`, T-36) no se toca ni se lee.

**D12 · Fuente `rutas` en el pull.** Aditivo al contrato (`CONTRATO_ACTUAL` sigue en 1), en los dos `contrato.ts` y en `docs/contrato-sincronizacion.md`:

```ts
export interface RutaPull extends FilaSincronizable {   // id, activo (0 = baja)
  cliente_id: string;
  fecha: string;            // AAAA-MM-DD, la de la asignación
  orden: number;
  origen: 'oficina' | 'vendedor';
}
// RespuestaPull.rutas: RutaPull[]   — nuevo campo del snapshot
```

Reglas del repositorio del pull (`sincronizacion.repository.ts`, método `rutas(vendedorId, desde)`):
- Solo filas del **vendedor del token** y `tipo = 'diaria'`.
- Ventana de fechas por el reloj del servidor: `fecha between current_date - 1 and current_date + 7`. La tablet decide qué día mostrar con su `reloj.hoy()` local (Tijuana); la ventana existe para que una ruta asignada el viernes para el lunes baje el viernes.
  - *Ajuste en la implementación:* sin tope superior (`fecha >= current_date - 1`); con tope, una ruta asignada a 8+ días nunca entraba al pull incremental (ventana + cursor por `updated_at`).
- Incremental por `updated_at > desde` como las demás fuentes; una fila con `deleted_at` dentro de la ventana viaja con `activo: 0` (baja como bandera, nunca como ausencia).
- Con `desde = null` (vuelco completo) bajan todas las vivas de la ventana.

**D13 · Operación `ruta-alta`.** Tipo nuevo en `TIPOS_OPERACION` de los dos contratos (**no** se reutiliza `'ruta'`, que el roadmap y el vault reservan para la visita de T-39). Sobre:

```ts
{ clave, tipo: 'ruta-alta', fecha_operacion: '2026-10-12', ocurrido_en, datos: { cliente_id: string } }
```

Proyección según ADR-0009, en el módulo `rutas` (`rutas/RutasService.agregarAlDia(alta, contexto)`), dentro de la transacción de la operación:
- `fecha = fecha_operacion` (la manda la tablet; el servidor no la re-deriva).
- `orden = max(orden) + 1` entre las vivas de ese vendedor y fecha, o `1` si no hay.
- `origen = 'vendedor'`, `tipo = 'diaria'`.
- Inserta con `on conflict` sobre la unicidad de D11 → **do nothing**; si no insertó, es `ruta-duplicada`.
- Devuelve `{ tabla: 'ruta', id }` para `entidad_tabla`/`entidad_id`.

Códigos de rechazo nuevos, aditivos, en `CODIGOS_RECHAZO` de los dos contratos y en `docs/contrato-sincronizacion.md`:
- `ruta-datos-invalidos` — `datos.cliente_id` ausente o no es uuid (antes de la transacción).
- `cliente-inexistente` — el cliente no existe, tiene `deleted_at`, o es de otra sucursal que la del vendedor del token. Un cliente **inactivo** (`activo = 0` lógico del portal, si lo hubiera) **sí** entra: el vendedor fue físicamente; mismo criterio que el vehículo desactivado en T-38. Un `tipo = 'prospecto'` **también se rechaza** con este código: a un prospecto no se le vende (D7).
- `ruta-duplicada` — ya había fila viva de ese vendedor, fecha y cliente con **otra** clave (la misma clave la resuelve el buzón como `duplicada`). **La tablet la trata como aplicada** (D15, `fuente-rutas`): no es un error del vendedor, es la oficina y él agregando al mismo cliente.

**D14 · Endpoints para el portal**, en `rutas.module.ts` (controlador nuevo `rutas-diarias.controller.ts`), permiso `ruta_diaria.gestionar`, alcance por sucursal con `resolverAlcance` como `clientes.controller.ts`:
- `GET /rutas/diaria?vendedor_id&fecha` → `{ vendedor, fecha, filas: [{ id, cliente_id, cliente_nombre, orden, origen }] }` ordenadas por `orden`. 404 si el vendedor no está en el alcance del usuario.
- `PUT /rutas/diaria` con `{ vendedor_id, fecha, clientes: [cliente_id…] }` (lista ordenada, sin repetidos, todos de la sucursal del vendedor; 400 si no). Semántica de **reemplazo** en una transacción:
  - para cada `cliente_id` en posición `i`: si hay fila viva (de cualquier origen) → `orden = i + 1`, `origen = 'oficina'`; si no → inserta `origen = 'oficina'`.
  - filas vivas de `origen = 'oficina'` que no vienen en la lista → `deleted_at = now()`.
  - filas vivas de `origen = 'vendedor'` que no vienen en la lista → **se conservan**, y se renumeran al final en su orden relativo. El portal no puede quitar lo que agregó el vendedor (D2); solo reordenarlo incluyéndolo en la lista.
  - responde con el mismo cuerpo que el `GET`.
- `GET /rutas/diaria/anterior?vendedor_id&fecha` → la última fecha **anterior** a `fecha` con filas vivas de ese vendedor y sus `cliente_id` en orden, o `{ fecha: null, clientes: [] }`. Sirve a "Copiar de ayer" (D17); no escribe nada.

**Pruebas del servidor:** pgTAP (D11); unitarias de `RutasService` (orden siguiente, duplicada, prospecto rechazado); e2e en `test/sincronizacion.e2e-spec.ts` (pull: ventana, incremental, baja como bandera, solo mi vendedor; push: aplicada con `entidad_tabla = 'ruta'`, `ruta-datos-invalidos`, `cliente-inexistente` por sucursal ajena y por prospecto, `ruta-duplicada` con otra clave y `duplicada` con la misma) y e2e nuevo `test/rutas-diarias.e2e-spec.ts` (permiso, alcance, reemplazo que conserva las del vendedor, renumeración, 400 por cliente de otra sucursal, "anterior").

## Tablet · datos

**D15 · Migración local 011 `ruta`** (`apps/tablet/src/datos/migraciones/011-ruta.ts`, registrada en `index.ts`):

```sql
create table ruta (
  id              text primary key,          -- id del servidor, o uuid local mientras es alta pendiente
  cliente_id      text not null references cliente(id),
  fecha           text not null,             -- AAAA-MM-DD
  orden           integer not null,          -- el del servidor; en un alta local, el siguiente libre
  origen          text not null check (origen in ('oficina','vendedor')),
  activo          integer not null default 1,
  sync_estado     text not null default 'sincronizada' check (sync_estado in ('sincronizada','pendiente','error')),
  sync_error      text,
  clave           text unique,               -- clave de idempotencia; solo en altas locales
  sincronizado_en text not null
);
create unique index uq_ruta_fecha_cliente on ruta (fecha, cliente_id) where activo = 1;  -- parcial: una baja vieja y la fila viva nueva conviven
create table ruta_orden_local (
  fecha      text not null,
  cliente_id text not null,
  posicion   integer not null,
  primary key (fecha, cliente_id)
);
```

Dos tablas a propósito: `ruta` la escribe el pull; `ruta_orden_local` la escribe solo el dedo del vendedor. Así ningún snapshot pisa el orden.

Repositorio nuevo `repositorios/rutas.ts` (`crearRepositorioRutas({ bd, reloj })`), con el patrón de `ventas.ts`:
- `delDia(fecha = reloj.hoy())` → filas vivas de `ruta` para esa fecha, con el cliente (`join cliente`) y el conteo de notas pendientes del cliente (`nota_pendiente` con `activo = 1 and saldo_centavos > 0`: la misma consulta que `catalogos.notasPendientesDe`, así que la burbuja baja al cobrar sin red). Orden: `coalesce(ruta_orden_local.posicion, 1e9 + ruta.orden)`; las filas sin posición local van al final en el orden del servidor.
- `agregar(clienteId, fecha = hoy)` → valida que el cliente sea `tipo = 'cliente'`, `activo = 1` y de la sucursal; si ya hay fila viva para (fecha, cliente) lanza `ErrorRuta('Ese cliente ya está en la ruta de hoy.')`; inserta `id = uuid local`, `origen = 'vendedor'`, `orden = max + 1`, `sync_estado = 'pendiente'`, `clave = uuid`. Candado de jornada: primera línea `exigirJornadaAbierta`, como `ventas.registrar`.
- `reordenar(fecha, clienteIds[])` → reescribe `ruta_orden_local` de esa fecha en una transacción.
- `aplicarSnapshot(filas: RutaPull[], ahora)` lo llama `catalogos.aplicarSnapshot` como una fuente más (`upsert(bd, 'ruta', COLUMNAS.ruta, snapshot.rutas, ahora)`), **después** de `cliente` (la fila de ruta referencia al cliente y un cliente nuevo puede venir en el mismo snapshot), con una diferencia: **antes** del upsert, para cada fila **viva** que llega borra cualquier fila local del mismo `(fecha, cliente_id)` con **otro id**: un alta local pendiente (se **funde**: queda la del servidor; si la operación seguía pendiente, el servidor la responderá `ruta-duplicada`, que la tablet trata como aplicada) o una baja vieja (la oficina quitó y volvió a poner al cliente: en el servidor es una fila nueva). La posición en `ruta_orden_local` va por `(fecha, cliente_id)`, así que sobrevive a la fusión. Una fila que llega con `activo: 0` se queda en la tabla con la bandera (como los demás catálogos) y la pantalla decide (D5/D16).
- `pendientesDeSincronizar()`, `marcarSincronizada(id)`, `marcarError(id, motivo)`: el patrón de `ventas.ts`.
- `purgar(antesDe = hoy − 7 días)` → borra `ruta` y `ruta_orden_local` de fechas anteriores. Lo llama `abrir-dia` al abrir.

Fuente de sincronización nueva `sincronizacion/fuente-rutas.ts` (`tipo: 'ruta-alta'`), registrada en la lista `fuentes` del proveedor junto a ventas, cobranzas, prospectos y jornadas. `marcarError` con motivo `ruta-duplicada` **llama a `marcarSincronizada`** en vez de dejar error (D13).

`contarPendientesDeSubir()` suma las altas de ruta pendientes.

**Regla de fusión al refrescar (resumen para quien lea solo esto):**

| Llega del servidor | Hay en la tablet | Resultado |
|---|---|---|
| fila nueva viva | nada | aparece al final (sin posición local) |
| fila conocida con otro `orden` | la misma | se actualiza `orden`; si tiene posición local, manda la local |
| fila con `activo: 0` | la misma, cliente **sin** actividad hoy | desaparece de la lista |
| fila con `activo: 0` | la misma, cliente **con** actividad hoy | se queda, visitado, grupo "fuera de ruta" |
| fila viva del mismo `(fecha, cliente)` | alta local con otro id | se funde: queda la del servidor |
| fila viva del mismo `(fecha, cliente)` | baja vieja con otro id | la baja se borra; queda la viva (la oficina quitó y volvió a poner) |

**Cruces con la nube, acordados con Mario:**
- *Sin ruta en la nube al sincronizar:* lista vacía con aviso (D3); las altas del vendedor suben con `origen = 'vendedor'`.
- *La oficina asigna después de que el vendedor armó la suya:* el orden pull → push → pull posterior del motor lo resuelve solo. El pull baja las de la oficina, el push sube las del vendedor, las repetidas vuelven `ruta-duplicada` (aplicada), el pull posterior (PR #114) trae el estado final. Sin duplicados y con el orden local intacto.
- *La oficina asigna un cliente que el vendedor ya había subido:* el `PUT` lo adopta (orden de la oficina, `origen = 'oficina'`); no crea otra fila.
- *Sincronizar a media jornada:* nunca quita un cliente con actividad de hoy ni toca `ruta_orden_local`.

**Visitado (D5):** `rutas.delDia` devuelve por fila `visitado: boolean` = `ventas.delDia(clienteId).length > 0 || cobranzas.delDia(clienteId).length > 0`. La pieza 3 suma `visitas.delDia`.

**Pruebas (Node, base en memoria como el resto):** los cinco casos de la tabla de fusión; orden combinado (local + servidor); `agregar` rechaza prospecto, inactivo, repetido y día cerrado; `reordenar` es transaccional; visitado derivado por venta y por cobranza; conteo de la burbuja antes y después de una cobranza local; `purgar`; `fuente-rutas` con `ruta-duplicada` → sincronizada; motor: `contarPendientesDeSubir` con altas de ruta.

## Tablet · pantallas

**D16 · Pantalla principal** (`app/(jornada)/index.tsx` se reescribe):
- **Barra superior.** Izquierda, tres botones juntos con icono y texto corto: **Prospecto** (abre `prospectos.tsx`, el alta que ya existe), **Refrescar** (el "Sincronizar ahora" actual, con la pastilla "N por subir" pegada; D6) y **Agregar a mi ruta** (pantalla nueva). Derecha: hamburguesa (D9). Debajo del título, "Jornada del {fecha}" y "Catálogos bajados: {formatearMomento}".
- **Lista.** Una columna ancha (tablet horizontal). Por fila: número de orden, nombre, primera línea del domicilio (o "sin domicilio" en un prospecto convertido sin él), y a la derecha la **burbuja** con el número de notas pendientes solo si es mayor a cero. Visitado: palomita y texto atenuado, sin salir de la lista. Fuera de ruta con actividad: al final, bajo el separador "Fuera de ruta". Tocar la fila → ficha del cliente. Mantener presionado y arrastrar → reordena (D10); al soltar se guarda sin confirmar.
- **Estados.** Sin ruta: aviso de D3 con botones "Sincronizar" y "Agregar a mi ruta". Sin red al refrescar: el mismo error que hoy; la lista no cambia. Día cerrado: lista en solo lectura, "Agregar a mi ruta" deshabilitado, aviso "Día cerrado" como en T-38.
- **Menú hamburguesa** (hoja modal desde arriba a la derecha): Todos los clientes (`operacion/index.tsx`, la lista actual del catálogo), Prospectos capturados (`prospectos.tsx`), Gastos (pendiente, pieza 6), Inventario (pendiente T-27), Merma, promoción y consumo (pendiente T-27/T-31), Ruta y GPS (pendiente T-41), Cerrar el día. Las pendientes abren `PantallaPendiente` con su ticket.

**Agregar a mi ruta** (`app/(jornada)/agregar-a-ruta.tsx`, nueva): buscador por nombre sobre clientes activos de la sucursal, `tipo = 'cliente'`, que **no** están en la ruta de hoy; tocar uno llama `rutas.agregar`, vuelve a la lista y muestra un aviso breve "{nombre} agregado al final". Errores de `ErrorRuta` y `ErrorJornada` en pantalla, como en venta.

**Ficha del cliente** (`operacion/[clienteId]/index.tsx` se amplía):
- Encabezado: nombre y encargado.
- Tres datos tocables: **teléfono** (`Linking.openURL('tel:…')`), **dirección** (`https://www.google.com/maps/search/?api=1&query=lat,lng` si hay coordenada, si no `query=` con el domicilio codificado; Android lo abre con la app de Maps si está) y **Ver foto**, solo si existe `foto_uri` local del prospecto (D8).
- Tres botones grandes: **Vender**, **Cobrar**, **Visita** (pendiente T-39 hasta la pieza 3; ya existe como `PantallaPendiente`). Se quita de la ficha "Merma, promoción, consumo y gasto": vive en el menú.
- Abajo: las notas pendientes del cliente (folio, fecha, saldo) y los registros de hoy, que ya existen en `registros.tsx` y en la ficha.
- Candado del día cerrado igual que hoy (T-38).

**Lo que se quita.** `operacion/index.tsx` deja de ser el camino principal y sobrevive como "Todos los clientes" en el menú. El `BotonMenu` de "Ruta y GPS" pasa al menú.

**Pruebas de pantalla:** no hay infraestructura de pruebas de pantalla en la tablet (solo `src/**/*.spec.ts` en Node). Toda la lógica de la pantalla principal que se pueda probar va a funciones puras en `src/estado/` (`ordenarRuta`, `agruparRuta` con visitado y fuera de ruta, `textoAvisoSinRuta`, `urlMapa(cliente)`, `urlTelefono`) con sus specs, siguiendo `menu-jornada.ts` de T-38.

## Portal

**D17 · Pantalla Ruta Diaria** en `apps/portal/src/app/(portal)/operacion/ruta-diaria/page.tsx` (sustituye al `Placeholder`), componentes en `components/rutas/`, cliente de API en `lib/rutas.ts` con el patrón de `lib/cobranzas.ts`.
- **Filtros:** sucursal (el selector global del portal), vendedor (de esa sucursal), fecha (por defecto hoy; se puede ir a días futuros).
- **Dos columnas:** izquierda, cartera de clientes activos de la sucursal con buscador y botón "Agregar"; derecha, la ruta del día numerada con subir / bajar / quitar. Las filas con `origen = 'vendedor'` llevan la etiqueta "agregada por el vendedor" y **no tienen quitar**, solo subir/bajar (D14). Si todas las filas son del vendedor, encabezado "Ruta armada por el vendedor" (D3).
- **Guardar ruta:** un botón manda la lista completa al `PUT`. Nada se guarda al mover; un error de red no deja la ruta a medias. Aviso de cambios sin guardar al cambiar de vendedor o fecha.
- **Copiar de ayer:** llama al `GET …/anterior` y carga esos clientes en la columna derecha **sin guardar**; el usuario revisa y guarda.
- **Sin mapa, sin seguimiento de visitas, sin efectividad** (T-41, pieza 3, T-46). Sin ruta semanal (T-36).
- **Pruebas:** unitarias de los componentes de lista y reorden (`*.test.tsx` con el patrón del portal) y de `lib/rutas.ts`; permisos y alcance los cubren las e2e del backend.

## Errores al vendedor

- Sin red al refrescar: el mensaje actual del motor; la lista no cambia.
- `cliente-inexistente` o `ruta-datos-invalidos` en un alta: la fila queda en `error` con el motivo y la pantalla principal la muestra con el mismo tratamiento que una venta rechazada (texto rojo bajo la fila). El vendedor puede quitarla (único caso en que se quita una fila: es suya y no existe en el servidor).
- `ruta-duplicada`: no se muestra; la fila pasa a sincronizada y, en el pull posterior, se funde con la del servidor.

## Aceptación manual en el emulador

Con la receta de `pruebas-manuales-emulador` (adb + uiautomator), antes de abrir el PR:
1. Día abierto sin ruta en Postgres → aviso de D3. Agregar dos clientes a mano → aparecen 1 y 2 con `sync_estado = 'pendiente'`.
2. Sincronizar → en Postgres dos filas `origen = 'vendedor'`; en la tablet las mismas con id del servidor y `sincronizada`.
3. Desde el portal asignar al vendedor: cliente A (uno de los dos) y cliente C (nuevo), guardar. En Postgres: A pasa a `oficina`, B sigue `vendedor`, C nuevo.
4. Arrastrar en la tablet para poner B primero. Sincronizar → la lista queda B, A, C (orden local de B respetado; C al final). Ninguna fila duplicada.
5. Cobrar a un cliente con dos notas pendientes **con el servidor apagado** (`adb reverse --remove`) → la burbuja pasa de 2 a 1 y la fila queda visitada.
6. Quitar A desde el portal y sincronizar: A ya tiene cobranza → se queda en "Fuera de ruta" visitado. Quitar C (sin actividad) → desaparece.
7. Teléfono abre el marcador; dirección abre Maps (en el emulador, el intent se ve en `logcat`).
8. Cerrar el día → lista en solo lectura y "Agregar a mi ruta" deshabilitado.

## Restricciones globales (van en el plan)

- Código en español, identificadores sin acentos, mensajes al usuario con acentos. Comentarios que explican *por qué*.
- Contrato aditivo: `CONTRATO_ACTUAL` se queda en 1; los dos `contrato.ts` y `docs/contrato-sincronizacion.md` cambian en la misma tarea.
- ADR-0009: una transacción por operación; una rechazada no deja fila; trazabilidad por `entidad_tabla`/`entidad_id`.
- Nada de `db reset`. Migración local 011 nueva, nunca se renumera una publicada.
- `npm run typecheck`, `lint` y `test` de backend, tablet y portal en verde; `npm run test:e2e` del backend contra el Postgres local; pgTAP con `npm run supabase -- test db --local`.
- Los implementadores no despachan subagentes, no empujan, no mergean.

## Fuera de alcance

Visita sin venta y fotos del servidor (pieza 3), geocodificación (4), gastos (6), firma (7), inventario y merma (T-24/T-27), mapa y GPS (T-41), ruta semanal (T-36), efectividad (T-46), notificación de clientes sin ruta (vault [[Ruta Diaria]]), subir el orden del vendedor al servidor.
