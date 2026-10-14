# T-74 · Promociones por regla — portal, pull y app (spec)

**Fecha:** 2026-10-14 · **Estado:** aprobado en diálogo con Mario, pendiente de revisión del texto.
**Origen:** rediseño de la app de tablet (2026-10-12). Mario pidió el 2026-10-14 cambiar la lógica de la promoción: deja de ser el enum `10+1`/`20+1` del cliente y pasa a ser una regla configurable por cliente o para todos, que el vendedor ve antes de capturar y aplica sin hacer cuentas. Entra **antes de la pieza 3** del rediseño (visita sin venta) porque se pidió ahora.
**Vault:** [[Cliente]], [[Venta-Nota]], [[Status de venta]], [[App Tablet]], [[Portal Web]]. Las notas de dominio se actualizan con este spec (ver "Memoria").

## Por qué cambia

Hoy la promoción existe dos veces y ninguna sirve al vendedor:

- **En el cliente**: `cliente.promocion` (`ninguna` | `10+1` | `20+1`) y `cliente_promocion_producto` (productos a los que aplica). El portal los captura, el `pull` baja el enum (no los productos) y **nadie lo aplica**: la tablet solo lo pinta en la lista vieja del catálogo. Medido el 2026-10-14: 0 clientes con promoción capturada en `sinmex dev` y en local.
- **En la nota**: `venta_nota_detalle.cantidad_promocion`, piezas regaladas por línea que no suman al importe; toda la nota a $0 → status `promocion`. Esto **sí funciona** y se conserva tal cual.

Lo que falta es la regla que une las dos: qué se regala, a quién, por cuánto comprado, y que la app lo calcule.

## Decisiones de producto (dictadas por Mario el 2026-10-14)

**D1 · La promoción es una regla con forma general.** Por la compra de **N piezas** de *un producto*, *una presentación* o *cualquier producto*, se regalan **M piezas** *del mismo*, *de un producto* o *de una presentación*. Los tres casos que pidió Mario ("compra lo que sea y te doy X", "compra X y te doy del mismo", "compra tantas de lo que sea y te regalo X") son filas de la misma tabla.

**D2 · Se repite o no, lo dice cada promoción.** Casilla `se_repite`: con "por cada 10, 1" y 30 compradas, 3 gratis si se repite; 1 si no.

**D3 · Producto completo o presentación.** La compra y el regalo se definen a nivel producto (suma sus presentaciones) o a nivel presentación. Al crear la promoción se elige.

**D4 · Para quién: un cliente, todos, o prospectos.** Las de **todos** y las de **prospectos** son **por sucursal** (al crear se elige la sucursal o "todas", que crea una copia por sucursal). Las de **un cliente** quedan en la sucursal del cliente.

**D5 · La propia del cliente desplaza a la general.** Si el cliente tiene una promoción propia que **coincide en al menos un producto** con una general, la general no se aplica. Entre las que quedan, **se aplican todas**: cada una se calcula por su lado sobre las mismas piezas compradas.

**D6 · El vendedor no regala fuera de promoción.** La app calcula las piezas gratis; el vendedor solo puede **quitarlas** ("el cliente no lo quiso"), nunca agregar ni subir. El campo libre "Promoción" de la captura desaparece de la tablet.

**D7 · Promoción de prospecto, solo en su primera venta.** Audiencia `prospecto`: aplica a un cliente `tipo = 'prospecto'` que no tiene ninguna venta todavía. Puede regalar **sin exigir compra** (cantidad de compra 0), así se cubre "a veces regalan 1-2 piezas sueltas". Cuando el prospecto se convierte en cliente o ya tiene una venta, deja de aplicar.

**D8 · Sin fechas.** Una promoción está activa hasta que la oficina la desactiva (baja lógica). Nunca se borra: las notas la referencian.

**D9 · El portal queda libre.** Al registrar o editar una venta desde el portal (T-17) la oficina sigue escribiendo las piezas de promoción que quiera; la regla ata a la app, no a la administración, que es donde se corrigen errores de campo.

