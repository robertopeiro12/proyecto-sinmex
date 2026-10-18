import type { Migracion } from './motor';

/**
 * La visita sin venta en la tablet (T-39).
 *
 * - `motivo_visita`: el catalogo que baja en el pull (`motivos_visita`, upsert
 *   generico, baja como bandera). `exige_foto`/`exige_atendio` los aplica
 *   `validarVisita` al guardar; el servidor no los revisa.
 * - `visita`: lo que el vendedor captura. `id` = clave de idempotencia y, en el
 *   servidor, el id de la fila (D2). `motivo_nombre` es una copia del nombre al
 *   guardar, para pintar sin join aunque la oficina lo renombre despues. Sin
 *   GPS exige `direccion_texto` (el mismo CHECK que Postgres).
 * - La foto de la visita usa el **mismo esquema derivado** que la del prospecto
 *   (007): `foto_local` + `foto_subida_en` + `foto_error` + `foto_descartada`,
 *   sin una columna de estado que pueda contradecirlos. Ninguna toca
 *   `sync_estado`: una foto que falla no se lleva la visita.
 * - `cliente.foto_subida_en` baja en el pull (D9); `foto_cache_subida_en` es de
 *   la tablet: el `foto_subida_en` de la copia que ya bajo a su cache. El pull
 *   no la escribe (no esta en las columnas del upsert), asi que la conserva.
 */
export const visitas: Migracion = {
  version: 13,
  nombre: 'visitas',
  sql: `
    create table motivo_visita (
      id              text primary key,
      nombre          text not null,
      exige_foto      integer not null default 0 check (exige_foto in (0, 1)),
      exige_atendio   integer not null default 0 check (exige_atendio in (0, 1)),
      activo          integer not null default 1,
      sincronizado_en text not null
    );

    create table visita (
      id               text primary key,           -- = clave de idempotencia
      fecha            text not null,              -- dia de trabajo (fecha_operacion)
      cliente_id       text not null references cliente(id),
      vendedor_id      text not null references vendedor(id),
      sucursal_id      text not null references sucursal(id),
      motivo_visita_id text not null references motivo_visita(id),
      motivo_nombre    text not null,
      visitada_en      text not null,              -- ISO; viaja como ocurrido_en
      observaciones    text,
      atendio          text,
      lat              real,
      lng              real,
      precision_m      real,
      direccion_texto  text,
      foto_local       text,
      foto_subida_en   text,
      foto_error       text,
      foto_descartada  integer not null default 0 check (foto_descartada in (0, 1)),
      sync_estado      text not null default 'pendiente'
                         check (sync_estado in ('pendiente','enviando','sincronizado','error')),
      sync_error       text,
      sincronizado_en  text,
      check ((lat is null) = (lng is null)),
      check (lat is not null or trim(coalesce(direccion_texto, '')) <> '')
    );

    -- Lo que falta por subir (mismo patron que idx_cobranza_sync).
    create index idx_visita_sync on visita (sync_estado) where sync_estado <> 'sincronizado';
    -- "Visitas de hoy" de la ficha y la consulta de la ruta del dia.
    create index idx_visita_cliente_fecha on visita (cliente_id, fecha);
    -- "Atendidos fuera de ruta".
    create index idx_visita_vendedor_fecha on visita (vendedor_id, fecha);
    -- La cola de fotos, como idx_prospecto_foto_pendiente (007).
    create index idx_visita_foto_pendiente on visita (sync_estado)
      where foto_local is not null and foto_subida_en is null and foto_descartada = 0;

    alter table cliente add column foto_subida_en text;
    alter table cliente add column foto_cache_subida_en text;
  `,
};
