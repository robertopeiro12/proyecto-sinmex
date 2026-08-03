-- gen_random_uuid() es parte del core de Postgres 13+, no requiere extensión.

-- Función reutilizable para mantener updated_at en cada UPDATE.
create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