**D10 · Empezar en blanco.** No hay datos que migrar (medido: 0 filas). La migración elimina el enum y la tabla de productos, y **se niega a correr** si encuentra una fila con `promocion <> 'ninguna'` o alguna fila en `cliente_promocion_producto`, para que "en blanco" sea una decisión y no un accidente. Si al llegar a producción hubiera alguna, se recaptura a mano en la zona nueva.

**D11 · Dónde la ve el vendedor** *(acordado con Mario)*: en la **ficha del cliente** y arriba de la **pantalla de venta**, en lenguaje llano ("Por cada 10 Jawa 600 ml, 1 gratis"); conforme captura, la app va calculando y lo muestra por producto; al revisar, los regalos salen aparte con su frase.

## Decisiones del agente (a revisar por Mario)

**D12 · Trazabilidad por nota, no por línea.** Nueva tabla `venta_nota_promocion` (nota, promoción, presentación, cantidad, texto congelado de la promoción). Una línea puede recibir regalo de dos promociones distintas (una propia y una general de "cualquier producto"), así que no cabe un `promocion_id` en la línea. `cantidad_promocion` de la línea sigue siendo la suma de lo regalado en esa presentación. Costo si está mal: una tabla más.

**D13 · El servidor no rechaza por la regla de negocio.** Las piezas ya se entregaron en la calle; rechazar la venta no las recupera. El servidor valida la **forma** de `regalos` (uuids, cantidades, que las sumas por presentación cuadren con `cantidad_promocion`) y guarda la trazabilidad; si la promoción ya no existe (nunca pasa con baja lógica, pero sí si llega un id desconocido) guarda la fila con `promocion_id` nulo y el texto que mandó la tablet. La tablet es la que aplica la regla. Costo si está mal: una tablet manipulada podría regalar sin promoción; el riesgo ya existe hoy con el campo libre.

**D14 · "Primera venta" la marca el servidor y baja en el pull.** `cliente.primera_venta_en` se fija al proyectar la primera `venta_nota` viva de un cliente (venga de la tablet o del portal), tocando `updated_at` para que el pull incremental lo traiga. La tablet aplica la promoción de prospecto si `tipo = 'prospecto'`, `primera_venta_en` es nulo **y** no tiene ventas locales de ese cliente. Así dos tablets que compartan un prospecto no le dan dos veces el regalo salvo en la ventana entre sincronizaciones, que se acepta. Costo si está mal: un regalo duplicado en esa ventana.

**D15 · Editar desde el portal borra la trazabilidad de esa nota.** Si la oficina edita una nota (T-17), se eliminan sus filas de `venta_nota_promocion` y queda solo `cantidad_promocion` por línea, que la oficina ya controla. Mantenerlas en sincronía con una captura libre no tiene sentido. Costo si está mal: se pierde "qué promoción se dio" en notas editadas; el Reporte de Ventas sigue contando las piezas.

**D16 · El regalo "del mismo" por producto cae en la presentación que más compró**; si empata, la primera en el orden del catálogo. Un regalo de **producto completo** le pide al vendedor elegir la presentación en una lista corta (solo las del producto que el cliente tiene en catálogo, o todas las del producto si es prospecto sin lista). Sin elegir, no se puede grabar. Costo si está mal: un toque más por venta en ese caso.

**D17 · `promocion` sale del `ClientePull` sin subir el contrato.** Es un cambio no aditivo, pero con la misma justificación que `domicilio` (T-40): la app no se ha publicado y las dos mitades salen del mismo repo. `CONTRATO_ACTUAL` sigue en 1; se documenta en los dos `contrato.ts` y en `docs/contrato-sincronizacion.md`.

**D18 · Las piezas regaladas no cuentan como compradas** para ninguna promoción, y una misma pieza comprada cuenta para todas las promociones que la cubren (D5 dice "se aplican todas"). Costo si está mal: la oficina podría regalar de más al apilar generales; lo corrige desactivando una.

**D19 · Permiso.** Se reutiliza el permiso ya sembrado `promocion.gestionar` ("Registrar/editar/eliminar promoción y consumo"); su descripción pasa a "Promociones: crear, editar y desactivar". El consumo interno llegará con T-27 y tendrá el suyo.

