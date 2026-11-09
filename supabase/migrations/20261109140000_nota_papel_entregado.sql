-- Dashboard: casilla "Entregada" de las notas de venta a credito (como el sistema
-- viejo). Registra si el vendedor regreso la nota de papel a la oficina.
-- Spec: docs/superpowers/specs/2026-11-09-dashboard-flujo-diario-design.md
--
-- papel_entregado: null = sin revisar; true = la entrego; false = no la entrego.
-- Pre-flight contra la nube: solo columnas nulas nuevas, un check que se cumple
-- con todas en null, un insert de permiso y el trigger; nada que contar.

alter table venta_nota
  add column papel_entregado boolean null,
  add column papel_revisado_en timestamptz null,
  add column papel_revisado_por_usuario_id uuid null references usuario(id);

alter table venta_nota
  add constraint ck_venta_nota_papel_revisado
  check ((papel_entregado is null) = (papel_revisado_en is null));

-- Revisar el papel es cosa de la oficina: NO debe mover updated_at, porque la
-- tablet baja la nota otra vez cuando cambia (pull incremental). Si el update
-- solo cambia las columnas papel_*, se conserva updated_at; cualquier otro
-- update (aun uno que no cambia nada, como reescribir el status en T-34) la mueve.
create or replace function set_updated_at_venta_nota()
returns trigger
language plpgsql
as $$
declare
  papel constant text[] := array[
    'papel_entregado', 'papel_revisado_en', 'papel_revisado_por_usuario_id',
    'updated_at'
  ];
begin
  if (to_jsonb(new) - papel) = (to_jsonb(old) - papel)
     and (new.papel_entregado is distinct from old.papel_entregado
          or new.papel_revisado_en is distinct from old.papel_revisado_en
          or new.papel_revisado_por_usuario_id
             is distinct from old.papel_revisado_por_usuario_id) then
    new.updated_at = old.updated_at;
  else
    new.updated_at = now();
  end if;
  return new;
end;
$$;

drop trigger trg_venta_nota_updated on venta_nota;
create trigger trg_venta_nota_updated before update on venta_nota
  for each row execute function set_updated_at_venta_nota();

insert into permiso (clave, grupo, descripcion) values
  ('nota_papel.revisar', 'General', 'Marcar si el vendedor entregó la nota de papel')
on conflict (clave) do nothing;
