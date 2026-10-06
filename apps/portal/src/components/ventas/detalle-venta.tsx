"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/components/auth/auth-provider";
import { useEnvioFormulario } from "@/components/catalogo/use-envio-formulario";
import {
  ETIQUETA_ORIGEN,
  ETIQUETA_STATUS,
  eliminarVenta,
  formatearPesos,
  marcarCuentaPerdida,
  type VentaDetalle,
} from "@/lib/ventas";

const ETIQUETA_COBRO: Record<VentaDetalle["cobros"][number]["origen"], string> = {
  venta_contado: "Cobro de contado",
  cobro: "Cobranza",
};

const ETIQUETA_METODO: Record<string, string> = {
  efectivo: "Efectivo",
  transferencia: "Transferencia",
  cheque: "Cheque",
};

/**
 * El detalle de una venta y sus acciones (T-17, parte 2, §3.2). Los botones
 * salen de las banderas del servidor (`editable`, `puedeMarcarPerdida`) Y del
 * permiso `venta.editar_eliminar`: el servidor no conoce la pantalla y la
 * pantalla no decide reglas de la venta.
 */
export function DetalleVenta({
  venta,
  onVolver,
  onEditar,
  onCambiada,
  onEliminada,
}: {
  venta: VentaDetalle;
  onVolver: () => void;
  onEditar: () => void;
  onCambiada: (actualizada: VentaDetalle) => void;
  onEliminada: () => void;
}) {
  const { puede } = useAuth();
  const puedeGestionar = puede("venta.editar_eliminar");
  const { enviando, error, enviar } = useEnvioFormulario("No se pudo completar la acción.");

  async function eliminar() {
    if (!window.confirm(`¿Eliminar la venta ${venta.folio}${venta.numNota ? ` (nota ${venta.numNota})` : ""}? No se puede deshacer.`)) {
      return;
    }
    await enviar(() => eliminarVenta(venta.id), onEliminada);
  }

  async function marcarPerdida() {
    if (!window.confirm(`La venta ${venta.folio} dejará de cobrarse. ¿Continuar?`)) return;
    await enviar(
      async () => {
        onCambiada(await marcarCuentaPerdida(venta.id));
      },
      () => {},
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Venta {venta.folio}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm md:grid-cols-4">
          <Dato etiqueta="Fecha" valor={venta.fecha} />
          <Dato etiqueta="Cliente" valor={`${venta.cliente} · ${venta.sucursalCodigo}`} />
          <Dato etiqueta="Repartidor" valor={venta.repartidor ?? "Oficina"} />
          <Dato etiqueta="# de nota" valor={venta.numNota ?? "Sin nota"} />
          <Dato etiqueta="Contado o crédito" valor={venta.contadoCredito === "contado" ? "Contado" : "Crédito"} />
          <Dato etiqueta="Factura" valor={venta.factura} />
          <Dato etiqueta="Status" valor={ETIQUETA_STATUS[venta.status]} />
          <Dato etiqueta="Origen" valor={ETIQUETA_ORIGEN[venta.origen]} />
          <Dato etiqueta="Monto" valor={formatearPesos(venta.montoCentavos)} />
          <Dato etiqueta="Saldo pendiente" valor={formatearPesos(venta.saldoCentavos)} />
          {venta.comentarios && <Dato etiqueta="Comentarios" valor={venta.comentarios} />}
        </dl>

        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-muted-foreground">
              <th className="py-1 font-medium">Producto</th>
              <th className="py-1 font-medium">Cantidad</th>
              <th className="py-1 font-medium">Promoción</th>
              <th className="py-1 font-medium">Precio</th>
              <th className="py-1 text-right font-medium">Subtotal</th>
            </tr>
          </thead>
          <tbody>
            {venta.lineas.map((l) => (
              <tr key={l.presentacionId} className="border-t">
                <td className="py-1.5">{`${l.producto} ${l.volumen}`}</td>
                <td className="py-1.5">{l.cantidad}</td>
                <td className="py-1.5">{l.cantidadPromocion}</td>
                <td className="py-1.5">{formatearPesos(l.precioCentavos)}</td>
                <td className="py-1.5 text-right">{formatearPesos(l.subtotalCentavos)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">Cobros</h3>
          {venta.cobros.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin cobros.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th className="py-1 font-medium">Fecha</th>
                  <th className="py-1 font-medium">Método</th>
                  <th className="py-1 font-medium">Origen</th>
                  <th className="py-1 text-right font-medium">Monto</th>
                </tr>
              </thead>
              <tbody>
                {venta.cobros.map((c) => (
                  <tr key={c.id} className="border-t">
                    <td className="py-1.5">{c.fechaPago}</td>
                    <td className="py-1.5">{ETIQUETA_METODO[c.metodoPago] ?? c.metodoPago}</td>
                    <td className="py-1.5">{ETIQUETA_COBRO[c.origen]}</td>
                    <td className="py-1.5 text-right">{formatearPesos(c.montoCentavos)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        {venta.motivoNoEditable && (
          <p className="text-sm text-muted-foreground">{venta.motivoNoEditable}</p>
        )}

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          {puedeGestionar && venta.editable && (
            <>
              <Button onClick={onEditar} disabled={enviando}>
                Editar
              </Button>
              <Button variant="destructive" onClick={eliminar} disabled={enviando}>
                Eliminar
              </Button>
            </>
          )}
          {puedeGestionar && venta.puedeMarcarPerdida && (
            <Button variant="outline" onClick={marcarPerdida} disabled={enviando}>
              Marcar como cuenta perdida
            </Button>
          )}
          <Button variant="ghost" onClick={onVolver} disabled={enviando}>
            Volver
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function Dato({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <div>
      <dt className="text-muted-foreground">{etiqueta}</dt>
      <dd>{valor}</dd>
    </div>
  );
}