**D20 · Módulo.** Backend en `modules/cartera-clientes/` (`promociones.controller/service/repository`), porque la promoción es configuración del cliente y de la sucursal, no una operación de venta. La aplicación de la regla vive en la tablet.

## Servidor

### Migración `20261014130000_promociones.sql`

```sql
-- Guardia de D10: en blanco es una decisión, no un accidente.
do $$
begin
  if exists (select 1 from cliente where promocion <> 'ninguna')
     or exists (select 1 from cliente_promocion_producto) then
    raise exception 'T-74: hay promociones capturadas con el modelo viejo; recaptúralas en Promociones antes de migrar';
  end if;
end $$;

create table promocion (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  sucursal_id uuid not null references sucursal(id),
  activo boolean not null default true,
  audiencia text not null check (audiencia in ('todos','cliente','prospecto')),
  cliente_id uuid references cliente(id),
  compra_tipo text not null check (compra_tipo in ('cualquiera','producto','presentacion')),
  compra_producto_id uuid references producto(id),
  compra_presentacion_id uuid references presentacion(id),
  compra_cantidad integer not null check (compra_cantidad >= 0),
  regalo_tipo text not null check (regalo_tipo in ('mismo','producto','presentacion')),
  regalo_producto_id uuid references producto(id),
  regalo_presentacion_id uuid references presentacion(id),
  regalo_cantidad integer not null check (regalo_cantidad >= 1),
  se_repite boolean not null default true,
  constraint ck_promocion_audiencia check (
    (audiencia = 'cliente') = (cliente_id is not null)),
  constraint ck_promocion_compra check (
    (compra_tipo = 'cualquiera' and compra_producto_id is null and compra_presentacion_id is null) or
    (compra_tipo = 'producto' and compra_producto_id is not null and compra_presentacion_id is null) or
    (compra_tipo = 'presentacion' and compra_presentacion_id is not null and compra_producto_id is null)),
  constraint ck_promocion_regalo check (
    (regalo_tipo = 'mismo' and regalo_producto_id is null and regalo_presentacion_id is null and compra_tipo <> 'cualquiera') or
    (regalo_tipo = 'producto' and regalo_producto_id is not null and regalo_presentacion_id is null) or
    (regalo_tipo = 'presentacion' and regalo_presentacion_id is not null and regalo_producto_id is null)),
  -- Comprar 0 solo tiene sentido en el regalo de bienvenida al prospecto (D7).
  constraint ck_promocion_compra_cero check (compra_cantidad > 0 or audiencia = 'prospecto')
);
create trigger trg_promocion_updated before update on promocion
  for each row execute function set_updated_at();
create index idx_promocion_sucursal on promocion (sucursal_id) where deleted_at is null;
create index idx_promocion_cliente on promocion (cliente_id) where deleted_at is null and cliente_id is not null;

create table venta_nota_promocion (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  venta_nota_id uuid not null references venta_nota(id),
  promocion_id uuid references promocion(id),          -- nulo si llegó un id desconocido (D13)
  presentacion_id uuid not null references presentacion(id),
  cantidad integer not null check (cantidad >= 1),
  promocion_texto text not null                         -- la frase, congelada al vender
);
create index idx_venta_nota_promocion_nota on venta_nota_promocion (venta_nota_id);

alter table cliente add column primera_venta_en timestamptz;
-- Backfill: los clientes que ya tienen notas vivas.
update cliente c set primera_venta_en = v.primera
  from (select cliente_id, min(created_at) as primera from venta_nota where deleted_at is null group by cliente_id) v
  where v.cliente_id = c.id;

drop table cliente_promocion_producto;
alter table cliente drop column promocion;

update permiso set descripcion = 'Promociones: crear, editar y desactivar' where clave = 'promocion.gestionar';
```

pgTAP (`99_promocion_test.sql`): cada `check` con un caso que entra y uno que no; `compra_cantidad = 0` solo con `prospecto`; `regalo_tipo = 'mismo'` rechazado con `compra_tipo = 'cualquiera'`; `audiencia = 'cliente'` exige `cliente_id` y al revés.

