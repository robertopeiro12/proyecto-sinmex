-- Rediseno de la app del vendedor, pieza 4 (merma y cambios).
-- Spec: docs/superpowers/specs/2026-11-18-rediseno-app-vendedor-design.md §11 y §16-bis "Cambios".
-- Plan: docs/superpowers/plans/2026-11-25-rediseno-pieza-4-merma-y-cambios.md (decisiones 1 y 2).
--
-- * `movimiento_inventario.tipo` admite `cambio`: el cambio fisico con un cliente
--   (lo `recibido` regresa al inventario del vendedor, lo `entregado` sale). Como
--   la merma del cliente, lleva cliente (`ck_movimiento_cliente`). La regla de
--   "al menos una pieza recibida y una entregada" la exige el backend (forma).
-- * `motivo_merma_id`: el motivo del catalogo `motivo_merma` (el del Registro de
--   Operacion). **Nulo permitido**: filas viejas y tablets sin actualizar mandan la
--   merma sin motivo y el servidor la acepta. Solo las mermas (del cliente y del
--   trayecto) pueden llevarlo (`ck_movimiento_motivo`). El servidor no revisa las
--   banderas `aplica_*` ni `deleted_at` (uno dado de baja tras capturar sin red entra).
--
-- Pre-flight contra la nube: nada que contar. Los dos checks se ensanchan (toda
-- fila que cumplia el viejo cumple el nuevo) y la columna nueva es nula, asi que
-- `ck_movimiento_motivo` lo cumple toda fila existente. Backend antes que la app.

alter table movimiento_inventario drop constraint movimiento_inventario_tipo_check;
alter table movimiento_inventario add constraint movimiento_inventario_tipo_check
  check (tipo in ('merma_cliente', 'merma_trayecto', 'consumo', 'cambio'));

alter table movimiento_inventario drop constraint ck_movimiento_cliente;
alter table movimiento_inventario add constraint ck_movimiento_cliente
  check ((tipo in ('merma_cliente', 'cambio')) = (cliente_id is not null));

alter table movimiento_inventario add column motivo_merma_id uuid references motivo_merma(id);
alter table movimiento_inventario add constraint ck_movimiento_motivo
  check (motivo_merma_id is null or tipo in ('merma_cliente', 'merma_trayecto'));
