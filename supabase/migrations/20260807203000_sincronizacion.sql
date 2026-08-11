-- Bitacora de operaciones recibidas por el `push` de la tablet (T-07).
--
-- Es la pieza que hace **idempotente** la sincronizacion: la tablet sube su dia
-- por WiFi intermitente y reintenta, y reenviar el mismo lote no puede duplicar
-- operaciones. La regla vive aqui, en un unique de la base, y no en una
-- comprobacion del servicio: entre el SELECT y el INSERT de una comprobacion
-- previa cabe un segundo reintento del mismo lote, que es precisamente el caso
-- que hay que evitar.
--
-- ## Que es y que NO es
--
-- Es un **buzon de transporte**, no la operacion de negocio. Ventas, cobranza,
-- gastos, merma y ruta son T-16/T-20/T-27/T-33/T-39 y todavia no existen: T-07
-- define el contrato por el que viajan y las guarda tal cual llegaron. Cuando
-- cada modulo exista, proyectara desde aqui a su tabla real y dejara el id de
-- la fila creada en `entidad_id` / `entidad_tabla`.
--
-- TODO: T-16/T-20/T-27/T-33/T-39 — proyectar cada `tipo` a su tabla de negocio.
-- TODO: T-43 — resolucion de conflictos. Esta tabla es el registro sobre el que
--       se apoyara: guarda lo que mando la tablet, cuando ocurrio y cuando se
--       recibio, sin haberlo mezclado todavia con lo que hizo el portal.
--
-- ## Por que la clave de idempotencia es del cliente
--
-- Los [[Folios]] los genera T-14 y todavia no existen; ademas un folio es un
-- identificador de **negocio** que solo se puede emitir una vez, asi que no
-- sirve como clave de reintento (emitirlo dos veces seria el bug, no la
-- solucion). La clave es el **id local de la fila en SQLite** (uuid v4 generado
-- en la tablet al capturar), estable desde la captura y nunca regenerado.
-- Cuando llegue T-14, el folio se emitira **al proyectar** esta fila a su tabla
-- de negocio, una sola vez: un reenvio encuentra el unique, no vuelve a
-- proyectar y devuelve el mismo `entidad_id` — y con el, el mismo folio.
--
-- ## Solo se registran las operaciones ACEPTADAS
--
-- Una operacion rechazada NO deja fila. Si la dejara, consumiria su clave y la
-- tablet no podria reenviar nunca una version corregida de esa misma fila
-- local: quedaria rechazada para siempre. El rechazo se recalcula en cada
-- intento, que es deterministico y no necesita memoria.

create table sync_operacion (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Quien la mando. Lo decide el servidor desde el token, nunca el cuerpo.
  vendedor_id uuid not null references vendedor(id),
  sucursal_id uuid not null references sucursal(id),

  -- Id local de la fila en la tablet. Unico POR VENDEDOR: dos tablets no
  -- comparten espacio de nombres y una no puede pisar la operacion de la otra.
  clave_idempotencia text not null,

  tipo text not null,
  -- Version del contrato con la que se recibio. Un lote viejo sigue siendo
  -- interpretable cuando el contrato avance.
  contrato integer not null,

  -- El dia de trabajo del vendedor, tal como lo calculo la tablet con su reloj
  -- LOCAL (America/Tijuana). El servidor no lo re-deriva de `ocurrido_en`: a
  -- las 18:00 de Tijuana en UTC ya es el dia siguiente, y partir la jornada ahi
  -- romperia el corte del dia y el contador diario de folios (ADR-0001).
  fecha_operacion date not null,
  -- El instante exacto, con zona horaria. Es dato de transporte/auditoria.
  ocurrido_en timestamptz not null,
  recibido_en timestamptz not null default now(),

  -- El cuerpo de la operacion tal como lo mando la tablet, sin interpretar.
  datos jsonb not null,

  -- Se llenan cuando el modulo de negocio del `tipo` exista y proyecte.
  entidad_tabla text,
  entidad_id uuid,

  unique (vendedor_id, clave_idempotencia)
);

create trigger trg_sync_operacion_updated before update on sync_operacion
  for each row execute function set_updated_at();

-- Lo que consulta el push al resolver un lote (todas las claves de un vendedor)
-- y lo que consultara la proyeccion de cada modulo (lo pendiente de un tipo).
create index idx_sync_operacion_vendedor_fecha
  on sync_operacion (vendedor_id, fecha_operacion);

create index idx_sync_operacion_sin_proyectar
  on sync_operacion (tipo, recibido_en) where entidad_id is null;
