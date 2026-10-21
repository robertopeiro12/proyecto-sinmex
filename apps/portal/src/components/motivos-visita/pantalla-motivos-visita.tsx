"use client";

import { PantallaCatalogo } from "@/components/catalogo/pantalla-catalogo";
import {
  eliminarMotivoVisita,
  listarMotivosVisita,
  PERMISO_MOTIVOS_VISITA,
  type MotivoVisita,
} from "@/lib/motivos-visita";
import { FormularioMotivoVisita } from "./formulario-motivo-visita";

const siNo = (valor: boolean) => (valor ? "Sí" : "No");

/**
 * Catálogo › Motivos de visita (T-39, D5): por qué un cliente no compró. Leer pide
 * sesión; dar de alta, editar y dar de baja (lógica, con confirmación) pide
 * `motivo_visita.gestionar`. Sobre la pantalla compartida de catálogos, igual que Campos de egreso.
 */
export function PantallaMotivosVisita() {
  return (
    <PantallaCatalogo<MotivoVisita>
      titulo="Motivos de visita"
      descripcion="Por qué un cliente no compró; lo elige el vendedor en la app."
      permiso={PERMISO_MOTIVOS_VISITA}
      etiquetaAlta="Nuevo motivo"
      tituloFormulario={(m) => (m ? `Editar ${m.nombre}` : "Nuevo motivo")}
      vacio="Todavía no hay motivos de visita. Da de alta el primero."
      mensajeError="No se pudieron cargar los motivos de visita."
      cargar={() => listarMotivosVisita()}
      columnas={[
        { encabezado: "Motivo", celda: (m) => m.nombre },
        { encabezado: "Exige foto", celda: (m) => siNo(m.exigeFoto), className: "whitespace-nowrap" },
        { encabezado: "Exige nombre", celda: (m) => siNo(m.exigeAtendio), className: "whitespace-nowrap" },
      ]}
      baja={{
        etiqueta: "Eliminar",
        confirmar: (m) => ({
          titulo: `¿Eliminar el motivo "${m.nombre}"?`,
          descripcion: "Las visitas ya registradas lo conservan, pero las tablets dejarán de ofrecerlo.",
          confirmar: "Eliminar motivo",
          tono: "peligro",
        }),
        ejecutar: async (m) => {
          await eliminarMotivoVisita(m.id);
        },
        mensajeError: "No se pudo eliminar el motivo.",
      }}
      formulario={(item, alGuardar, alCancelar) => (
        <FormularioMotivoVisita motivo={item} alGuardar={alGuardar} alCancelar={alCancelar} />
      )}
    />
  );
}
