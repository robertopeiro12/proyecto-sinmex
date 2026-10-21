"use client";

import { PantallaCatalogo } from "@/components/catalogo/pantalla-catalogo";
import {
  eliminarCampoEgreso,
  ETIQUETA_TIPO_EGRESO,
  listarCamposEgreso,
  PERMISO_CAMPOS_EGRESO,
  type CampoEgreso,
} from "@/lib/campos-egreso";
import { FormularioCampoEgreso } from "./formulario-campo-egreso";

const siNo = (valor: boolean) => (valor ? "Sí" : "No");

/**
 * Catálogo › Campos de egreso (T-30, D3): en qué se gasta el dinero (gasolina, hielo, envases…). Leer pide
 * sesión; dar de alta, editar y dar de baja (lógica, con confirmación) pide `campo_egreso.gestionar`. Mismo
 * patrón que Motivos de visita (T-39), sobre la pantalla compartida de catálogos. La baja la rechaza el
 * servidor con 409 si el campo tiene gastos este año; el motivo se muestra tal cual.
 */
export function PantallaCamposEgreso() {
  return (
    <PantallaCatalogo<CampoEgreso>
      titulo="Campos de egreso"
      descripcion="Los conceptos de gasto, de qué tipo son y si salen en la app."
      permiso={PERMISO_CAMPOS_EGRESO}
      etiquetaAlta="Nuevo campo"
      tituloFormulario={(c) => (c ? `Editar ${c.nombre}` : "Nuevo campo")}
      vacio="Todavía no hay campos de egreso. Da de alta el primero."
      mensajeError="No se pudieron cargar los campos de egreso."
      cargar={() => listarCamposEgreso()}
      columnas={[
        { encabezado: "Nombre", celda: (c) => c.nombre },
        { encabezado: "Tipo", celda: (c) => ETIQUETA_TIPO_EGRESO[c.tipo], className: "whitespace-nowrap" },
        { encabezado: "Se usa en la app", celda: (c) => siNo(c.seUsaEnApp), className: "whitespace-nowrap" },
      ]}
      baja={{
        etiqueta: "Eliminar",
        confirmar: (c) => ({
          titulo: `¿Eliminar el campo "${c.nombre}"?`,
          descripcion: "Los gastos ya registrados lo conservan, pero las tablets dejarán de ofrecerlo.",
          confirmar: "Eliminar campo",
          tono: "peligro",
        }),
        ejecutar: async (c) => {
          await eliminarCampoEgreso(c.id);
        },
        mensajeError: "No se pudo eliminar el campo.",
      }}
      formulario={(item, alGuardar, alCancelar) => (
        <FormularioCampoEgreso campo={item} alGuardar={alGuardar} alCancelar={alCancelar} />
      )}
    />
  );
}
