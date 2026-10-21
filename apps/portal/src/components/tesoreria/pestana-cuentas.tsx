"use client";

import { useState } from "react";
import { Aviso } from "@/components/ui/aviso";
import { Button } from "@/components/ui/button";
import { useConfirmar } from "@/components/ui/confirmar";
import { EstadoPantalla } from "@/components/ui/estado-pantalla";
import { CajaTabla } from "@/components/ui/tabla";
import { Ventana } from "@/components/ui/ventana";
import { useAuth } from "@/components/auth/auth-provider";
import { TablaCatalogo } from "@/components/catalogo/tabla-catalogo";
import { useCatalogo } from "@/components/catalogo/use-catalogo";
import { mensajeDe } from "@/lib/api";
import {
  eliminarCuentaTesoreria,
  etiquetaSucursalCuenta,
  listarCuentasTesoreria,
  type CuentaTesoreria,
} from "@/lib/tesoreria";
import { FormularioCuentaTesoreria } from "./formulario-cuenta-tesoreria";
import { SeccionDestinos } from "./seccion-destinos";

/** Las cuentas ("campos" del cliente). Alta, renombrar y baja lógica con confirmación. */
export function PestanaCuentas({ sucursal }: { sucursal: string | null }) {
  const { usuario } = useAuth();
  const catalogo = useCatalogo<CuentaTesoreria>(() => listarCuentasTesoreria(sucursal), {
    mensajeError: "No se pudieron cargar las cuentas.",
    deps: [sucursal],
  });
  const { confirmar, ventana } = useConfirmar();
  const [eliminando, setEliminando] = useState<string | null>(null);
  const [errorAccion, setErrorAccion] = useState<string | null>(null);
  // El título se guarda al abrir para que no cambie durante la animación de salida, cuando `edicion` ya es null.
  const [tituloVentana, setTituloVentana] = useState("");

  // Un usuario atado a una sucursal no administra las generales (spec §3.2).
  const modificable = (c: CuentaTesoreria) => usuario?.sucursal === null || c.sucursalId !== null;

  function abrir(c: CuentaTesoreria | null) {
    setErrorAccion(null);
    setTituloVentana(c ? `Editar ${c.nombre}` : "Nueva cuenta");
    if (c) catalogo.abrirEdicion(c);
    else catalogo.abrirAlta();
  }

  async function eliminar(c: CuentaTesoreria) {
    const si = await confirmar({
      titulo: `¿Eliminar la cuenta "${c.nombre}"?`,
      descripcion: "Su historia se conserva, pero ya no aparecerá en la Tesorería.",
      confirmar: "Eliminar cuenta",
    });
    if (!si) return;
    setEliminando(c.id);
    setErrorAccion(null);
    try {
      await eliminarCuentaTesoreria(c.id);
      void catalogo.recargar();
    } catch (err) {
      // El servidor es el único candado (403 cuenta general, 409 la que recibe cobranza): su mensaje, tal cual.
      setErrorAccion(mensajeDe(err, "No se pudo eliminar la cuenta."));
    } finally {
      setEliminando(null);
    }
  }

  const error = catalogo.error ?? errorAccion;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Button size="sm" disabled={catalogo.edicion !== null} onClick={() => abrir(null)}>
          Nueva cuenta
        </Button>
      </div>

      {error && <Aviso tono="error">{error}</Aviso>}
      {catalogo.cargando && <EstadoPantalla tipo="cargando" />}

      {!catalogo.cargando && !catalogo.error && (
        <CajaTabla>
          <TablaCatalogo
            items={catalogo.items}
            vacio="Todavía no hay cuentas. Da de alta la primera (Efectivo, Caja Chica, un banco…)."
            columnas={[
              { encabezado: "Cuenta", celda: (c) => c.nombre },
              {
                encabezado: "Sucursal",
                celda: (c) => etiquetaSucursalCuenta(c.sucursalCodigo),
                className: "whitespace-nowrap",
              },
            ]}
            acciones={(c) =>
              modificable(c) ? (
                <div className="flex justify-end gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={catalogo.edicion !== null || eliminando !== null}
                    onClick={() => abrir(c)}
                  >
                    Editar
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={catalogo.edicion !== null || eliminando !== null}
                    onClick={() => void eliminar(c)}
                  >
                    {eliminando === c.id ? "Eliminando…" : "Eliminar"}
                  </Button>
                </div>
              ) : null
            }
          />
        </CajaTabla>
      )}

      <Ventana abierta={catalogo.edicion !== null} titulo={tituloVentana} alCerrar={catalogo.cerrar}>
        {catalogo.edicion !== null && (
          <FormularioCuentaTesoreria
            key={catalogo.edicion === "nueva" ? "nueva" : catalogo.edicion.id}
            cuenta={catalogo.edicion === "nueva" ? null : catalogo.edicion}
            alGuardar={() => {
              catalogo.cerrar();
              void catalogo.recargar();
            }}
            alCancelar={catalogo.cerrar}
          />
        )}
      </Ventana>

      {!catalogo.cargando && !catalogo.error && <SeccionDestinos sucursal={sucursal} cuentas={catalogo.items} />}
      {ventana}
    </div>
  );
}
