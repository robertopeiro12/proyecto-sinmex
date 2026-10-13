# T-34 · Peticiones / Autorizaciones — borrar un cobro con autorización (Portal) — Diseño

**Issue:** [#34](https://github.com/robertopeiro12/proyecto-sinmex/issues/34)
**Fecha:** 2026-10-13 · **Estado:** propuesto, pendiente de revisión de Roberto
**Base:** `Cobranza-Abono.md`, `Ventas y Cobranza.md`, `Portal Web.md`, `Usuario.md` y `Perfil.md` del vault;
T-20 (cobranza de la tablet), T-21 (cobranza del portal, `cobranzas.service.ts`), T-17 parte 2 (edición de
ventas, `ventas-edicion.*`).

## 1. Para qué

Fuentes del cliente (solo lectura, `90-Fuentes/` del vault):

> *Cambios v2.0:* "Proceso de eliminar una cobranza no funciona […] pasa seguido que se equivocan cuando una
> venta es de crédito y la marcaron como de contado, es decir, ya cobrada. Entonces lo que hacen actualmente es
> mandar a eliminar la nota completa y vuelven a capturar todo. Se debe corregir esto para que se pueda eliminar
> la cobranza y que siga el mismo procedimiento en donde el administrador desde el portal web autoriza, y el
> vendedor en la app, nuevamente ponga la opción de liquidar cobranza."

> *Julio 2027:* "Peticiones: el vendedor pide desde la app eliminar una venta/cobranza y administración
> autoriza (candado anti-fraude)." · Permiso "Peticiones (autorizar/denegar eliminación de ventas y cobranzas
> del día)".

**Qué ya existe y qué falta.** El caso típico del cliente ("la marcaron de contado y era crédito") ya se
corrige desde T-17: editar la venta de contado a crédito borra su cobro automático de contado. Lo que **no
existe** es quitar un **cobro** de verdad (origen `cobro`, de la tablet o del portal) ni una **aplicación de
saldo a favor** (origen `saldo_favor`, T-21). Y mientras una venta tenga uno de esos vivo, **no se puede
editar ni eliminar** (`abonosDeCobroVivos`). T-34 es esa pieza, con su bandeja de autorización.

### Reparto de responsabilidades

**El Portal es de Roberto y la App de tablet es de Mario.** T-34 **no toca `apps/tablet`**: la tablet ya
recibe sola las notas que vuelven a deber (§4.5). Pedir el borrado desde la app queda para Mario (§8).

## 2. Decisiones de producto (Roberto, 2026-10-13)

| Tema | Decisión |
|---|---|
| Flujo | **Petición en el portal.** Quien tiene `cobranza.editar_eliminar` pide el borrado con un motivo; cae en una **Bandeja de Peticiones** y quien tiene `peticiones.gestionar` la **autoriza** (se borra) o la **deniega**. Sin tocar la app |
| Alcance | **Solo cobros.** Borrar ventas sigue directo como en T-17. La bandeja nace genérica (columna `tipo`) para sumar otros tipos después |
| Qué se borra | **El pago completo**: todas sus filas en notas y su movimiento de saldo a favor. Nunca un pedazo |
| Quién autoriza | **Puede ser la misma persona** que pidió si tiene los dos permisos. Queda registrado quién pidió y quién resolvió |
| Antigüedad | **Cualquier fecha.** Siempre hay autorización de por medio; un futuro cierre de corte/tesorería pondrá su propio candado |
| Modelo | **Tabla `cobro`** (un renglón por pago); abonos y saldo a favor apuntan a ella con `cobro_id` |

## 3. Pantallas

### 3.1 Pedir el borrado

Dos lugares, mismo componente:

- **Detalle de una venta** (`/operacion/ventas`, el detalle de T-17): en la lista de cobros de la nota, cada
  fila que pertenece a un pago (`cobroId` no nulo; el cobro de contado no) tiene **"Pedir borrado"**.
- **Cobranza** (`/operacion/cobranza`, T-21): en los abonos anteriores desplegables de cada nota, el mismo botón.

El botón abre un diálogo:

1. **Vista previa** (`GET /cobros/:id/vista-borrado`): "Pago de $1,000.00 · Tacos Erick · 10/10/2026 ·
   Efectivo · cobró Juan Pérez (o Oficina)", una tabla con cada nota del pago (folio, # de nota, lo que le
   abonó este pago, saldo hoy → saldo tras borrar, status tras borrar) y, si aplica, "Saldo a favor:
   $300.00 → $200.00" (o "+$50.00" si el pago era una aplicación de saldo a favor).
