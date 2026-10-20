"use client";

import { useState, type ReactNode } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { useEnvioFormulario } from "@/components/catalogo/use-envio-formulario";
import { PedirBorradoCobro } from "@/components/peticiones/pedir-borrado-cobro";
import { Aviso } from "@/components/ui/aviso";
import { Button } from "@/components/ui/button";
import { useConfirmar } from "@/components/ui/confirmar";
import { EncabezadoPantalla, Pantalla } from "@/components/ui/encabezado-pantalla";
import { EtiquetaStatusVenta } from "@/components/ui/etiqueta";
import { Fecha } from "@/components/ui/fecha";
import { Monto } from "@/components/ui/monto";
import { CajaTabla, Tabla, Td, TdMonto, Th } from "@/components/ui/tabla";
import { ETIQUETA_METODO_PAGO } from "@/lib/cobranzas";
import { formatearFecha, formatearPesos } from "@/lib/formato";
import { ETIQUETA_BORRADO_PEDIDO } from "@/lib/peticiones";
import {
  ETIQUETA_ORIGEN,
  eliminarVenta,
  marcarCuentaPerdida,
  obtenerVenta,
  type VentaDetalle,
} from "@/lib/ventas";
import { FirmaVenta } from "./firma-venta";

const ETIQUETA_COBRO: Record<VentaDetalle["cobros"][number]["origen"], string> = {
  venta_contado: "Cobro de contado",
  cobro: "Cobranza",
  saldo_favor: "Saldo a favor",
};

