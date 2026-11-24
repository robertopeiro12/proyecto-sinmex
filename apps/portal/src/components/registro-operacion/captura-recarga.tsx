"use client";

import { useMemo, useState } from "react";
import { Aviso } from "@/components/ui/aviso";
import { Button } from "@/components/ui/button";
import { Campo, Entrada, Lista } from "@/components/ui/campo";
import { EncabezadoPantalla, Pantalla } from "@/components/ui/encabezado-pantalla";
import { CajaTabla, Fila, Tabla, Td, Th } from "@/components/ui/tabla";
import { ErrorApi, mensajeDe } from "@/lib/api";
import {
  borradorDe,
  crearCarga,
  editarCarga,
  leerBorrador,
  MAX_PIEZAS_LINEA,
  totalBorrador,
  type Borrador,
  type CargaRejilla,
  type Rejilla,
} from "@/lib/cargas";
import { claveTamano } from "@/lib/cortes";
import { agruparPorTamano, type Renglon } from "./captura-operacion";

const piezasValidas = (texto: string) => /^\d+$/.test(texto) && Number(texto) <= MAX_PIEZAS_LINEA;

/**
 * Captura o corrección de una recarga de HOY, en pantalla completa: el vendedor arriba y la
 * rejilla de todas las presentaciones activas por tamaño (TAB pasa al siguiente campo).
 */
export function CapturaRecarga({
  rejilla,
  carga,
  vendedorId,
  onVolver,
  onGuardado,
}: {
  rejilla: Rejilla;
  carga: CargaRejilla | null;
  vendedorId: string;
  onVolver: () => void;
  /** Avisa con el texto para la lista. */
  onGuardado: (aviso: string) => void;
}) {
  const [vendedor, setVendedor] = useState(vendedorId);
  const [borrador, setBorrador] = useState<Borrador>(() => borradorDe(carga, rejilla.presentaciones));
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const grupos = useMemo(() => {
    const renglones: Renglon[] = rejilla.presentaciones
      .filter((p) => p.activa)
      .map((p) => ({ presentacionId: p.id, nombre: `${p.productoNombre} ${p.volumen}`, producto: p.productoNombre, volumen: p.volumen }));
    return agruparPorTamano(renglones);
  }, [rejilla]);

  const hayInvalidas = Object.values(borrador).some((t) => t.trim() !== "" && !piezasValidas(t.trim()));
  const total = totalBorrador(borrador);
  const puedeGuardar = !guardando && vendedor !== "" && total > 0 && !hayInvalidas;

  async function guardar() {
    const { lineas, error: errorBorrador } = leerBorrador(borrador);
    if (errorBorrador !== null) {
      setError(errorBorrador);
      return;
    }
    setGuardando(true);
    setError(null);
    try {
      if (carga) await editarCarga(carga.id, { version: carga.version, lineas });
      else await crearCarga({ vendedorId: vendedor, lineas });
      onGuardado("Recarga guardada. Le llega al vendedor cuando sincronice.");
    } catch (err) {
      const mensaje = mensajeDe(err, "No se pudo guardar la recarga. Vuelve a intentar.");
      if (err instanceof ErrorApi && err.status === 409) {
        // Lo capturado ya no aplica a la carga actual: se vuelve a la lista con lo que hay.
        onGuardado(mensaje);
      } else {
        setError(mensaje);
        setGuardando(false);
      }
    }
  }

  return (
    <Pantalla key="captura-recarga">
      <div>
        <Button type="button" variant="ghost" size="sm" onClick={onVolver}>
          ← Volver a Recargas
        </Button>
      </div>
      <EncabezadoPantalla
        titulo={carga ? `Corregir · Recarga n.º ${carga.numero}` : "Registrar · Recarga"}
        descripcion={`Sucursal ${rejilla.sucursal.codigo}, hoy. Captura solo las piezas que lleva; deja en blanco el resto.`}
      />

      <div className="flex flex-wrap items-start gap-4">
        <Campo id="recarga-vendedor" etiqueta="Vendedor" className="w-72">
          <Lista value={vendedor} disabled={carga !== null} onChange={(e) => setVendedor(e.target.value)}>
            <option value="">Elige uno…</option>
            {rejilla.vendedores.map((v) => (
              <option key={v.id} value={v.id}>
                {v.nombre}
              </option>
            ))}
          </Lista>
        </Campo>
      </div>

      {error && <Aviso tono="error">{error}</Aviso>}
      {hayInvalidas && <Aviso tono="error">{`Las piezas son números enteros de 1 a ${MAX_PIEZAS_LINEA}.`}</Aviso>}

      <CajaTabla altoMaximo="55vh">
        <Tabla aria-label="Piezas por producto" className="table-fixed">
          <colgroup>
            <col />
            <col className="w-40" />
          </colgroup>
          <thead>
            <tr>
              <Th>Producto</Th>
              <Th alinear="derecha">Piezas</Th>
            </tr>
          </thead>
          <tbody>
            {grupos.map((g) => (
              <GrupoTamano key={claveTamano(g.tamano)} grupo={g} borrador={borrador} onPiezas={(id, t) => setBorrador((b) => ({ ...b, [id]: t }))} />
            ))}
          </tbody>
        </Tabla>
      </CajaTabla>

      <div className="flex items-center gap-2">
        <Button type="button" disabled={!puedeGuardar} onClick={() => void guardar()}>
          Guardar
        </Button>
        <Button type="button" variant="outline" onClick={onVolver}>
          Cancelar
        </Button>
        <span className="ml-2 text-sm text-muted-foreground">{`Total: ${total} piezas`}</span>
      </div>
    </Pantalla>
  );
}

function GrupoTamano({
  grupo,
  borrador,
  onPiezas,
}: {
  grupo: { tamano: string; renglones: Renglon[] };
  borrador: Borrador;
  onPiezas: (id: string, texto: string) => void;
}) {
  return (
    <>
      <tr>
        <th colSpan={2} scope="colgroup" className="bg-muted px-3 py-1.5 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {grupo.tamano}
        </th>
      </tr>
      {grupo.renglones.map((r) => {
        const texto = borrador[r.presentacionId] ?? "";
        const invalido = texto.trim() !== "" && !piezasValidas(texto.trim());
        return (
          <Fila key={r.presentacionId} className="align-middle">
            <Td>{r.producto}</Td>
            <Td alinear="derecha">
              <Entrada
                type="text"
                inputMode="numeric"
                aria-label={`Piezas de ${r.nombre}`}
                aria-invalid={invalido || undefined}
                className="w-28 text-right"
                value={texto}
                onChange={(e) => onPiezas(r.presentacionId, e.target.value)}
              />
            </Td>
          </Fila>
        );
      })}
    </>
  );
}
