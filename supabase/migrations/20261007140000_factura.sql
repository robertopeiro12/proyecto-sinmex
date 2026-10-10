-- T-19: asignar factura a notas de ventas.
--
-- La factura se emite FUERA de JAWA, en el programa avalado por el SAT; aqui
-- solo se registra su numero en las ventas que ampara. Fuente: "una factura
-- puede agrupar varias notas" y "algunos clientes piden factura mensual".
--
-- Decisiones de Roberto (2026-10-07): se asigna a varias ventas de un jalon,
-- se puede corregir el numero o quitar ventas, y un numero es de UN cliente.
-- Ver docs/superpowers/specs/2026-10-07-t19-asignar-factura-design.md.

create table factura (
  id                          uuid primary key default gen_random_uuid(),
  numero                      text not null
                                check (char_length(btrim(numero)) between 1 and 30),
  cliente_id                  uuid not null references cliente(id),
  creado_por_usuario_id       uuid not null references usuario(id),
  creado_en                   timestamptz not null default now(),
  actualizado_por_usuario_id  uuid references usuario(id),
  actualizado_en              timestamptz,
  -- Destino de la llave compuesta de venta_nota (abajo).
  unique (id, cliente_id)
);

-- Un numero es de un solo cliente: A780, a780 y " A780 " son la misma
-- factura. El servicio reconoce su `23505` por este nombre.
create unique index uq_factura_numero on factura (lower(btrim(numero)));

alter table venta_nota
  add column factura_id                      uuid,
  add column factura_asignada_por_usuario_id uuid references usuario(id),
  add column factura_asignada_en             timestamptz,
  -- La BASE impide que una venta apunte a la factura de otro cliente. Con
  -- factura_id null no se comprueba (MATCH SIMPLE).
  add constraint fk_venta_nota_factura
    foreign key (factura_id, cliente_id) references factura (id, cliente_id);

-- `factura` era texto libre y nullable desde T-05. Hasta hoy solo hay N/A y
-- pendiente, y null en filas viejas (el lector ya lo trataba como N/A).
update venta_nota set factura = 'N/A' where factura is null;

alter table venta_nota
  alter column factura set default 'N/A',
  alter column factura set not null,
  add constraint ck_venta_nota_factura
    check (factura in ('N/A', 'pendiente', 'facturada')),
  -- "facturada" si y solo si apunta a una factura.
  add constraint ck_venta_nota_factura_id
    check ((factura = 'facturada') = (factura_id is not null));

create index idx_venta_nota_factura on venta_nota (factura_id)
  where factura_id is not null;
create index idx_venta_nota_por_facturar on venta_nota (cliente_id)
  where factura = 'pendiente' and deleted_at is null;

insert into permiso (clave, grupo, descripcion) values
  ('venta.asignar_factura', 'Operacion Comercial', 'Asignar factura a notas de ventas')
on conflict (clave) do nothing;
