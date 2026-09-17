import type { Migracion } from './motor';

/**
 * El registro de prospectos en ruta (T-40): el catalogo que necesita y la tabla
 * donde se captura.
 *
 * ## 1. `tipo_negocio` — catalogo, baja del pull
 *
 * Es el desplegable *Tipo de negocio* de la pantalla. Baja del `pull` como
 * cualquier otro catalogo (coleccion `tipos_negocio`, nueva en T-40) y **no
 * cuelga de una sucursal**: el giro es de la empresa, igual que `producto`.
 *
 * ## 2. `prospecto` — captura local, sube en el push
 *
 * > [!danger] Por que NO se captura en la tabla `cliente`
 * > Seria lo intuitivo y esta mal. Un prospecto que se guardara en `cliente`
 * > tendria el `id` que genero **la tablet**; al sincronizar, el servidor crea la
 * > fila de `cliente` con **su propio uuid**, y en el siguiente `pull` esa fila
 * > baja como un cliente nuevo. Resultado: **dos filas para el mismo negocio**,
 * > una local y una del servidor, sin nada que las relacione y sin forma de
 * > reconciliarlas hasta T-43.
 * >
 * > Con una tabla propia el reparto queda limpio: `cliente` es **solo** el
 * > espejo de lo que manda el portal (y sigue siendo de solo lectura, como dice
 * > `catalogos.ts`), y `prospecto` es la bitacora de lo que este vendedor
 * > capturo. El prospecto proyectado vuelve por el `pull` con `tipo =
 * > 'prospecto'` y ahi no estorba a nadie. Es el mismo reparto que T-16 uso para
 * > `venta` frente a `nota_pendiente`.
 *
 * ## 3. `foto_uri`, previsto y sin usar
 *
 * La columna existe y **nadie la escribe todavia**. El cliente confirmo que
 * quiere la foto del lugar (2026-08-23, condicionada a que no haga lento el
 * alta), pero falta decidir **donde se guarda el archivo** — el candidato es
 * Supabase Storage, y el alcance de Supabase es justo lo que
 * `ADR-0002 Stack tecnologico inicial` dejo abierto. Se deja el hueco para que
 * el ticket de la foto sea una pantalla y un upload, no una migracion que tenga
 * que rehacer esta tabla en tablets que ya esten en la calle.
 *
 * ## `id` es la clave de idempotencia
 *
 * Un uuid v4 generado al grabar, que no cambia nunca. Reenviar el lote no puede
 * duplicar el prospecto. **No lleva folio** (`folio_emitido` no se toca aqui): un
 * prospecto no es una nota que nadie firme, asi que no consume un numero del
 * contador del dia (ADR-0001).
 */
export const prospectos: Migracion = {
  version: 6,
  nombre: 'prospectos',
  sql: `
    ------------------------------------------------------------------
    -- 1. Catalogo de tipos de negocio (baja del pull)
    ------------------------------------------------------------------

    create table tipo_negocio (
      id                text primary key,
      nombre            text not null,
      -- La baja llega como bandera, nunca como ausencia: el snapshot se aplica
      -- con upsert. Ver 002-sincronizacion.ts.
      activo            integer not null default 1,
      sincronizado_en   text not null
    );

    ------------------------------------------------------------------
    -- 2. Prospectos capturados en ruta (suben en el push)
    ------------------------------------------------------------------

    create table prospecto (
      id                    text primary key,        -- = clave de idempotencia
      -- Dia de trabajo (\`reloj.hoy()\`, hora local de Tijuana), el mismo que
      -- viaja como \`fecha_operacion\`. NO se deriva de UTC: a las 18:00 de
      -- Tijuana en UTC ya es el dia siguiente.
      fecha                 text not null,
      vendedor_id           text not null references vendedor(id),
      sucursal_id           text not null references sucursal(id),

      -- Los campos que dicto el cliente (agosto 2026, ver [[Cliente]]).
      nombre                text not null check (length(trim(nombre)) > 0),
      telefono              text not null check (length(trim(telefono)) > 0),
      encargado             text,
      -- Sin llave foranea a proposito: el tipo de negocio pudo darse de baja en
      -- el portal despues de capturarse, y una FK impediria conservar el
      -- prospecto para reintentarlo. El servidor es quien decide si sigue
      -- vigente (\`tipo-negocio-inexistente\`).
      tipo_negocio_id       text,
      comentarios           text,
      -- Las dos o ninguna: media coordenada no ubica nada. Sin ubicacion es un
      -- caso normal (permiso negado, sin GPS) y no bloquea el alta.
      lat                   real,
      lng                   real,

      -- Previsto, sin usar. Ver el bloque 3 del comentario de arriba.
      foto_uri              text,

      grabado_en            text not null,
      sync_estado           text not null default 'pendiente'
                              check (sync_estado in ('pendiente', 'enviando', 'sincronizado', 'error')),
      sync_error            text,
      sincronizado_en       text,

      -- Va al final porque SQLite no admite definiciones de columna despues de
      -- una restriccion de tabla: puestas en medio, el \`create table\` falla con
      -- un \`syntax error\` en la columna siguiente.
      check ((lat is null) = (lng is null))
    );

    -- Lo que falta por subir (mismo patron que idx_jornada_pendiente).
    create index idx_prospecto_sync on prospecto (sync_estado) where sync_estado <> 'sincronizado';
    -- "Prospectos de hoy" en la pantalla.
    create index idx_prospecto_dia on prospecto (vendedor_id, fecha);
  `,
};
