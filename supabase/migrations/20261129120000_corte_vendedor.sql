-- Rediseño pieza 6: el corte que el vendedor hace en la tablet al cerrar el dia.
-- Spec: docs/superpowers/specs/2026-11-18-rediseno-app-vendedor-design.md §13;
-- plan: docs/superpowers/plans/2026-11-25-rediseno-pieza-6-corte.md (Task 3).
--
-- Proyeccion de la operacion `corte` del push (ADR-0009): la escribe
-- `rutas/CortesVendedorService.registrarCorte` dentro de la transaccion de la
-- operacion. Es **informativo**: guarda lo que decia el sistema de la tablet y
-- lo que capturo el vendedor, y no mueve saldos, existencias ni el corte de
-- mercancia de la oficina (`corte_mercancia`, que no se toca).
--
-- * `id` ES la clave de la operacion (como gasto y movimiento), sin default.
-- * `fecha` es la `fecha_operacion` del sobre, nunca re-derivada de UTC.
-- * Los tres apartados se guardan tal cual llegan, en el formato del contrato
--   (`DatosCorte`, `docs/contrato-sincronizacion.md`):
--     efectivo   {esperado_centavos, traido_centavos}
--     notas      [{folio, traida, saldo_centavos}]
--     inventario {renglones: [{presentacion_id, sistema, contado}], merma: {sistema, contado}}
--   La merma vive dentro de `inventario` (es su renglon de "Merma" en la tablet).
--   Sin llaves foraneas a presentacion ni a venta_nota: es una foto del momento.
-- * Sin `sync_operacion_id`: la trazabilidad va por sync_operacion.entidad_tabla /
--   entidad_id (ADR-0009, enmienda §2.4).
--
-- Tabla nueva y vacia: el pre-flight contra la nube no tiene nada que contar.

create table corte_vendedor (
  id           uuid primary key,
  vendedor_id  uuid not null references vendedor(id),
  sucursal_id  uuid not null references sucursal(id),
  fecha        date not null,
  efectivo     jsonb not null,
  notas        jsonb not null,
  inventario   jsonb not null,
  enviado_en   timestamptz not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  constraint ck_corte_vendedor_efectivo check (jsonb_typeof(efectivo) = 'object'),
  constraint ck_corte_vendedor_notas check (jsonb_typeof(notas) = 'array'),
  constraint ck_corte_vendedor_inventario check (jsonb_typeof(inventario) = 'object')
);
create trigger trg_corte_vendedor_updated before update on corte_vendedor
  for each row execute function set_updated_at();

-- Un corte vivo por vendedor y dia, como la jornada que cierra. Parcial: dar de
-- baja uno libera el dia. `CortesVendedorRepository.insertar` usa `on conflict
-- do nothing` y responde `corte-duplicado` sin abortar la transaccion.
create unique index uq_corte_vendedor_vendedor_fecha
  on corte_vendedor (vendedor_id, fecha) where deleted_at is null;

-- Para leerlo por sucursal y dia (portal, piezas futuras).
create index idx_corte_vendedor_sucursal_fecha
  on corte_vendedor (sucursal_id, fecha) where deleted_at is null;
