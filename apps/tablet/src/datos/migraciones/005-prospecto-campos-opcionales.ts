import type { Migracion } from './motor';

/**
 * `cliente.domicilio` deja de ser obligatorio en la base local (T-40).
 *
 * ## Por que la tablet tiene que aceptar un domicilio nulo
 *
 * No es para capturar prospectos aqui — para eso esta la tabla `prospecto` de la
 * migracion siguiente. Es para poder **recibirlos de vuelta**.
 *
 * Desde T-40, `cliente.domicilio` es nulo en Postgres cuando el prospecto lo dio
 * de alta un vendedor (el cliente dicto ubicacion, no direccion; ver
 * `20260914120000_prospecto_campos_opcionales.sql`). Los prospectos **bajan en el
 * `pull`** como cualquier otro cliente de la sucursal, asi que ese nulo llega
 * aqui. Con la columna `not null`, el `insert` del snapshot revienta, y como
 * `guardarSnapshot` aplica todo en una sola transaccion, **la tablet dejaria de
 * sincronizar del todo** — no solo se perderia ese prospecto. Y le pasaria a un
 * companero de sucursal que no dio de alta nada.
 *
 * ## Por que se rehace la tabla
 *
 * `ALTER TABLE` de SQLite no sabe quitar un `not null`. La unica forma es crear
 * la tabla nueva, copiar, borrar la vieja y renombrar — y eso exige apagar las
 * llaves foraneas **fuera** de la transaccion, que es lo que hace
 * `sinLlavesForaneas` (el porque, con lo que se probo y fallo, esta en
 * `motor.ts`). El motor corre `pragma foreign_key_check` antes del commit,
 * acotado a las tres hijas de `cliente` (`comprobar`): un huerfano preexistente
 * en una tabla ajena (`jornada`, `folio_contador`, etc.) no tiene por que
 * bloquear esta migracion.
 *
 * Se copian las columnas **por nombre y no con `select *`**: si el orden
 * cambiara, `select *` metería cada valor en la columna de al lado sin avisar.
 */
export const prospectoCamposOpcionales: Migracion = {
  version: 5,
  nombre: 'prospecto-campos-opcionales',
  // Las tres hijas de `cliente` (confirmado contra `pragma foreign_key_list`
  // en 001-004: no hay mas). Acotar el chequeo a ellas evita que un huerfano
  // preexistente en una tabla ajena bloquee esta migracion (M-2).
  sinLlavesForaneas: { comprobar: ['cliente_precio', 'nota_pendiente', 'venta'] },
  sql: `
    create table cliente_nueva (
      id                  text primary key,
      nombre              text not null,
      -- Nulo solo si es un prospecto que nacio en la app. El equivalente del
      -- \`ck_cliente_domicilio_obligatorio\` de Postgres: aqui no hace falta
      -- repetirlo, porque la tablet **no da de alta clientes** — solo refleja lo
      -- que baja del portal, que ya paso por ese check.
      domicilio           text,
      telefono            text not null,
      encargado           text,
      tipo                text not null check (tipo in ('cliente', 'prospecto')),
      pct_comision        real,
      promocion           text not null default 'ninguna'
                            check (promocion in ('ninguna', '10+1', '20+1')),
      plazo_credito_dias  integer,
      lat                 real,
      lng                 real,
      sucursal_id         text not null references sucursal(id),
      activo              integer not null default 1,
      sincronizado_en     text not null
    );

    insert into cliente_nueva (
      id, nombre, domicilio, telefono, encargado, tipo, pct_comision, promocion,
      plazo_credito_dias, lat, lng, sucursal_id, activo, sincronizado_en
    )
    select
      id, nombre, domicilio, telefono, encargado, tipo, pct_comision, promocion,
      plazo_credito_dias, lat, lng, sucursal_id, activo, sincronizado_en
    from cliente;

    drop table cliente;
    alter table cliente_nueva rename to cliente;

    -- El indice no viaja con el \`rename\`: se recrea igual que en 001.
    create index idx_cliente_sucursal on cliente (sucursal_id, tipo);
  `,
};
