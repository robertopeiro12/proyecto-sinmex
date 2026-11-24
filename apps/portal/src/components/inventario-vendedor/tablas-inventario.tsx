"use client";

import { Fragment } from "react";
import { Ayuda } from "@/components/ui/ayuda";
import { Aviso } from "@/components/ui/aviso";
import { Pestanas } from "@/components/ui/pestanas";
import {
  CajaTabla,
  Fila,
  FilaGrupo,
  FilaTotal,
  FilaVacia,
  Tabla,
  Td,
  Th,
} from "@/components/ui/tabla";
import { fraseFaltan } from "@/lib/cortes";
import {
  gruposPorTamano,
  mermaRegistrada,
  textoEstadoRecarga,
  textoHora,
  type InventarioVendedor,
} from "@/lib/inventario-vendedor";

// Línea vertical entre bloques, la misma del Corte.
const SEPARADOR = "border-l-2 border-l-foreground/20";
const TITULO_BLOQUE =
  "text-xs font-semibold uppercase tracking-wide text-foreground";
// Alto de la primera fila del encabezado (32,5 px medidos a 1366 y 1920): la segunda se pega debajo.
const TOP2 = "top-[32.5px]";
const VACIO_INVENTARIO = "Sin carga aceptada ni venta ese día.";
const VACIO_RECARGAS = "No hubo recargas ese día.";

/**
 * Las tres sub-pestañas (Inventario · Recargas · Merma) de unos datos dados. No lee la URL
 * ni al usuario: la pantalla y el Dashboard le pasan `datos`. Nada se recalcula aquí; los
 * números vienen del servidor (`reglas-corte.ts`) y `null` es "corte sin hacer" → vacío.
 */
export function TablasInventario({ datos }: { datos: InventarioVendedor }) {
  const todos = datos.vendedor === null;
  return (
    <Pestanas
      etiqueta="Inventario por vendedor"
      pestanas={[
        {
          valor: "inventario",
          etiqueta: "Inventario",
          contenido: (
            <div className="flex flex-col gap-3">
              {todos && datos.vendedoresSinCorte > 0 && (
                <Aviso tono="advertencia">
                  {`${datos.vendedoresSinCorte} ${
                    datos.vendedoresSinCorte === 1 ? "vendedor sin corte" : "vendedores sin corte"
                  }: no entran en la validación por almacén.`}
                </Aviso>
              )}
              <TablaInventario datos={datos} />
            </div>
          ),
        },
        {
          valor: "recargas",
          etiqueta: "Recargas",
          contenido: <TablaRecargas datos={datos} />,
        },
        {
          valor: "merma",
          etiqueta: "Merma",
          contenido: <TablaMerma datos={datos} />,
        },
      ]}
    />
  );
}

