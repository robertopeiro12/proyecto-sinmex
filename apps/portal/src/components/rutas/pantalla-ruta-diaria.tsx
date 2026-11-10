"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { Aviso } from "@/components/ui/aviso";
import { Button } from "@/components/ui/button";
import { Campo, Entrada } from "@/components/ui/campo";
import { useConfirmar } from "@/components/ui/confirmar";
import { EncabezadoPantalla, Pantalla } from "@/components/ui/encabezado-pantalla";
import { EstadoPantalla } from "@/components/ui/estado-pantalla";
import { CajaTabla, FilaVacia, Tabla, Td, Th } from "@/components/ui/tabla";
import { mensajeDe } from "@/lib/api";
import { formatearDiaLargo } from "@/lib/formato";
import { obtenerDia, quitarRutaDiaria, type ListaDelDia, type RenglonDia } from "@/lib/rutas";
import { hoyEnTijuana } from "@/lib/ventas";
import { RutaDeVendedor } from "./ruta-de-vendedor";

const TITULO = "Ruta Diaria";
const DESCRIPCION = "La ruta, el vehículo y las notas por cobrar de cada vendedor en un día.";

/** Qué columna de notas se picó (la ventana de notas es de la Tarea 11). */
export type NotasDelRenglon = "pendientes" | "asignadas";

/**
 * Operación → Ruta Diaria (spec §5.1), como la del sistema viejo: un renglón por vendedor
 * activo de la sucursal, con su ruta, clientes, notas y vehículo del día. "Asignar ruta" /
 * "Editar" abren la ruta del vendedor a pantalla completa. Un día pasado es solo lectura.
 */
export function PantallaRutaDiaria({ sucursal }: { sucursal: string | null }) {
  const { usuario, puede, cargando } = useAuth();

  if (cargando) return <EstadoPantalla titulo={TITULO} tipo="cargando" />;
  if (!puede("ruta_diaria.gestionar")) return <EstadoPantalla titulo={TITULO} tipo="sin-permiso" />;

  const codigo =
    usuario?.sucursal?.codigo ?? (sucursal && sucursal.toLowerCase() !== "todas" ? sucursal.toUpperCase() : null);
  if (!codigo) return <EstadoPantalla titulo={TITULO} tipo="elige-sucursal" />;

  return <RutaDiariaDelDia key={codigo} sucursal={codigo} />;
}

function RutaDiariaDelDia({ sucursal }: { sucursal: string }) {
  const [fecha, setFecha] = useState(hoyEnTijuana);
  const [dia, setDia] = useState<ListaDelDia | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [abierto, setAbierto] = useState<RenglonDia | null>(null);
  const [quitando, setQuitando] = useState<string | null>(null);
  const { confirmar, ventana } = useConfirmar();

  // Una respuesta de otra fecha no pisa la pantalla actual.
  const fechaVigente = useRef(fecha);
  useEffect(() => {
    fechaVigente.current = fecha;
  });

  const cargar = useCallback(() => {
    const paraFecha = fecha;
    setError(null);
    return obtenerDia(paraFecha, sucursal)
      .then((lista) => {
        if (fechaVigente.current === paraFecha) setDia(lista);
      })
      .catch((err: unknown) => {
        if (fechaVigente.current === paraFecha) setError(mensajeDe(err, "No se pudo cargar la ruta del día."));
      });
  }, [fecha, sucursal]);

  useEffect(() => {
    setDia(null);
    void cargar();
  }, [cargar]);

  async function quitarRuta(r: RenglonDia) {
    if (
      !(await confirmar({
        titulo: `¿Quitar la ruta de ${r.vendedor}?`,
        descripcion:
          "Se quitan su ruta, su vehículo, los clientes que puso la oficina y sus notas asignadas de ese día. Los clientes que agregó el vendedor se quedan.",
        confirmar: "Quitar ruta",
      }))
    ) {
      return;
    }
    setQuitando(r.vendedorId);
    setError(null);
    try {
      await quitarRutaDiaria(r.vendedorId, fecha);
      await cargar();
    } catch (err) {
      setError(mensajeDe(err, "No se pudo quitar la ruta."));
    } finally {
      setQuitando(null);
    }
  }

  if (abierto) {
    return (
      <RutaDeVendedor
        key={`${abierto.vendedorId}-${fecha}`}
        vendedorId={abierto.vendedorId}
        vendedorNombre={abierto.vendedor}
        fecha={fecha}
        sucursal={sucursal}
        onVolver={() => {
          setAbierto(null);
          void cargar();
        }}
      />
    );
  }

  return (
    <Pantalla>
      <EncabezadoPantalla titulo={TITULO} descripcion={DESCRIPCION} />
      <div className="flex flex-wrap items-end gap-4">
        <Campo id="ruta-diaria-dia" etiqueta="Día">
          <Entrada
            type="date"
            value={fecha}
            onChange={(e) => {
              if (e.target.value !== "") setFecha(e.target.value);
            }}
          />
        </Campo>
        <p className="pb-2 text-sm text-muted-foreground">{formatearDiaLargo(fecha)}</p>
      </div>

      {dia && !dia.editable ? <Aviso tono="informacion">Ese día ya pasó; solo se puede consultar.</Aviso> : null}
      {error ? <Aviso tono="error">{error}</Aviso> : null}

      {dia === null ? (
        error ? null : (
          <EstadoPantalla tipo="cargando" />
        )
      ) : (
        <TablaDelDia
          renglones={dia.renglones}
          editable={dia.editable}
          quitando={quitando}
          onAbrir={setAbierto}
          onQuitar={(r) => void quitarRuta(r)}
        />
      )}
      {ventana}
    </Pantalla>
  );
}