**Pre-flight para quien empuja a la nube** (debe dar 0 y 0): `select count(*) from cliente where promocion <> 'ninguna'; select count(*) from cliente_promocion_producto;`.

`npm run db:types` regenera `schema.d.ts`; el `ClienteDetalle`/DTOs pierden `promocion` y `productosPromocion`; `reconciliar-promocion-productos.ts` y su spec se eliminan.

### La frase de la promoción (función pura, en los dos lados)

`textoPromocion(p, catalogo)` produce la frase que ven la oficina y el vendedor, y la que se congela en la nota. Misma función (duplicada a propósito en backend `promociones-texto.ts` y tablet `promociones-reglas.ts`, como ya se duplican los límites de venta):

| Caso | Frase |
|---|---|
| compra producto 10, regalo mismo 1, se repite | "Por cada 10 Jawa, 1 Jawa gratis" |
| compra presentación 10, regalo mismo 1, sin repetir | "Al comprar 10 Jawa 600 ml, 1 Jawa 600 ml gratis (una vez)" |
| compra cualquiera 20, regalo presentación 1 | "Por cada 20 piezas de lo que sea, 1 Jawa 1 L gratis" |
| compra cualquiera 1, regalo producto 1 | "Por cada pieza, 1 Horchata gratis" |
| prospecto, compra 0, regalo presentación 2 | "Bienvenida al prospecto: 2 Jawa 600 ml gratis en su primera venta" |

Regla: "Por cada N" si se repite, "Al comprar N … (una vez)" si no; "pieza(s) de lo que sea" para `cualquiera`; el nombre del producto o "producto volumen" de la presentación; prefijo "Bienvenida al prospecto:" cuando la audiencia es `prospecto`. Las de un cliente no llevan prefijo: el contexto ya es su ficha.

### Endpoints del portal (`promociones.controller.ts`, permiso `promocion.gestionar`, alcance por `resolverAlcance`)

- `GET /promociones?sucursalId=&clienteId=`: sin `clienteId`, las de `todos` y `prospecto` de la sucursal; con `clienteId`, las propias del cliente **más** las generales de su sucursal que le aplican (campo `desplazada: boolean` calculado con D5) para la pestaña del cliente. Incluye inactivas con `activo: false`; el portal las muestra atenuadas.
- `POST /promociones` con `{ sucursalId | 'todas', audiencia, clienteId?, compra: { tipo, productoId?, presentacionId?, cantidad }, regalo: { tipo, productoId?, presentacionId?, cantidad }, seRepite }`. `'todas'` crea una fila por sucursal en alcance, en una transacción, y devuelve las creadas. Valida lo mismo que los `check` con mensajes en español (400 `promocion-datos-invalidos`), que los productos/presentaciones existan y estén vivos, y que el cliente sea de la sucursal.
- `PATCH /promociones/:id`: mismos campos salvo `sucursalId` y `audiencia`/`clienteId` (para cambiar de audiencia se crea otra). Editar no toca las notas ya vendidas (texto congelado, D12).
- `PATCH /promociones/:id/activo` `{ activo }`: desactivar y reactivar. No hay `DELETE`.
- Respuestas en camelCase con `texto` ya calculado, como el resto del portal.

Al **convertir un prospecto en cliente** (`POST /clientes/:id/convertir-a-cliente`) nada cambia en `promocion`: sus propias siguen; la de prospecto deja de aplicarle por el `tipo`.

### Proyección de la venta (`VentasService.registrarVenta`)

- `DatosVenta` gana `regalos?: { promocion_id: string; presentacion_id: string; cantidad: number; texto: string }[]` (aditivo; ausente = venta sin regalos o venta del portal).
- `normalizarDatosVenta` valida: uuids, `cantidad >= 1`, `texto` de 1 a 200, y que **por presentación** la suma de `regalos.cantidad` sea igual a `cantidad_promocion` de la línea cuando `regalos` viene (si no viene, no se exige: T-17 y tablets viejas). Falla → `datos-invalidos` con el campo.
- En la transacción: inserta `venta_nota_promocion` (buscando `promocion_id` entre las vivas; desconocido → nulo, D13) y, si el cliente no tiene `primera_venta_en`, lo fija y toca `updated_at` (D14). Esto último también en la venta del portal.
- `editarVenta` (T-17): borra las filas de `venta_nota_promocion` de la nota (D15).
- El status (`reglas-venta.ts`) no cambia.

