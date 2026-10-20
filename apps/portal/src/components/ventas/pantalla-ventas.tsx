"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { Aviso } from "@/components/ui/aviso";
import { buttonVariants } from "@/components/ui/button";
import { Campo, Entrada } from "@/components/ui/campo";
import { EncabezadoPantalla, Pantalla } from "@/components/ui/encabezado-pantalla";
import { EtiquetaStatusVenta } from "@/components/ui/etiqueta";
import { Fecha } from "@/components/ui/fecha";
import { FiltroFechas } from "@/components/ui/filtro-fechas";
import { CajaTabla, Fila, Tabla, Td, TdMonto, Th } from "@/components/ui/tabla";
import { mensajeDe } from "@/lib/api";
import { listarClientes, type ClienteResumen } from "@/lib/clientes";
import {
  ETIQUETA_ORIGEN,
  buscarVentas,
  hoyEnTijuana,
  obtenerVenta,
  type ResultadoBusquedaVentas,
  type VentaDetalle,
} from "@/lib/ventas";
import { BuscadorCliente } from "./buscador-cliente";
import { DetalleVenta } from "./detalle-venta";
import { FormularioEditarVenta } from "./formulario-editar-venta";

interface Filtro {
  desde: string;
  hasta: string;
  cliente: ClienteResumen | null;
  numNota: string;
}

type Vista =
  | { tipo: "busqueda" }
  | { tipo: "detalle"; venta: VentaDetalle }
  | { tipo: "edicion"; venta: VentaDetalle };

function filtroDeHoy(): Filtro {
  const hoy = hoyEnTijuana();
  return { desde: hoy, hasta: hoy, cliente: null, numNota: "" };
}

/**
 * Ventas (T-17, parte 2, §3): buscar por rango de fechas, cliente y # de nota;
 * ver el detalle; editar, eliminar o marcar como cuenta perdida. Vale para las
 * ventas de la tablet y del portal.
 *
 * Los filtros viven aquí y no en la vista de búsqueda: así "Volver" regresa
 * con los mismos filtros y vuelve a buscar (la venta pudo cambiar).
 */
