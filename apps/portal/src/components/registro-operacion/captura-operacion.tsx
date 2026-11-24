"use client";

import { useEffect, useMemo, useState } from "react";
import { Aviso } from "@/components/ui/aviso";
import { Button } from "@/components/ui/button";
import { AreaTexto, Campo, Entrada, Lista } from "@/components/ui/campo";
import { EncabezadoPantalla, Pantalla } from "@/components/ui/encabezado-pantalla";
import { CajaTabla, Fila, Tabla, Td, Th } from "@/components/ui/tabla";
import { mensajeDe } from "@/lib/api";
import { claveTamano, compararTamano } from "@/lib/cortes";
import { diaAnterior } from "@/lib/fechas";
import { listarMotivosMerma, type MotivoMerma } from "@/lib/motivos-merma";
import {
  crearOperacion,
  editarOperacion,
  infoDeTipo,
  MAX_COMENTARIO,
  MAX_PIEZAS,
  MAX_TRABAJADOR,
  type DatosEditarOperacion,
  type OperacionAlmacen,
  type OrigenEntrada,
  type TipoOperacion,
} from "@/lib/operaciones-almacen";
import { listarProductos, type Producto } from "@/lib/productos";
import { listarSucursales, type Sucursal } from "@/lib/sucursales";
import { hoyEnTijuana } from "@/lib/ventas";
import { diaDeEnvio, SelectorDiaEnvio } from "./selector-dia-envio";

interface Renglon {
  presentacionId: string;
  nombre: string;
  producto: string;
  volumen: string;
}

/** Los productos activos más lo que la operación ya traía (aunque se haya dado de baja). */
function renglonesDe(productos: Producto[], operacion: OperacionAlmacen | null): Renglon[] {
  const lista: Renglon[] = [];
  for (const p of productos) {
    if (!p.activo) continue;
    for (const pr of p.presentaciones) {
      lista.push({ presentacionId: pr.id, nombre: `${p.nombre} ${pr.volumen}`, producto: p.nombre, volumen: pr.volumen });
    }
  }
  for (const l of operacion?.lineas ?? []) {
    if (!lista.some((r) => r.presentacionId === l.presentacionId)) {
      lista.push({ presentacionId: l.presentacionId, nombre: l.nombre, producto: l.producto, volumen: l.volumen });
    }
  }
  return lista;
}

function agruparPorTamano(renglones: Renglon[]): { tamano: string; renglones: Renglon[] }[] {
  const grupos = new Map<string, { tamano: string; renglones: Renglon[] }>();
  for (const r of renglones) {
    const clave = claveTamano(r.volumen);
    const g = grupos.get(clave) ?? { tamano: r.volumen, renglones: [] };
    g.renglones.push(r);
    grupos.set(clave, g);
  }
  return [...grupos.values()]
    .sort((a, b) => compararTamano(a.tamano, b.tamano))
    .map((g) => ({ ...g, renglones: g.renglones.sort((a, b) => a.producto.localeCompare(b.producto, "es")) }));
}

/**
 * Día con que abre la captura: el de la operación que se corrige; en una nueva, el de la
 * pestaña si cabe en la regla del tipo (nunca futuro; el envío, solo hoy o ayer), si no, hoy.
 */
function fechaInicial(tipo: TipoOperacion, fecha: string, operacion: OperacionAlmacen | null, hoy: string): string {
  if (tipo === "envio") return diaDeEnvio(operacion?.fecha ?? fecha);
  if (operacion) return fecha > hoy ? hoy : fecha;
  return fecha > hoy ? hoy : fecha;
}

const ENTERO = /^\d+$/;
const piezasValidas = (texto: string) => ENTERO.test(texto) && Number(texto) >= 1 && Number(texto) <= MAX_PIEZAS;

/**
 * Captura o corrección de una operación de almacén, en pantalla completa: los datos del
 * tipo arriba y la rejilla de todos los productos activos por tamaño (TAB pasa al
 * siguiente campo de piezas; vacío = sin línea).
 */
