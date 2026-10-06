-- El # de la nota fisica pasa a ser OPCIONAL y deja de ser unico.
--
-- Respuesta del cliente (2026-10-06), textual:
--
--   "los bloq de notas que usan los vendedores, es para cuando no sirve el
--   sistema. pero regularmente esos bloq de notas vienen foleados ej: 1000-2000,
--   pero eso no importa [...] cuando ellos venden el papel fisico de todas
--   maneras meten la nota al sistema y lo que nos interesa es el folio que
--   genera el sistema"
--
-- Es decir: en una venta normal NO hay nota de papel, asi que no hay numero que
-- capturar. T-16 lo habia hecho obligatorio (D7) y T-17 unico por sucursal
-- (#95); las dos cosas obligaban al vendedor a inventarse un numero, y uno
-- repetido le rechazaba la venta al sincronizar sin forma de corregirla (T-71).
-- La identidad de la venta es el FOLIO, que sigue siendo unico.
--
-- Se conserva la columna como dato de referencia: cuando si hubo papel, sirve
-- para buscar la venta por el numero que trae la nota.

drop index if exists uq_venta_nota_num_nota_sucursal;

alter table venta_nota alter column num_nota drop not null;

-- Mismo nombre, regla nueva: nulo, o con algo escrito. Una cadena vacia no
-- es "sin nota", es basura; el servicio la normaliza a null antes de llegar.
alter table venta_nota drop constraint ck_venta_nota_num_nota_no_vacio;
alter table venta_nota add constraint ck_venta_nota_num_nota_no_vacio
  check (num_nota is null or char_length(btrim(num_nota)) > 0);