2. Si la vista previa trae un **bloqueo** (§4.3, saldo a favor ya aplicado), se muestra como aviso: la
   petición se puede enviar igual (lo que importa es el estado al autorizar), pero el usuario sabe que hoy no
   se autorizaría.
3. Campo **Motivo** (obligatorio, hasta 500 caracteres) y **"Enviar petición"**.

Si el pago ya tiene una petición pendiente, en lugar del botón se lee **"Borrado pedido · pendiente"**. Sin
`cobranza.editar_eliminar` el botón no se muestra. Un pago borrado ya no aparece (sus filas tienen
`deleted_at`).

### 3.2 Bandeja: Operación → Peticiones

Ruta existente **`/operacion/peticiones`** (hoy placeholder "Próximamente"). Sin `peticiones.gestionar`:
"No tienes permiso para ver peticiones".

- Pestañas **Pendientes** (default) e **Historial** (autorizadas y denegadas, las 200 más recientes por
  fecha de resolución).
- Respeta el **filtro global "Por sucursal"** (sucursal del cliente del pago).
- Columnas: fecha de la petición, quién la pidió, cliente, el pago (fecha, monto, método, quién cobró),
  notas afectadas (folios), motivo. En Historial además: resultado, quién resolvió, cuándo y el comentario.
- **Autorizar**: abre la misma vista previa, **recalculada en ese momento**, y pide confirmar.
- **Denegar**: pide un comentario opcional (hasta 500 caracteres).
- Si autorizar falla (409), el mensaje del servidor se muestra en el diálogo y la petición sigue pendiente;
  la lista se recarga.

**Producción → Peticiones** (`/produccion/peticiones`) no cambia: son peticiones de recarga, de otro ticket.

## 4. Diseño técnico

### 4.1 Modelo de datos (migración `20261013120000_peticiones_cobro.sql`)

**Tabla `cobro`** — un pago recibido o una aplicación de saldo a favor:

```sql
create table cobro (
  id                       uuid primary key default gen_random_uuid(),
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  deleted_at               timestamptz,
  cliente_id               uuid not null references cliente(id),
  -- El cobrador: un vendedor, o null = Oficina (T-21). Una aplicación de saldo a favor va siempre null.
  vendedor_id              uuid references vendedor(id),
  -- Quién lo capturó en el portal; null = vino de la tablet.
  capturo_usuario_id       uuid references usuario(id),
  origen                   text not null,   -- 'cobro' | 'saldo_favor'
  metodo_pago              text not null,   -- 'efectivo' | 'transferencia' | 'cheque' | 'saldo_favor'
  monto                    numeric(12,2) not null,   -- lo recibido (o lo aplicado), sobrante incluido
  fecha_pago               date not null,
  fecha_operacion          date not null,
  eliminado_por_usuario_id uuid references usuario(id),
  constraint ck_cobro_origen check (origen in ('cobro', 'saldo_favor')),
  constraint ck_cobro_metodo check (metodo_pago in ('efectivo', 'transferencia', 'cheque', 'saldo_favor')),
  constraint ck_cobro_saldo_favor check ((origen = 'saldo_favor') = (metodo_pago = 'saldo_favor')),
  constraint ck_cobro_monto_positivo check (monto > 0),
  constraint ck_cobro_borrado check ((deleted_at is null) = (eliminado_por_usuario_id is null))
);
create trigger trg_cobro_updated before update on cobro for each row execute function set_updated_at();
create index idx_cobro_cliente on cobro (cliente_id) where deleted_at is null;
```

**`cobro_id`** en `cobranza_abono` y `saldo_favor_movimiento` (FK a `cobro`, con índice):

- `cobranza_abono`: `check ((origen = 'venta_contado') = (cobro_id is null))` — el cobro automático de una
  venta de contado no es un pago aparte; todo lo demás pertenece a uno.
- `saldo_favor_movimiento`: `cobro_id not null` (hoy solo hay `excedente_cobro` y `aplicacion`, y los dos
  salen de un pago).

**Tabla `peticion`** — la bandeja:

```sql
create table peticion (
  id                       uuid primary key default gen_random_uuid(),
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  tipo                     text not null,
  status                   text not null default 'pendiente',
  cobro_id                 uuid references cobro(id),
  -- La sucursal del cliente al pedir: el filtro "Por sucursal" y el alcance.
  sucursal_id              uuid not null references sucursal(id),
  motivo                   text not null,
  solicito_usuario_id      uuid not null references usuario(id),
  resuelta_por_usuario_id  uuid references usuario(id),
  resuelta_en              timestamptz,
  comentario_resolucion    text,
  constraint ck_peticion_tipo check (tipo in ('eliminar_cobro')),
  constraint ck_peticion_status check (status in ('pendiente', 'autorizada', 'denegada')),
  constraint ck_peticion_objetivo check ((tipo = 'eliminar_cobro') = (cobro_id is not null)),
  constraint ck_peticion_motivo check (length(btrim(motivo)) between 1 and 500),
  constraint ck_peticion_resolucion check (
    (status = 'pendiente') = (resuelta_por_usuario_id is null)
    and (status = 'pendiente') = (resuelta_en is null)),
  constraint ck_peticion_comentario check (
    comentario_resolucion is null or (status = 'denegada' and length(comentario_resolucion) <= 500))
);
create trigger trg_peticion_updated before update on peticion for each row execute function set_updated_at();
create unique index uq_peticion_cobro_pendiente on peticion (cobro_id) where status = 'pendiente';
create index idx_peticion_status_sucursal on peticion (status, sucursal_id, created_at);
```

Sin `deleted_at` en `peticion`: una petición no se borra, se resuelve.

**Relleno de los pagos que ya existen** (dentro de la misma migración, antes de los checks):

- Un pago = las filas de `cobranza_abono` con origen `cobro` o `saldo_favor` que comparten **cliente de la
  nota, `created_at`, origen, `vendedor_id`, `capturo_usuario_id`, `metodo_pago`, `fecha_pago` y
  `fecha_operacion`**. `created_at` es `now()`, la hora de **inicio de la transacción**, idéntica para todas
  las filas de un mismo cobro (la tablet y el portal escriben cada cobro en su propia transacción).
- Su `saldo_favor_movimiento` (excedente o aplicación) es el del mismo cliente y el mismo `created_at`. Un
  excedente sin filas en notas (todo el pago quedó a favor) genera su propio `cobro` (origen `cobro`, su
  vendedor y capturista, método `efectivo`: el movimiento no guarda método).
  **Ojo:** ese método es una suposición que solo afecta a filas de prueba (en `sinmex dev` no hay cobros, ver
  §4.7).
- `monto` del pago = suma de sus filas + su excedente; en una aplicación, la suma de sus filas.
- **Pre-flight / validación dentro de la migración:** tras rellenar, `do $$ … raise exception …` si queda
  alguna fila de `cobranza_abono` no-contado o de `saldo_favor_movimiento` sin `cobro_id`. Así la migración
  falla entera en vez de dejar datos a medias.

