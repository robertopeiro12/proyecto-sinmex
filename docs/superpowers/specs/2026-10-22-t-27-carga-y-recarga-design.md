# T-27 pieza 1 · Carga y recarga del vendedor — diseño

**Tickets:** #27 (T-27, inventario del repartidor) y #26 (T-26, recarga en el portal) · **Pieza 1 de 3** de T-27
(acordado con Mario el 2026-10-20) · **Depende de:** T-10 (productos), T-16 (venta en la tablet), T-74 (regalos)

## Objetivo

Que la tablet sepa **qué producto trae el vendedor** y no venda lo que no tiene. Producción registra en el portal la
carga de la mañana y cada recarga; la carga baja a la tablet, el vendedor la **acepta o la rechaza** y, con el control
de inventario de su sucursal activo, la venta no puede dejar ninguna presentación en negativo.

**Las tres piezas de T-27** (cada una con su spec, plan y PR):

1. **Carga y recarga** (este spec).
2. **Movimientos del día** en la tablet: merma en 3 tipos (de almacén, recibida del cliente, entregada al cliente),
   cambios físicos recibidos/entregados y consumo propio; inventario teórico en vivo.
3. **Corte de inventario**: "enviar corte" con las piezas teóricas a retornar; el almacenista captura el retorno
   validado en el portal; resultado en rojo si falta.

Fuera de las tres: captura de merma/promoción desde el portal (T-35), corte de caja (T-33), almacenes (T-63),
inventario de planta (T-24).

## Proceso del negocio (documento del cliente, julio 2026)

Al llegar, el almacenista entrega el producto para ruta y ambos firman el *Formato de Almacén*. El almacenista captura
la salida en el portal y al vendedor le llega a la app para **aceptarla o rechazarla**. A media mañana el vendedor
puede volver por más producto (recarga): mismo proceso. Todo se maneja en **piezas**.

## Decisiones de producto

**D1 · La carga la registra producción en el portal.** Elegido por Mario. El vendedor no la teclea: la recibe.

**D2 · Aceptar o rechazar la carga completa; el rechazo lleva motivo.** Elegido por Mario. El almacenista ve el
rechazo en el portal, corrige la carga y la vuelve a mandar; el vendedor la acepta. No hay aceptación parcial ni
corrección de cantidades en la tablet.

**D3 · Con una carga pendiente no se vende.** Elegido por Mario. Aplica a la carga inicial y a las recargas. Cobranza,
visitas, prospectos y gastos siguen permitidos.

**D4 · No se vende más de lo que se trae.** Elegido por Mario. Una venta que deje cualquier presentación en negativo
(piezas vendidas **más** piezas regaladas) no se graba.

**D5 · Una carga aceptada no se edita ni se elimina.** Elegido por Mario. Pendiente o rechazada sí: editarla la regresa
a pendiente (y vuelve a llegar al vendedor). Un error en una carga aceptada se corrige con otra recarga o en el corte
de inventario (pieza 3). El inventario de la tablet nunca cambia por debajo.

**D6 · La respuesta del vendedor viaja con red, en el momento.** Elegido por Mario (opción A). "Aceptar"/"Rechazar"
llaman a un endpoint del servidor con la versión de la carga; si el portal la editó mientras tanto, el servidor
contesta 409 y la tablet muestra la nueva. La carga ocurre en la planta, con WiFi y con el almacenista enfrente, y así
el inventario de la tablet solo cuenta cargas que el servidor confirmó. Sin red no se puede aceptar (y, por D3, no se
vende).

**D7 · El control se prende por sucursal.** Elegido por Mario. Casilla "Control de inventario en la app" en
*Catálogo › Sucursales*, **apagada por defecto**. Apagada: la app vende como hoy (ni D3 ni D4), aunque existan cargas.
Prendida: D3 y D4 aplican. Permite arrancar Tijuana y después Mexicali, y evita que la versión nueva deje sin vender a
una sucursal donde producción todavía no captura cargas.

**D8 · Solo se capturan cargas de hoy (Tijuana).** *(agente)* La carga se registra cuando el producto sale; una carga de
un día anterior no tiene vendedor que la acepte. *Si está mal:* se abre el selector de fecha en el `POST`.

