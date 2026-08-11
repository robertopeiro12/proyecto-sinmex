-- Folios de operacion (T-14). Ver [[Folios]] y [[ADR-0001 Formato de folios]].
--
-- ## Que es un folio
--
-- 12 caracteres en 6 segmentos de 2, tal como lo fija ADR-0001:
--
--     TJ 26 03 22 AP 05
--     ^^ sucursal        (2 letras, el codigo de `sucursal`)
--        ^^ ano          (2 digitos)
--           ^^ mes
--              ^^ dia
--                 ^^ vendedor  (iniciales, ver abajo)
--                    ^^ operacion del dia (consecutivo, reinicia en 01)
--
-- ## Quien lo emite: la TABLET, offline
--
-- ADR-0001 descarta explicitamente generarlo en el servidor: la tablet opera sin
-- red toda la jornada y el folio se necesita **en campo**, escrito en la nota
-- fisica que el cliente firma. No puede esperar a la sincronizacion.
--
-- > [!warning] Esto corrige lo que T-07 dejo escrito
-- > `20260807203000_sincronizacion.sql` y ADR-0006 anticiparon que "el folio se
-- > emitira al proyectar", es decir en el servidor. T-07 acerto en la **capa**
-- > (folio != clave de idempotencia) y erro en el **emisor**. Lo que sigue en
-- > pie de T-07: la clave identifica el *transporte* y la pone la tablet; el
-- > folio identifica el *hecho de negocio*. Al proyectar (T-16/T-20) el folio
-- > se **copia** a `venta_nota.folio`, no se re-emite, y un reenvio sigue
-- > devolviendo el mismo folio.
--
-- ## Por que la deteccion de colision vive AQUI y no en el servicio
--
-- Si dos tablets emiten el mismo folio, el servidor no puede aceptarlo en
-- silencio: el folio es el identificador con el que se cotejan las notas
-- fisicas, y dos operaciones distintas con el mismo folio hacen ese cotejo
-- imposible para siempre. Entre el `SELECT` de comprobacion y su `INSERT` cabe
-- el push de la otra tablet, asi que la regla es un **unique de la base** —
-- misma doctrina que T-09 (las semillas y los scripts entran por debajo de la
-- API) y que la clave de idempotencia de T-07.

------------------------------------------------------------------
-- 1. El segmento de vendedor del folio
------------------------------------------------------------------

-- Las 2 letras que identifican al vendedor dentro del folio (5o segmento).
--
-- > [!warning] PROVISIONAL — pendiente de confirmar con el cliente
-- > ADR-0001 y [[Vendedor]] dejan abierto **como se desambigua** cuando dos
-- > vendedores comparten iniciales (dos "A P"). Las fuentes no lo dicen y
-- > AGENTS.md prohibe inventar reglas de negocio, asi que esto es una
-- > estrategia defendible marcada como provisional, no una regla confirmada.
-- > Ver ADR-0007.
--
-- Por que es una **columna** y no un calculo:
--
-- 1. La tablet no puede desambiguar offline. T-07 fijo que del `pull` "de
--    vendedores baja **solo su propia ficha**": la tablet no ve a sus
--    companeros, asi que no puede saber si comparte iniciales con alguien.
--    Solo el servidor tiene la visibilidad global para resolverlo.
-- 2. Un folio emitido no se corrige hacia atras. Si el segmento se recalculara,
--    dar de alta a un companero con las mismas iniciales cambiaria el segmento
--    de alguien que ya tiene folios en notas fisicas firmadas. Se asigna una
--    vez y **no se toca** — misma doctrina que el codigo de sucursal (T-09),
--    que es inmutable precisamente porque abre el folio.
alter table vendedor add column folio_segmento text;

-- Formato en la base y no solo en el DTO: `crear-vendedor`, las semillas y
-- cualquier carga futura no pasan por la API.
alter table vendedor
  add constraint vendedor_folio_segmento_formato
  check (folio_segmento is null or folio_segmento ~ '^[A-Z]{2}$');

-- Unico entre los vendedores **vivos**, no entre los activos.
--
-- Los vendedores son rotativos y su baja es logica (ver [[Vendedor]]). Liberar
-- el segmento al desactivar a alguien haria que su reactivacion colisionara, y
-- peor: reciclar un segmento vuelve **ambiguos los folios historicos** contra
-- las notas fisicas, que es justo la auditabilidad por la que existe el folio.
create unique index uq_vendedor_folio_segmento
  on vendedor (folio_segmento)
  where folio_segmento is not null and deleted_at is null;

-- Nullable a proposito: la columna se llena al dar de alta (script
-- `crear-vendedor`, T-62 despues) y el backfill de abajo cubre lo que ya
-- existe. Ponerla NOT NULL exigiria una regla confirmada por el cliente que
-- todavia no hay.

------------------------------------------------------------------
-- 2. Backfill de los vendedores que ya existen
------------------------------------------------------------------

