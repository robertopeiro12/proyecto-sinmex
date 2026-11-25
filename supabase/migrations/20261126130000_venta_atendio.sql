-- Rediseño app del vendedor, pieza 2 (Vender y Cobranza): quien atendio al
-- vendedor en el negocio del cliente. Plan:
-- docs/superpowers/plans/2026-11-25-rediseno-pieza-2-vender-cobranza.md (Task 1).
--
-- Lo manda la tablet en la operacion `venta` (campo `atendio` del contrato,
-- aditivo). Es distinto de `firma_nombre` (T-73): la pieza 2 quita la firma de
-- la pantalla y pide el nombre de quien atiende. Recortado, de 1 a 80; `null` =
-- no lo dijo (tablet anterior, venta del portal).
--
-- El abono al vender (`abono_centavos`) no necesita columna: se escribe como el
-- cobro automatico del contado (`cobranza_abono` de origen `venta_contado`).
--
-- Columna nula: las filas existentes cumplen el check en null, asi que no hay
-- nada que contar en el pre-flight contra la nube.

alter table venta_nota
  add column atendio_nombre text,
  add constraint ck_venta_nota_atendio_nombre
    check (atendio_nombre is null or char_length(btrim(atendio_nombre)) between 1 and 80);