**D9 · Sin notificaciones push.** *(agente)* La app no tiene notificaciones. La carga llega al sincronizar (Refrescar) y
la pantalla principal avisa "Tienes una carga por aceptar". En la planta el vendedor sincroniza de todos modos.

**D10 · El regalo cuenta contra la existencia.** *(agente)* Las piezas de promoción también salen de la camioneta. Una
venta de solo regalo (prospecto, T-75) también se bloquea si no hay piezas.

## Servidor

### Migración `supabase/migrations/20261022120000_carga_vendedor.sql`

```sql
alter table sucursal add column control_inventario boolean not null default false;

create table carga (
  id uuid primary key default gen_random_uuid(),
  sucursal_id uuid not null references sucursal(id),
  vendedor_id uuid not null references vendedor(id),
  fecha date not null,
  numero smallint not null check (numero >= 1),
  estado text not null default 'pendiente' check (estado in ('pendiente', 'aceptada', 'rechazada')),
  motivo_rechazo text check (motivo_rechazo is null or char_length(motivo_rechazo) between 1 and 300),
  version integer not null default 1 check (version >= 1),
  capturo_usuario_id uuid not null references usuario(id),
  respondida_en timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint ck_carga_motivo check ((estado = 'rechazada') = (motivo_rechazo is not null)),
  constraint ck_carga_respondida check ((estado = 'pendiente') = (respondida_en is null))
);
create unique index uq_carga_vendedor_fecha_numero on carga (vendedor_id, fecha, numero) where deleted_at is null;
create index idx_carga_vendedor_updated on carga (vendedor_id, updated_at);

create table carga_detalle (
  id uuid primary key default gen_random_uuid(),
  carga_id uuid not null references carga(id),
  presentacion_id uuid not null references presentacion(id),
  piezas integer not null check (piezas > 0),
  constraint uq_carga_detalle_presentacion unique (carga_id, presentacion_id)
);
```

- Trigger `before update … execute function set_updated_at()` en `carga`, como las demás tablas con `updated_at`.
- **Permiso: `carga.gestionar` ya existe** (semillas, grupo `Produccion/Almacen`): no se crea permiso ni grupo y el
  conteo del pgTAP de permisos no cambia. Sin RLS: el alcance lo pone el backend, como en todo el repo.
- Una carga **eliminada** (baja lógica) libera su `numero`; el siguiente `POST` toma `max(numero vivo) + 1`.
- pgTAP `99_carga_test.sql`: columnas, checks, índice único parcial, trigger.

### Módulo

Backend en `modules/produccion/` (hoy vacío): `cargas.controller.ts`, `cargas.service.ts`, `cargas.repository.ts`,
reglas puras en `reglas-carga.ts` (estado editable, armado de la rejilla, validación de líneas).

**Portal** (permiso `carga.gestionar`; alcance de sucursal con `resolverAlcance`; otra sucursal = **404**):

- `GET /cargas?fecha=YYYY-MM-DD&sucursal=<id>` → `{ fecha, presentaciones: [...], vendedores: [{ id, nombre, cargas:
  [{ id, numero, estado, motivoRechazo, version, respondidaEn, lineas: [{ presentacionId, piezas }] }] }] }`.
  Presentaciones activas ordenadas por presentación y luego por sabor (criterio de T-10); vendedores activos de la
  sucursal en orden alfabético.
- `POST /cargas` `{ vendedorId, lineas: [{ presentacionId, piezas }] }` → crea la carga de **hoy en Tijuana** (D8) con
  el número siguiente, `pendiente`, versión 1. Valida: vendedor activo de la sucursal en alcance; al menos una línea;
  presentaciones activas sin repetir; piezas enteras de 1 a 99 999. El número se asigna bloqueando las cargas vivas del
  vendedor y fecha (`for update`) para que dos capturas simultáneas no choquen; el índice único es la red.
- `PATCH /cargas/:id` `{ version, lineas }` → solo si `pendiente` o `rechazada` y la `version` coincide (si no, 409 con
  la carga actual). Reemplaza las líneas, sube la versión, vuelve a `pendiente`, limpia `motivo_rechazo` y
  `respondida_en`.
- `DELETE /cargas/:id` `{ version }` → baja lógica, mismas condiciones. Una aceptada: 409 "Una carga aceptada no se
  modifica" (D5).

**App** (`@SoloApp()`, en `modules/sincronizacion/` junto a las fotos):

