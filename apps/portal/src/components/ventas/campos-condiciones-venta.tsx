"use client";

import { AreaTexto, Campo, Entrada, Lista } from "@/components/ui/campo";
import type {
  CondicionesVenta,
  ContadoCredito,
  FacturaVenta,
  MetodoPagoContado,
} from "@/lib/ventas";

/** # de nota, contado/crédito, método de pago, factura y comentarios: iguales al registrar y al editar. */
export function CamposCondicionesVenta({
  valores,
  onCambio,
  disabled,
}: {
  valores: CondicionesVenta;
  onCambio: (cambio: Partial<CondicionesVenta>) => void;
  disabled: boolean;
}) {
  return (
    <>
      <div className="flex flex-wrap gap-4">
        <Campo id="num-nota" etiqueta="Número de nota" opcional>
          <Entrada
            maxLength={30}
            placeholder="Solo si hubo nota de papel"
            disabled={disabled}
            value={valores.numNota}
            onChange={(e) => onCambio({ numNota: e.target.value })}
            className="w-40"
          />
        </Campo>

        <Campo id="contado-credito" etiqueta="Contado o crédito">
          <Lista
            disabled={disabled}
            value={valores.contadoCredito}
            onChange={(e) => onCambio({ contadoCredito: e.target.value as ContadoCredito })}
          >
            <option value="contado">Contado</option>
            <option value="credito">Crédito</option>
          </Lista>
        </Campo>

        {valores.contadoCredito === "contado" && (
          <Campo id="metodo-pago" etiqueta="Método de pago">
            <Lista
              disabled={disabled}
              value={valores.metodoPago}
              onChange={(e) => onCambio({ metodoPago: e.target.value as MetodoPagoContado })}
            >
              <option value="transferencia">Transferencia</option>
              <option value="efectivo">Efectivo</option>
            </Lista>
          </Campo>
        )}

        <Campo id="factura" etiqueta="Factura">
          <Lista
            disabled={disabled}
            value={valores.factura}
            onChange={(e) => onCambio({ factura: e.target.value as FacturaVenta })}
          >
            <option value="N/A">N/A</option>
            <option value="pendiente">Pendiente</option>
          </Lista>
        </Campo>
      </div>

      <Campo id="comentarios" etiqueta="Comentarios">
        <AreaTexto
          maxLength={500}
          disabled={disabled}
          value={valores.comentarios}
          onChange={(e) => onCambio({ comentarios: e.target.value })}
        />
      </Campo>
    </>
  );
}
