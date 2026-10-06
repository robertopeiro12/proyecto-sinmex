-- Buscar, editar y eliminar ventas desde el portal (T-17, parte 2).
-- Spec: docs/superpowers/specs/2026-10-06-t17b-buscar-editar-eliminar-venta-design.md (§5)
--
-- Pre-flight antes de empujar a `sinmex dev` (protocolo de CLAUDE.md): no hay
-- checks, `not null` ni `unique` nuevos que puedan fallar. El indice parcial es
-- MAS permisivo que la constraint total que reemplaza: toda fila que hoy cumple
-- la total cumple la parcial. Igual se anota `migration list` antes y despues.

-- Historial minimo (§2): quien y cuando. `updated_at` ya dice cuando se edito
-- y `deleted_at` cuando se elimino; aqui solo falta el quien.
alter table venta_nota
  -- Ultimo usuario del portal que la edito o la marco como cuenta perdida.
  add column actualizado_por_usuario_id uuid references usuario(id),
  -- Quien la elimino (borrado logico).
  add column eliminado_por_usuario_id uuid references usuario(id);

-- Una presentacion, una linea VIVA por venta. La constraint total de T-16
-- impediria volver a agregar una presentacion que una edicion quito (su linea
-- queda con `deleted_at`). Se conserva el nombre: es el que nombran
-- `despacho.spec.ts` y `datos-venta.ts`.
alter table venta_nota_detalle drop constraint uq_venta_detalle_presentacion;
create unique index uq_venta_detalle_presentacion
  on venta_nota_detalle (venta_nota_id, presentacion_id)
  where deleted_at is null;
