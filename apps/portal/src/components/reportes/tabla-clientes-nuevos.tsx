import { formatearFecha } from "@/lib/reportes";
import { nombreConBaja, type ClienteNuevo } from "@/lib/reporte-clientes-nuevos";

/*
 * Una sola tabla `table-fixed` (T-51), con lo aprendido en T-49: letra de 13 px,
 * el mismo relleno en toda celda y anchos que caben desde 1366 px de ventana
 * (Cliente es la columna flexible). Textos largos se cortan con `title`.
 */
const TH = "sticky top-0 bg-background px-2 py-2 font-medium shadow-[inset_0_-1px_0_var(--border)]";
const TD = "px-2 py-1.5";

function Texto({ valor }: { valor: string | null }) {
  const texto = valor ?? "—";
  return (
    <td className={`${TD} truncate`} title={valor ?? undefined}>
      {texto}
    </td>
  );
}

export function TablaClientesNuevos({ clientes }: { clientes: ClienteNuevo[] }) {
  return (
    <div className="w-0 min-w-full max-h-[70vh] overflow-auto rounded-md border">
      <table aria-label="Clientes nuevos" className="w-full min-w-[60rem] table-fixed text-[13px]">
        <colgroup>
          <col className="w-26" />
          <col />
          <col className="w-18" />
          <col className="w-32" />
          <col className="w-30" />
          <col className="w-28" />
          <col className="w-36" />
          <col className="w-36" />
        </colgroup>
        <thead className="text-left">
          <tr>
            <th className={TH}>Fecha de alta</th>
            <th className={TH}>Cliente</th>
            <th className={TH}>Sucursal</th>
            <th className={TH}>Tipo de negocio</th>
            <th className={TH}>Lista de precios</th>
            <th className={TH}>Teléfono</th>
            <th className={TH}>Encargado</th>
            <th className={TH}>Usuario</th>
          </tr>
        </thead>
        <tbody>
          {clientes.map((c) => (
            <tr key={c.id} className="border-t">
              <td className={TD}>{formatearFecha(c.fechaAlta)}</td>
              <Texto valor={nombreConBaja(c)} />
              <td className={TD}>{c.sucursalCodigo}</td>
              <Texto valor={c.tipoNegocio} />
              <Texto valor={c.listaPrecio} />
              <td className={TD}>{c.telefono}</td>
              <Texto valor={c.encargado} />
              <Texto valor={c.usuario} />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
