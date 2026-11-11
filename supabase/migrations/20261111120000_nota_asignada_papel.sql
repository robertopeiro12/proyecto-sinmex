-- Ruta Diaria parte 2: revision de notas en la tarde. Administracion marca si el
-- vendedor regreso el papel de cada nota ASIGNADA que no cobro (la casilla de las
-- ventas a credito del dia sigue en venta_nota.papel_entregado, 2026-11-09).
-- Spec: docs/superpowers/specs/2026-11-11-ruta-diaria-parte-2-revision-notas-design.md
--
-- papel_entregado: null = sin revisar; true = la entrego; false = no la entrego.
-- La marca es de la asignacion (una nota asignada en dos dias distintos se revisa
-- en cada uno), por eso vive en nota_asignada y no en venta_nota.
--
-- updated_at: aqui NO se protege como en venta_nota. El trigger generico
-- set_updated_at() de nota_asignada lo mueve tambien cuando solo cambian las
-- columnas papel_*. Es inofensivo y se acepta a proposito: la tablet no usa el
-- papel, y si una asignacion vuelve a bajar en el pull, la mezcla local la pisa
-- con los mismos datos.
--
-- Pre-flight contra la nube: solo columnas nulas nuevas y un check que se cumple
-- con todas en null; nada que contar.

alter table nota_asignada
  add column papel_entregado boolean null,
  add column papel_revisado_en timestamptz null,
  add column papel_revisado_por_usuario_id uuid null references usuario(id);

alter table nota_asignada
  add constraint ck_nota_asignada_papel_revisado
  check ((papel_entregado is null) = (papel_revisado_en is null));
