-- T-40 (foto del prospecto): donde queda anotada la foto que subio la tablet.
--
-- `20260914120000_prospecto_campos_opcionales.sql` dejo escrito que la foto
-- seguia sin columna porque no se habia decidido donde vive el archivo. Ya se
-- decidio (Mario, 2026-09-18, en `Despliegue y topologia` del vault): **el disco
-- del backend**, ni `bytea` ni Supabase Storage. Eso cierra el alcance de
-- Supabase en solo Postgres, y es lo que hace que aqui basten dos columnas.
--
-- **Sin tabla nueva y sin `bytea`.** Con el archivo fuera de la base no hay
-- bytes que aislar en su propia tabla: lo unico que guarda Postgres es el
-- nombre del archivo y cuando llego. Una tabla `cliente_foto` seria un join de
-- mas para leer dos campos que son 1:1 con el cliente.
--
--   * `foto_archivo` es el NOMBRE del archivo dentro de `FOTOS_DIR`
--     (`<clave>.jpg`), no una ruta absoluta: la ruta es configuracion del
--     despliegue y cambia con el hosting, que sigue en hold. Guardarla completa
--     obligaria a un UPDATE masivo el dia que se mueva el volumen.
--   * `foto_subida_en` es cuando el SERVIDOR la recibio, no cuando el vendedor
--     la tomo. La foto viaja en la sincronizacion, que puede ser horas despues;
--     el momento de la captura no se necesita para nada hoy y mezclar los dos
--     relojes (el de la tablet y el del servidor) en una sola columna es como
--     se producen los desfases que ya documenta `fecha_operacion`.
--
-- Las dos son **nulables y se quedan asi**: un prospecto sin foto es un
-- prospecto completo (el cliente pidio la foto condicionada a que no hiciera
-- lento el alta), y la foto puede llegar tarde o no llegar nunca.
--
-- > [!info] El canal de la foto no es el lote del push
-- > No hay codigo de rechazo nuevo en `CODIGOS_RECHAZO` ni version nueva del
-- > contrato: `POST /sync/foto/:clave` responde con codigos HTTP. Es lo que
-- > impide que una foto pesada o a medias se lleve por delante el alta del
-- > prospecto, que es el fallo que este diseno existe para prevenir.

alter table cliente add column foto_archivo text;
alter table cliente add column foto_subida_en timestamptz;

-- Las dos columnas **se escriben juntas o ninguna**: el servicio anota el nombre
-- y la fecha en el mismo UPDATE, despues de que el archivo ya esta en disco. El
-- check lo hace cumplir en vez de confiar en que ningun camino futuro las separe.
--
-- Sin el, un estado a medias es representable y los dos lados son danos reales:
-- nombre sin fecha significa que el portal intenta servir un archivo sin saber
-- si llego completo; fecha sin nombre significa que la ficha dice "tiene foto" y
-- no hay archivo que mostrar.
--
-- > [!info] Pre-flight para quien empuje esto a `sinmex dev`
-- > El `CLAUDE.md` pide una consulta de solo lectura por cada `check` nuevo, que
-- > debe dar 0. Aqui da 0 **por construccion** —las dos columnas nacen en esta
-- > misma migracion, asi que todas las filas existentes las tienen en null y
-- > `null = null` es cierto para el check— pero la consulta queda escrita para
-- > que nadie tenga que deducirlo:
-- >
-- >   select count(*) from cliente
-- >    where (foto_archivo is null) <> (foto_subida_en is null);
alter table cliente add constraint ck_cliente_foto_completa
  check ((foto_archivo is null) = (foto_subida_en is null));
