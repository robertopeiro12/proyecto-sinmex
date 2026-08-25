"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/components/auth/auth-provider";
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
  // siquiera le pinta un <select>, ver selector-sucursal.tsx). General: la
  // que elija el selector, o ninguna hasta que elija -- la matriz pinta UNA
  // sucursal a la vez (D7 del spec), a diferencia de Vehiculos.
  const sucursalActual =
    usuario?.sucursal ?? sucursales.find((s) => s.codigo === sucursal) ?? null;

  if (usuario !== null && usuario.sucursal === null && !sucursal) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Listas de Precios</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">
            Elige una sucursal en el filtro para ver y editar sus precios.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (!sucursalActual) {
    // Sesion o lista de sucursales todavia cargando.
    return null;
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

  function precioDe(presentacionId: string, listaPrecioId: string): number | null {
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
    return (
      <Card>
        <CardHeader>
          <CardTitle>Listas de Precios</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">Cargando…</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Listas de Precios</CardTitle>
      </CardHeader>
      <CardContent>
        {error && (
          <p role="alert" className="mb-4 text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-2 font-medium">Producto</th>
                <th className="py-2 font-medium">Presentación</th>
                {listas.map((lista) => (
                  <th key={lista.id} className="py-2 font-medium">
                    {lista.nombre}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {productos.flatMap((producto) =>
                producto.presentaciones.map((presentacion) => (
                  <tr key={presentacion.id} className="border-b last:border-0">
                    <td className="py-2">{producto.nombre}</td>
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
        </div>
      </CardContent>
    </Card>
  );
}