-- Asigna el segmento a quien no lo tenga, resolviendo colisiones de forma
-- determinista. Tiene que sobrevivir a una base con datos (la de `sinmex dev`
-- ya tiene vendedores), asi que el orden es por `created_at`: el mas antiguo se
-- queda con sus iniciales y el que llego despues cede. Que el mas antiguo
-- conserve las suyas es lo que evita reescribir folios ya emitidos.
--
-- La misma estrategia, en TypeScript, vive en
-- `apps/backend/src/modules/sincronizacion/segmento-vendedor.ts`. Si tocas una,
-- toca la otra: aqui esta para la base que ya existe, alli para las altas
-- nuevas.
do $$
declare
  v          record;
  letras     text;      -- el nombre reducido a A-Z y espacios
  palabras   text[];
  candidatos text[];
  candidato  text;
  i          integer;
  j          integer;
begin
  for v in
    select id, nombre from vendedor
     where folio_segmento is null and deleted_at is null
     order by created_at, id
  loop
    -- Solo A-Z: se quitan acentos y todo lo que no sea letra.
    letras := upper(translate(v.nombre,
      'áàäâãéèëêíìïîóòöôõúùüûñçÁÀÄÂÃÉÈËÊÍÌÏÎÓÒÖÔÕÚÙÜÛÑÇ',
      'aaaaaeeeeiiiiooooouuuuncAAAAAEEEEIIIIOOOOOUUUUNC'));
    letras   := regexp_replace(letras, '[^A-Z ]', '', 'g');
    palabras := array_remove(string_to_array(letras, ' '), '');

    -- Los candidatos, **en orden de preferencia**. El primero libre gana.
    candidatos := array[]::text[];

    -- 1. La regla del ADR: inicial del nombre + inicial del apellido.
    --    Un nombre de una sola palabra ("Madonna") no tiene apellido del que
    --    sacar la segunda letra; se usa su segunda letra. Es el caso que las
    --    fuentes no cubren y por el que esto va marcado como provisional.
    if array_length(palabras, 1) >= 2 then
      candidatos := candidatos || (substr(palabras[1], 1, 1) || substr(palabras[2], 1, 1));
    elsif array_length(palabras, 1) = 1 and length(palabras[1]) >= 2 then
      candidatos := candidatos || substr(palabras[1], 1, 2);
    end if;

    -- 2. Si choca: se conserva la inicial del nombre (es lo que hace el folio
    --    legible) y se camina la segunda letra por el resto del apellido...
    if array_length(palabras, 1) >= 2 then
      for j in 2..length(palabras[2]) loop
        candidatos := candidatos || (substr(palabras[1], 1, 1) || substr(palabras[2], j, 1));
      end loop;
    end if;

    -- 3. ...y despues, A..Z con la misma inicial.
    if array_length(palabras, 1) >= 1 then
      for j in 1..26 loop
        candidatos := candidatos || (substr(palabras[1], 1, 1) || chr(64 + j));
      end loop;
    end if;

    -- 4. Ultimo recurso (nombre sin ninguna letra latina): AA..ZZ.
    for i in 1..26 loop
      for j in 1..26 loop
        candidatos := candidatos || (chr(64 + i) || chr(64 + j));
      end loop;
    end loop;

    -- El primero libre gana.
    foreach candidato in array candidatos loop
      continue when candidato !~ '^[A-Z]{2}$';
      if not exists (
        select 1 from vendedor
         where folio_segmento = candidato and deleted_at is null
      ) then
        update vendedor set folio_segmento = candidato where id = v.id;
        exit;
      end if;
    end loop;
  end loop;
end $$;

------------------------------------------------------------------
-- 3. El folio que emitio la tablet, y su deteccion de colision
------------------------------------------------------------------

-- El folio que la tablet emitio **offline** para esta operacion.
--
-- Es NULL para las operaciones que no son un hecho de negocio foliado: hoy la
-- `jornada` (vehiculo + kilometraje) no lleva folio, porque no es una nota que
-- nadie firme. Venta y cobranza si lo llevaran (T-16/T-20).
alter table sync_operacion add column folio text;

-- El formato, en la base. No se codifican las sucursales (`TJ|MX`) a proposito:
-- T-09 dejo el catalogo de sucursales **dinamico** y su codigo validado como
-- `^[A-Z]{2}$`. Que el folio corresponda a la sucursal y a la fecha **de esta
-- operacion** lo comprueba el servicio, que es quien conoce las dos.
alter table sync_operacion
  add constraint sync_operacion_folio_formato
  check (folio is null or folio ~ '^[A-Z]{2}[0-9]{6}[A-Z]{2}[0-9]{2}$');

-- **La deteccion de colision del criterio de aceptacion.**
--
-- Es unico **global**, no por vendedor — al reves que la clave de idempotencia.
-- Y la diferencia no es un descuido: la clave es un identificador de transporte
-- y cada tablet tiene su propio espacio de nombres, mientras que el folio es un
-- identificador de negocio que tiene que ser unico en toda la empresa (igual
-- que `venta_nota.folio`, que ya nacio `unique` en T-05).
--
-- Si dos tablets mandan el mismo folio, la segunda **no entra**: el push la
-- rechaza por operacion con `folio-duplicado` (T-07: rechazo por operacion, el
-- lote no se tumba) y la tablet se lo dice al vendedor en vez de tragarselo.
create unique index uq_sync_operacion_folio
  on sync_operacion (folio) where folio is not null;
