"use client";

import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { Aviso } from "@/components/ui/aviso";
import { Button } from "@/components/ui/button";
import { Campo, Entrada, Lista } from "@/components/ui/campo";
import { useConfirmar } from "@/components/ui/confirmar";
import { EncabezadoPantalla, Pantalla } from "@/components/ui/encabezado-pantalla";
import { EstadoPantalla } from "@/components/ui/estado-pantalla";
import { CajaTabla, Fila, FilaTotal, Tabla, Td, Th } from "@/components/ui/tabla";
import { mensajeDe } from "@/lib/api";
import { formatearFechaHora } from "@/lib/formato";
import { leerPiezas } from "@/lib/produccion";
import { guardarRetorno, obtenerRetorno, type DiaRetorno } from "@/lib/retornos";
import { listarVendedores, type Vendedor } from "@/lib/vendedores";
import { hoyEnTijuana } from "@/lib/ventas";

const TITULO = "Retorno";
const DESCRIPCION = "Las piezas que regresa cada vendedor al final del día.";

const textoDe = (piezas: number) => (piezas > 0 ? String(piezas) : "");

/**
 * Producción › Retorno: el almacenista anota, por vendedor y día, las piezas buenas
 * que regresaron de cada presentación (la merma no cuenta). Hoy por omisión, días
 * anteriores se corrigen, el futuro no. Vacío o 0 = sin registro; Guardar reemplaza
 * el día completo. Reutiliza `leerPiezas` de producción (mismo tope y mismo criterio).
 */
export function PantallaRetorno({ sucursal }: { sucursal: string | null }) {
  const { usuario, puede, cargando } = useAuth();

  if (cargando) return <EstadoPantalla titulo={TITULO} tipo="cargando" />;
  if (!puede("retorno.gestionar")) return <EstadoPantalla titulo={TITULO} tipo="sin-permiso" />;

  const codigo = usuario?.sucursal?.codigo ?? (sucursal && sucursal.toLowerCase() !== "todas" ? sucursal.toUpperCase() : null);
  if (!codigo) return <EstadoPantalla titulo={TITULO} tipo="elige-sucursal" />;

  return <RetornoDelDia key={codigo} sucursal={codigo} />;
}

