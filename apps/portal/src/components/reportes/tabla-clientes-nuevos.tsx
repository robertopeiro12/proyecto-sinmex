import { CajaTabla, Fila, Tabla, Td, Th } from "@/components/ui/tabla";
import { formatearFecha } from "@/lib/reportes";
import { nombreConBaja, type ClienteNuevo } from "@/lib/reporte-clientes-nuevos";

/*
 * Una sola tabla `table-fixed` (T-51), con lo aprendido en T-49: letra de 13 px y
 * anchos que caben desde 1366 px de ventana (Cliente es la columna flexible). Los
 * anchos se midieron con celdas de `px-2`; las piezas comunes llevan `px-3`, así que
 * aquí se vuelve a `px-2`. Textos largos se cortan con `title`.
 */
const TH = "bg-background px-2 py-2 font-medium text-foreground";
const TD = "px-2 py-1.5";

function Texto({ valor }: { valor: string | null }) {
  const texto = valor ?? "—";
  return (
    <Td className={`${TD} truncate`} title={valor ?? undefined}>
      {texto}
    </Td>
  );
}

export function TablaClientesNuevos({ clientes }: { clientes: ClienteNuevo[] }) {
  return (
    <CajaTabla altoMaximo="70vh" className="w-0 min-w-full">
      <Tabla aria-label="Clientes nuevos" className="min-w-[61rem] table-fixed text-[13px]">
        <colgroup>
          <col className="w-25" />
          <col />
          <col className="w-18" />
          <col className="w-28" />
          <col className="w-28" />
          <col className="w-27" />
          <col className="w-28" />
          <col className="w-28" />
          <col className="w-28" />
        </colgroup>
        <thead>
          <tr>
            <Th className={TH}>Fecha de alta</Th>
            <Th className={TH}>Cliente</Th>
            <Th className={TH}>Sucursal</Th>
            <Th className={TH}>Tipo de negocio</Th>
            <Th className={TH}>Lista de precios</Th>
            <Th className={TH}>Teléfono</Th>
            <Th className={TH}>Encargado</Th>
            <Th className={TH}>Usuario</Th>
            <Th className={TH}>Prospectó</Th>
          </tr>
        </thead>
        <tbody>
          {clientes.map((c) => (
            <Fila key={c.id}>
              <Td className={TD}>{formatearFecha(c.fechaAlta)}</Td>
              <Texto valor={nombreConBaja(c)} />
              <Td className={TD}>{c.sucursalCodigo}</Td>
              <Texto valor={c.tipoNegocio} />
              <Texto valor={c.listaPrecio} />
              <Texto valor={c.telefono} />
              <Texto valor={c.encargado} />
              <Texto valor={c.usuario} />
              <Texto valor={c.prospecto} />
            </Fila>
          ))}
        </tbody>
      </Tabla>
    </CajaTabla>
  );
}
