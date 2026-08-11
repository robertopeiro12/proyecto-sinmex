import type { Migracion } from './motor';

/**
 * Emision **offline** de [[Folios|folios]] en la tablet (T-14).
 *
 * Cierra el `TODO: T-14 — tabla de folios y contador diario local` que dejo
 * `001-esquema-inicial.ts`.
 *
 * ## Por que el folio se emite aqui y no en el servidor
 *
 * [[ADR-0001 Formato de folios]] lo descarta explicitamente: la tablet opera
 * sin red toda la jornada y el folio **se escribe en la nota fisica que el
 * cliente firma**, en campo. No puede esperar a la sincronizacion.
 *
 * ## Las dos tablas, y por que son dos
 *
 * - **`folio_contador`** — el contador. Su llave primaria es
 *   `(vendedor_id, sucursal_id, fecha)`, y **ahi vive el arreglo del bug**: el
 *   consecutivo cuelga de la FECHA, no de "el ultimo folio que emiti". Por eso
 *   un dia nuevo no puede heredar el numero del dia anterior, que es
 *   exactamente lo que el sistema v1 hacia mal ("el vendedor empieza en la
 *   operacion que finalizo el dia anterior").
 *
 * - **`folio_emitido`** — que folio se le dio a que operacion. Existe por dos
 *   motivos que el contador solo no cubre:
 *
 *   1. `folio` es **llave primaria**: la misma base impide emitir dos veces el
 *      mismo folio, aunque el contador se corrompiera.
 *   2. `operacion_clave` es **unica**: pedir folio dos veces para la misma
 *      operacion devuelve el que ya tenia en vez de quemar un numero nuevo. Es
 *      lo que evita **saltos** cuando la app se cierra a media operacion y al
 *      volver reintenta la misma captura.
 *
 * > [!danger] El reloj de la tablet es manipulable, y eso se acepta
 * > Igual que ADR-0005 y ADR-0006 ya lo aceptan para la ventana offline y para
 * > `fecha_operacion`. Lo que **se garantiza** aqui es que un dispositivo nunca
 * > emite dos veces el mismo folio: si el vendedor mueve la fecha atras, la
 * > fila de esa fecha ya existe y el contador **continua** donde iba en vez de
 * > reiniciar. Lo que **no** se garantiza es que la fecha del folio sea la
 * > fecha real — para eso no hay forma sin NTP, y el servidor solo corta lo que
 * > venga a mas de un dia en el futuro (T-07).
 */
export const folios: Migracion = {
  version: 3,
  nombre: 'folios',
  sql: `
    ------------------------------------------------------------------
    -- 1. El segmento de vendedor, que baja del pull
    ------------------------------------------------------------------

    -- Las 2 letras del vendedor dentro del folio (5o segmento).
    --
    -- **No se deriva aqui de \`nombre\`.** Podria, pero seria incorrecto: dos
    -- vendedores con las mismas iniciales chocarian y la tablet **no puede
    -- detectarlo**, porque del pull solo baja su propia ficha y no ve a sus
    -- companeros. Lo asigna el servidor y esta columna lo refleja.
    --
    -- Nulo mientras no haya sincronizado nunca. Sin segmento no se puede
    -- foliar, y el repositorio lo dice en voz alta en vez de inventarselo.
    alter table vendedor add column folio_segmento text;

    ------------------------------------------------------------------
    -- 2. El contador diario
    ------------------------------------------------------------------

    create table folio_contador (
      vendedor_id   text not null references vendedor(id),
      sucursal_id   text not null references sucursal(id),
      -- El dia de trabajo del vendedor (\`reloj.hoy()\`, hora local de Tijuana),
      -- el mismo que viaja como \`fecha_operacion\` en el push. NO se deriva de
      -- UTC: a las 18:00 de Tijuana en UTC ya es el dia siguiente y la jornada
      -- quedaria partida en dos.
      fecha         text not null,
      -- Ultimo consecutivo emitido para esa combinacion. Arranca en 1.
      ultimo        integer not null check (ultimo >= 1),
      creado_en     text not null,
      actualizado_en text not null,
      -- La llave es (vendedor, sucursal, FECHA). El reinicio diario no es
      -- codigo que haya que acordarse de ejecutar: es la forma de la tabla.
      primary key (vendedor_id, sucursal_id, fecha)
    );

    ------------------------------------------------------------------
    -- 3. Los folios ya emitidos
    ------------------------------------------------------------------

    create table folio_emitido (
      -- Llave primaria: la base impide emitir dos veces el mismo folio.
      folio            text primary key,
      vendedor_id      text not null references vendedor(id),
      sucursal_id      text not null references sucursal(id),
      fecha            text not null,
      consecutivo      integer not null,
      -- La operacion local que consumio este folio (el \`id\` de su fila, que es
      -- tambien su clave de idempotencia en el push).
      --
      -- **Unica**: pedir folio dos veces para la misma operacion devuelve el
      -- mismo, en vez de quemar un numero. Sin esto, una app que se cierra a
      -- media operacion dejaria huecos en la numeracion del dia.
      --
      -- Ojo: folio y clave de idempotencia son cosas distintas y viven en capas
      -- distintas (T-07/ADR-0006). Esta columna las **relaciona**, no las
      -- confunde: la clave identifica el transporte, el folio el hecho de
      -- negocio.
      operacion_clave  text not null unique,
      emitido_en       text not null
    );

    create index idx_folio_emitido_dia
      on folio_emitido (vendedor_id, fecha);
  `,
};
