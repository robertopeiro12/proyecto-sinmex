"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { Aviso } from "@/components/ui/aviso";
import { Button } from "@/components/ui/button";
import { Campo, Entrada } from "@/components/ui/campo";
import { EncabezadoPantalla, Pantalla } from "@/components/ui/encabezado-pantalla";
import { EstadoPantalla } from "@/components/ui/estado-pantalla";
import { Etiqueta } from "@/components/ui/etiqueta";
import { CajaTabla, Fila, FilaGrupo, FilaVacia, Tabla, Td, Th } from "@/components/ui/tabla";
import { mensajeDe } from "@/lib/api";
import { etiquetaEstadoCorte, leerCortesDelDia, type CortesDelDia, type FilaCorte } from "@/lib/cortes";
import { diaAnterior } from "@/lib/fechas";
import { agruparPorSucursal } from "@/lib/flujo-diario";
import { listarSucursales, type Sucursal } from "@/lib/sucursales";
import { hoyEnTijuana } from "@/lib/ventas";
import { CorteVendedor } from "./corte-vendedor";

const TITULO = "Corte";
const DESCRIPCION = "Compara lo que debería regresar cada vendedor contra lo que contó el almacén.";
const COLUMNAS = 4;

/**
 * Producción › Corte (absorbe a Retorno; spec 2026-11-12 §5): la lista de vendedores del
 * día y, al picar uno, su corte en pantalla completa. Un solo día (Hoy · Ayer o cualquiera
 * anterior; el futuro no se ofrece). Atado: su sucursal; General: la del selector del menú,
 * y con "Todas" un bloque por sucursal. La página la monta con `key={sucursal}`.
 */
export function PantallaCorte({ sucursal }: { sucursal: string | null }) {
  const { usuario, puede, cargando } = useAuth();

  if (cargando) return <EstadoPantalla titulo={TITULO} tipo="cargando" />;
  if (!puede("retorno.gestionar")) return <EstadoPantalla titulo={TITULO} tipo="sin-permiso" />;

  const codigo = usuario?.sucursal?.codigo ?? (sucursal && sucursal.toLowerCase() !== "todas" ? sucursal.toUpperCase() : null);
  return <Cortes sucursal={codigo} />;
}

function Cortes({ sucursal }: { sucursal: string | null }) {
  const hoy = hoyEnTijuana();
  const [fecha, setFecha] = useState(hoy);
  // El vendedor cuyo corte está abierto; `null` = la lista.
  const [abierto, setAbierto] = useState<FilaCorte["vendedor"] | null>(null);
  const [dia, setDia] = useState<CortesDelDia | null>(null);
  const [sucursales, setSucursales] = useState<Sucursal[]>([]);
  const [cargandoDia, setCargandoDia] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Cambia al volver de un corte: la lista se vuelve a pedir (su estado pudo cambiar).
  const [vuelta, setVuelta] = useState(0);
  const ultima = useRef(0);

  useEffect(() => {
    let vigente = true;
    listarSucursales().then(
      (lista) => {
        if (vigente) setSucursales(lista);
      },
      () => {
        // Sin nombres, los bloques dicen el código (TJ, MX).
      },
    );
    return () => {
      vigente = false;
    };
  }, []);

  useEffect(() => {
    const esta = ++ultima.current;
    setCargandoDia(true);
    leerCortesDelDia(fecha, sucursal)
      .then((r) => {
        if (esta !== ultima.current) return;
        setDia(r);
        setError(null);
      })
      .catch((err: unknown) => {
        if (esta !== ultima.current) return;
        setDia(null);
        setError(mensajeDe(err, "No se pudo cargar el corte del día."));
      })
      .finally(() => {
        if (esta === ultima.current) setCargandoDia(false);
      });
  }, [fecha, sucursal, vuelta]);

  function cambiarFecha(nueva: string) {
    // El `max` del campo no impide teclear un día futuro: ni se pide ni se cambia.
    if (nueva === "" || nueva > hoy) return;
    setFecha(nueva);
  }

  if (abierto) {
    return (
      <CorteVendedor
        key={`${abierto.id}-${fecha}`}
        fecha={fecha}
        vendedor={abierto}
        onVolver={() => {
          setAbierto(null);
          setVuelta((v) => v + 1);
        }}
      />
    );
  }

  const nombreSucursal = (codigo: string) => sucursales.find((s) => s.codigo === codigo)?.nombre ?? codigo;
  const filas = (dia?.vendedores ?? []).map((f) => ({ ...f, sucursalCodigo: f.sucursal.codigo }));
  const grupos = agruparPorSucursal(filas);
  const varias = sucursal === null && grupos.length > 1;

  const renglon = (f: FilaCorte) => {
    const estado = etiquetaEstadoCorte(f);
    return (
      <Fila key={f.vendedor.id} className="align-middle">
        <Td className="truncate">{f.vendedor.nombre}</Td>
        <Td alinear="derecha">
          {f.sinCarga ? <Etiqueta tono="advertencia">Sin carga</Etiqueta> : f.piezasCargadas}
        </Td>
        <Td>
          <Etiqueta tono={estado.tono}>{estado.texto}</Etiqueta>
        </Td>
        <Td alinear="derecha">
          <Button size="sm" variant={f.estado === "sin_corte" ? "default" : "outline"} onClick={() => setAbierto(f.vendedor)}>
            {f.estado === "sin_corte" ? "Hacer corte" : "Ver corte"}
          </Button>
        </Td>
      </Fila>
    );
  };

  return (
    <Pantalla key="lista">
      <EncabezadoPantalla titulo={TITULO} descripcion={DESCRIPCION} />

      <div className="flex flex-wrap items-end gap-3">
        <Campo id="corte-fecha" etiqueta="Día" className="w-48">
          <Entrada type="date" required max={hoy} value={fecha} onChange={(e) => cambiarFecha(e.target.value)} />
        </Campo>
        <div role="group" aria-label="Atajos de día" className="flex items-center gap-0.5">
          <Button type="button" variant="ghost" size="sm" onClick={() => cambiarFecha(hoy)}>
            Hoy
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => cambiarFecha(diaAnterior(hoy))}>
            Ayer
          </Button>
        </div>
      </div>

      {error && <Aviso tono="error">{error}</Aviso>}
      {cargandoDia && !dia && <EstadoPantalla tipo="cargando" />}

      {dia && (
        <CajaTabla className={cargandoDia ? "opacity-60" : undefined}>
          <Tabla aria-label="Vendedores del día" className="table-fixed">
            <colgroup>
              <col />
              <col className="w-36" />
              <col className="w-36" />
              <col className="w-36" />
            </colgroup>
            <thead>
              <tr>
                <Th>Vendedor</Th>
                <Th alinear="derecha">Piezas cargadas</Th>
                <Th>Estado</Th>
                <Th>
                  <span className="sr-only">Acción</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {filas.length === 0 ? (
                <FilaVacia columnas={COLUMNAS}>Nadie cargó, vendió ni regresó mercancía ese día.</FilaVacia>
              ) : varias ? (
                grupos.map((g) => (
                  <Fragment key={g.sucursalCodigo}>
                    <FilaGrupo columnas={COLUMNAS} sucursal={g.sucursalCodigo}>
                      {nombreSucursal(g.sucursalCodigo)}
                    </FilaGrupo>
                    {g.filas.map(renglon)}
                  </Fragment>
                ))
              ) : (
                filas.map(renglon)
              )}
            </tbody>
          </Tabla>
        </CajaTabla>
      )}
    </Pantalla>
  );
}
