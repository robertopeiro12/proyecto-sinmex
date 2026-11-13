import type { Migracion } from './motor';

/**
 * Las notas asignadas en la tablet (spec 2026-11-13, notas asignadas con
 * condicion de venta): la oficina le asigna al vendedor notas por cobrar de un
 * dia, con una condicion (`ninguna`, `liquidar`, `abonar`) que la tablet usa
 * para bloquear la venta; el vendedor puede "continuar sin cobrar" dejando un
 * comentario.
 *
 * - `ruta.recado`: el mensaje de la oficina para el vendedor (lo trae el pull).
 * - `ruta_dia`: nombre de la ruta y vehiculo del dia. Solo lo escribe el pull.
 * - `nota_asignada`: la asignacion de una nota a un dia, con su condicion. Solo
 *   la escribe el pull. Sin llave foranea a `nota_pendiente`: la asignacion
 *   puede bajar antes que la nota (o la nota ya no existir) y la pantalla
 *   decide con lo que haya; una nota sin saldo vivo nunca se pide.
 * - `nota_no_cobrada`: el comentario del vendedor; lo escribe la tablet y lo
 *   sube el push (`tipo: 'nota-no-cobrada'`). `id` = clave de idempotencia. No
 *   se edita ni se borra: cada "Continuar sin cobrar" es una fila nueva.
 * - `cobranza.reparto_json`: a que notas fue cada cobro (`[]` en los viejos);
 *   con el se sabe si hoy se "toco" una nota asignada.
 *
 * Todo es tabla nueva o `add column` con default: no rehace `ruta` (011) ni
 * `cobranza` (010). Al final se borra el cursor del pull (decision 16): la
 * tablet ya sincronizada no traeria `recado`, `reparto_json` ni las
 * asignaciones de dias anteriores con un pull incremental; sin cursor baja todo
 * de nuevo.
 */
export const notasAsignadas: Migracion = {
  version: 19,
  nombre: 'notas-asignadas',
  sql: `
    alter table ruta add column recado text;

    create table ruta_dia (
      id               text primary key,
      fecha            text not null,
      nombre_ruta      text,
      vehiculo_id      text,
      activo           integer not null default 1,
      sincronizado_en  text not null
    );

    create table nota_asignada (
      id               text primary key,
      venta_nota_id    text not null,
      fecha            text not null,
      condicion_venta  text not null check (condicion_venta in ('ninguna', 'liquidar', 'abonar')),
      activo           integer not null default 1,
      sincronizado_en  text not null
    );
    create index idx_nota_asignada_fecha on nota_asignada (fecha) where activo = 1;

    create table nota_no_cobrada (
      id               text primary key,           -- = clave de idempotencia
      venta_nota_id    text not null,
      cliente_id       text not null references cliente(id),
      vendedor_id      text not null references vendedor(id),
      fecha            text not null,              -- reloj.hoy(), dia de trabajo
      comentario       text not null,              -- recortado, 1 a 300
      registrado_en    text not null,
      sync_estado      text not null default 'pendiente'
                         check (sync_estado in ('pendiente','enviando','sincronizado','error')),
      sync_error       text,
      sincronizado_en  text
    );
    create index idx_nota_no_cobrada_sync on nota_no_cobrada (sync_estado)
      where sync_estado <> 'sincronizado';
    create index idx_nota_no_cobrada_nota_fecha on nota_no_cobrada (venta_nota_id, fecha);

    alter table cobranza add column reparto_json text not null default '[]';

    delete from sync_cursor where entidad = 'pull';
  `,
};
