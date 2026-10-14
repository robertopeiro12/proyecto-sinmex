"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/components/auth/auth-provider";
import { FormularioPromocion } from "@/components/promociones/formulario-promocion";
import { mensajeDe } from "@/lib/api";
import { editarPromocion, listarPromociones, type Promocion } from "@/lib/promociones";

interface Props {
  clienteId: string;
  clienteNombre: string;
}

// Solo viajan la regla y `activo`: la API no deja cambiar sucursal, audiencia ni cliente.
// Los `null` de la lectura se vuelven `undefined` porque el DTO de escritura omite lo que no aplica.
function reglaConActivo(p: Promocion, activo: boolean) {
  return {
    compraTipo: p.compraTipo,
    compraProductoId: p.compraProductoId ?? undefined,
    compraPresentacionId: p.compraPresentacionId ?? undefined,
    compraCantidad: p.compraCantidad,
    regaloTipo: p.regaloTipo,
    regaloProductoId: p.regaloProductoId ?? undefined,
    regaloPresentacionId: p.regaloPresentacionId ?? undefined,
    regaloCantidad: p.regaloCantidad,
    seRepite: p.seRepite,
    activo,
  };
}

/**
 * Las promociones de un cliente (T-74, D10): las suyas, que se editan aquí, y las generales de su
 * sucursal, que solo se muestran (atenuadas) para que se vea qué le toca de verdad. Reemplaza al
 * enum `promocion` del cliente.
 */
export function PromocionesDeCliente({ clienteId, clienteNombre }: Props) {
  const { puede } = useAuth();
  const permitido = puede("promocion.gestionar");

  const [promociones, setPromociones] = useState<Promocion[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editando, setEditando] = useState<Promocion | "nueva" | null>(null);

  const recargar = useCallback(async () => {
    try {
      setPromociones(await listarPromociones({ clienteId }));
      setError(null);
    } catch (err) {
      setError(mensajeDe(err, "No se pudieron cargar las promociones."));
    }
  }, [clienteId]);

  useEffect(() => {
    if (!permitido) return;
    // `vigente`: si el formulario cambia de cliente a mitad de la carga, la respuesta vieja no pisa.
    let vigente = true;
    listarPromociones({ clienteId })
      .then((lista) => {
        if (vigente) {
          setPromociones(lista);
          setError(null);
        }
      })
      .catch((err) => {
        if (vigente) setError(mensajeDe(err, "No se pudieron cargar las promociones."));
      });
    return () => {
      vigente = false;
    };
  }, [clienteId, permitido]);

  // La API contesta 403 sin este permiso: ni se pide ni se pinta.
  if (!permitido) return null;

  async function alternar(p: Promocion) {
    try {
      await editarPromocion(p.id, reglaConActivo(p, !p.activo));
      await recargar();
    } catch (err) {
      setError(mensajeDe(err, "No se pudo cambiar la promoción."));
    }
  }

  async function alGuardar() {
    setEditando(null);
    await recargar();
  }

  const propias = promociones.filter((p) => p.audiencia === "cliente");
  // Las de `todos` y, si es un prospecto sin primera venta, la de bienvenida (la API decide cuáles).
  const generales = promociones.filter((p) => p.audiencia !== "cliente");

  return (
    <section className="mb-6 flex flex-col gap-4 rounded-md border p-4">
      <h3 className="text-sm font-semibold">Promociones de este cliente</h3>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      {propias.length === 0 ? (
        <p className="text-sm text-muted-foreground">Este cliente no tiene promociones propias.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {propias.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-3 text-sm">
              <span className={p.activo ? undefined : "text-muted-foreground"}>{p.texto}</span>
              <span className="text-xs text-muted-foreground">{p.activo ? "Activa" : "Inactiva"}</span>
              <Button type="button" size="sm" variant="outline" onClick={() => setEditando(p)}>
                Editar
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={() => alternar(p)}>
                {p.activo ? "Desactivar" : "Reactivar"}
              </Button>
            </li>
          ))}
        </ul>
      )}

      {generales.length > 0 && (
        <div>
          <h4 className="mb-2 text-sm font-medium">Generales de su sucursal</h4>
          <ul className="flex flex-col gap-1">
            {generales.map((p) => (
              <li key={p.id} className="text-sm text-muted-foreground opacity-60">
                {p.texto}
                {p.desplazada && " (desplazada por una propia)"}
                {!p.activo && " · Inactiva"}
              </li>
            ))}
          </ul>
        </div>
      )}

      {editando !== null ? (
        <FormularioPromocion
          promocion={editando === "nueva" ? null : editando}
          contexto={{ tipo: "cliente", clienteId, clienteNombre }}
          alGuardar={alGuardar}
          alCancelar={() => setEditando(null)}
        />
      ) : (
        <div>
          <Button type="button" variant="outline" onClick={() => setEditando("nueva")}>
            Nueva promoción para este cliente
          </Button>
        </div>
      )}
    </section>
  );
}
