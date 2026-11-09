"use client";

import { Fragment, useEffect, useRef } from "react";
import { Etiqueta } from "@/components/ui/etiqueta";
import { CajaTabla, Fila, FilaGrupo, FilaTotal, Tabla, Td, TdMonto, Th } from "@/components/ui/tabla";
import { DetalleVendedor, type PestanaDetalleVendedor } from "@/components/flujo-diario/detalle-vendedor";
import { FilaDetalle } from "@/components/flujo-diario/fila-detalle";
import { Barra, BotonNumero, BotonRenglon, BotonVer, formatearPiezas, Pronto } from "@/components/flujo-diario/piezas";
import { useDetalleAbierto } from "@/components/flujo-diario/use-detalle-abierto";
import {
  agruparPorSucursal,
  etiquetaRutaAsignada,
  obtenerDetalleDashboard,
  type Dashboard,
  type DetalleVendedorDia,
  type ResumenVendedorDia,
  type Totales,
} from "@/lib/flujo-diario";
import { formatearPesos, plural } from "@/lib/formato";

const COLUMNAS = 13;

/**
 * La tabla del Dashboard (spec §5.2): un renglón por vendedor de hoy; con varias sucursales,
 * un bloque por sucursal con su subtotal y un total. El detalle se abre bajo el renglón.
 * `actualizacion` cambia con cada consulta automática: el detalle abierto se vuelve a pedir
 * sin cerrarse ni cambiar de pestaña.
 */
