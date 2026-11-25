-- Rediseño de la app del vendedor, pieza 3: la carga se acepta por renglón.
-- Plan: docs/superpowers/plans/2026-11-25-rediseno-pieza-3-inventario-por-renglon.md
-- Spec: docs/superpowers/specs/2026-11-18-rediseno-app-vendedor-design.md §7 y §16-bis
--
-- * `carga_detalle.aceptada`: si el vendedor aceptó ese renglón. `null` mientras
--   la carga está pendiente y en las cargas respondidas antes de esta pieza (una
--   aceptada vieja se lee como "todo aceptado", una rechazada vieja como "nada").
--   Editar una carga borra y reinserta sus renglones, así que vuelven a `null`.
--   Columna nullable sin default: no reescribe la tabla ni toca filas existentes.
-- * `carga.estado` conserva sus tres valores: respondida con al menos un renglón
--   aceptado queda `aceptada`; con ninguno, `rechazada`.
-- * `ck_carga_motivo`: el motivo deja de ser obligatorio al rechazar (la lista
--   vacía rechaza sin escribir), pero solo una rechazada puede llevarlo. Las
--   filas viejas (rechazada con motivo, pendiente/aceptada sin motivo) ya cumplen
--   el check nuevo, que es más débil que el anterior: no hay nada que contar en
--   el pre-flight.

alter table carga_detalle add column aceptada boolean;

alter table carga drop constraint ck_carga_motivo;
alter table carga add constraint ck_carga_motivo
  check (motivo_rechazo is null or estado = 'rechazada');
