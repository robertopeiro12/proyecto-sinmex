-- Cobranza, abono y saldo a favor (T-20).
--
-- T-05 creo `cobranza_abono` como esqueleto. T-20 es el primero que escribe en
-- ella: el push de la tablet (tipo `cobranza`) y la venta de contado (D2).

alter table cobranza_abono
  -- El folio que emitio la tablet (D11). Se repite en todas las filas que
  -- genera un mismo cobro, asi que NO es unique aqui: su unicidad global vive
  -- en `sync_operacion.folio`.
  add column folio text,
  -- Cobro automatico de una venta de contado o cobro capturado (D2). Corte y
  -- tesoreria suman una sola tabla y pueden desglosar.
  add column origen text not null default 'cobro'
    check (origen in ('venta_contado', 'cobro')),
  -- El dia de trabajo del sobre, tal cual llego (D3). El corte suma por esta
  -- fecha; `fecha_pago` es informativa.
  add column fecha_operacion date;

-- Filas previas (si las hay en un entorno compartido): su fecha de operacion es la de pago.
update cobranza_abono set fecha_operacion = fecha_pago where fecha_operacion is null;

alter table cobranza_abono
  alter column fecha_operacion set not null,
  add constraint ck_cobranza_abono_monto_positivo check (monto > 0),
  -- La foto del saldo tras el abono (D7). Nunca negativa: lo que sobra va a
  -- saldo a favor, no a una nota con saldo negativo.
  add constraint ck_cobranza_abono_saldo_no_negativo check (saldo_pendiente >= 0);

create index idx_cobranza_abono_nota on cobranza_abono (venta_nota_id) where deleted_at is null;
create index idx_cobranza_abono_folio on cobranza_abono (folio);

-- Saldo a favor del cliente como libro de movimientos (D5): el saldo es la
-- suma de sus movimientos vivos. T-20 solo escribe excedentes de cobro; usarlo
-- es de otro ticket, y ese ticket agregara su origen al check.
create table saldo_favor_movimiento (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz,
  cliente_id      uuid not null references cliente(id),
  vendedor_id     uuid references vendedor(id),
  monto           numeric(12,2) not null check (monto <> 0),
  origen          text not null check (origen in ('excedente_cobro')),
  folio           text,
  fecha_operacion date not null
);
create index idx_saldo_favor_cliente on saldo_favor_movimiento (cliente_id) where deleted_at is null;
create trigger trg_saldo_favor_movimiento_updated before update on saldo_favor_movimiento
  for each row execute function set_updated_at();
