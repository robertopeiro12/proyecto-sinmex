-- T-73: firma del cliente en la nota de venta.
-- Spec: docs/superpowers/specs/2026-10-21-t-73-firma-del-cliente-design.md
--
-- La tablet captura la firma ANTES de grabar (D3) y la sube como JPG por el
-- canal de fotos (`POST /sync/foto/:clave`), aparte del lote del push. Por eso
-- la nota guarda dos cosas distintas:
--
-- * `firma_esperada` / `firma_nombre`: lo dice la operacion `venta` (campo
--   `firma` del contrato) al proyectar. Presente = la venta espera imagen.
--   Las del portal y las de apps anteriores a T-73 quedan en false: "sin firma".
-- * `firma_archivo` / `firma_subida_en`: los anota el canal de fotos cuando la
--   imagen llega (`venta-<id>-firma.jpg` dentro de FOTOS_DIR).
--
-- Columnas nuevas, con default o nulas: las filas existentes quedan con
-- `firma_esperada = false` y sin archivo, asi que ningun check puede fallar y
-- no hay filas que contar en el pre-flight contra la nube (solo el
-- `migration list` antes y despues del protocolo de CLAUDE.md).

alter table venta_nota
  add column firma_esperada boolean not null default false,
  add column firma_nombre text
    check (firma_nombre is null or char_length(firma_nombre) between 1 and 80),
  add column firma_archivo text,
  add column firma_subida_en timestamptz,
  -- Una nota que no espera firma (portal, app vieja) nunca recibe archivo: el
  -- canal de fotos responde 409 antes de escribir.
  add constraint ck_venta_firma_archivo check (firma_archivo is null or firma_esperada);