- `POST /sync/cargas/:id/respuesta` `{ version, accion: 'aceptar' | 'rechazar', motivo?: string }`:
  - Carga de otro vendedor, inexistente o eliminada → **404** (no confirma que exista).
  - `rechazar` exige `motivo` de 1 a 300 caracteres (recortado); `aceptar` no lleva motivo → 400 si viene.
  - En una transacción con `for update` de la carga: si ya tiene **esa misma respuesta** → 200 con la carga
    (idempotente, reintento de red); si la versión no coincide o no está `pendiente` → **409** con la carga actual; si
    no, escribe estado, motivo, `respondida_en = now()` y responde 200 con la carga.
  - **No renueva la sesión** fuera de lo normal: usa el mismo `Authorization: Bearer` que las demás llamadas de la app.

### Pull y contrato (aditivo, `CONTRATO_ACTUAL` sigue en 1)

- Colección nueva **`cargas`** en `RespuestaPull`: las del vendedor del token con `fecha >= current_date - 1` (como
  `rutas`), cada una con `numero`, `fecha`, `estado`, `motivo_rechazo`, `version`, `respondida_en` y `lineas`. Una
  eliminada baja con `activo: 0`. Editar líneas toca `carga.updated_at`.
- `VendedorPull.control_inventario: boolean` (de su sucursal). Cambiar la casilla toca `updated_at` de los vendedores de
  esa sucursal para que el pull incremental la baje.
- `contrato.ts` se actualiza en backend y tablet a la vez, y `docs/contrato-sincronizacion.md` en el mismo commit
  (incluye el endpoint de respuesta).

## Portal

- **Producción › Recarga** (`/produccion/recarga`, hoy un `Placeholder`): selector de sucursal (los atados ven la
  suya) y fecha (hoy por defecto; días anteriores en solo lectura, D8).
- **Rejilla**: filas = presentaciones; columnas = vendedores, con el encabezado fijo al desplazar. Cada vendedor muestra
  sus cargas del día en subcolumnas `n.º 1`, `n.º 2`, … con una pastilla de estado (Pendiente, Aceptada, Rechazada) y
  las piezas por presentación; total de piezas al pie.
- **"Nueva carga"** por vendedor abre una subcolumna editable; "Guardar" hace el `POST`. Una pendiente o rechazada tiene
  "Editar" y "Eliminar" (confirmación). Una rechazada muestra su motivo en rojo y queda resaltada hasta que se edite.
- Mensajes de 409 en español ("El vendedor ya respondió esta carga; recarga la página").
- Diseñada para **1366 px** (≈1012 px de caja): la rejilla se desplaza horizontalmente dentro de su caja, con la
  columna de presentación fija. Medir en navegador.
- **Catálogo › Sucursales**: casilla "Control de inventario en la app" (permiso que ya gestiona sucursales), con texto
  de ayuda: "Al prenderla, los vendedores de esta sucursal necesitan aceptar su carga para vender y no pueden vender más
  de lo que traen."

## Tablet

### Datos (migración local 017)

`carga` (`id`, `vendedor_id`, `fecha`, `numero`, `estado`, `motivo_rechazo`, `version`, `respondida_en`, `activo`,
`actualizado_en`) y `carga_detalle` (`carga_id`, `presentacion_id`, `piezas`), llenadas solo por el pull (la tablet no
crea cargas). `vendedor.control_inventario integer not null default 0`. Nunca se edita una migración publicada
(001–016).

### Lógica pura (`src/estado/inventario.ts`, con pruebas)

- `existencias(cargas, ventas, hoy): Map<presentacionId, { cargado, vendido, regalado, existencia }>` — suma solo
  cargas **aceptadas** y vivas de `hoy`, y las ventas de hoy (piezas vendidas y piezas de promoción).
- `cargaPendiente(cargas, hoy): Carga | null` — la pendiente viva de hoy de menor número.
- `bloqueoDeVenta({ controlInventario, cargas, hoy })` → `null` o el motivo ("Tienes una carga por aceptar").
- `faltantesDeVenta({ controlInventario, existencias, lineas, regalos })` → lista de `{ presentacionId, faltan }`
  (vacía si el control está apagado).
- `validarRespuesta(accion, motivo)` → errores de forma del rechazo.

### Repositorio

