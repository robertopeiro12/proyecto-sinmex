-- Las 2 letras del codigo son el primer segmento del folio de cada operacion
-- (ADR-0001, p. ej. TJ260322AP05). Un codigo con otro formato dejaria folios
-- historicos apuntando a algo que no existe, y esos folios ya no se pueden
-- corregir. La restriccion vive en la base porque las semillas, el script
-- crear-usuario y cualquier carga futura no pasan por el DTO del backend.
alter table sucursal
  add constraint sucursal_codigo_formato check (codigo ~ '^[A-Z]{2}$');