function TablaInventario({ datos }: { datos: InventarioVendedor }) {
  const grupos = gruposPorTamano(datos.lineas);
  return (
    <CajaTabla>
      <Tabla aria-label="Inventario" className="table-fixed">
        {/* Producto con ancho proporcional y las 10 columnas de números se reparten el resto: al
            esconder el menú lateral crece toda la tabla, no solo Producto. */}
        <colgroup>
          <col className="w-[16%]" />
          {Array.from({ length: 10 }, (_, n) => (
            <col key={n} />
          ))}
        </colgroup>
        <thead>
          <tr>
            <Th rowSpan={2} className="align-bottom">
              Producto
            </Th>
            <Th colSpan={7} alinear="centro" className={`${SEPARADOR} ${TITULO_BLOQUE}`}>
              Operación del vendedor
            </Th>
            <Th colSpan={3} alinear="centro" className={`${SEPARADOR} ${TITULO_BLOQUE}`}>
              Validación por almacén
            </Th>
          </tr>
          <tr>
            <Th alinear="derecha" className={`${TOP2} whitespace-normal ${SEPARADOR}`}>
              Piezas cargadas
            </Th>
            <Th alinear="derecha" className={`${TOP2} whitespace-normal`}>
              Ventas
            </Th>
            <Th alinear="derecha" className={`${TOP2} whitespace-normal`}>
              Merma registrada en sistema
              <Ayuda
                tema="Merma registrada en sistema"
                texto="Merma entregada al cliente + merma de almacén."
              />
            </Th>
            <Th alinear="derecha" className={`${TOP2} whitespace-normal`}>
              Cambio físico entregado
              <Ayuda
                tema="Cambio físico entregado"
                texto="Los cambios físicos se registrarán desde la app; por ahora valen 0."
              />
            </Th>
            <Th alinear="derecha" className={`${TOP2} whitespace-normal`}>
              Cambio físico recibido
              <Ayuda
                tema="Cambio físico recibido"
                texto="Los cambios físicos se registrarán desde la app; por ahora valen 0."
              />
            </Th>
            <Th alinear="derecha" className={`${TOP2} whitespace-normal`}>
              Promoción
            </Th>
            <Th alinear="derecha" className={`${TOP2} whitespace-normal`}>
              Consumo
            </Th>
            <Th alinear="derecha" className={`${TOP2} whitespace-normal ${SEPARADOR}`}>
              Piezas teóricas por regresar
            </Th>
            <Th alinear="derecha" className={`${TOP2} whitespace-normal`}>
              Piezas reales retornadas
            </Th>
            <Th alinear="derecha" className={`${TOP2} whitespace-normal`}>
              Resultado
            </Th>
          </tr>
        </thead>
        <tbody>
          {grupos.length === 0 && <FilaVacia columnas={11}>{VACIO_INVENTARIO}</FilaVacia>}
          {grupos.map((g) => (
            <Fragment key={g.tamano}>
              <FilaGrupo columnas={11}>{g.tamano}</FilaGrupo>
              {g.lineas.map((l) => (
                <Fila key={l.presentacionId} className="align-middle">
                  <Td>
                    <span className="block truncate">{l.producto}</span>
                  </Td>
                  <Td alinear="derecha" className={SEPARADOR}>{l.cargadas}</Td>
                  <Td alinear="derecha">{l.vendidas}</Td>
                  <Td alinear="derecha">{mermaRegistrada(l)}</Td>
                  <Td alinear="derecha">{l.cambiosEntregados}</Td>
                  <Td alinear="derecha">{l.cambiosRecibidos}</Td>
                  <Td alinear="derecha">{l.regaladas}</Td>
                  <Td alinear="derecha">{l.consumo}</Td>
                  <Td alinear="derecha" className={SEPARADOR}>{l.deberiaRegresar}</Td>
                  <Td alinear="derecha">{l.buenas}</Td>
                  <Td alinear="derecha">
                    <Resultado valor={l.faltante} />
                  </Td>
                </Fila>
              ))}
              <FilaTotal>
                <Td>{`Total ${g.tamano}`}</Td>
                <Td alinear="derecha" className={SEPARADOR}>{g.totales.cargadas}</Td>
                <Td alinear="derecha">{g.totales.vendidas}</Td>
                <Td alinear="derecha">{g.totales.mermaEntregada + g.totales.mermaAlmacen}</Td>
                <Td alinear="derecha">{g.totales.cambiosEntregados}</Td>
                <Td alinear="derecha">{g.totales.cambiosRecibidos}</Td>
                <Td alinear="derecha">{g.totales.regaladas}</Td>
                <Td alinear="derecha">{g.totales.consumo}</Td>
                <Td alinear="derecha" className={SEPARADOR}>{g.totales.deberiaRegresar}</Td>
                <Td alinear="derecha">{g.totales.buenas}</Td>
                <Td alinear="derecha">
                  <Resultado valor={g.totales.faltante} />
                </Td>
              </FilaTotal>
            </Fragment>
          ))}
        </tbody>
        {grupos.length > 0 && (
          <tfoot>
            {/* Suma por tamaño solo lo que falta: lo manda el servidor, no es la suma de los resultados. */}
            <FilaTotal>
              <Td>Faltantes del día</Td>
              <Td colSpan={9} className={SEPARADOR} />
              <Td alinear="derecha" className="whitespace-nowrap">
                {(datos.totales.faltante ?? 0) > 0 && (
                  <span className="text-destructive">{fraseFaltan(datos.totales.faltante ?? 0, 0)}</span>
                )}
              </Td>
            </FilaTotal>
          </tfoot>
        )}
      </Tabla>
    </CajaTabla>
  );
}