/** Lo que salió de pedir un borrado: bien (verde) o la pantalla quedó vieja (ámbar). */
type AvisoDetalle = { texto: string; tono: "exito" | "advertencia" };

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
  const { confirmar, ventana } = useConfirmar();
  const puedePedirBorrado = puede("cobranza.editar_eliminar");
  // El pago cuyo borrado se está pidiendo (T-34); uno a la vez.
  const [pidiendo, setPidiendo] = useState<string | null>(null);
  const [aviso, setAviso] = useState<AvisoDetalle | null>(null);

  function pedirBorrado(cobroId: string | null) {
    if (cobroId === null) return;
    setAviso(null);
    setPidiendo(cobroId);
  }

  /** Tras pedir (o tras un 409): la venta fresca, para que el cobro diga "Borrado pedido · pendiente". */
  async function refrescar(texto: string, tono: AvisoDetalle["tono"]) {
    setPidiendo(null);
    setAviso({ texto, tono });
    try {
      onCambiada(await obtenerVenta(venta.id));
    } catch {
      setAviso({ texto: `${texto} Vuelve a abrir la venta para ver el cambio.`, tono: "advertencia" });
    }
  }

  async function eliminar() {
    const si = await confirmar({
      titulo: `¿Eliminar la venta ${venta.folio}${venta.numNota ? ` (nota ${venta.numNota})` : ""}?`,
      descripcion:
        "La venta deja de contar en reportes y en cobranza, y su folio no se vuelve a usar. No se puede deshacer.",
      confirmar: "Eliminar venta",
    });
    if (!si) return;
    await enviar(() => eliminarVenta(venta.id), onEliminada);
  }

  async function marcarPerdida() {
    const si = await confirmar({
      titulo: `¿Marcar la venta ${venta.folio} como cuenta perdida?`,
      descripcion: "La venta dejará de cobrarse.",
      confirmar: "Marcar como perdida",
    });
    if (!si) return;
    await enviar(
      async () => {
        onCambiada(await marcarCuentaPerdida(venta.id));
      },
      () => {},
    );
  }

  return (
    <Pantalla>
      <EncabezadoPantalla
        titulo={`Venta ${venta.folio}`}
        descripcion="Lo que se vendió y lo que se ha cobrado. Desde aquí se edita, se elimina o se marca como cuenta perdida."
        acciones={
          <Button variant="outline" onClick={onVolver} disabled={enviando}>
            Volver
          </Button>
        }
      />

      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 rounded-[10px] border p-4 text-sm md:grid-cols-4">
        <Dato etiqueta="Fecha" valor={<Fecha valor={venta.fecha} />} />
        <Dato etiqueta="Cliente" valor={`${venta.cliente} · ${venta.sucursalCodigo}`} />
        <Dato etiqueta="Repartidor" valor={venta.repartidor ?? "Oficina"} />
        <Dato etiqueta="# de nota" valor={venta.numNota ?? "Sin nota"} />
        <Dato etiqueta="Contado o crédito" valor={venta.contadoCredito === "contado" ? "Contado" : "Crédito"} />
        <Dato
          etiqueta="Factura"
          valor={venta.facturaNumero ? `Facturada · ${venta.facturaNumero}` : venta.factura}
        />
        <Dato etiqueta="Status" valor={<EtiquetaStatusVenta status={venta.status} />} />
        <Dato etiqueta="Origen" valor={ETIQUETA_ORIGEN[venta.origen]} />
        <Dato etiqueta="Monto" valor={<Monto centavos={venta.montoCentavos} />} />
        <Dato etiqueta="Saldo pendiente" valor={<Monto centavos={venta.saldoCentavos} />} />
        {venta.comentarios && <Dato etiqueta="Comentarios" valor={venta.comentarios} />}
      </dl>

      <CajaTabla>
        <Tabla>
          <thead>
            <tr>
              <Th>Producto</Th>
              <Th alinear="derecha">Cantidad</Th>
              <Th alinear="derecha">Promoción</Th>
              <Th alinear="derecha">Precio</Th>
              <Th alinear="derecha">Subtotal</Th>
            </tr>
          </thead>
          <tbody>
            {venta.lineas.map((l) => (
              <tr key={l.presentacionId}>
                <Td>{`${l.producto} ${l.volumen}`}</Td>
                <Td alinear="derecha">{l.cantidad}</Td>
                <Td alinear="derecha">{l.cantidadPromocion}</Td>
                <TdMonto centavos={l.precioCentavos} />
                <TdMonto centavos={l.subtotalCentavos} />
              </tr>
            ))}
          </tbody>
        </Tabla>
      </CajaTabla>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold">Cobros</h2>
        {venta.cobros.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sin cobros.</p>
        ) : (
          <CajaTabla>
            <Tabla>
              <thead>
                <tr>
                  <Th>Fecha</Th>
                  <Th>Método</Th>
                  <Th>Origen</Th>
                  <Th alinear="derecha">Monto</Th>
                  <Th>
                    <span className="sr-only">Acciones</span>
                  </Th>
                </tr>
              </thead>
              <tbody>
                {venta.cobros.map((c) => (
                  <tr key={c.id}>
                    <Td>
                      <Fecha valor={c.fechaPago} />
                    </Td>
                    <Td>{ETIQUETA_METODO_PAGO[c.metodoPago] ?? c.metodoPago}</Td>
                    <Td>{ETIQUETA_COBRO[c.origen]}</Td>
                    <TdMonto centavos={c.montoCentavos} />
                    <Td alinear="derecha">
                      {c.cobroId !== null && c.peticionPendiente && (
                        <span className="text-muted-foreground">{ETIQUETA_BORRADO_PEDIDO}</span>
                      )}
                      {c.cobroId !== null && !c.peticionPendiente && puedePedirBorrado && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          aria-label={`Pedir borrado del cobro del ${formatearFecha(c.fechaPago)} por ${formatearPesos(c.montoCentavos)}`}
                          disabled={pidiendo !== null}
                          onClick={() => pedirBorrado(c.cobroId)}
                        >
                          Pedir borrado
                        </Button>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Tabla>
          </CajaTabla>
        )}
      </section>

      <FirmaVenta ventaId={venta.id} firma={venta.firma} editada={venta.editada} />

      {pidiendo && (
        <PedirBorradoCobro
          key={pidiendo}
          cobroId={pidiendo}
          onEnviada={(mensaje) => void refrescar(mensaje, "exito")}
          onDesactualizado={(mensaje) => void refrescar(mensaje, "advertencia")}
          onCancelar={() => setPidiendo(null)}
        />
      )}

      {aviso && <Aviso tono={aviso.tono}>{aviso.texto}</Aviso>}

      {venta.motivoNoEditable && <p className="text-sm text-muted-foreground">{venta.motivoNoEditable}</p>}

      {error && <Aviso tono="error">{error}</Aviso>}

      <div className="flex flex-wrap gap-2">
        {puedeGestionar && venta.editable && (
          <>
            <Button onClick={onEditar} disabled={enviando}>
              Editar
            </Button>
            <Button variant="destructive" onClick={() => void eliminar()} disabled={enviando}>
              Eliminar
            </Button>
          </>
        )}
        {puedeGestionar && venta.puedeMarcarPerdida && (
          <Button variant="outline" onClick={() => void marcarPerdida()} disabled={enviando}>
            Marcar como cuenta perdida
          </Button>
        )}
      </div>

      {ventana}
    </Pantalla>
  );
}

function Dato({ etiqueta, valor }: { etiqueta: string; valor: ReactNode }) {
  return (
    <div>
      <dt className="text-muted-foreground">{etiqueta}</dt>
      <dd className="mt-0.5">{valor}</dd>
    </div>
  );
}