/**
 * La tabla del día. Cabe en la caja de 1366 px (≈1012 px): columnas fijas y el nombre del
 * vendedor se lleva lo que sobra. `onAbrirNotas` es el punto de entrada de la ventana de
 * notas (Tarea 11): sin él, las columnas de notas muestran solo el número.
 */
export function TablaDelDia({
  renglones,
  editable,
  quitando,
  onAbrir,
  onQuitar,
  onAbrirNotas,
}: {
  renglones: RenglonDia[];
  editable: boolean;
  quitando: string | null;
  onAbrir: (renglon: RenglonDia) => void;
  onQuitar: (renglon: RenglonDia) => void;
  onAbrirNotas?: (renglon: RenglonDia, cuales: NotasDelRenglon) => void;
}) {
  const celdaNotas = (r: RenglonDia, cuales: NotasDelRenglon) => {
    const n = cuales === "pendientes" ? r.notasPendientes : r.notasAsignadas;
    return onAbrirNotas ? (
      <button
        type="button"
        className="cursor-pointer font-medium tabular-nums underline-offset-2 hover:underline focus-visible:underline"
        onClick={() => onAbrirNotas(r, cuales)}
      >
        {n}
      </button>
    ) : (
      n
    );
  };

  return (
    <CajaTabla>
      <Tabla className="table-fixed">
        <colgroup>
          <col />
          <col className="w-[180px]" />
          <col className="w-[92px]" />
          <col className="w-[104px]" />
          <col className="w-[104px]" />
          <col className="w-[150px]" />
          <col className="w-[184px]" />
        </colgroup>
        <thead>
          <tr>
            <Th>Vendedor</Th>
            <Th>Ruta asignada</Th>
            <Th alinear="derecha">Clientes asignados</Th>
            <Th alinear="derecha">Notas pendientes por cobrar</Th>
            <Th alinear="derecha">Notas asignadas por cobrar</Th>
            <Th>Vehículo</Th>
            <Th>Acciones</Th>
          </tr>
        </thead>
        <tbody>
          {renglones.length === 0 ? (
            <FilaVacia columnas={7}>Sin vendedores activos en la sucursal.</FilaVacia>
          ) : (
            renglones.map((r) => (
              <tr key={r.vendedorId}>
                <Td className="truncate font-medium" title={r.vendedor}>
                  {r.vendedor}
                </Td>
                <Td className="truncate" title={r.rutaNombre ?? undefined}>
                  {r.rutaNombre ?? <span className="text-muted-foreground">Sin ruta</span>}
                </Td>
                <Td alinear="derecha">{r.clientes}</Td>
                <Td alinear="derecha">{celdaNotas(r, "pendientes")}</Td>
                <Td alinear="derecha">{celdaNotas(r, "asignadas")}</Td>
                <Td className="truncate" title={r.vehiculo ?? undefined}>
                  {r.vehiculo ?? <span className="text-muted-foreground">Sin vehículo</span>}
                </Td>
                <Td>
                  <div className="flex gap-1.5">
                    {!editable ? (
                      r.tieneRuta ? (
                        <Button type="button" size="sm" variant="outline" onClick={() => onAbrir(r)}>
                          Ver
                        </Button>
                      ) : null
                    ) : r.tieneRuta ? (
                      <>
                        <Button type="button" size="sm" variant="outline" onClick={() => onAbrir(r)}>
                          Editar
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={quitando !== null}
                          onClick={() => onQuitar(r)}
                        >
                          Quitar ruta
                        </Button>
                      </>
                    ) : (
                      <Button type="button" size="sm" onClick={() => onAbrir(r)}>
                        Asignar ruta
                      </Button>
                    )}
                  </div>
                </Td>
              </tr>
            ))
          )}
        </tbody>
      </Tabla>
    </CajaTabla>
  );
}