**Permisos:** ya están sembrados (T-05): `peticiones.gestionar` ("Autorizar/denegar eliminación de ventas y
cobranzas") y `cobranza.editar_eliminar`. No se siembra nada.

### 4.2 Los cobros nuevos nacen con su `cobro`

- `CobranzasRepository.insertarCobro(...)` → id. `NuevoAbono` y `NuevoSaldoFavor` ganan `cobroId`.
- `CobranzasService.escribir` inserta primero el `cobro` (cliente, cobrador, capturista, origen, método,
  monto = el pago completo, fechas) y pasa su id a cada abono y al excedente. `aplicarSaldoFavor` hace lo
  mismo con origen y método `saldo_favor`, y su movimiento negativo `aplicacion` lleva el mismo `cobro_id`.
- Cubre los tres caminos: tablet (push `cobranza`), portal (registrar) y portal (aplicar saldo a favor).
- **La venta de contado no cambia**: su abono `venta_contado` (en `ventas.service.ts` y en la edición de
  `ventas-edicion.service.ts`) sigue con `cobro_id` null.
- **Entidad del push de la tablet:** la operación `cobranza` registra en `sync_operacion` la entidad
  `('cobro', id)` en vez de "la primera fila de `cobranza_abono` o el movimiento". Es interno del servidor;
  `docs/contrato-sincronizacion.md` (pasos del push de cobranza) se actualiza. El contrato no cambia.

### 4.3 Borrar un pago — `CobrosBorradoService` (en `ventas-cobranza/`)

Una regla pura, `planearBorrado` (`reglas-borrado-cobro.ts`, sin base), recibe el pago, sus filas por nota,
el total y el abonado vivo actual de cada nota, el status actual de cada nota, el saldo a favor vivo del
cliente y el movimiento del pago; devuelve por nota `saldoAntes`, `saldoDespues` y `statusDespues`, el saldo a
favor antes/después y un **bloqueo** opcional:

- **Status tras borrar**, por nota del pago: `cuenta_perdida` se queda igual; si no, con lo que le queda
  abonado vivo (sin las filas de este pago): `0` → `pendiente`, `≥ monto_total` → `pagada`, si no `abonado`.
- **Bloqueo `saldo-favor-aplicado`**: si el pago dejó excedente y el saldo a favor vivo del cliente **menos**
  ese excedente queda **< 0**. Mensaje: "El saldo a favor que dejó este pago ya se aplicó a otras notas.
  Primero borra el pago que lo aplicó."

`vistaPrevia(cobroId, usuario)` — lectura sin candados, para pintar (§3.1). Exige alcance sobre la sucursal
del cliente. 404 si el pago no existe; si ya está borrado, 409 `cobro-borrado`.

`borrar(cobroId, usuarioId, trx)` — **solo lo llama la autorización** (§4.4), dentro de su transacción:

1. Lee el pago (`cliente_id`, notas de sus filas vivas).
2. **Candados, en el mismo orden que el cobro** (sin abrazo mortal con T-20/T-21):
   `bloquearNotasDelCliente(cliente, notasDelPago)` → `bloquearSaldoFavor(cliente)` → la fila de `cobro`
   `for update`.
3. Si el pago ya tiene `deleted_at` → 409 `cobro-borrado`.
4. Recalcula con `planearBorrado` sobre lo **bloqueado** (abonado vivo leído después de los candados). Si hay
   bloqueo → 409 con su mensaje (no escribe nada).
5. Escribe: `cobro.deleted_at = now()` y `eliminado_por_usuario_id`; `deleted_at` en sus filas de
   `cobranza_abono` y en su `saldo_favor_movimiento`; `status` de cada nota del pago (se escribe aunque no
   cambie: el trigger toca `updated_at` y el pull lo ve); si hubo movimiento de saldo a favor,
   `cliente.updated_at = now()` (igual que `insertarSaldoFavor`).

Una nota **facturada** sí admite borrar un pago (no cambia la venta). Una nota **borrada** no puede tener
pagos vivos (T-17 impide eliminar una venta con cobros), así que no es caso.

### 4.4 Peticiones — `PeticionesService` y `peticiones.controller.ts` (en `ventas-cobranza/`)

| Endpoint | Permiso | Qué hace |
|---|---|---|
| `GET /peticiones?status=pendiente\|historial&sucursal=` | `peticiones.gestionar` | La bandeja (§3.2). `sucursal` sigue la regla de `resolverAlcance` |
| `POST /peticiones/eliminar-cobro` `{ cobroId, motivo }` | `cobranza.editar_eliminar` | Crea la petición |
| `POST /peticiones/:id/autorizar` | `peticiones.gestionar` | Autoriza y borra (§4.3) |
| `POST /peticiones/:id/denegar` `{ comentario? }` | `peticiones.gestionar` | Deniega |
| `GET /cobros/:id/vista-borrado` | `cobranza.editar_eliminar` **o** `peticiones.gestionar` | Vista previa (§4.3) |

`@RequierePermiso` acepta un solo permiso; el "o" de la vista previa se resuelve en el servicio con
`PermisosRepository.permisosDe(usuarioId)` (no se agrega una regla nueva al guard ni a la resolución de
permisos): sin ninguno de los dos → 403. Respuestas en camelCase, como
T-37.

**Crear** (`solicitarEliminarCobro`): el pago existe (404), alcance sobre la sucursal de su cliente (403, con
`exigirAlcanceSobre`), no está borrado (409 `cobro-borrado`), motivo con texto tras `trim` (400). Inserta con
`sucursal_id` = sucursal del cliente. Si choca con `uq_peticion_cobro_pendiente` (`23505`) → 409
`peticion-pendiente`: "Este cobro ya tiene una petición de borrado pendiente."

**Autorizar**: en una transacción, `select … from peticion where id = $1 for update` **primero** (ningún
cobro bloquea peticiones, así que no hay ciclo con §4.3); alcance (403); si `status <> 'pendiente'` → 409
`peticion-resuelta`: "Esta petición ya fue resuelta." Luego `CobrosBorradoService.borrar` y
`status = 'autorizada'`, `resuelta_por_usuario_id`, `resuelta_en = now()`. Un 409 de `borrar` revierte todo:
la petición sigue pendiente. Dos autorizaciones a la vez: la segunda espera el candado y sale con
`peticion-resuelta`. Interbloqueo de Postgres (`40P01`) → 409 "Otro movimiento tocó estas notas al mismo
tiempo. Intenta de nuevo." (como `MOTIVO_INTERBLOQUEO_COBRO`).

**Denegar**: mismo candado y mismas comprobaciones; `status = 'denegada'` con comentario opcional (`trim`;
vacío → null). El pago no cambia y después se puede volver a pedir.

**Que el mismo usuario pida y autorice está permitido** (decisión de Roberto, §2).

### 4.5 Lo que ya existe y hay que cuidar

- **Tablet / pull (sin cambios en la app):** las notas del pago reciben `update` de status → `updated_at`
  nuevo; el pull incremental baja las notas con status `pendiente`/`abonado` y su lista de abonos **vivos**
  (`ca.deleted_at is null` ya está). La tablet hace upsert sobre `nota_pendiente`, así que una nota que
  estaba cerrada (`activo: 0`) vuelve con `activo: 1`. El saldo a favor baja porque se toca
  `cliente.updated_at`. **Queda cubierto por e2e** (§6).
- **Una nota que sigue `pagada`** tras borrar (otro pago la cubre) no viaja en el incremental si era de
  contado: no importa, no cambió nada para la tablet.
- **Edición de ventas (T-17):** `abonosDeCobroVivos` ya filtra `deleted_at`; tras borrar el pago la venta se
  puede editar y eliminar. Cubierto por e2e.
- **Lectores de cobros:** detalle de venta (`ventas-consulta.repository.ts`, `CobroDeVenta`) y abonos
  anteriores de Cobranza (`cobranzas-portal.repository.ts`) agregan `cobroId` y `peticionPendiente`
  (booleano). Ya filtran `deleted_at`.
- **Corte, Flujo de Efectivo y Tesorería** (T-32, T-33, tickets de Tesorería) todavía no existen. Cuando
  existan **deben contar pagos de `cobro` vivos** (y excluir `saldo_favor`). Se anota en el vault y en
  CLAUDE.md.

### 4.6 Portal

- `apps/portal/src/app/(portal)/operacion/peticiones/page.tsx` deja de ser placeholder.
- Componente `DialogoPedirBorrado` (vista previa + motivo), usado por el detalle de venta y por Cobranza.
- Componente de la bandeja con sus pestañas y los diálogos de autorizar y denegar.
- Cliente HTTP en el mismo estilo que Cobranza (T-21) y Ventas (T-17); permisos vía `GET /auth/me`.
- Pruebas de pantalla con Testing Library (patrón T-65).

### 4.7 Migración en la nube

`sinmex dev` tiene **0** filas en `cobranza_abono` y `saldo_favor_movimiento` (verificado el 2026-10-13). El
pre-flight antes del `db push` repite esos conteos y, si ya no da 0, cuenta las filas que el relleno no
podría agrupar (deben ser 0). La migración la sube Roberto tras el merge, con su protocolo.

## 5. Lo que NO entra

- **Pedir el borrado desde la app** (la tablet). Lo puede hacer Mario después, mandando peticiones a esta
  misma tabla (nota en el PR, §8).
- Peticiones de **ventas** (borrar ventas sigue directo, T-17) y de **producción** (recargas).
- **Cancelar** una petición propia: si ya no aplica, se deniega.
- Editar un pago (cambiar monto o método): se borra y se vuelve a capturar.
- Efecto en Corte, Flujo y Tesorería (no existen todavía; §4.5).
- Notificar al que pidió: ve el estado en el propio cobro ("Borrado pedido · pendiente") y en el historial.
- Paginación del historial (las 200 más recientes bastan por ahora).

## 6. Pruebas

- **Unitarias:** `planearBorrado` (status tras borrar: pendiente/abonado/pagada/cuenta perdida; pago a varias
  notas; excedente; aplicación de saldo a favor que lo devuelve; bloqueo `saldo-favor-aplicado` en el borde
  exacto: queda en 0 se permite, en −0.01 no); validaciones de `PeticionesService` (motivo vacío/largo,
  comentario).
- **pgTAP:** checks de `cobro` y `peticion`; `cobro_id` obligatorio salvo contado; una sola pendiente por
  pago; coherencia de `resuelta_*`; el relleno agrupa por transacción (dos cobros del mismo cliente en
  transacciones distintas → dos pagos).
- **e2e:**
  - Los tres caminos crean su `cobro`: tablet, portal y aplicar saldo a favor. La venta de contado no lo crea.
  - Pedir: 201, motivo vacío 400, pago inexistente 404, otra sucursal 403, pago borrado 409, segunda
    pendiente 409, sin permiso 403.
  - Autorizar un pago a varias notas con excedente: filas borradas, status recalculados, saldo a favor
    rebajado, `eliminado_por`, petición `autorizada`.
  - Autorizar con el saldo a favor ya aplicado: 409 y nada cambia (la petición sigue pendiente).
  - Borrar una aplicación de saldo a favor: el saldo vuelve.
  - Dos autorizaciones simultáneas: una gana, la otra `peticion-resuelta`.
  - Denegar con y sin comentario; se puede volver a pedir.
  - La venta se vuelve a poder editar.
  - El **pull** incremental de la tablet baja la nota otra vez pendiente con sus abonos vivos y el saldo a
    favor nuevo.
  - Bandeja: filtro por sucursal, pendientes vs historial, alcance de un usuario de una sola sucursal.
  - La misma persona pide y autoriza.
- **Portal:** botón según permiso y estado, diálogo de petición (vista previa, motivo obligatorio, bloqueo
  visible), bandeja (pestañas, autorizar, denegar, error 409 visible).
- **Manual:** en el navegador contra el Postgres **local** (no contra `sinmex dev`).

## 7. Documentación al terminar

- `CLAUDE.md`: bloque **Peticiones (T-34)** — tabla `cobro`, `cobro_id`, la regla del pago completo, el
  bloqueo de saldo a favor aplicado, el orden de candados y que Corte/Flujo/Tesorería deben contar `cobro`
  vivos; y en el bloque de T-21 cambiar "Un cobro del portal no se deshace todavía: eso es T-34".
- `docs/contrato-sincronizacion.md`: la entidad del push de cobranza (§4.2).
- Vault: **ADR-0013** "El pago como entidad (`cobro`) y peticiones de borrado"; `Cobranza-Abono.md`,
  `Ventas y Cobranza.md`, `Portal Web.md` (Peticiones), `Estado del proyecto.md` y la bitácora.

## 8. Notas para Mario (app de tablet)

- La app **no cambia**. Una nota cuyo cobro se borra en el portal vuelve a la tablet como pendiente en el
  siguiente pull, y el vendedor la vuelve a cobrar como siempre.
- Si después quieres que el vendedor pida el borrado desde la tablet: sería una operación nueva del push que
  inserte en `peticion` (con su propio "quién pidió", hoy `solicito_usuario_id` es un usuario del portal; habría
  que agregar `solicito_vendedor_id` y un check de "uno de los dos"). La tablet necesitaría conocer el `cobro_id`
  de sus pagos, que hoy no baja en el pull.

## 9. Riesgos y notas

- El relleno de pagos viejos se apoya en que cada cobro se escribe en su propia transacción. Hoy es cierto
  para los tres caminos; en la nube no hay filas.
- `saldo_pendiente` de `cobranza_abono` es solo una foto: tras borrar un pago, las fotos de abonos
  posteriores de la misma nota quedan viejas. No se reescriben: nadie las lee como fuente (`docs/contrato-sincronizacion.md` ya lo advierte).
- Si algún día solo hay un usuario con `peticiones.gestionar` y se va, nadie podrá autorizar: se arregla en
  Perfiles y Permisos.
