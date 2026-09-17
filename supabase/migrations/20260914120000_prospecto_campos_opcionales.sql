-- T-40: un prospecto que nace en la app no trae domicilio ni lista de precios.
--
-- El cliente dicto (respuesta de agosto 2026, ver `Cliente.md`) que el alta de
-- prospecto desde la tablet captura: nombre del negocio, encargado, telefono,
-- ubicacion (coordenadas), tipo de negocio, comentario y foto. **Ni domicilio
-- ni lista de precios.** Y no es un olvido del formulario:
--
--   * el **domicilio** lo sustituye la ubicacion — el vendedor esta parado
--     enfrente del negocio y lo que sirve para volver es la coordenada, no una
--     direccion escrita a mano en una tablet al sol;
--   * la **lista de precios** es del administrador a proposito. El vendedor no
--     puede dar de alta clientes justamente porque el control del precio no es
--     suyo (`Cartera de Clientes`, cambio v2.0). Un prospecto no se le vende:
--     se le obsequian piezas.
--
-- Las dos columnas eran `not null` desde T-05 (`20260803163300_clientes.sql`),
-- que solo conocia el alta del portal. Se relajan a nivel de columna y la
-- obligatoriedad se conserva **solo para `tipo = 'cliente'`** con un check: asi
-- el portal no puede dar de alta un cliente a medias ni por la API, y la tablet
-- puede dar de alta un prospecto sin inventarse datos.
--
-- > [!info] La conversion Prospecto -> Cliente es donde se completan
-- > `POST /clientes/:id/convertir-a-cliente` (T-12, PR #83) pasa `tipo` a
-- > 'cliente', y a partir de esta migracion el check lo frena si el prospecto
-- > todavia no tiene domicilio y lista. Eso es exactamente lo que el cliente
-- > confirmo el 2026-09-02: "el administrador solo agrega lo que falta (precio,
-- > plazo de credito)". `ClientesService.convertirACliente` lo traduce a un 409
-- > con el motivo, no a un 500.
--
-- Lo que esta migracion **no** hace: la foto. Sigue sin columna porque sigue
-- sin decidirse donde se guarda el archivo (candidato: Supabase Storage, que es
-- parte del alcance de Supabase que ADR-0002 dejo abierto). Ver la nota
-- `T-40 Registro de Prospectos` del vault: es un ticket aparte.

alter table cliente alter column domicilio drop not null;
alter table cliente alter column lista_precio_id drop not null;

-- Los checks se nombran a mano: el codigo (y las pruebas de pgTAP) los citan, y
-- un nombre generado por Postgres cambiaria si algun dia se recrea la tabla.
alter table cliente add constraint ck_cliente_domicilio_obligatorio
  check (tipo <> 'cliente' or domicilio is not null);

alter table cliente add constraint ck_cliente_lista_precio_obligatoria
  check (tipo <> 'cliente' or lista_precio_id is not null);

-- `tipo <> 'cliente'` y no `tipo = 'prospecto'`: si algun dia aparece un tercer
-- tipo, el check no lo obliga a llevar domicilio sin que nadie lo haya decidido.
-- El check de `tipo` de T-05 sigue siendo el que limita los valores posibles.
