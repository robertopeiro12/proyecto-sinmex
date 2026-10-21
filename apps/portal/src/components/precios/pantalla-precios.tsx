"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { Aviso } from "@/components/ui/aviso";
import {
  EncabezadoPantalla,
  Pantalla,
} from "@/components/ui/encabezado-pantalla";
import { EstadoPantalla } from "@/components/ui/estado-pantalla";
import { CajaTabla } from "@/components/ui/tabla";
import { listarProductos, type Producto } from "@/lib/productos";
import { listarSucursales, type Sucursal } from "@/lib/sucursales";
import {
  listarListasPrecio,
  listarPrecios,
  type ListaPrecio,
} from "@/lib/precios";
import { CeldaPrecio } from "./celda-precio";

interface PrecioCelda {
  presentacionId: string;
  listaPrecioId: string;
  precio: number;
}

export function PantallaPrecios({ sucursal }: { sucursal: string | null }) {
  const { usuario, puede } = useAuth();
  const puedeGestionar = puede("precio.gestionar");

  const [sucursales, setSucursales] = useState<Sucursal[]>([]);
  useEffect(() => {
    listarSucursales()
      .then(setSucursales)
      .catch(() => setSucursales([]));
  }, []);

  // Atado: siempre la suya, sin importar el filtro global (el selector ni
  // siquiera le pinta una lista, ver use-sucursal-actual.ts). General: la
  // que elija el selector, o ninguna hasta que elija -- la matriz pinta UNA
  // sucursal a la vez (D7 del spec), a diferencia de Vehiculos.
  const sucursalActual =
    usuario?.sucursal ?? sucursales.find((s) => s.codigo === sucursal) ?? null;

  if (usuario !== null && usuario.sucursal === null && !sucursal) {
    return <EstadoPantalla titulo="Listas de Precios" tipo="elige-sucursal" />;
  }

  if (!sucursalActual) {
    // Sesion o lista de sucursales todavia cargando: mismo shell que usa
    // MatrizPrecios para su propio "Cargando...", asi la pantalla nunca se ve
    // en blanco.
    if (usuario === null || sucursales.length === 0) {
      return <EstadoPantalla titulo="Listas de Precios" tipo="cargando" />;
    }
    // Ya cargo todo y el codigo pedido no resolvio a ninguna sucursal (URL
    // vieja, sucursal desactivada, o alguien escribio el query param a mano):
    // mismo mensaje que el caso de General sin filtro, en vez de un callejon
    // sin salida en blanco.
    return <EstadoPantalla titulo="Listas de Precios" tipo="elige-sucursal" />;
  }

  return (
    <MatrizPrecios
      key={sucursalActual.id}
      sucursalId={sucursalActual.id}
      sucursalCodigo={sucursalActual.codigo}
      puedeGestionar={puedeGestionar}
    />
  );
}

function MatrizPrecios({
  sucursalId,
  sucursalCodigo,
  puedeGestionar,
}: {
  sucursalId: string;
  sucursalCodigo: string;
  puedeGestionar: boolean;
}) {
  const [productos, setProductos] = useState<Producto[]>([]);
  const [listas, setListas] = useState<ListaPrecio[]>([]);
  const [precios, setPrecios] = useState<PrecioCelda[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let vigente = true;
    setCargando(true);
    setError(null);
    Promise.all([
      listarProductos(),
      listarListasPrecio(),
      listarPrecios(sucursalCodigo),
    ])
      .then(([p, l, pr]) => {
        if (!vigente) return;
        setProductos(p);
        setListas(l);
        setPrecios(
          pr.map(({ presentacionId, listaPrecioId, precio }) => ({
            presentacionId,
            listaPrecioId,
            precio,
          })),
        );
      })
      .catch(() => {
        if (vigente) setError("No se pudieron cargar los precios.");
      })
      .finally(() => {
        if (vigente) setCargando(false);
      });
    return () => {
      vigente = false;
    };
  }, [sucursalCodigo]);

  function precioDe(
    presentacionId: string,
    listaPrecioId: string,
  ): number | null {
    return (
      precios.find(
        (p) =>
          p.presentacionId === presentacionId &&
          p.listaPrecioId === listaPrecioId,
      )?.precio ?? null
    );
  }

  function alGuardarCelda(
    presentacionId: string,
    listaPrecioId: string,
    precio: number,
  ) {
    setPrecios((previos) => [
      ...previos.filter(
        (p) =>
          !(
            p.presentacionId === presentacionId &&
            p.listaPrecioId === listaPrecioId
          ),
      ),
      { presentacionId, listaPrecioId, precio },
    ]);
  }

  if (cargando) {
    return <EstadoPantalla titulo="Listas de Precios" tipo="cargando" />;
  }

  return (
    <Pantalla>
      <EncabezadoPantalla
        titulo="Listas de Precios"
        descripcion="El precio de cada presentación en cada lista de la sucursal."
      />
      {error && <Aviso tono="error">{error}</Aviso>}
      <CajaTabla>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th scope="col" className="py-2 font-medium">
                Producto
              </th>
              <th scope="col" className="py-2 font-medium">
                Presentación
              </th>
              {listas.map((lista) => (
                <th key={lista.id} scope="col" className="py-2 font-medium">
                  {lista.nombre}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {productos.flatMap((producto) =>
              producto.presentaciones.map((presentacion) => (
                <tr key={presentacion.id} className="border-b last:border-0">
                  <td className="py-2">
                    {producto.nombre}
                    {!producto.activo && (
                      <span className="ml-2 text-xs text-muted-foreground">
                        Inactivo
                      </span>
                    )}
                  </td>
                  <td className="py-2">{presentacion.volumen}</td>
                  {listas.map((lista) => (
                    <td key={lista.id} className="py-2">
                      <CeldaPrecio
                        presentacionId={presentacion.id}
                        listaPrecioId={lista.id}
                        sucursalId={sucursalId}
                        precioInicial={precioDe(presentacion.id, lista.id)}
                        editable={puedeGestionar}
                        alGuardar={(precio) =>
                          alGuardarCelda(presentacion.id, lista.id, precio)
                        }
                      />
                    </td>
                  ))}
                </tr>
              )),
            )}
            {productos.length === 0 && (
              <tr>
                <td
                  colSpan={2 + listas.length}
                  className="py-4 text-muted-foreground"
                >
                  No hay productos en el catálogo.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </CajaTabla>
    </Pantalla>
  );
}