### Pull (`sincronizacion.repository.ts`, contrato)

- Colección nueva de primer nivel `promociones: PromocionPull[]`: las vivas de la sucursal del vendedor con `audiencia in ('todos','prospecto')` **más** las de `audiencia = 'cliente'` cuyo cliente está en alcance (`clientesEnAlcance`). Incremental por `updated_at > desde`; baja lógica o `activo = false` bajan con `activo: 0` (la tablet las guarda inactivas, no las borra: una venta local puede referenciarlas).

```ts
export interface PromocionPull extends FilaSincronizable {
  audiencia: 'todos' | 'cliente' | 'prospecto';
  cliente_id: string | null;
  compra_tipo: 'cualquiera' | 'producto' | 'presentacion';
  compra_producto_id: string | null;
  compra_presentacion_id: string | null;
  compra_cantidad: number;
  regalo_tipo: 'mismo' | 'producto' | 'presentacion';
  regalo_producto_id: string | null;
  regalo_presentacion_id: string | null;
  regalo_cantidad: number;
  se_repite: boolean;
  activo: 0 | 1;
}
```

- `ClientePull`: se quita `promocion`; se añade `primera_venta_en: string | null` (ISO). Comentario con la justificación de D17.
- `docs/contrato-sincronizacion.md`: sección de `promociones`, de `regalos` en `venta` y del cambio del cliente.

## Tablet · datos

### Migración local `012-promociones.ts`

```sql
create table promocion (
  id text primary key,
  audiencia text not null,
  cliente_id text,
  compra_tipo text not null, compra_producto_id text, compra_presentacion_id text, compra_cantidad integer not null,
  regalo_tipo text not null, regalo_producto_id text, regalo_presentacion_id text, regalo_cantidad integer not null,
  se_repite integer not null,
  activo integer not null default 1,
  sincronizado_en text not null
);
create index idx_promocion_cliente on promocion (cliente_id);
create table venta_promocion (
  id text primary key,
  venta_id text not null references venta(id),
  promocion_id text not null,
  presentacion_id text not null,
  cantidad integer not null check (cantidad >= 1),
  texto text not null
);
create index idx_venta_promocion_venta on venta_promocion (venta_id);
alter table cliente add column primera_venta_en text;
```

La columna `cliente.promocion` local se queda (SQLite y "nunca se renumera una publicada"); el tipo `Cliente` deja de leerla y el snapshot deja de escribirla.

### Repositorio y reglas

- `catalogos.guardarSnapshot` upsertea `promociones` (patrón de `aplicarSnapshotRutas`: fila por id, `activo`, `sincronizado_en`).
- `catalogos.promocionesDe(clienteId): PromocionAplicable[]`: las activas de la sucursal del cliente, ya filtradas por D5 y D7 (usa `cliente.tipo`, `cliente.primera_venta_en` y `ventas.hayAlgunaDe(clienteId)`), cada una con su `texto`. Es la lista que ven la ficha y la venta.
- `src/datos/promociones-reglas.ts` (pura, con spec):
  - `textoPromocion(p, nombres)`.
  - `coincidenEnProducto(a, b, catalogo): boolean` (D5).
  - `calcularRegalos(lineas: LineaCaptura[], promociones: PromocionAplicable[], catalogo): Regalo[]` donde `Regalo = { promocionId, texto, presentacionId: string | null, productoId: string | null, cantidad }`; `presentacionId` nulo y `productoId` lleno cuando falta elegir (D16).
  - `aplicarRegalos(lineas, regalos, descartados: Set<promocionId>, elecciones: Map<promocionId, presentacionId>): LineaCaptura[]` devuelve las líneas con `cantidadPromocion` rellenada y la lista final para `regalos`.
