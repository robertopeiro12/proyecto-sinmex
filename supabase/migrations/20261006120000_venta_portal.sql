-- Venta registrada desde el portal (T-17, parte 1) y # de nota unico por
-- sucursal (#95). Spec: docs/superpowers/specs/2026-10-06-t17a-registrar-venta-portal-design.md
--
-- Pre-flight antes de empujar a `sinmex dev` (protocolo de CLAUDE.md), los
-- dos deben dar 0:
--   select count(*) from vendedor where folio_segmento = 'OF';
--   select count(*) from (select 1 from venta_nota where deleted_at is null
--     group by sucursal_id, lower(btrim(num_nota)) having count(*) > 1) d;
-- Los checks de `origen` son vacuos sobre las filas existentes: el default
-- 'app' las rellena y todas tienen vendedor.

-- La venta de mostrador ("Oficina") no tiene vendedor: no genera comision y en
-- reportes sale como Oficina (§2). Hoy nada lee esta columna.
alter table venta_nota alter column vendedor_id drop not null;

alter table venta_nota
  add column origen text not null default 'app',
  -- Quien la capturo en el portal. No sustituye al vendedor: una venta que la
  -- oficina captura "como si fuera el vendedor" lleva a los dos.
  add column capturo_usuario_id uuid references usuario(id),
  add constraint ck_venta_nota_origen
    check (origen in ('app', 'portal')),
  -- La venta sin vendedor solo existe si nacio en el portal, y toda venta del
  -- portal dice quien la capturo.
  add constraint ck_venta_nota_origen_actores check (
    (origen = 'app' and vendedor_id is not null and capturo_usuario_id is null)
    or (origen = 'portal' and capturo_usuario_id is not null)
  );

-- #95: el # de la nota fisica no se repite dentro de la sucursal. Insensible a
-- mayusculas y espacios porque es texto tecleado a mano. Parcial para que, en
-- la parte 2, una nota eliminada libere su numero. Su nombre es el que el
-- servicio reconoce en el `23505` (`nota-duplicada.ts`).
create unique index uq_venta_nota_num_nota_sucursal
  on venta_nota (sucursal_id, lower(btrim(num_nota)))
  where deleted_at is null;

-- El cobro automatico de una venta de contado de Oficina no tiene cobrador.
alter table cobranza_abono alter column vendedor_id drop not null;

-- Folio de oficina (§4.4): `{sucursal}{AAMMDD}OF{01..99}`, emitido por el
-- SERVIDOR. El contador se incrementa con `insert ... on conflict do update`
-- dentro de la transaccion de la venta: si la venta falla el numero no se
-- quema, y dos usuarios grabando a la vez esperan uno al otro en la fila.
-- La fecha es la de la VENTA, no la de captura.
create table folio_oficina_contador (
  sucursal_id uuid not null references sucursal(id),
  fecha       date not null,
  ultimo      integer not null check (ultimo >= 1),
  primary key (sucursal_id, fecha)
);

-- Ningun vendedor puede tener el segmento de la oficina: su folio chocaria con
-- los OF. `is distinct from` deja pasar el null (vendedor sin segmento).
alter table vendedor
  add constraint ck_vendedor_folio_segmento_no_oficina
  check (folio_segmento is distinct from 'OF');
