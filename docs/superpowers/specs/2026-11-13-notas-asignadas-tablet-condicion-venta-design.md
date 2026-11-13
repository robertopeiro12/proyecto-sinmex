# Notas asignadas en la tablet, condición de venta y comentario de no cobro — diseño

Fecha: 2026-11-13 · Backend + portal (PR 1) y tablet (PR 2) · Cierra la parte de tablet de la pieza 6 del MVP.

## 1. Para qué

La oficina ya asigna notas por cobrar a un vendedor para un día (Ruta Diaria parte 1, PR #155) y en la tarde revisa
cuáles no cobró (parte 2, PR #156). La tablet todavía no sabe nada de eso: baja las notas pendientes de toda la
sucursal, no distingue las asignadas, no muestra el recado y deja vender aunque el cliente no pague.

Lo que pidió Mario (2026-11-13), encima de lo que dijo el tío el 2026-11-10:

- Las notas asignadas son **dinero que la oficina le encargó al vendedor**: se le ponen enfrente al empezar la visita.
- **Puede cobrar notas no asignadas** del cliente; las asignadas salen primero y las demás abajo como información.
- Al **asignar la nota**, la oficina escoge si el vendedor **puede vender aunque no cobre**, **solo si liquida** o **solo
  si abona**.
- Si no cobra una asignada, **comentario obligatorio** y se sigue. **No** se registra Visita sin venta por esto.
- **Sin firma en pantalla ni reimpresión** de tickets al cobrar: el ticket de la venta es el único papel.

Fuentes:
- Respuestas del tío: vault `90-Fuentes/Respuestas del cliente 2026-11-10 Rutas (fuente).md`, R-3.5 a R-3.8.
- Spec de la parte 1: `docs/superpowers/specs/2026-11-10-ruta-semanal-y-diaria-design.md`, §9 "Lo que necesita la
  tablet". Nota para Mario en el PR #155.
- Tickets: #151 (T-79, asignar notas al vendedor) y #152 (T-80, bloquear venta y recado). Esta spec los **sustituye**:
  la asignación y el recado ya los hizo el #155; aquí van el bloqueo, el comentario y la tablet. El bloqueo de T-80
  **se mueve** del cliente en la ruta a la **nota asignada**.

## 2. Reglas

### Del tío (2026-11-10)
1. Una nota pagada en parte queda **abonado** y sigue por cobrar con su saldo (R-3.5). No se genera nota nueva.
2. En la ruta de la tablet se **señalan los clientes que traen nota asignada**, no todos los que deben: muchos los cobra
   administración por transferencia (R-3.8).
3. De cada nota asignada el vendedor ve **cliente, folio, fecha de la nota, cuánto debe y días de vencimiento** (R-3.8).

### Del equipo (Mario, 2026-11-13)
4. **El vendedor sí puede cobrar una nota que no le asignaron.** El tío dijo en R-3.6 que "solo puede cobrar las que le
   asignaron" y que el vendedor le habla a la oficina para que se la asignen. Decisión del equipo: no bloquear ese cobro;
   la asignada va primero y la oficina ve igual el cobro en el Flujo diario. Se registra aquí para que quede escrito.
5. **Condición de venta por nota asignada**, elegida por la oficina al asignar: `ninguna` (vende aunque no cobre),
   `liquidar` (vende solo si deja la nota en cero) o `abonar` (vende si le paga algo, lo que sea).
6. **Vender queda bloqueado** en la tablet mientras alguna nota asignada de hoy con condición no la cumpla con cobros
   **de hoy**. Con varias notas asignadas del mismo cliente, **todas** las que tienen condición deben cumplirla. El
   servidor **no** rechaza la venta (igual que la cobranza: se captura sin red y la oficina pudo asignar después).
7. **Comentario obligatorio** si no cobra una asignada: el vendedor dice "No pude cobrar", escribe por qué y sigue con
   la visita. Nada de Visita sin venta. El comentario **sube a la oficina** y se ve en la revisión de la tarde junto a la
   nota.
8. **Sin firma ni ticket** al cobrar o abonar. Fuera de este trabajo.

### Decisiones del agente (para revisar)
9. **Qué nota asignada "se pide"** en la tablet: asignación viva (`activo = 1`), con `fecha` = hoy por el reloj de la
   tablet, cuya nota local sigue viva con `saldo_centavos > 0`. Una asignada que la oficina ya cobró baja en el pull pero
   no se pide ni bloquea.
10. **Cuándo se cumple la condición**, con datos locales de la tablet:
    - Una nota con `nota_pendiente.saldo_centavos = 0` **nunca bloquea ni se pide**, la haya cobrado quien sea (regla 9):
      no hay nada que cobrar.
    - `liquidar`: la nota quedó en saldo 0.
    - `abonar`: **un cobro del vendedor registrado hoy tocó esa nota**. "Hoy" es la fecha de operación del cobro (el día
      de la jornada), **no** `fecha_pago`, que el vendedor puede retroceder. "Tocó" = la nota recibió dinero en el reparto
      del cobro, la haya elegido él o no; para saberlo la tabla local `cobranza` guarda el reparto (`reparto_json`,
      migración 019). Un abono que registró la oficina **no** cumple `abonar` (la condición es "si *te* paga"); solo
      cumple si dejó la nota en cero. **No** se usa `abonos_json`: el pull lo pisa con lo del servidor y trae también
      los cobros de la oficina.
11. **La nota sale primero, cada vez** (Mario, 2026-11-13). Al empezar a operar con el cliente (abrir su ficha y al
    picar **Vender**), si tiene notas asignadas sin cobrar hoy, la app las pone enfrente **antes** de seguir, con dos
    opciones: **Cobrar** o **Continuar sin cobrar**. Continuar sin cobrar pide **comentario obligatorio** (por qué no
    pagó). Lo que sigue depende de la condición: sin condición vende; con condición sin cumplir, Vender queda bloqueado.
    **El vendedor puede regresar**: si vuelve a abrir la ficha más tarde, la nota sale otra vez con las mismas dos
    opciones, y puede cobrarla. Cada "Continuar sin cobrar" deja su propio comentario (una fila por intento); la oficina
    ve el último. La nota deja de salir solo cuando un cobro del vendedor de hoy la tocó (regla 10) o quedó en cero.
12. **Dónde vive el comentario en el servidor**: tabla nueva `nota_no_cobrada`, una fila por comentario, con `id = clave`
    como las demás proyecciones del push (visita, gasto, movimiento). No es una columna de `nota_asignada`: el push
    siempre inserta, nunca actualiza, y una columna ahí movería `updated_at` y haría bajar la asignación otra vez.
13. **El comentario se acepta aunque la asignación ya no exista** cuando llega el push (la oficina la pasó a otro o la
    quitó, o eliminó la venta): se guarda igual, referido a la nota, el vendedor del token y la fecha. Mismo criterio que
    la cobranza de una nota que ya no tiene saldo (D9 de T-21). Lo único que se rechaza es una nota que no existe o no
    es de la sucursal del vendedor (`nota-no-encontrada`).
14. **Cambiar la condición = volver a asignar** (Mario, 2026-11-13): la oficina quita la nota y la vuelve a asignar con
    otra condición. El `PUT` para el mismo vendedor sigue siendo un no-op aunque traiga otra condición (no se edita en
    sitio). **Pasar** la nota a otro vendedor es una asignación nueva: lleva la condición que la oficina escoja al
    pasarla (el selector arranca con la que tenía).
15. **La tablet guarda también `recado` y `rutas_dia`** en la misma migración local, aunque la pantalla de esta pieza
    solo use el recado. Razón: el pull ya los manda y cada versión que agrega colecciones obliga a un pull completo
    en todas las tablets; mejor una sola vez. Vehículo propuesto y kilometraje por vehículo quedan para otra pieza,
    pero ya con los datos abajo.
16. **El pull completo lo dispara la propia migración 019**, no un paso a mano: la migración borra el cursor del pull
    (`olvidarCursor()` ya existe en `repositorios/sync.ts`), así la primera sincronización tras instalar baja todo y
    recoge `recado`, `rutas_dia` y `notas_asignadas` que una tablet vieja ya se saltó. Sin `pm clear`, que borraría
    operaciones locales sin subir.
17. **"No pude cobrar" cuenta como visita al cliente**: en la ruta de la tablet el cliente queda con palomita (como el
    visitado sin venta) y en la pestaña Ruta de la oficina deja de salir "Cliente no visitado" (se lee `nota_no_cobrada`
    además de ventas y visitas). Si no, un vendedor bloqueado por la condición y sin cobro quedaría como si nunca hubiera
    ido.
18. **El comentario se cruza por nota y fecha, no por vendedor**, y se muestra con el nombre de quien lo escribió. Si A
    comentó y la oficina le pasó la nota a B, la revisión de B ve "A: el cliente no estaba"; la de A ya no muestra la nota
    (su asignación está dada de baja).

## 3. Datos (nube, migración `20261113120000_nota_asignada_condicion.sql`)

```sql
alter table nota_asignada
  add column condicion_venta text not null default 'ninguna'
    check (condicion_venta in ('ninguna', 'liquidar', 'abonar'));

-- Comentario del vendedor cuando no cobra una nota asignada. id = clave del push.
create table nota_no_cobrada (
  id             uuid primary key,
  venta_nota_id  uuid not null references venta_nota(id),
  vendedor_id    uuid not null references vendedor(id),
  sucursal_id    uuid not null references sucursal(id),
  fecha          date not null,                 -- fecha_operacion del sobre
  comentario     text not null check (char_length(comentario) between 1 and 300),
  registrado_en  timestamptz not null,          -- cuando lo guardó la tablet
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz
);
create trigger trg_nota_no_cobrada_updated before update on nota_no_cobrada
  for each row execute function set_updated_at();
create index idx_nota_no_cobrada_vendedor_fecha on nota_no_cobrada (vendedor_id, fecha) where deleted_at is null;
create index idx_nota_no_cobrada_nota on nota_no_cobrada (venta_nota_id) where deleted_at is null;
```

Pre-flight: una columna con default y una tabla nueva; nada que contar. `updated_at` de `nota_asignada` se mueve al
cambiar la condición, y eso es lo que queremos: la tablet la vuelve a bajar.

## 4. Backend (PR 1, con el portal)

### Asignar con condición (`modules/rutas/`)
- `AsignarNotaDto` gana `condicionVenta?: 'ninguna' | 'liquidar' | 'abonar'` (default `ninguna`).
- `NotasAsignadasService.asignar`: si la asignación viva ya es de este vendedor y la condición cambia, **actualiza**
  la columna (hoy regresa sin hacer nada). Al asignar o pasar, inserta con la condición del cuerpo.
- `NotaDeRuta` gana `condicionVenta` (null si no está asignada) para que el portal la muestre.

### Pull (`modules/sincronizacion/`)
- `NotaAsignadaPull` gana `condicion_venta: 'ninguna' | 'liquidar' | 'abonar'`. Aditivo; `CONTRATO_ACTUAL` sigue en 1.
- `notasAsignadas()` la selecciona. Nada más cambia: ventana de ayer en adelante, incremental por `updated_at`.

### Push: operación nueva `nota-no-cobrada`
- `TIPOS_OPERACION` += `'nota-no-cobrada'`. Sobre: `cliente_id` obligatorio (pasa por el alcance del lote), **sin
  folio**, `clave` = uuid = `nota_no_cobrada.id`, `fecha_operacion` = el día.
- `DatosNotaNoCobrada = { venta_nota_id: string; comentario: string /* 1..300, recortado */; registrado_en: string /* ISO con zona */ }`.
- `despacho-nota-no-cobrada.ts`: `prepararNotaNoCobrada` puro, antes de la transacción (clave uuid, sin folio, con
  `cliente_id`, forma de `datos`) → `datos-invalidos`. `CODIGO_POR_RAZON_NOTA_NO_COBRADA`.
- Dominio en `modules/rutas/notas-no-cobradas.service.ts` (`registrar(datos, {id, sucursalId, vendedorId, clienteId,
  fechaOperacion}, trx)`): la nota debe existir, estar viva o no (una venta borrada después del comentario se acepta:
  regla 13), ser del `cliente_id` del sobre y de la sucursal del token; si no, `nota-no-encontrada` (código que ya
  existe). `insert ... on conflict (id) do nothing`; si no insertó, `nota-no-cobrada-id-ocupado` (código nuevo, motivo
  neutro). La misma clave del mismo vendedor es `duplicada` por el buzón, como siempre. Entidad del buzón:
  `nota_no_cobrada`.
- `despacho.ts`: variante en `Proyeccion` y `case` en `prepararProyeccion`; `sincronizacion.service.ts`: `case` en
  `proyectar` y `instanceof NotaNoCobradaRechazada` en el `catch`.
- Orden del push de la tablet: `… → cobranzas → notas-no-cobradas → visitas → …` (después de las cobranzas, para que un
  cobro y un comentario del mismo día lleguen en ese orden; no hay dependencia dura).
- `docs/contrato-sincronizacion.md`: tipo nuevo, `condicion_venta`, código nuevo, orden del push.

### Revisión de la tarde (`modules/estadisticas/`)
- `NotaRevision` gana `comentarioVendedor: { texto, vendedor } | null` y `condicionVenta`.
  `detalle.repository.asignadas()` hace `left join lateral` al último `nota_no_cobrada` vivo de esa **nota y fecha**
  (cualquier vendedor, decisión 18), con el nombre del vendedor que lo escribió.
- Solo se muestra; no cambia el conteo de no entregadas ni las tres listas.
- **Pestaña Ruta** (`reglas-detalle.ts`, `detalle.repository.ts`): un cliente con `nota_no_cobrada` del vendedor ese día
  cuenta como visitado (decisión 17), con el texto "No cobró: <comentario>" en vez de "Cliente no visitado".

## 5. Portal (PR 1)

### Ventana de notas (`components/rutas/ventana-notas.tsx`)
- Columna nueva **"Condición"** entre "Días de atraso" y "Acción" (colgroup pasa a 7; `FilaVacia columnas={7}`).
  - Nota **sin asignar**, editable: un selector con "Puede vender", "Vender solo si liquida", "Vender solo si abona"
    (default "Puede vender") y el botón **Asignar**. Un clic en Asignar manda la condición elegida.
  - Nota **asignada a este vendedor**: texto de la condición y **Quitar**. Para cambiarla se quita y se vuelve a
    asignar (decisión 14).
  - Nota **de otro vendedor**, editable: "La trae X · <condición>", el selector (arranca con la condición que tenía) y
    **Pasársela**, que manda la elegida.
  - Solo lectura (día pasado): texto.
- `lib/rutas.ts`: `asignarNota(ventaNotaId, vendedorId, fecha, condicionVenta)`; `NotaDeRuta.condicionVenta`.

### Revisión de la tarde (`components/flujo-diario/detalle-vendedor-pestanas.tsx`)
- En "Notas Asignadas NO cobradas por Entregar", debajo del folio o en una columna "Comentario del vendedor", el texto
  que dejó; vacío si cobró o no comentó. La condición como pastilla corta ("Solo si liquida") junto al folio.

## 6. Tablet (PR 2)

### Contrato y migración local 019 (`019-notas-asignadas.ts`)
- Copiar a `apps/tablet/src/sincronizacion/contrato.ts`: `RutaPull.recado`, `RutaDiaPull`, `NotaAsignadaPull` (con
  `condicion_venta`), `rutas_dia` y `notas_asignadas` en `RespuestaPull`; `'nota-no-cobrada'` en `TipoOperacion`;
  `DatosNotaNoCobrada`; `'nota-no-cobrada-id-ocupado'` en `CODIGOS_RECHAZO`.
- SQLite:
  - `alter table ruta add column recado text;`
  - `ruta_dia (id text pk, fecha text not null, nombre_ruta text, vehiculo_id text, activo integer not null default 1,
    sincronizado_en text not null)`.
  - `nota_asignada (id text pk, venta_nota_id text not null, fecha text not null, condicion_venta text not null
    check in ('ninguna','liquidar','abonar'), activo integer not null default 1, sincronizado_en text not null)` con
    índice `(fecha) where activo = 1`. Sin FK a `nota_pendiente`: la asignación puede bajar antes que la nota (orden del
    snapshot) o referir una nota que la tablet ya no tiene; se cruza al leer.
  - `nota_no_cobrada (id text pk, venta_nota_id text not null, cliente_id text not null, fecha text not null,
    comentario text not null, registrado_en text not null, sync_estado text not null default 'pendiente' check in
    ('pendiente','enviando','sincronizado','error'), sync_error text, sincronizado_en text)` con
    `idx_nota_no_cobrada_sync (sync_estado) where sync_estado <> 'sincronizado'` e índice `(venta_nota_id, fecha)`.
  - `alter table cobranza add column reparto_json text not null default '[]';` — las líneas del reparto del cobro
    (`[{venta_nota_id, monto_centavos}]`) tal como las calculó la tablet al grabar; `cobranzas.registrar` las guarda
    desde entonces. Es lo que lee la regla 10. Las cobranzas anteriores a la migración quedan con `[]` (son de días
    pasados: no afectan "hoy").
  - La migración termina llamando `olvidarCursor()` (decisión 16).
- `aSnapshot` / `guardarSnapshot`: `ruta` con `recado`; `rutas_dia` y `notas_asignadas` por upsert sobre `id` con su
  `activo` (bandera, nunca ausencia), después de `nota_pendiente`.

### Repositorio `notasAsignadas` (`src/datos/repositorios/notas-asignadas.ts`)
- `delDia(fecha)`: asignadas vivas de hoy cruzadas con `nota_pendiente` viva, saldo > 0, con cliente, folio, fecha,
  saldo, días de atraso (`hoy − (fecha + cliente.plazo_credito_dias)`, mínimo 0; sin plazo = 0, igual que el servidor) y
  condición.
- `porCliente(clienteId, fecha)` y `porAtender(clienteId, fecha)`: las que no tienen cobro de hoy ni comentario de hoy
  (regla 11).
- `bloqueoDeVenta(clienteId, fecha): string | null`: motivo si alguna asignada con condición no la cumple (regla 10).
  Textos: "Tiene una nota asignada que debe liquidar antes de venderle" / "… que debe abonar antes de venderle".
- `registrarNoCobrada({ventaNotaId, clienteId, comentario})`: exige jornada abierta, comentario 1..300 recortado,
  inserta `nota_no_cobrada` con `id` uuid, `fecha` = hoy, `registrado_en` = ahora. Más `pendientesDeSincronizar`,
  `marcarSincronizada`, `marcarError` (patrón de gastos). Un comentario grabado no se edita ni se borra.

### Ruta del día (`lista-ruta.tsx`, `rutas.delDia()`)
- Cada fila gana `notas_asignadas` (conteo de asignadas de hoy con saldo) y `recado`. La burbuja de notas pendientes se
  queda; junto a ella una **marca** distinta cuando `notas_asignadas > 0` (por ejemplo "Nota asignada · 2"). El recado se
  muestra en la fila, debajo del nombre, en una línea.
- `visitado` también es verdadero si hay `nota_no_cobrada` de hoy del cliente (decisión 17); en `agruparRuta` ese
  cliente va a "Visitados sin venta" salvo que además tenga venta (atendido gana, como con la visita).

### Ficha del cliente (`operacion/[clienteId]/index.tsx`)
- Arriba, antes de los botones, una **tarjeta "Notas asignadas por cobrar"** si `porCliente` no está vacía: una fila por
  nota con folio, fecha, saldo, días de atraso y condición ("Debe liquidar" / "Debe abonar" / nada). Si el cliente trae
  recado, el recado va primero, en su propia tarjeta "Mensaje de la oficina".
- Si hay notas **por atender** (regla 11), la tarjeta trae dos botones: **Cobrar** (va a la pantalla de cobro con la
  primera asignada preseleccionada) y **Continuar sin cobrar** (abre el comentario). El comentario es un campo de texto
  obligatorio con "Guardar"; al guardar, el vendedor sigue en la ficha. Si vuelve a abrir la ficha más tarde, la nota
  sale otra vez.
- **Vender con notas por atender** abre primero esa misma pantalla de la nota (Cobrar / Continuar sin cobrar). Después
  de continuar sin cobrar, entra a la venta si no hay condición; si la hay, se queda en la ficha con el motivo.
- **Vender** se deshabilita con el motivo de `bloqueoDeVenta` debajo del botón mientras la condición no se cumpla. El
  bloqueo también se exige dentro de `ventas.registrar()` (como la carga pendiente) por si llegan por otro camino.
- Lo demás de la ficha no cambia: Visita, Merma y la lista de notas pendientes siguen igual.

### Cobrar (`operacion/[clienteId]/cobranza.tsx`)
- Las notas se listan en dos grupos: **"Asignadas a ti"** primero, luego **"Otras notas del cliente"**. Ambos se pueden
  elegir. Cada tarjeta de asignada muestra la condición. El reparto y el registro no cambian.
- Al grabar un cobro que cumple la condición, la ficha deja de bloquear Vender sin más pasos (lo decide `bloqueoDeVenta`
  leyendo `nota_pendiente`).

### Push
- `fuente-notas-no-cobradas.ts` (`FuenteOperaciones`): `tipo: 'nota-no-cobrada'`, `clave` = id, `cliente_id` en el
  sobre, `fecha_operacion` = fecha, `ocurrido_en` = `registrado_en`, `datos` = `{venta_nota_id, comentario,
  registrado_en}`. Registrar en `fuentesDelPush` (después de Cobranzas), `FuentesConPendientes` y
  `contarPendientesDeSubir`.
- Rechazo `nota-no-encontrada` o `nota-no-cobrada-id-ocupado`: la fila queda en `error` con el motivo y se ve en la
  ficha como las demás; no se reintenta sola.

### Cerrar el día
- Sin cambios. No se exige atender todas las asignadas para cerrar (la oficina lo ve en la revisión de la tarde).

## 7. Despliegue

1. PR 1: migración a `sinmex dev` con el protocolo de CLAUDE.md; **backend y portal juntos** (el `PUT` de notas cambia
   de cuerpo de forma compatible, pero el portal nuevo manda la condición y la quiere ver de regreso).
2. PR 2: backend antes que la app (un servidor viejo responde `tipo-desconocido` a `nota-no-cobrada`).
3. **Al instalar la app** no hay paso a mano: la migración local 019 borra el cursor del pull (decisión 16) y la primera
   sincronización baja todo, incluidos `recado`, `rutas_dia` y `notas_asignadas` que una tablet vieja se saltó (nota del
   PR #155). Las operaciones locales sin subir se conservan.

## 8. Fuera de alcance

- Firma en pantalla al abonar y reimpresión de tickets "ABONADO" / "LIQUIDADA" (R-3.6, R-3.7). Sin impresión en la app.
- Vehículo propuesto al abrir el día y kilometraje por vehículo (R-4.1): los datos ya quedan en `ruta_dia`.
- Control impreso del inventario de notas (T-79) y la sincronización automática (T-44).
- Impedir que el vendedor cobre notas no asignadas (R-3.6 del tío): decisión 4.

## 9. Respuestas de Mario (2026-11-13)

1. La nota sale primero al empezar a operar con el cliente, con **Cobrar** o **Continuar sin cobrar** (comentario
   obligatorio); después manda la condición. Cerrar el día no se bloquea (regla 11).
2. Cambiar la condición = quitar y volver a asignar (decisión 14).
3. El vendedor puede regresar y volver a intentar cobrar: la nota sale de nuevo al reabrir la ficha (regla 11).
4. El PR 1 (servidor y portal) lo hace esta misma sesión. El resto de la spec, de acuerdo, incluido guardar `recado` y
   `rutas_dia` en la migración 019.