- `problemasDeCaptura` cambia: ya no acepta `cantidadPromocion` capturada a mano; añade "Elige la presentación del regalo de «{texto}»" cuando falta elección. La regla "sin precio solo promoción" se conserva (un regalo puede caer en una presentación sin precio).
- `ventas.registrar` recibe `regalos` y los guarda en `venta_promocion`; `fuente-ventas` los manda en `datos.regalos`.
- `ventas.hayAlgunaDe(clienteId): boolean` sobre `venta` local (no se purga: comprobar en el plan; si se purgara, la comprobación cae en `primera_venta_en` del pull).

## Tablet · pantallas

**Ficha del cliente** (`operacion/[clienteId]/index.tsx`): tarjeta "Promociones" después del saldo a favor: una línea por `promocionesDe(cliente)` con su frase; vacío → "Sin promoción"; a un prospecto con la de bienvenida vigente se le marca "(primera venta)".

**Venta** (`operacion/[clienteId]/venta.tsx`):
- Arriba, la misma tarjeta "Promociones", fija.
- Por producto, el campo "Promoción" **desaparece**; en su lugar, bajo la cantidad, un texto calculado "+N gratis por promoción" cuando `calcularRegalos` le asigna algo a esa presentación. El vendedor solo escribe cantidades.
- Tarjeta **"Regalos"** debajo de los productos, solo si hay alguno: por regalo, la frase, la presentación y las piezas; una casilla "El cliente no lo quiso" (lo descarta, D6); si falta elegir presentación, un selector con las presentaciones del producto. Sin elegir, "Revisar" lo lista como problema.
- Revisión: las líneas muestran "N de promoción" como hoy, y la tarjeta "Regalos" repite las frases aplicadas. Total sin cambios.
- Un prospecto con la promoción de bienvenida y compra 0 puede grabar una nota solo de regalo (status `promocion`), como hoy una línea de pura promoción.

**Pruebas de pantalla:** no hay; toda la lógica va a `promociones-reglas.ts` y `ventas-reglas.ts` con specs (casos: cada tipo de regla, se repite / una vez, desplazamiento D5, prospecto con y sin primera venta, empate de presentación D16, regalo sobre presentación sin precio, descartar un regalo, falta de elección).

## Portal

- **Nav**: Operación › **Promociones** (`/operacion/promociones`), después de "Reporte de Ventas". Página `pantalla-promociones.tsx` con selector de sucursal (como Ruta Diaria), lista de generales y de prospecto con frase, estado y botones Editar / Desactivar / Reactivar; botón "Nueva promoción".
- **Formulario** `formulario-promocion.tsx` (modal, reutilizado desde el cliente): tres bloques, *Para quién* (todos · prospectos en su primera venta · este cliente, fijo cuando se abre desde el cliente), *Qué compra* (cualquier producto · producto · presentación; cantidad; con prospecto permite 0 y lo etiqueta "sin compra"), *Qué regala* (del mismo · producto · presentación; cantidad), casilla *Se repite por bloques*. Debajo, la **frase** en vivo con `textoPromocion`. Sucursal: la seleccionada o "Todas las sucursales" (solo al crear; aviso de que crea una por sucursal).
- **Formulario de cliente**: el bloque "Promoción" (select + checkboxes) se sustituye por "Promociones de este cliente": lista de sus propias (frase, estado, Editar / Desactivar), botón "Nueva promoción para este cliente", y debajo, atenuadas, las generales de su sucursal que le aplican, con "(desplazada por una propia)" cuando toca. Solo visible al **editar** (un cliente nuevo primero se guarda).
- `lib/promociones.ts` con llamadas y `textoPromocion` (tercera copia, con su test; el portal no importa del backend).
- Registrar/editar venta del portal: **sin cambios** (D9).
- Vitest: lista por sucursal, crear con "todas", frase en vivo, validaciones del formulario (mismo con cualquiera; cantidad 0 solo prospecto), bloque del cliente con desplazadas.

## Errores al vendedor

- "Elige la presentación del regalo de «…»" (falta elección, D16).
- El resto de la venta no cambia. Un rechazo `datos-invalidos` por `regalos` (sumas que no cuadran) solo puede venir de un defecto de la app: se muestra como hoy cualquier rechazo, con el campo.

