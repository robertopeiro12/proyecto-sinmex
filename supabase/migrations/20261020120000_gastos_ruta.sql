-- T-30 / T-31 (parte de la ruta): catalogo de campos de egreso y gastos de la ruta.
-- Spec: docs/superpowers/specs/2026-10-20-t-30-31-gastos-de-ruta-design.md
--
-- Dos tablas nuevas y vacias (mas la semilla del catalogo): no hay filas que
-- violen nada, asi que no hace falta pre-flight contra la nube.
--
-- * `campo_egreso` es un catalogo GLOBAL (D2), como `motivo_visita`: la oficina
--   lo administra en el portal y baja en el pull como `campos_egreso`. Los tres
--   tipos de egreso son fijos (D1): un check, no una tabla.
-- * `gasto` guarda cada gasto que sube la tablet (D4). Su `id` es la clave de la
--   operacion del push (como `visita` en T-39), asi que la foto del ticket se
--   liga a ella sin ambiguedad. `vendedor_id` nulo queda para las compras de
--   oficina del siguiente ticket (el resto de T-31).
--
-- `set_actualizado_en()` ya existe (T-39); aqui solo se cuelga el trigger.

create table campo_egreso (
  id             uuid primary key default gen_random_uuid(),
  nombre         text not null
    constraint ck_campo_egreso_nombre check (btrim(nombre) <> ''),
  tipo           text not null
    constraint ck_campo_egreso_tipo check (tipo in ('produccion', 'operacion', 'financiero')),
  se_usa_en_app  boolean not null default false,
  deleted_at     timestamptz,
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

-- Mismo patron que `uq_motivo_visita_nombre`: "Hielo", "hielo" y " Hielo " son
-- el mismo campo, y dar uno de baja libera su nombre.
create unique index uq_campo_egreso_nombre
  on campo_egreso (lower(btrim(nombre))) where deleted_at is null;

create trigger trg_campo_egreso_actualizado before update on campo_egreso
  for each row execute function set_actualizado_en();

-- Semilla del cliente (spec D2). Los cuatro de la ruta llevan la casilla.
insert into campo_egreso (nombre, tipo, se_usa_en_app) values
  ('Envases',                 'produccion', false),
  ('Celular',                 'operacion',  false),
  ('Gastos diversos',         'operacion',  false),
  ('Ajustes x no cuadrar',    'operacion',  false),
  ('Gasolina',                'operacion',  true),
  ('Hielo',                   'operacion',  true),
  ('Reparación del vehículo', 'operacion',  true),
  ('Adelanto de sueldo',      'operacion',  true)
on conflict do nothing;

create table gasto (
  id                 uuid primary key,             -- = clave de la operacion (D4)
  sucursal_id        uuid not null references sucursal(id),
  vendedor_id        uuid references vendedor(id), -- null: compra de oficina (siguiente ticket)
  capturo_usuario_id uuid references usuario(id),  -- null por ahora
  campo_egreso_id    uuid not null references campo_egreso(id),
  campo_nombre       text not null,                -- copia al proyectar (D4)
  tipo               text not null
    constraint ck_gasto_tipo check (tipo in ('produccion', 'operacion', 'financiero')),
  fecha              date not null,                -- fecha_operacion del sobre: el dia al que cuenta
  registrado_en      timestamptz not null,
  monto              numeric(14,2) not null
    constraint ck_gasto_monto check (monto > 0),
  metodo             text not null
    constraint ck_gasto_metodo check (metodo in ('efectivo_cobranza_dia')),
  quien              text,
  factura            text not null default 'N/A',
  comentario         text
    constraint ck_gasto_comentario check (comentario is null or char_length(comentario) <= 200),
  foto_archivo       text,                         -- nombre dentro de FOTOS_DIR (gasto-<id>.jpg)
  foto_subida_en     timestamptz,
  origen             text not null
    constraint ck_gasto_origen check (origen in ('app', 'portal')),
  deleted_at         timestamptz,
  creado_en          timestamptz not null default now(),
  -- Igual que `ck_visita_foto_completa`: nombre y fecha se escriben juntos.
  constraint ck_gasto_foto_completa check ((foto_archivo is null) = (foto_subida_en is null)),
  -- Un gasto de la app siempre es de un vendedor.
  constraint ck_gasto_app_con_vendedor check (origen <> 'app' or vendedor_id is not null)
);

-- Tesoreria (T-29) y el corte (T-33) leen por sucursal y dia; la lista del
-- portal, por vendedor y por campo; la baja del campo busca por campo y fecha.
create index idx_gasto_sucursal_fecha on gasto (sucursal_id, fecha);
create index idx_gasto_vendedor_fecha on gasto (vendedor_id, fecha);
create index idx_gasto_campo_fecha on gasto (campo_egreso_id, fecha);

-- El perfil `Administrador General` los recibe solos (PERFIL_MAESTRO). Leer el
-- catalogo de campos solo pide sesion del portal (D3).
insert into permiso (clave, grupo, descripcion) values
  ('campo_egreso.gestionar', 'General',  'Campos de egreso: alta, edición y baja'),
  ('gasto.ver',              'Finanzas', 'Ver gastos')
on conflict (clave) do nothing;
