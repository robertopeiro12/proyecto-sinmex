-- T-21: cobranza desde el portal.
--
-- 1. Quien capturo el cobro en el portal (la tablet deja null).
-- 2. Aplicar saldo a favor desde el portal: el abono lleva metodo y origen
--    `saldo_favor` (no es dinero nuevo: Flujo y Tesoreria no deben contarlo) y
--    el libro de saldo a favor gana el movimiento negativo `aplicacion`.
-- 3. La cobranza NO lleva folio. Respuesta del cliente (2026-10-07): "Un solo
--    folio", "Porque la cobranza no lleva folio". Solo las ventas se numeran.
--    `cobranza_abono.folio` tambien guardaba una copia del folio de la venta en
--    los cobros de contado: sobra, la venta lo tiene en `venta_nota.folio`.
--
-- Ver docs/superpowers/specs/2026-10-07-t21-cobranza-portal-design.md §4.4.

alter table cobranza_abono
  add column capturo_usuario_id uuid references usuario(id);

alter table cobranza_abono drop constraint cobranza_abono_metodo_pago_check;
alter table cobranza_abono add constraint ck_cobranza_abono_metodo
  check (metodo_pago in ('efectivo', 'transferencia', 'cheque', 'saldo_favor'));

alter table cobranza_abono drop constraint cobranza_abono_origen_check;
alter table cobranza_abono add constraint ck_cobranza_abono_origen
  check (origen in ('venta_contado', 'cobro', 'saldo_favor'));

-- Uno sin el otro no tiene sentido: el metodo `saldo_favor` es justamente
-- "esto lo pago su saldo a favor", y ese abono no es un cobro ni una venta.
alter table cobranza_abono add constraint ck_cobranza_abono_saldo_favor
  check ((origen = 'saldo_favor') = (metodo_pago = 'saldo_favor'));

alter table saldo_favor_movimiento
  add column capturo_usuario_id uuid references usuario(id);

alter table saldo_favor_movimiento drop constraint saldo_favor_movimiento_origen_check;
alter table saldo_favor_movimiento add constraint ck_saldo_favor_origen
  check (origen in ('excedente_cobro', 'aplicacion'));

-- Defensa en profundidad: el excedente suma al saldo a favor y la aplicación resta.
alter table saldo_favor_movimiento add constraint ck_saldo_favor_signo
  check ((origen = 'aplicacion' and monto < 0) or (origen = 'excedente_cobro' and monto > 0));

drop index if exists idx_cobranza_abono_folio;
alter table cobranza_abono drop column folio;
alter table saldo_favor_movimiento drop column folio;
