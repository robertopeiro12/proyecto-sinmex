"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Aviso } from "@/components/ui/aviso";
import { useConfirmar, type OpcionesConfirmar } from "@/components/ui/confirmar";
import { EncabezadoPantalla, Pantalla } from "@/components/ui/encabezado-pantalla";
import { EstadoPantalla } from "@/components/ui/estado-pantalla";
import { CajaTabla } from "@/components/ui/tabla";
import { Ventana } from "@/components/ui/ventana";
import { useAuth } from "@/components/auth/auth-provider";
import { mensajeDe } from "@/lib/api";
import { TablaCatalogo, type Columna } from "./tabla-catalogo";
import { useCatalogo } from "./use-catalogo";

interface Props<T> {
  titulo: string;
  /** La línea de para qué sirve la pantalla (spec Etapa 2, §4.1). */
  descripcion?: string;
  /** Clave que habilita alta y edicion, p.ej. "producto.gestionar". */
  permiso: string;
  etiquetaAlta: string;
  vacio: string;
  mensajeError: string;
  cargar: () => Promise<T[]>;
  columnas: Columna<T>[];
  formulario: (
    item: T | null,
    alGuardar: () => void,
    alCancelar: () => void,
  ) => ReactNode;
  /** El título de la ventana: "Nuevo producto" / "Editar Jamaica". Obligatorio en modo "ventana". */
  tituloFormulario?: (item: T | null) => string;
  /**
   * "ventana" (por omisión): el formulario sale en una `Ventana` encima de la lista.
   * "pantalla": el formulario reemplaza a la lista, con "← Volver"; para los formularios
   * largos (Promociones, hasta su etapa).
   */
  formularioEn?: "ventana" | "pantalla";
  /** Dar de baja opcional: un botón junto a "Editar" que pregunta antes con `useConfirmar`. */
  baja?: {
    /** "Dar de baja" por omisión. */
    etiqueta?: string;
    confirmar: (item: T) => OpcionesConfirmar;
    ejecutar: (item: T) => Promise<void>;
    /** Si el error no trae mensaje del servidor. */
    mensajeError: string;
  };
  /** Recarga cuando algo de aqui cambie. Ver useCatalogo. */
  deps?: unknown[];
}

/**
 * El envoltorio que arma una pantalla de catalogo entera. Por dentro son
 * piezas sueltas (useCatalogo + TablaCatalogo) a proposito: T-12 Clientes
 * probablemente no quepa aqui —lleva filtros, lista de precios, promocion y
 * credito— y cuando pase, baja al hook sin tener que inflar este componente
 * con props que solo usa el, ni duplicar la logica (D9).
 */
export function PantallaCatalogo<T extends { id: string }>({
  titulo,
  descripcion,
  permiso,
  etiquetaAlta,
  vacio,
  mensajeError,
  cargar,
  columnas,
  formulario,
  tituloFormulario,
  formularioEn = "ventana",
  baja,
  deps = [],
}: Props<T>) {
  const { puede } = useAuth();
  const puedeGestionar = puede(permiso);
  const catalogo = useCatalogo<T>(cargar, { mensajeError, deps });
  const { confirmar, ventana } = useConfirmar();
  const [eliminando, setEliminando] = useState<string | null>(null);
  const [errorBaja, setErrorBaja] = useState<string | null>(null);
  const ocupado = catalogo.edicion !== null || eliminando !== null;

  // Cada apertura del formulario lleva su número. Si la ventana se cerró (Esc, clic fuera)
  // con el guardado en vuelo y luego se abrió otra, la respuesta tardía de la primera recarga
  // la lista pero no cierra la de ahora. El título se guarda al abrir para que no cambie
  // durante la animación de salida, cuando `edicion` ya es null.
  const [apertura, setApertura] = useState({ numero: 0, titulo: "" });
  const vigente = useRef(0);

  // El aviso de una baja fallida es de la lista que se miraba: cambiar de sucursal lo quita.
  useEffect(() => {
    setErrorBaja(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  const abrir = (item: T | null) => {
    setErrorBaja(null);
    vigente.current += 1;
    setApertura({ numero: vigente.current, titulo: tituloFormulario?.(item) ?? etiquetaAlta });
    if (item === null) catalogo.abrirAlta();
    else catalogo.abrirEdicion(item);
  };

  const cerrar = () => {
    vigente.current += 1;
    catalogo.cerrar();
  };

  const alGuardar = () => {
    if (vigente.current === apertura.numero) cerrar();
    void catalogo.recargar();
  };

  async function darDeBaja(item: T) {
    if (!baja || !(await confirmar(baja.confirmar(item)))) return;
    setEliminando(item.id);
    setErrorBaja(null);
    try {
      await baja.ejecutar(item);
      void catalogo.recargar();
    } catch (err) {
      // El mensaje del servidor tal cual: el 409 de Campos de egreso dice cuándo se podrá.
      setErrorBaja(mensajeDe(err, baja.mensajeError));
    } finally {
      setEliminando(null);
    }
  }

  const contenidoFormulario = catalogo.edicion !== null && (
    <div
      // Sin `key` React reutiliza la misma instancia del formulario al
      // pasar de "editar A" a "editar B": sus useState solo leen el prop
      // en el primer montaje, asi que los campos se quedarian con los
      // valores viejos de A. Lo descubrio T-09 y aqui se hereda para todas
      // las pantallas de catalogo.
      key={catalogo.edicion === "nueva" ? "nueva" : catalogo.edicion.id}
    >
      {formulario(catalogo.edicion === "nueva" ? null : catalogo.edicion, alGuardar, cerrar)}
    </div>
  );

  if (formularioEn === "pantalla" && catalogo.edicion !== null) {
    return (
      <Pantalla>
        <Button variant="ghost" className="self-start" onClick={cerrar}>
          ← Volver a {titulo.toLowerCase()}
        </Button>
        {contenidoFormulario}
      </Pantalla>
    );
  }

  const error = catalogo.error ?? errorBaja;

  return (
    <Pantalla>
      <EncabezadoPantalla
        titulo={titulo}
        descripcion={descripcion}
        acciones={
          puedeGestionar && (
            <Button disabled={ocupado} onClick={() => abrir(null)}>
              {etiquetaAlta}
            </Button>
          )
        }
      />

      {error && <Aviso tono="error">{error}</Aviso>}

      {catalogo.cargando && <EstadoPantalla tipo="cargando" />}

      {!catalogo.cargando && !catalogo.error && (
        <CajaTabla>
          <TablaCatalogo
            items={catalogo.items}
            columnas={columnas}
            vacio={vacio}
            acciones={
              puedeGestionar
                ? (item) => (
                    <div className="flex justify-end gap-2">
                      <Button variant="outline" size="sm" disabled={ocupado} onClick={() => abrir(item)}>
                        Editar
                      </Button>
                      {baja && (
                        <Button variant="outline" size="sm" disabled={ocupado} onClick={() => void darDeBaja(item)}>
                          {eliminando === item.id ? "Eliminando…" : (baja.etiqueta ?? "Dar de baja")}
                        </Button>
                      )}
                    </div>
                  )
                : undefined
            }
          />
        </CajaTabla>
      )}

      {formularioEn === "ventana" && (
        <Ventana abierta={catalogo.edicion !== null} titulo={apertura.titulo} alCerrar={cerrar}>
          {contenidoFormulario}
        </Ventana>
      )}

      {ventana}
    </Pantalla>
  );
}
