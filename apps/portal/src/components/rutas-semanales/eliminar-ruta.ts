import type { OpcionesConfirmar } from "@/components/ui/confirmar";
import { mensajeDe } from "@/lib/api";
import { eliminarRutaSemanal } from "@/lib/rutas-semanales";

export type ResultadoEliminar = { estado: "cancelada" } | { estado: "eliminada" } | { estado: "error"; mensaje: string };

/**
 * Confirma y elimina una ruta semanal (spec §4). Lo comparten la lista y la edición, para
 * que el texto de la confirmación y el mensaje del 409 (ruta en uso) sean uno solo.
 */
export async function confirmarYEliminarRuta(
  confirmar: (opciones: OpcionesConfirmar) => Promise<boolean>,
  ruta: { id: string; nombre: string },
): Promise<ResultadoEliminar> {
  if (
    !(await confirmar({
      titulo: `¿Eliminar la ruta ${ruta.nombre}?`,
      descripcion: "No se puede deshacer.",
      confirmar: "Eliminar",
    }))
  ) {
    return { estado: "cancelada" };
  }
  try {
    await eliminarRutaSemanal(ruta.id);
    return { estado: "eliminada" };
  } catch (err) {
    return { estado: "error", mensaje: mensajeDe(err, "No se pudo eliminar la ruta.") };
  }
}
