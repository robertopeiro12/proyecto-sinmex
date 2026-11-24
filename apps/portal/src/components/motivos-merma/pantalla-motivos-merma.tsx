"use client";

import { PantallaCatalogo } from "@/components/catalogo/pantalla-catalogo";
import {
  eliminarMotivoMerma,
  listarMotivosMerma,
  PERMISO_MOTIVOS_MERMA,
  type MotivoMerma,
} from "@/lib/motivos-merma";
import { FormularioMotivoMerma } from "./formulario-motivo-merma";

const siNo = (valor: boolean) => (valor ? "Sí" : "No");

/**
 * Catálogo › Motivos de merma (Registro de Operación, D7): por qué se pierde producto,
 * en el almacén, con un cliente o en el vehículo. Leer pide sesión; alta, edición y baja
 * (lógica, con confirmación) piden `motivo_merma.gestionar`.
 */
export function PantallaMotivosMerma() {
  return (
    <PantallaCatalogo<MotivoMerma>
      titulo="Motivos de merma"
      descripcion="Por qué se pierde producto; se elige al registrar una merma."
      permiso={PERMISO_MOTIVOS_MERMA}
      etiquetaAlta="Nuevo motivo"
      tituloFormulario={(m) => (m ? `Editar ${m.nombre}` : "Nuevo motivo")}
      vacio="Todavía no hay motivos de merma. Da de alta el primero."
      mensajeError="No se pudieron cargar los motivos de merma."
      cargar={() => listarMotivosMerma()}
      columnas={[
        { encabezado: "Motivo", celda: (m) => m.nombre },
        { encabezado: "Almacén", celda: (m) => siNo(m.aplicaAlmacen), className: "whitespace-nowrap" },
        { encabezado: "Cliente", celda: (m) => siNo(m.aplicaCliente), className: "whitespace-nowrap" },
        { encabezado: "Vehículo", celda: (m) => siNo(m.aplicaVehiculo), className: "whitespace-nowrap" },
      ]}
      baja={{
        etiqueta: "Eliminar",
        confirmar: (m) => ({
          titulo: `¿Eliminar el motivo "${m.nombre}"?`,
          descripcion: "Las mermas ya registradas lo conservan, pero ya no se podrá elegir en las nuevas.",
          confirmar: "Eliminar motivo",
          tono: "peligro",
        }),
        ejecutar: async (m) => {
          await eliminarMotivoMerma(m.id);
        },
        mensajeError: "No se pudo eliminar el motivo.",
      }}
      formulario={(item, alGuardar, alCancelar) => (
        <FormularioMotivoMerma motivo={item} alGuardar={alGuardar} alCancelar={alCancelar} />
      )}
    />
  );
}
