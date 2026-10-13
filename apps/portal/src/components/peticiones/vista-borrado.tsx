import { describirPago, type VistaBorrado } from "@/lib/peticiones";
import { ETIQUETA_STATUS, formatearPesos } from "@/lib/ventas";

/**
 * Qué pasaría si se borra el pago (§3.1): lo calculó el servidor con las notas
 * bloqueadas. La usan quien pide y quien autoriza. El bloqueo (saldo a favor ya
 * aplicado) se lee aquí; el servidor lo rechazaría igual al autorizar.
 */
export function VistaBorradoPago({ vista }: { vista: VistaBorrado }) {
  return (
    <div className="flex flex-col gap-2 text-sm">
      <p className="font-medium">{describirPago(vista.cobro)}</p>
      {vista.notas.length > 0 && (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-muted-foreground">
              <th className="py-1 font-medium">Folio</th>
              <th className="py-1 font-medium"># de nota</th>
              <th className="py-1 text-right font-medium">Le abonó</th>
              <th className="py-1 text-right font-medium">Saldo hoy</th>
              <th className="py-1 text-right font-medium">Saldo tras borrar</th>
              <th className="py-1 font-medium">Queda</th>
            </tr>
          </thead>
          <tbody>
            {vista.notas.map((n) => (
              <tr key={n.notaId} className="border-t">
                <td className="py-1.5 font-mono">{n.folio}</td>
                <td className="py-1.5">{n.numNota ?? "—"}</td>
                <td className="py-1.5 text-right">{formatearPesos(n.delPagoCentavos)}</td>
                <td className="py-1.5 text-right">{formatearPesos(n.saldoAntesCentavos)}</td>
                <td className="py-1.5 text-right font-semibold">{formatearPesos(n.saldoDespuesCentavos)}</td>
                <td className="py-1.5">{ETIQUETA_STATUS[n.statusDespues]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {vista.movimientoSaldoFavorCentavos !== 0 && (
        <p>{`Saldo a favor: ${formatearPesos(vista.saldoFavorAntesCentavos)} → ${formatearPesos(vista.saldoFavorDespuesCentavos)}`}</p>
      )}
      {vista.bloqueo && <p className="font-medium text-destructive">{vista.bloqueo.motivo}</p>}
    </div>
  );
}