export function CapturaOperacion({
  tipo,
  sucursal,
  operacion,
  fecha,
  onVolver,
  onGuardado,
}: {
  tipo: TipoOperacion;
  /** Código de la sucursal donde se registra. */
  sucursal: string;
  operacion: OperacionAlmacen | null;
  fecha: string;
  onVolver: () => void;
  onGuardado: () => void;
}) {
  const info = infoDeTipo(tipo);
  const hoy = hoyEnTijuana();
  const ayer = diaAnterior(hoy);

  const [productos, setProductos] = useState<Producto[] | null>(null);
  const [sucursales, setSucursales] = useState<Sucursal[]>([]);
  const [motivos, setMotivos] = useState<MotivoMerma[]>([]);
  const [dia, setDia] = useState(fechaInicial(tipo, fecha, operacion, hoy));
  const [origen, setOrigen] = useState<OrigenEntrada>(operacion?.origen ?? "produccion");
  const [destino, setDestino] = useState(operacion?.destino?.codigo ?? "");
  const [motivoId, setMotivoId] = useState(operacion?.motivo?.id ?? "");
  const [trabajador, setTrabajador] = useState(operacion?.trabajador ?? "");
  const [comentario, setComentario] = useState(operacion?.comentario ?? "");
  const [piezas, setPiezas] = useState<Record<string, string>>(() =>
    Object.fromEntries((operacion?.lineas ?? []).map((l) => [l.presentacionId, String(l.piezas)])),
  );
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let vigente = true;
    listarProductos().then(
      (p) => vigente && setProductos(p),
      (err: unknown) => {
        if (!vigente) return;
        setProductos([]);
        setError(mensajeDe(err, "No se pudieron cargar los productos."));
      },
    );
    if (tipo === "envio") {
      listarSucursales().then(
        (s) => vigente && setSucursales(s),
        (err: unknown) => vigente && setError(mensajeDe(err, "No se pudieron cargar las sucursales.")),
      );
    }
    if (tipo === "merma") {
      listarMotivosMerma("almacen").then(
        (m) => vigente && setMotivos(m),
        (err: unknown) => vigente && setError(mensajeDe(err, "No se pudieron cargar los motivos de merma.")),
      );
    }
    return () => {
      vigente = false;
    };
  }, [tipo]);

  const grupos = useMemo(() => agruparPorTamano(renglonesDe(productos ?? [], operacion)), [productos, operacion]);
  const lineas = Object.entries(piezas)
    .filter(([, t]) => t.trim() !== "")
    .map(([presentacionId, t]) => ({ presentacionId, texto: t.trim() }));
  const hayInvalidas = lineas.some((l) => !piezasValidas(l.texto));
  const trabajadorLimpio = trabajador.trim();

  const faltaDato =
    (tipo === "envio" && destino === "") ||
    (tipo === "merma" && motivoId === "") ||
    (tipo === "descuento" && trabajadorLimpio === "");
  const puedeGuardar = !guardando && lineas.length > 0 && !hayInvalidas && !faltaDato && dia !== "" && dia <= hoy && (tipo !== "envio" || dia >= ayer);

  async function guardar() {
    setGuardando(true);
    setError(null);
    const datos: DatosEditarOperacion = {
      fecha: dia,
      comentario: comentario.trim() === "" ? null : comentario.trim(),
      lineas: lineas.map((l) => ({ presentacionId: l.presentacionId, piezas: Number(l.texto) })),
    };
    if (tipo === "entrada") datos.origen = origen;
    if (tipo === "envio") datos.destino = destino;
    if (tipo === "merma") datos.motivoId = motivoId;
    if (tipo === "descuento") datos.trabajador = trabajadorLimpio;
    try {
      if (operacion) await editarOperacion(operacion.id, datos);
      else await crearOperacion({ ...datos, tipo, sucursal });
      onGuardado();
    } catch (err) {
      setError(mensajeDe(err, "No se pudo guardar el registro."));
      setGuardando(false);
    }
  }

  const destinos = sucursales.filter((s) => s.activa && s.codigo !== sucursal);
  const opcionesMotivo =
    operacion?.motivo && !motivos.some((m) => m.id === operacion.motivo!.id)
      ? [...motivos, { id: operacion.motivo.id, nombre: operacion.motivo.nombre }]
      : motivos;

  return (
    <Pantalla key="captura">
      <div>
        <Button type="button" variant="ghost" size="sm" onClick={onVolver}>
          ← Volver a {info.etiqueta}
        </Button>
      </div>
      <EncabezadoPantalla
        titulo={`${operacion ? "Corregir" : "Registrar"} · ${info.etiqueta}`}
        descripcion={`Sucursal ${sucursal}. Captura solo las piezas de lo que se movió; deja en blanco el resto.`}
      />

      <div className="flex flex-wrap items-start gap-4">
        {tipo === "envio" ? (
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Día</span>
            <SelectorDiaEnvio valor={dia} onCambio={setDia} />
          </div>
        ) : (
          <Campo id="op-fecha" etiqueta="Día" className="w-48">
            <Entrada type="date" required max={hoy} value={dia} onChange={(e) => setDia(e.target.value)} />
          </Campo>
        )}
        {tipo === "entrada" && (
          <Campo id="op-origen" etiqueta="Origen" className="w-48">
            <Lista value={origen} onChange={(e) => setOrigen(e.target.value as OrigenEntrada)}>
              <option value="produccion">Producción</option>
              <option value="compra">Compra</option>
            </Lista>
          </Campo>
        )}
        {tipo === "envio" && (
          <Campo id="op-destino" etiqueta="Sucursal destino" className="w-56">
            <Lista value={destino} onChange={(e) => setDestino(e.target.value)}>
              <option value="">Elige una…</option>
              {destinos.map((s) => (
                <option key={s.id} value={s.codigo}>
                  {s.nombre}
                </option>
              ))}
            </Lista>
          </Campo>
        )}
        {tipo === "merma" && (
          <Campo id="op-motivo" etiqueta="Motivo" className="w-72">
            <Lista value={motivoId} onChange={(e) => setMotivoId(e.target.value)}>
              <option value="">Elige uno…</option>
              {opcionesMotivo.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.nombre}
                </option>
              ))}
            </Lista>
          </Campo>
        )}
        {tipo === "descuento" && (
          <Campo id="op-trabajador" etiqueta="Trabajador" className="w-72">
            <Entrada maxLength={MAX_TRABAJADOR} value={trabajador} onChange={(e) => setTrabajador(e.target.value)} />
          </Campo>
        )}
        <Campo id="op-comentario" etiqueta="Comentario" opcional className="min-w-64 flex-1">
          <AreaTexto maxLength={MAX_COMENTARIO} value={comentario} onChange={(e) => setComentario(e.target.value)} />
        </Campo>
      </div>

      {error && <Aviso tono="error">{error}</Aviso>}
      {hayInvalidas && <Aviso tono="error">{`Las piezas son números enteros de 1 a ${MAX_PIEZAS}.`}</Aviso>}

      {productos === null ? (
        <p className="text-sm text-muted-foreground">Cargando…</p>
      ) : (
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
                <GrupoTamano key={claveTamano(g.tamano)} grupo={g} piezas={piezas} onPiezas={(id, t) => setPiezas((p) => ({ ...p, [id]: t }))} />
              ))}
            </tbody>
          </Tabla>
        </CajaTabla>
      )}

      <div className="flex gap-2">
        <Button type="button" disabled={!puedeGuardar} onClick={guardar}>
          Guardar
        </Button>
        <Button type="button" variant="outline" onClick={onVolver}>
          Cancelar
        </Button>
      </div>
    </Pantalla>
  );
}

function GrupoTamano({
  grupo,
  piezas,
  onPiezas,
}: {
  grupo: { tamano: string; renglones: Renglon[] };
  piezas: Record<string, string>;
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
        const texto = piezas[r.presentacionId] ?? "";
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