function RetornoDelDia({ sucursal }: { sucursal: string }) {
  const hoy = hoyEnTijuana();
  const [fecha, setFecha] = useState(hoy);
  const [vendedorId, setVendedorId] = useState("");
  const [vendedores, setVendedores] = useState<Vendedor[]>([]);
  const [dia, setDia] = useState<DiaRetorno | null>(null);
  const [borrador, setBorrador] = useState<Record<string, string>>({});
  const [cargandoDia, setCargandoDia] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const ultima = useRef(0);
  const { confirmar, ventana } = useConfirmar();

  useEffect(() => {
    let vigente = true;
    listarVendedores(sucursal)
      .then((v) => {
        if (vigente) setVendedores(v.filter((x) => x.activo && x.sucursalCodigo === sucursal));
      })
      .catch((err: unknown) => {
        if (vigente) setError(mensajeDe(err, "No se pudo cargar la lista de vendedores."));
      });
    return () => {
      vigente = false;
    };
  }, [sucursal]);

  useEffect(() => {
    const esta = ++ultima.current;
    if (!vendedorId) {
      setDia(null);
      setCargandoDia(false);
      return;
    }
    setCargandoDia(true);
    obtenerRetorno(fecha, vendedorId)
      .then((r) => {
        if (esta !== ultima.current) return;
        setDia(r);
        setBorrador(Object.fromEntries(r.lineas.map((l) => [l.presentacionId, textoDe(l.piezas)])));
      })
      .catch((err: unknown) => {
        if (esta !== ultima.current) return;
        setDia(null);
        setError(mensajeDe(err, "No se pudo cargar el retorno."));
      })
      .finally(() => {
        if (esta === ultima.current) setCargandoDia(false);
      });
  }, [fecha, vendedorId]);

  const lineas = dia?.lineas ?? [];
  const lectura = (id: string) => leerPiezas(borrador[id] ?? "");
  const hayInvalidas = lineas.some((l) => lectura(l.presentacionId) === null);
  const cambios = lineas.some((l) => lectura(l.presentacionId) !== l.piezas);
  const total = lineas.reduce((suma, l) => suma + (lectura(l.presentacionId) ?? 0), 0);
  const totalCargadas = lineas.reduce((suma, l) => suma + l.cargadas, 0);

  function editar(id: string, valor: string) {
    setAviso(null);
    setBorrador((prev) => ({ ...prev, [id]: valor }));
  }

  // Cambiar de vendedor o de fecha tira lo escrito: si hay cambios, se pregunta.
  async function puedeDescartar(): Promise<boolean> {
    if (!cambios) return true;
    return confirmar({
      titulo: "¿Descartar los cambios?",
      descripcion: "Lo que escribiste en este retorno no se ha guardado.",
      confirmar: "Descartar",
    });
  }

  async function cambiarFecha(nueva: string) {
    if (nueva === "" || nueva === fecha) return;
    // El `max` del campo no impide teclear un día futuro: ni se pide ni se cambia.
    if (nueva > hoy) return;
    if (!(await puedeDescartar())) return;
    setError(null);
    setAviso(null);
    setFecha(nueva);
  }

  async function cambiarVendedor(nuevo: string) {
    if (nuevo === vendedorId) return;
    if (!(await puedeDescartar())) return;
    setError(null);
    setAviso(null);
    setVendedorId(nuevo);
  }

  async function guardar() {
    setGuardando(true);
    setError(null);
    setAviso(null);
    try {
      const r = await guardarRetorno({
        fecha,
        vendedor: vendedorId,
        lineas: lineas.map((l) => ({ presentacionId: l.presentacionId, piezas: lectura(l.presentacionId) ?? 0 })),
      });
      setDia(r);
      setBorrador(Object.fromEntries(r.lineas.map((l) => [l.presentacionId, textoDe(l.piezas)])));
      setAviso("Retorno guardado.");
    } catch (err) {
      setError(mensajeDe(err, "No se pudo guardar el retorno. Vuelve a intentar."));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Pantalla>
      <EncabezadoPantalla titulo={TITULO} descripcion={DESCRIPCION} />

      <div className="flex flex-wrap items-end gap-4">
        <Campo id="retorno-vendedor" etiqueta="Vendedor" className="w-64">
          <Lista value={vendedorId} disabled={guardando} onChange={(e) => void cambiarVendedor(e.target.value)}>
            <option value="">Elige un vendedor</option>
            {vendedores.map((v) => (
              <option key={v.id} value={v.id}>
                {v.nombre}
              </option>
            ))}
          </Lista>
        </Campo>
        <Campo id="retorno-fecha" etiqueta="Fecha" className="w-48">
          <Entrada
            type="date"
            required
            max={hoy}
            value={fecha}
            disabled={guardando}
            onChange={(e) => void cambiarFecha(e.target.value)}
          />
        </Campo>
      </div>

      {error && <Aviso tono="error">{error}</Aviso>}
      {!vendedorId && <p className="text-sm text-muted-foreground">Elige un vendedor para capturar lo que regresó.</p>}
      {cargandoDia && <EstadoPantalla tipo="cargando" />}

      {!cargandoDia && dia && lineas.length === 0 && (
        <p className="text-sm text-muted-foreground">No hay presentaciones activas. Da de alta una en el catálogo de productos.</p>
      )}

      {!cargandoDia && dia && lineas.length > 0 && (
        <>
          <CajaTabla>
            <Tabla aria-label="Retorno del vendedor">
              <thead>
                <tr>
                  <Th>Producto</Th>
                  <Th>Presentación</Th>
                  <Th alinear="derecha">Cargadas</Th>
                  <Th alinear="derecha">Piezas retornadas</Th>
                </tr>
              </thead>
              <tbody>
                {lineas.map((l) => {
                  const nombre = `${l.producto} ${l.presentacion}`;
                  const mala = lectura(l.presentacionId) === null;
                  return (
                    <Fila key={l.presentacionId} className="align-middle">
                      <Td>
                        {l.producto}
                        {!l.activa && <span className="text-muted-foreground"> (dada de baja)</span>}
                      </Td>
                      <Td>{l.presentacion}</Td>
                      <Td alinear="derecha" className="tabular-nums">
                        {l.cargadas}
                      </Td>
                      <Td alinear="derecha">
                        <Entrada
                          aria-label={`Piezas retornadas de ${nombre}`}
                          inputMode="numeric"
                          aria-invalid={mala || undefined}
                          value={borrador[l.presentacionId] ?? ""}
                          disabled={guardando}
                          onChange={(e) => editar(l.presentacionId, e.target.value)}
                          className="w-32 text-right tabular-nums"
                        />
                        {mala && <p className="mt-1 text-xs text-destructive">Solo piezas enteras</p>}
                      </Td>
                    </Fila>
                  );
                })}
              </tbody>
              <tfoot>
                <FilaTotal>
                  <Td colSpan={2}>Total</Td>
                  <Td alinear="derecha" className="tabular-nums">
                    {totalCargadas}
                  </Td>
                  <Td alinear="derecha" className="tabular-nums">
                    {total}
                  </Td>
                </FilaTotal>
              </tfoot>
            </Tabla>
          </CajaTabla>

          <div className="flex flex-wrap items-center gap-3">
            <Button disabled={guardando || hayInvalidas} onClick={() => void guardar()}>
              {guardando ? "Guardando…" : "Guardar retorno"}
            </Button>
            {aviso && <Aviso tono="exito">{aviso}</Aviso>}
            {dia.actualizadoEn && !aviso && (
              <span className="text-xs text-muted-foreground">Última captura: {formatearFechaHora(dia.actualizadoEn)}.</span>
            )}
          </div>
        </>
      )}
      {ventana}
    </Pantalla>
  );
}
