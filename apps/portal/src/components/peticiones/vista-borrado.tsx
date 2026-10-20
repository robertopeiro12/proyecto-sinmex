import { EtiquetaStatusVenta } from "@/components/ui/etiqueta";
import { CajaTabla, Tabla, Td, TdMonto, Th } from "@/components/ui/tabla";
import { formatearPesos } from "@/lib/formato";
import { describirPago, type VistaBorrado } from "@/lib/peticiones";

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
        <CajaTabla>
          <Tabla densidad="compacta">
            <thead>
              <tr>
                <Th>Folio</Th>
                <Th># de nota</Th>
                <Th alinear="derecha">Le abonó</Th>
                <Th alinear="derecha">Saldo hoy</Th>
                <Th alinear="derecha">Saldo tras borrar</Th>
                <Th>Queda</Th>
              </tr>
            </thead>
            <tbody>
              {vista.notas.map((n) => (
                <tr key={n.notaId}>
                  <Td className="font-mono">{n.folio}</Td>
                  <Td>{n.numNota ?? "—"}</Td>
                  <TdMonto centavos={n.delPagoCentavos} />
                  <TdMonto centavos={n.saldoAntesCentavos} />
                  <TdMonto centavos={n.saldoDespuesCentavos} className="font-semibold" />
                  <Td>
                    <EtiquetaStatusVenta status={n.statusDespues} />
                  </Td>
                </tr>
              ))}
            </tbody>
          </Tabla>
        </CajaTabla>
      )}
      {vista.movimientoSaldoFavorCentavos !== 0 && (
        <p>{`Saldo a favor: ${formatearPesos(vista.saldoFavorAntesCentavos)} → ${formatearPesos(vista.saldoFavorDespuesCentavos)}`}</p>
      )}
      {/* Texto rojo sin role: el que avisa en voz alta es el panel que lo contiene. */}
      {vista.bloqueo && <p className="font-medium text-destructive">{vista.bloqueo.motivo}</p>}
    </div>
  );
}