`ventas.registrar()` vuelve a calcular `faltantesDeVenta` **dentro de su transacción** y lanza `ErrorVenta` con el
detalle si hay faltantes, igual que pone el precio desde el catálogo: la pantalla no es la única defensa (D4). Lo mismo
con `bloqueoDeVenta` (D3).

### Pantallas

- **Inventario** (entrada del menú hamburguesa, hoy pendiente): lista de cargas de hoy con número, estado y total;
  tabla por presentación **Cargado − Vendido − Regalado = Existencia** (existencia en rojo si es 0). Con el control
  apagado se muestra igual, con la nota "El control de inventario de tu sucursal está apagado".
- **Detalle de una carga pendiente**: líneas y botones **Aceptar** (tono `confirmar`) y **Rechazar** (tono `peligro`,
  pide motivo). Llaman al endpoint con la versión; guardia de doble toque (`useRef`). Sin red: "Conéctate al WiFi para
  aceptar la carga." 409: se sincroniza para bajar la versión nueva y se avisa "La carga cambió en el almacén; revísala
  de nuevo." Tras responder, la tablet escribe la respuesta del servidor en su `carga` local.
- **Pantalla principal**: aviso "Tienes una carga por aceptar" con botón a la carga, mientras exista una pendiente de
  hoy (con o sin control; el aviso no bloquea nada por sí mismo).
- **Venta** (con control prendido): si `bloqueoDeVenta`, la pantalla de venta muestra el motivo y un botón a
  Inventario en lugar de la captura; en la captura cada presentación dice "Te quedan N"; la revisión no deja grabar con
  faltantes y lista "Horchata 1 L: faltan 3 piezas".

## Review Focus

1. **Recarga aceptada a mitad de la captura de una venta:** la existencia que valida al grabar es la del momento de
   grabar (el repositorio recalcula), no la que se pintó al abrir la pantalla.
2. **Portal edita una carga mientras el vendedor la está viendo:** "Aceptar" con la versión vieja → 409 → la tablet
   muestra la versión nueva; nunca acepta lo que no vio.
3. **Doble toque en Aceptar con red lenta:** una sola respuesta; el segundo envío es idempotente.
4. **Carga eliminada en el portal después de bajar a la tablet:** baja con `activo: 0` y desaparece del inventario y
   del aviso; responderla da 404 y la tablet se resincroniza.
5. **Sucursal con el control apagado y cargas capturadas:** la app vende como hoy, sin bloqueo ni faltantes, aunque haya
   una carga pendiente (solo el aviso).

## Pruebas

- **pgTAP:** columnas, checks (`ck_carga_motivo`, `ck_carga_respondida`, piezas > 0), índice único parcial y trigger.
- **Backend unit:** `reglas-carga.ts` (editable, rejilla, líneas), validación de la respuesta.
- **Backend e2e:** rejilla por sucursal (atado/General, otra sucursal 404), `POST` numera 1, 2, 3 y reutiliza tras
  baja, `PATCH`/`DELETE` solo pendiente/rechazada y con versión, respuesta (aceptar, rechazar con motivo, idempotente,
  409 por versión, 404 de otro vendedor), pull de `cargas` (incremental, `activo: 0`) y `control_inventario` que baja
  al cambiar la casilla.
- **Tablet:** `inventario.spec.ts` (existencias, pendiente, bloqueo, faltantes con regalos, control apagado),
  migración 017, `ventas.spec.ts` (el repositorio rechaza faltantes y bloqueo sin quemar folio), mezcla del pull.
- **Portal:** rejilla (estados, nueva, editar, eliminar, motivo), casilla de sucursal.
- **Emulador y navegador (al final):** carga en el portal → Refrescar → aceptar → vender hasta agotar una presentación
  → bloqueo; rechazar → corregir en el portal → aceptar; rejilla medida a 1366 px.

## Para el despliegue

- Migración `20261022120000_carga_vendedor.sql` a `sinmex dev` después del merge, con el protocolo de push (pre-flight:
  tablas nuevas y una columna con default; nada que contar).
- Backend antes que la app. Una app vieja no ve cargas ni bloquea: sigue vendiendo como hoy.
- **No prender la casilla de una sucursal hasta que sus tablets tengan la versión nueva** y producción esté capturando
  cargas: una tablet vieja ignora el control.