function TablaMerma({ datos }: { datos: InventarioVendedor }) {
  const grupos = gruposPorTamano(datos.lineas);
  return (
    <CajaTabla>
      <Tabla aria-label="Merma" className="table-fixed">
        <colgroup>
          <col className="w-[24%]" />
          {[1, 2, 3, 4, 5].map((n) => (
            <col key={n} />
          ))}
        </colgroup>
        <thead>
          <tr>
            <Th rowSpan={2} className="align-bottom">
              Producto
            </Th>
            <Th colSpan={2} alinear="centro" className={`${SEPARADOR} ${TITULO_BLOQUE}`}>
              Operación del vendedor
            </Th>
            <Th colSpan={3} alinear="centro" className={`${SEPARADOR} ${TITULO_BLOQUE}`}>
              Validación por almacén
            </Th>
          </tr>
          <tr>
            <Th alinear="derecha" className={`${TOP2} whitespace-normal ${SEPARADOR}`}>
              Merma recibida del cliente
            </Th>
            <Th alinear="derecha" className={`${TOP2} whitespace-normal`}>
              Merma de almacén
            </Th>
            <Th alinear="derecha" className={`${TOP2} whitespace-normal ${SEPARADOR}`}>
              Merma teórica por regresar
              <Ayuda
                tema="Merma teórica por regresar"
                texto="Merma recibida del cliente + merma de almacén."
              />
            </Th>
            <Th alinear="derecha" className={`${TOP2} whitespace-normal`}>
              Merma real validada
            </Th>
            <Th alinear="derecha" className={`${TOP2} whitespace-normal`}>
              Resultado
            </Th>
          </tr>
        </thead>
        <tbody>
          {grupos.length === 0 && <FilaVacia columnas={6}>{VACIO_INVENTARIO}</FilaVacia>}
          {grupos.map((g) => (
            <Fragment key={g.tamano}>
              <FilaGrupo columnas={6}>{g.tamano}</FilaGrupo>
              {g.lineas.map((l) => (
                <Fila key={l.presentacionId} className="align-middle">
                  <Td>
                    <span className="block truncate">{l.producto}</span>
                  </Td>
                  <Td alinear="derecha" className={SEPARADOR}>{l.mermaRecibida}</Td>
                  <Td alinear="derecha">{l.mermaAlmacen}</Td>
                  <Td alinear="derecha" className={SEPARADOR}>{l.mermaTeorica}</Td>
                  <Td alinear="derecha">{l.merma}</Td>
                  <Td alinear="derecha">
                    <Resultado valor={l.resultadoMerma} />
                  </Td>
                </Fila>
              ))}
              <FilaTotal>
                <Td>{`Total ${g.tamano}`}</Td>
                <Td alinear="derecha" className={SEPARADOR}>{g.totales.mermaRecibida}</Td>
                <Td alinear="derecha">{g.totales.mermaAlmacen}</Td>
                <Td alinear="derecha" className={SEPARADOR}>{g.totales.mermaTeorica}</Td>
                <Td alinear="derecha">{g.totales.merma}</Td>
                <Td alinear="derecha">
                  <Resultado valor={g.totales.resultadoMerma} />
                </Td>
              </FilaTotal>
            </Fragment>
          ))}
        </tbody>
        {grupos.length > 0 && (
          <tfoot>
            {/* Suma por tamaño solo lo que falta: lo manda el servidor, no es la suma de los resultados. */}
            <FilaTotal>
              <Td>Faltantes del día</Td>
              <Td colSpan={4} className={SEPARADOR} />
              <Td alinear="derecha" className="whitespace-nowrap">
                {(datos.totales.faltanteMerma ?? 0) > 0 && (
                  <span className="text-destructive">{fraseFaltan(0, datos.totales.faltanteMerma ?? 0)}</span>
                )}
              </Td>
            </FilaTotal>
          </tfoot>
        )}
      </Tabla>
    </CajaTabla>
  );
}

function TablaRecargas({ datos }: { datos: InventarioVendedor }) {
  const conVendedor = datos.vendedor === null;
  const columnas = conVendedor ? 6 : 5;
  return (
    <CajaTabla>
      <Tabla aria-label="Recargas" className="table-fixed">
        <colgroup>
          {conVendedor && <col className="w-[16%]" />}
          <col className="w-[22%]" />
          <col className="w-[20%]" />
          <col className="w-[12%]" />
          <col className="w-[12%]" />
          <col />
        </colgroup>
        <thead>
          <tr>
            {conVendedor && <Th>Vendedor</Th>}
            <Th>Producto</Th>
            <Th>Usuario recarga/respuesta</Th>
            <Th alinear="derecha">Piezas cargadas</Th>
            <Th>Hora de recarga</Th>
            <Th>Estado</Th>
          </tr>
        </thead>
        <tbody>
          {datos.recargas.length === 0 && (
            <FilaVacia columnas={columnas}>{VACIO_RECARGAS}</FilaVacia>
          )}
          {datos.recargas.map((r) => (
            <Fila key={`${r.cargaId}-${r.presentacionId}`} className="align-middle">
              {conVendedor && <Td className="truncate">{r.vendedor}</Td>}
              <Td className="truncate">{r.nombre}</Td>
              <Td className="truncate">{r.capturo}</Td>
              <Td alinear="derecha">{r.piezas}</Td>
              <Td>{textoHora(r.hora)}</Td>
              <Td>
                {textoEstadoRecarga(r)}
                {r.estado === "rechazada" && r.motivoRechazo && (
                  <span className="block text-xs text-destructive">
                    {`Motivo: ${r.motivoRechazo}`}
                  </span>
                )}
              </Td>
            </Fila>
          ))}
        </tbody>
      </Tabla>
    </CajaTabla>
  );
}

/** > 0 falta: rojo y negrita; < 0 sobra, en gris; `null` (corte sin hacer), vacío. */
function Resultado({ valor }: { valor: number | null }) {
  if (valor === null) return null;
  if (valor > 0)
    return <span className="font-semibold text-destructive">{valor}</span>;
  return <span className="text-muted-foreground">{valor}</span>;
}
