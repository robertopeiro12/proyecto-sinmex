-- Notas asignadas en la tablet: condicion de venta y comentario "no cobre".
-- Spec: docs/superpowers/specs/2026-11-13-notas-asignadas-tablet-condicion-venta-design.md (3)
--
-- condicion_venta: lo que la oficina le pide al vendedor al asignarle la nota:
-- 'ninguna' (default), 'liquidar' o 'abonar'. Es de la asignacion, igual que
-- papel_entregado, por eso vive en nota_asignada.
--
-- nota_no_cobrada: el comentario del vendedor cuando no cobra una nota asignada.
-- id = clave del push. A proposito NO tiene FK a nota_asignada: la asignacion se
-- puede dar de baja o rehacer despues del comentario y este debe sobrevivir
-- (decision 13 de la spec). Solo apunta a la venta, al vendedor y a la sucursal.
--
-- Pre-flight contra la nube: una columna con default y una tabla nueva; nada que
-- contar.

alter table nota_asignada
  add column condicion_venta text not null default 'ninguna';

alter table nota_asignada
  add constraint ck_nota_asignada_condicion
  check (condicion_venta in ('ninguna', 'liquidar', 'abonar'));

create table nota_no_cobrada (
  id             uuid primary key,
  venta_nota_id  uuid not null references venta_nota(id),
  vendedor_id    uuid not null references vendedor(id),
  sucursal_id    uuid not null references sucursal(id),
  fecha          date not null,
  comentario     text not null,
  registrado_en  timestamptz not null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz,
  constraint ck_nota_no_cobrada_comentario
    check (char_length(comentario) between 1 and 300)
);

create trigger trg_nota_no_cobrada_updated before update on nota_no_cobrada
  for each row execute function set_updated_at();

create index idx_nota_no_cobrada_vendedor_fecha
  on nota_no_cobrada (vendedor_id, fecha)
  where deleted_at is null;

create index idx_nota_no_cobrada_nota
  on nota_no_cobrada (venta_nota_id)
  where deleted_at is null;
