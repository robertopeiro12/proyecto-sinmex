-- Integridad de la venta (T-16).
--
-- T-05 creo `venta_nota` y `venta_nota_detalle` como esqueleto, sin reglas.
-- T-16 es el primer ticket que escribe en ellas —desde el `push` de la tablet—
-- y T-17 (portal) sera el segundo. Las reglas van en la base y no solo en el
-- servicio por la misma razon que el resto del esquema: las cargas futuras y
-- los scripts entran por debajo de la API.
--
-- Las dos tablas tenian 0 filas al escribir esto (verificado en local el
-- 2026-09-12), asi que ninguna restriccion tropieza con datos viejos.

alter table venta_nota
  -- Observaciones de la venta. Opcional en [[Venta-Nota]] (D9).
  add column comentarios text,
  -- El % de comision del cliente CONGELADO al vender (D8). `cliente.pct_comision`
  -- no tiene historial: si el administrador lo cambia manana, el valor de hoy se
  -- pierde. Guardarlo aqui deja abiertas las dos opciones de [[Calculo de
  -- comision]] (recalcular o no ventas pasadas) para T-45. NO se calcula la
  -- comision en T-16.
  add column pct_comision numeric(5,2),
  -- El numero de la nota fisica es obligatorio (D7). Sin unicidad: ninguna
  -- fuente la pide y la identidad del hecho de negocio es el folio. Pendiente
  -- de confirmar con el cliente.
  add constraint ck_venta_nota_num_nota_no_vacio
    check (char_length(btrim(num_nota)) > 0),
  add constraint ck_venta_nota_comentarios_largo
    check (comentarios is null or char_length(comentarios) <= 500);

alter table venta_nota_detalle
  -- Piezas enteras, nunca negativas, y una linea tiene que llevar algo: venta,
  -- promocion o las dos. Una linea de pura promocion (cantidad 0) es valida:
  -- es como se regalan piezas a un prospecto (D13).
  add constraint ck_venta_detalle_cantidades
    check (cantidad >= 0 and cantidad_promocion >= 0 and cantidad + cantidad_promocion > 0),
  -- 0 si se permite: una linea de pura promocion no necesita precio (D13).
  add constraint ck_venta_detalle_precio
    check (precio >= 0),
  -- Una presentacion, una linea por venta. Dos lineas de lo mismo partirian la
  -- cantidad y el reporte por presentacion sumaria mal.
  add constraint uq_venta_detalle_presentacion
    unique (venta_nota_id, presentacion_id);