## Aceptación manual en el emulador (contra Postgres local)

1. En el portal, con `promocion.gestionar`, crear en la sucursal del vendedor: (a) general "por cada 10 Jawa, 1 Jawa gratis" que se repite; (b) general "por cada 20 piezas de lo que sea, 1 Horchata 1 L" sin repetir; (c) propia del cliente DEMO 1 "al comprar 5 Jawa 600 ml, 1 Jawa 600 ml (una vez)"; (d) de prospecto "bienvenida: 2 Jawa 600 ml". Verificar la frase de cada una en la lista.
2. Sincronizar la tablet; la ficha de DEMO 1 muestra (b) y (c) y **no** (a) (desplazada, D5); la de DEMO 2 muestra (a) y (b).
3. Venta a DEMO 2: 30 Jawa 600 ml → "+3 gratis"; añadir 20 piezas más de otro producto → aparece 1 Horchata 1 L, elegir presentación si (b) fuera por producto. Descartar un regalo y comprobar que la línea baja. Grabar; la revisión lista los regalos.
4. Venta a DEMO 1: 5 Jawa 600 ml → 1 gratis; 10 → sigue 1 (una vez).
5. Prospecto nuevo desde la app → **sincronizar** (un prospecto capturado vive en la tabla local `prospecto` hasta que el servidor lo acepta y el pull lo devuelve como cliente `tipo = 'prospecto'`; antes no es vendible — *enmienda del plan, 2026-10-14*) → su ficha muestra la de bienvenida; venta de solo 2 regalos graba con status `promocion`; segunda venta al mismo prospecto ya no la ofrece; tras sincronizar, `cliente.primera_venta_en` quedó marcado y `venta_nota_promocion` tiene 1 fila.
6. Sincronizar: en Postgres, `venta_nota_promocion` tiene las filas con `promocion_texto`; `cantidad_promocion` cuadra por línea.
7. Desactivar (a) en el portal, sincronizar: la ficha de DEMO 2 ya no la muestra; la nota del paso 3 conserva su texto.
8. Editar desde el portal la nota del paso 3 cambiando una cantidad: `venta_nota_promocion` de esa nota queda vacía (D15); registrar una venta desde el portal con piezas de promoción libres funciona como antes (D9).
9. Convertir el prospecto del paso 5 en cliente: la de bienvenida ya no le aplica.

## Restricciones globales (van en el plan)

- Código en español, identificadores sin acentos, mensajes al usuario con acentos. Comentarios que explican *por qué*.
- Contrato aditivo salvo D17: `CONTRATO_ACTUAL` se queda en 1; los dos `contrato.ts` y `docs/contrato-sincronizacion.md` cambian en la misma tarea.
- ADR-0009: una transacción por operación; una rechazada no deja fila; trazabilidad por `entidad_tabla`/`entidad_id`.
- Nada de `db reset`. Migración local 012 nueva; nunca se renumera una publicada. Migración de Postgres `20261014130000_promociones.sql`.
- `npm run typecheck`, `lint` y `test` de backend, tablet y portal en verde; `npm run test:e2e` del backend contra el Postgres local; pgTAP con `npm run supabase -- test db --local`; `db:types` sin diff.
- Los implementadores no despachan subagentes, no empujan, no mergean.

## Fuera de alcance

Procesos del portal (merma, consumo; T-27/T-35), promociones con vigencia o tope por periodo, reportes nuevos de promociones (el Reporte de Ventas ya suma las piezas), aplicar la regla en la venta del portal (D9), promociones por lista de precios o por tipo de negocio, y la pieza 3 del rediseño (visita sin venta), que sigue después de esto.

## Memoria

Con este spec se actualizan en el vault: [[Cliente]] (campos Promoción y Productos con promoción → referencia a [[Promociones]]), nota nueva [[Promociones]] en `10-Dominio/Modulos/` con D1-D11, [[Venta-Nota]] (trazabilidad D12), [[App Tablet]] (ficha y venta), [[Portal Web]] (zona Promociones) y [[Estado del proyecto]] (T-74). La contradicción con la fuente ("únicas dos promos") queda anotada como decisión de Mario del 2026-10-14.