export function TablaDashboard({
  dashboard,
  actualizacion,
  nombreSucursal,
}: {
  dashboard: Dashboard;
  actualizacion: number;
  nombreSucursal: (codigo: string) => string;
}) {
  const { abierto, estado, alternar, abrirEn, cambiarPestana, recargar, cerrar } = useDetalleAbierto<
    DetalleVendedorDia,
    PestanaDetalleVendedor
  >((clave) => {
    const fila = dashboard.vendedores.find((f) => f.vendedorId === clave);
    if (!fila) return Promise.reject(new Error("Este vendedor ya no está en el Dashboard."));
    // La sucursal del renglón: así funciona también con "Todas".
    // La fecha del Dashboard pintado: a la medianoche el detalle no salta al día siguiente.
    return obtenerDetalleDashboard({ vendedor: fila.vendedorId, sucursal: fila.sucursalCodigo, fecha: dashboard.fecha });
  }, "venta");

  // Tras cada actualización: el detalle abierto se vuelve a pedir; si su vendedor ya no salió, se cierra.
  const vista = useRef(actualizacion);
  useEffect(() => {
    if (vista.current === actualizacion) return;
    vista.current = actualizacion;
    if (!abierto) return;
    if (dashboard.vendedores.some((f) => f.vendedorId === abierto.clave)) recargar();
    else cerrar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actualizacion]);

  const varias = dashboard.bloques.length > 1;

  function renglon(f: ResumenVendedorDia) {
    const clave = f.vendedorId;
    const estaAbierto = abierto?.clave === clave;
    const abrir = (p: PestanaDetalleVendedor) => abrirEn(clave, p);
    const terminado = f.estatus === "terminado";
    return (
      <Fragment key={clave}>
        <Fila interactiva onClick={() => alternar(clave)} className={estaAbierto ? "bg-menu" : undefined}>
          <Td>
            <BotonRenglon abierto={estaAbierto} onClick={() => alternar(clave)}>
              {f.vendedor}
            </BotonRenglon>
          </Td>
          <Td className={f.clientesEnRuta === 0 ? "text-muted-foreground" : undefined}>
            {etiquetaRutaAsignada(f.clientesEnRuta)}
          </Td>
          <Td className={f.vehiculo ? undefined : "text-muted-foreground"}>{f.vehiculo ?? "—"}</Td>
          <Td alinear="centro">
            <Pronto />
          </Td>
          <Td alinear="centro">
            <BotonVer etiqueta={`Mermas/Cambios/Promociones de ${f.vendedor}`} onClick={() => abrir("mermas")} />
          </Td>
          <Td alinear="derecha">
            <BotonNumero cero={f.piezas === 0} etiqueta={`Venta general de ${f.vendedor}`} onClick={() => abrir("venta")}>
              {formatearPiezas(f.piezas)}
            </BotonNumero>
          </Td>
          <Td alinear="derecha" className="whitespace-nowrap">
            <BotonNumero cero={f.cobranzaCentavos === 0} etiqueta={`Cobranza de ${f.vendedor}`} onClick={() => abrir("cobranza")}>
              {formatearPesos(f.cobranzaCentavos)}
            </BotonNumero>
          </Td>
          <Td alinear="derecha" className="whitespace-nowrap">
            <BotonNumero cero={f.gastoCentavos === 0} etiqueta={`Gastos de ${f.vendedor}`} onClick={() => abrir("gastos")}>
              {formatearPesos(f.gastoCentavos)}
            </BotonNumero>
          </Td>
          <Td alinear="centro">
            <BotonVer etiqueta={`Notas de ventas de ${f.vendedor}`} onClick={() => abrir("notas")} />
          </Td>
          {/* Las notas asignadas llegan con la pieza 6 (spec §6). */}
          <Td alinear="centro" className="text-muted-foreground">
            —
          </Td>
          <Td>
            <RutaXY
              atendidos={f.atendidosEnRuta}
              clientes={f.clientesEnRuta}
              etiqueta={`Ruta de ${f.vendedor}`}
              onClick={() => abrir("visitas")}
            />
          </Td>
          <Td>
            <Etiqueta tono={terminado ? "exito" : "informacion"}>{terminado ? "Terminó" : "En ruta"}</Etiqueta>
          </Td>
          <Td alinear="centro" className={terminado ? undefined : "text-muted-foreground"}>
            {terminado ? <BotonVer etiqueta={`Corte de ${f.vendedor}`} onClick={() => abrir("corte")} /> : "—"}
          </Td>
        </Fila>
        {estaAbierto && (
          <FilaDetalle columnas={COLUMNAS} estado={estado}>
            {(detalle) => (
              <DetalleVendedor
                key={abierto.vez}
                detalle={detalle}
                modo="dashboard"
                pestanaInicial={abierto.pestana}
                onCambioPestana={cambiarPestana}
                onNotasGuardadas={recargar}
              />
            )}
          </FilaDetalle>
        )}
      </Fragment>
    );
  }

  return (
    <CajaTabla>
      <Tabla aria-label="Vendedores de hoy" className="min-w-[76rem] table-fixed">
        <colgroup>
          <col />
          <col className="w-36" />
          <col className="w-24" />
          <col className="w-20" />
          <col className="w-20" />
          <col className="w-22" />
          <col className="w-28" />
          <col className="w-26" />
          <col className="w-18" />
          <col className="w-22" />
          <col className="w-22" />
          <col className="w-22" />
          <col className="w-16" />
        </colgroup>
        <thead>
          <tr>
            <Th>Vendedor</Th>
            <Th>Ruta asignada</Th>
            <Th>Vehículo</Th>
            <Th alinear="centro">Inventario</Th>
            <Th alinear="centro" className="whitespace-normal">Mermas/Cambios/Promociones</Th>
            <Th alinear="derecha" className="whitespace-normal">Venta general</Th>
            <Th alinear="derecha">Cobranza</Th>
            <Th alinear="derecha">Gasto</Th>
            <Th alinear="centro" className="whitespace-normal">Notas de ventas</Th>
            <Th alinear="centro" className="whitespace-normal">Notas ant. asignadas</Th>
            <Th>Ruta</Th>
            <Th>Estatus</Th>
            <Th alinear="centro">Corte</Th>
          </tr>
        </thead>
        <tbody>
          {varias
            ? agruparPorSucursal(dashboard.vendedores).map((g) => {
                const bloque = dashboard.bloques.find((b) => b.sucursalCodigo === g.sucursalCodigo);
                const nombre = nombreSucursal(g.sucursalCodigo);
                return (
                  <Fragment key={g.sucursalCodigo}>
                    <FilaGrupo columnas={COLUMNAS}>{nombre}</FilaGrupo>
                    {g.filas.map(renglon)}
                    {bloque && <RenglonTotal texto={`Subtotal ${nombre}`} totales={bloque.totales} />}
                  </Fragment>
                );
              })
            : dashboard.vendedores.map(renglon)}
          {varias && <RenglonTotal texto="Total" totales={dashboard.total} />}
        </tbody>
      </Tabla>
    </CajaTabla>
  );
}

/**
 * "6 / 16" con su barrita: clientes de la ruta del día atendidos contra los de la ruta. Se pica y
 * abre la pestaña Ruta (las visitas), como en el sistema viejo.
 */
function RutaXY({
  atendidos,
  clientes,
  etiqueta,
  onClick,
}: {
  atendidos: number;
  clientes: number;
  etiqueta: string;
  onClick: () => void;
}) {
  return (
    <div className="flex flex-col items-start gap-1">
      <BotonNumero cero={false} etiqueta={etiqueta} onClick={onClick}>{`${atendidos} / ${clientes}`}</BotonNumero>
      <Barra valor={atendidos} maximo={clientes} className="w-12" />
    </div>
  );
}

function RenglonTotal({ texto, totales }: { texto: string; totales: Totales }) {
  return (
    <FilaTotal>
      <Td colSpan={5}>{`${texto} · ${plural(totales.rutas, "vendedor", "vendedores")}`}</Td>
      <Td alinear="derecha">{formatearPiezas(totales.piezas)}</Td>
      <TdMonto centavos={totales.cobranzaCentavos} />
      <TdMonto centavos={totales.gastoCentavos} />
      <Td colSpan={2} />
      <Td className="whitespace-nowrap">{`${totales.atendidosEnRuta} / ${totales.clientesEnRuta}`}</Td>
      <Td colSpan={2} />
    </FilaTotal>
  );
}
