"use client";

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
        <div className="flex flex-col gap-1.5">
          <label htmlFor="num-nota" className="text-sm font-medium">
            Número de nota (opcional)
          </label>
          <input
            id="num-nota"
            maxLength={30}
            placeholder="Solo si hubo nota de papel"
            disabled={disabled}
            value={valores.numNota}
            onChange={(e) => onCambio({ numNota: e.target.value })}
            className="w-40 rounded-md border px-3 py-2 text-sm"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="contado-credito" className="text-sm font-medium">
            Contado o crédito
          </label>
          <select
            id="contado-credito"
            disabled={disabled}
            value={valores.contadoCredito}
            onChange={(e) => onCambio({ contadoCredito: e.target.value as ContadoCredito })}
            className="rounded-md border px-3 py-2 text-sm"
          >
            <option value="contado">Contado</option>
            <option value="credito">Crédito</option>
          </select>
        </div>

        {valores.contadoCredito === "contado" && (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="metodo-pago" className="text-sm font-medium">
              Método de pago
            </label>
            <select
              id="metodo-pago"
              disabled={disabled}
              value={valores.metodoPago}
              onChange={(e) => onCambio({ metodoPago: e.target.value as MetodoPagoContado })}
              className="rounded-md border px-3 py-2 text-sm"
            >
              <option value="transferencia">Transferencia</option>
              <option value="efectivo">Efectivo</option>
            </select>
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <label htmlFor="factura" className="text-sm font-medium">
            Factura
          </label>
          <select
            id="factura"
            disabled={disabled}
            value={valores.factura}
            onChange={(e) => onCambio({ factura: e.target.value as FacturaVenta })}
            className="rounded-md border px-3 py-2 text-sm"
          >
            <option value="N/A">N/A</option>
            <option value="pendiente">Pendiente</option>
          </select>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="comentarios" className="text-sm font-medium">
          Comentarios
        </label>
        <textarea
          id="comentarios"
          maxLength={500}
          disabled={disabled}
          value={valores.comentarios}
          onChange={(e) => onCambio({ comentarios: e.target.value })}
          className="rounded-md border px-3 py-2 text-sm"
        />
      </div>
    </>
  );
}
