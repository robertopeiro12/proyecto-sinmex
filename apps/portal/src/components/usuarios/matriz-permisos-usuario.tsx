"use client";

import type { Permiso } from "@/lib/usuarios";

interface Props {
  /** Ya viene ordenado por grupo desde el backend (PerfilesRepository.catalogoPermisos, T-08b). */
  catalogo: Permiso[];
  marcados: Set<string>;
  onCambiar: (clave: string, marcado: boolean) => void;
  /** D4: perfil maestro elegido -- todo aparece marcado y sin poder tocarse. */
  disabled: boolean;
}

/**
 * D3 del spec: cada checkbox nace precargado con lo que da el perfil
 * elegido (el padre inicializa `marcados` así) y el administrador lo
 * cambia como cualquier checkbox normal -- sin un tercer estado "Hereda"
 * visible (decisión explícita de Roberto: un tercer estado confundiría).
 *
 * Etiqueta = clave (compacta -- unas ~25 filas en una lista dentro de un
 * formulario no tienen el espacio de columnas que sí tiene la tabla de
 * Perfiles y Permisos, T-08b) + ícono (i) con `descripcion` en el atributo
 * `title` nativo del navegador (D9): sin dependencia nueva de tooltip.
 */
export function MatrizPermisosUsuario({ catalogo, marcados, onCambiar, disabled }: Props) {
  // Set preserva el orden de insercion: como `catalogo` ya viene agrupado
  // por `grupo` desde el backend, esto no reordena nada, solo enumera los
  // grupos una vez cada uno.
  const grupos = [...new Set(catalogo.map((p) => p.grupo))];

  return (
    <div className="flex flex-col gap-4">
      {grupos.map((grupo) => (
        <div key={grupo}>
          <p className="mb-1 text-xs font-semibold text-muted-foreground">{grupo}</p>
          <div className="flex flex-col gap-1">
            {catalogo
              .filter((p) => p.grupo === grupo)
              .map((permiso) => (
                <label key={permiso.id} className="flex items-center gap-1.5 text-sm">
                  <input
                    type="checkbox"
                    disabled={disabled}
                    checked={disabled ? true : marcados.has(permiso.clave)}
                    onChange={(e) => onCambiar(permiso.clave, e.target.checked)}
                  />
                  <span className="font-mono">{permiso.clave}</span>
                  {permiso.descripcion && (
                    <span
                      role="img"
                      title={permiso.descripcion}
                      aria-label={permiso.descripcion}
                      className="cursor-help text-muted-foreground"
                    >
                      ⓘ
                    </span>
                  )}
                </label>
              ))}
          </div>
        </div>
      ))}
    </div>
  );
}