export function PantallaVentas({ sucursal }: { sucursal: string | null }) {
  const { puede } = useAuth();
  const [clientes, setClientes] = useState<ClienteResumen[]>([]);
  const [borrador, setBorrador] = useState<Filtro>(filtroDeHoy);
  const [aplicado, setAplicado] = useState<Filtro>(filtroDeHoy);
  const [resultado, setResultado] = useState<ResultadoBusquedaVentas | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [vista, setVista] = useState<Vista>({ tipo: "busqueda" });

  useEffect(() => {
    let vigente = true;
    listarClientes(sucursal, "todos")
      .then((lista) => {
        if (vigente) setClientes(lista);
      })
      .catch(() => {
        if (vigente) setError("No se pudieron cargar los clientes.");
      });
    return () => {
      vigente = false;
    };
  }, [sucursal]);

  // Cada `setAplicado` (Mostrar, Volver) es un objeto nuevo: vuelve a buscar.
  useEffect(() => {
    let vigente = true;
    setCargando(true);
    buscarVentas({
      desde: aplicado.desde,
      hasta: aplicado.hasta,
      sucursal,
      clienteId: aplicado.cliente?.id ?? null,
      numNota: aplicado.numNota,
    })
      .then((r) => {
        if (!vigente) return;
        setResultado(r);
        setError(null);
      })
      .catch((err: unknown) => {
        if (vigente) setError(mensajeDe(err, "No se pudieron buscar las ventas."));
      })
      .finally(() => {
        if (vigente) setCargando(false);
      });
    return () => {
      vigente = false;
    };
  }, [aplicado, sucursal]);

  function volverABusqueda() {
    setVista({ tipo: "busqueda" });
    setAplicado((actual) => ({ ...actual }));
  }

  async function abrir(id: string) {
    setError(null);
    try {
      setVista({ tipo: "detalle", venta: await obtenerVenta(id) });
    } catch (err) {
      setError(mensajeDe(err, "No se pudo abrir la venta."));
    }
  }

  if (vista.tipo === "edicion") {
    return (
      <FormularioEditarVenta
        venta={vista.venta}
        onGuardada={(actualizada) => setVista({ tipo: "detalle", venta: actualizada })}
        onCancelar={() => setVista({ tipo: "detalle", venta: vista.venta })}
      />
    );
  }

  if (vista.tipo === "detalle") {
    return (
      <DetalleVenta
        venta={vista.venta}
        onVolver={volverABusqueda}
        onEditar={() => setVista({ tipo: "edicion", venta: vista.venta })}
        onCambiada={(actualizada) => setVista({ tipo: "detalle", venta: actualizada })}
        onEliminada={volverABusqueda}
      />
    );
  }

  const enlaceRegistrar = sucursal
    ? `/operacion/registrar-venta?sucursal=${encodeURIComponent(sucursal)}`
    : "/operacion/registrar-venta";

  return (
    <Pantalla>
      <EncabezadoPantalla
        titulo="Ventas"
        descripcion="Busca una venta por fecha, cliente o # de nota para verla, editarla o eliminarla."
        acciones={
          puede("venta.registrar") ? (
            <Link href={enlaceRegistrar} className={buttonVariants()}>
              Registrar venta
            </Link>
          ) : undefined
        }
      />

      <FiltroFechas
        id="ventas"
        desde={borrador.desde}
        hasta={borrador.hasta}
        onCambio={(rango) => setBorrador({ ...borrador, ...rango })}
        onMostrar={() => setAplicado({ ...borrador })}
        deshabilitado={cargando}
      >
        <BuscadorCliente
          clientes={clientes}
          cliente={borrador.cliente}
          onElegir={(cliente) => setBorrador({ ...borrador, cliente })}
          onQuitar={() => setBorrador({ ...borrador, cliente: null })}
          etiquetaQuitar="Quitar"
        />
        <Campo id="buscar-num-nota" etiqueta="# de nota">
          <Entrada
            maxLength={30}
            value={borrador.numNota}
            onChange={(e) => setBorrador({ ...borrador, numNota: e.target.value })}
            className="w-40"
          />
        </Campo>
      </FiltroFechas>

      {error && <Aviso tono="error">{error}</Aviso>}

      {resultado?.hayMas && (
        <Aviso tono="advertencia">Hay más de 200 ventas: acota el rango o filtra por cliente.</Aviso>
      )}

      {resultado && resultado.ventas.length === 0 && (
        <p className="text-sm text-muted-foreground">No hay ventas con esos filtros.</p>
      )}

      {resultado && resultado.ventas.length > 0 && (
        <CajaTabla>
          <Tabla className="min-w-[860px]">
            <thead>
              <tr>
                <Th>Folio</Th>
                <Th>Fecha</Th>
                <Th>Cliente</Th>
                <Th>Repartidor</Th>
                <Th># de nota</Th>
                <Th alinear="derecha">Monto</Th>
                <Th>Status</Th>
                <Th>Origen</Th>
                <Th alinear="derecha">Saldo</Th>
              </tr>
            </thead>
            <tbody>
              {resultado.ventas.map((v) => (
                <Fila key={v.id} interactiva>
                  <Td>
                    <button
                      type="button"
                      onClick={() => void abrir(v.id)}
                      className="font-mono underline-offset-2 hover:underline"
                    >
                      {v.folio}
                    </button>
                  </Td>
                  <Td>
                    <Fecha valor={v.fecha} />
                  </Td>
                  <Td>{v.cliente}</Td>
                  <Td>{v.repartidor ?? "Oficina"}</Td>
                  <Td>{v.numNota ?? "—"}</Td>
                  <TdMonto centavos={v.montoCentavos} />
                  <Td>
                    <EtiquetaStatusVenta status={v.status} />
                  </Td>
                  <Td>{ETIQUETA_ORIGEN[v.origen]}</Td>
                  <TdMonto centavos={v.saldoCentavos} />
                </Fila>
              ))}
            </tbody>
          </Tabla>
        </CajaTabla>
      )}
    </Pantalla>
  );
}
