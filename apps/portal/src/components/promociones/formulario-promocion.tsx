"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/components/auth/auth-provider";
import { useEnvioFormulario } from "@/components/catalogo/use-envio-formulario";
import { listarProductos, type Producto } from "@/lib/productos";
import { listarSucursales, type Sucursal } from "@/lib/sucursales";
import {
  crearPromocion,
  editarPromocion,
  nombresDe,
  problemaDeRegla,
  textoPromocion,
  type AudienciaPromocion,
  type CompraPromocion,
  type DatosPromocion,
  type Promocion,
  type ReglaCompleta,
  type RegaloPromocion,
} from "@/lib/promociones";

interface Props {
  /** La promoción a editar, o null para un alta. */
  promocion: Promocion | null;
  /** Desde la zona: la sucursal del selector global. Desde el cliente: el cliente (audiencia fija). */
  contexto:
    | { tipo: "sucursal"; sucursal: string | null }
    | { tipo: "cliente"; clienteId: string; clienteNombre: string };
  alGuardar: () => void;
  alCancelar: () => void;
}

const CLASE_SELECT = "w-64 rounded-md border px-3 py-2 text-sm";

export function FormularioPromocion({ promocion, contexto, alGuardar, alCancelar }: Props) {
  const { usuario } = useAuth();
  const esAlta = promocion === null;
  const deCliente = contexto.tipo === "cliente";

  // Mismo criterio que vehículos: `sucursal === null` es un General (D3) y solo él elige la
  // sucursal (o "todas") al dar de alta. Un usuario atado la recibe del servidor.
  // Desde el cliente la sucursal es la del cliente: no se elige.
  const eligeSucursal =
    esAlta && contexto.tipo === "sucursal" && usuario !== null && usuario.sucursal === null;

  const [audiencia, setAudiencia] = useState<AudienciaPromocion>(
    promocion?.audiencia ?? (deCliente ? "cliente" : "todos"),
  );
  const [sucursalId, setSucursalId] = useState("");
  const [compraTipo, setCompraTipo] = useState<CompraPromocion>(promocion?.compraTipo ?? "producto");
  const [compraProductoId, setCompraProductoId] = useState(promocion?.compraProductoId ?? "");
  const [compraPresentacionId, setCompraPresentacionId] = useState(
    promocion?.compraPresentacionId ?? "",
  );
  // La cantidad es texto: así se puede borrar y teclear sin que el campo salte a "0".
  const [compraCantidad, setCompraCantidad] = useState(String(promocion?.compraCantidad ?? 10));
  const [regaloTipo, setRegaloTipo] = useState<RegaloPromocion>(promocion?.regaloTipo ?? "mismo");
  const [regaloProductoId, setRegaloProductoId] = useState(promocion?.regaloProductoId ?? "");
  const [regaloPresentacionId, setRegaloPresentacionId] = useState(
    promocion?.regaloPresentacionId ?? "",
  );
  const [regaloCantidad, setRegaloCantidad] = useState(String(promocion?.regaloCantidad ?? 1));
  const [seRepite, setSeRepite] = useState(promocion?.seRepite ?? true);
  const [activo, setActivo] = useState(promocion?.activo ?? true);

  const [productos, setProductos] = useState<Producto[]>([]);
  const [sucursales, setSucursales] = useState<Sucursal[]>([]);
  const { enviando, error, enviar } = useEnvioFormulario("No se pudo guardar la promoción.");

  useEffect(() => {
    let vigente = true;
    // El fallo se ignora a propósito (como en vehículos): los desplegables quedan vacíos,
    // la regla no se completa y Guardar sigue bloqueado, que ya explica que falta algo.
    void listarProductos()
      .then((lista) => {
        if (vigente) setProductos(lista);
      })
      .catch(() => {});
    return () => {
      vigente = false;
    };
  }, []);

  useEffect(() => {
    if (!eligeSucursal) return;
    let vigente = true;
    void listarSucursales()
      .then((lista) => {
        if (vigente) setSucursales(lista.filter((s) => s.activa));
      })
      .catch(() => {});
    return () => {
      vigente = false;
    };
  }, [eligeSucursal]);

  // Sin tocar el desplegable, la sucursal es la del selector global.
  const sucursalElegida =
    sucursalId ||
    (contexto.tipo === "sucursal"
      ? (sucursales.find((s) => s.codigo === contexto.sucursal)?.id ?? "")
      : "");

  // Los activos, más los que esta promoción ya usa (si se desactivó uno, el campo no debe quedar en blanco).
  const productosVisibles = productos.filter(
    (p) =>
      p.activo ||
      p.id === promocion?.compraProductoId ||
      p.id === promocion?.regaloProductoId ||
      p.presentaciones.some(
        (x) => x.id === promocion?.compraPresentacionId || x.id === promocion?.regaloPresentacionId,
      ),
  );
  const presentaciones = productosVisibles.flatMap((p) =>
    p.presentaciones.map((x) => ({ id: x.id, etiqueta: `${p.nombre} · ${x.volumen}` })),
  );

  // Los ids que no aplican al tipo elegido se mandan vacíos (null): el estado conserva lo que el
  // usuario escogió antes de cambiar de tipo, pero la regla solo lleva lo vigente.
  const regla: ReglaCompleta = useMemo(
    () => ({
      audiencia,
      clienteId: audiencia === "cliente" ? (promocion?.clienteId ?? (deCliente ? contexto.clienteId : null)) : null,
      compraTipo,
      compraProductoId: compraTipo === "producto" ? compraProductoId || null : null,
      compraPresentacionId: compraTipo === "presentacion" ? compraPresentacionId || null : null,
      compraCantidad: compraCantidad.trim() === "" ? NaN : Number(compraCantidad),
      regaloTipo,
      regaloProductoId: regaloTipo === "producto" ? regaloProductoId || null : null,
      regaloPresentacionId: regaloTipo === "presentacion" ? regaloPresentacionId || null : null,
      regaloCantidad: regaloCantidad.trim() === "" ? NaN : Number(regaloCantidad),
      seRepite,
    }),
    [
      audiencia, promocion, deCliente, contexto, compraTipo, compraProductoId, compraPresentacionId,
      compraCantidad, regaloTipo, regaloProductoId, regaloPresentacionId, regaloCantidad, seRepite,
    ],
  );

  const problema = problemaDeRegla(regla);
  const frase = problema ? null : textoPromocion(regla, nombresDe(deNulos(regla), productos));
  const falta = eligeSucursal && !sucursalElegida;

  async function alEnviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (problema) return;
    const cuerpo = deNulos(regla);

    await enviar(() => {
      if (promocion) {
        // Audiencia, cliente y sucursal no se editan: el PATCH solo lleva la regla y `activo`.
        return editarPromocion(promocion.id, {
          compraTipo: cuerpo.compraTipo,
          ...(cuerpo.compraProductoId ? { compraProductoId: cuerpo.compraProductoId } : {}),
          ...(cuerpo.compraPresentacionId
            ? { compraPresentacionId: cuerpo.compraPresentacionId }
            : {}),
          compraCantidad: cuerpo.compraCantidad,
          regaloTipo: cuerpo.regaloTipo,
          ...(cuerpo.regaloProductoId ? { regaloProductoId: cuerpo.regaloProductoId } : {}),
          ...(cuerpo.regaloPresentacionId
            ? { regaloPresentacionId: cuerpo.regaloPresentacionId }
            : {}),
          regaloCantidad: cuerpo.regaloCantidad,
          seRepite: cuerpo.seRepite,
          activo,
        });
      }
      return crearPromocion({
        ...cuerpo,
        ...(eligeSucursal ? { sucursalId: sucursalElegida } : {}),
      });
    }, alGuardar);
  }

  return (
    <form onSubmit={alEnviar} className="mb-6 flex flex-col gap-4 rounded-md border p-4">
      <h2 className="text-sm font-semibold">{esAlta ? "Nueva promoción" : "Editar promoción"}</h2>

      {esAlta && !deCliente && (
        <fieldset className="flex flex-col gap-1.5">
          <legend className="text-sm font-medium">Para quién</legend>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="audiencia"
              checked={audiencia === "todos"}
              disabled={enviando}
              onChange={() => setAudiencia("todos")}
            />
            Todos los clientes
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="audiencia"
              checked={audiencia === "prospecto"}
              disabled={enviando}
              onChange={() => setAudiencia("prospecto")}
            />
            Prospectos, solo en su primera venta
          </label>
        </fieldset>
      )}

      {esAlta && deCliente && (
        <p className="text-sm">
          <span className="font-medium">Para quién: </span>
          Para {contexto.clienteNombre}
        </p>
      )}

      {!esAlta && (
        <p className="text-xs text-muted-foreground">
          Para{" "}
          {promocion.audiencia === "cliente"
            ? (promocion.clienteNombre ?? "un cliente")
            : promocion.audiencia === "todos"
              ? "todos los clientes"
              : "prospectos (primera venta)"}
          {" · "}Sucursal: {promocion.sucursalCodigo}. La audiencia y la sucursal de una promoción no
          se pueden cambiar.
        </p>
      )}

      {eligeSucursal && (
        <div className="flex flex-col gap-1.5">
          <label htmlFor="sucursal" className="text-sm font-medium">
            Sucursal
          </label>
          <select
            id="sucursal"
            required
            disabled={enviando}
            value={sucursalElegida}
            onChange={(e) => setSucursalId(e.target.value)}
            className={CLASE_SELECT}
          >
            <option value="">Elige una sucursal…</option>
            {sucursales.map((s) => (
              <option key={s.id} value={s.id}>
                {s.codigo} · {s.nombre}
              </option>
            ))}
            <option value="todas">Todas las sucursales — crea una por sucursal</option>
          </select>
        </div>
      )}

      <div className="flex flex-wrap items-end gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="compra-tipo" className="text-sm font-medium">
            Qué compra
          </label>
          <select
            id="compra-tipo"
            disabled={enviando}
            value={compraTipo}
            onChange={(e) => setCompraTipo(e.target.value as CompraPromocion)}
            className={CLASE_SELECT}
          >
            <option value="cualquiera">Cualquier producto</option>
            <option value="producto">Un producto</option>
            <option value="presentacion">Una presentación</option>
          </select>
        </div>

        {compraTipo === "producto" && (
          <SelectorProducto
            id="compra-producto"
            etiqueta="Producto que compra"
            valor={compraProductoId}
            alCambiar={setCompraProductoId}
            deshabilitado={enviando}
            productos={productosVisibles}
          />
        )}
        {compraTipo === "presentacion" && (
          <SelectorPresentacion
            id="compra-presentacion"
            etiqueta="Presentación que compra"
            valor={compraPresentacionId}
            alCambiar={setCompraPresentacionId}
            deshabilitado={enviando}
            presentaciones={presentaciones}
          />
        )}

        <Cantidad
          id="compra-cantidad"
          etiqueta="Cantidad que compra"
          valor={compraCantidad}
          alCambiar={setCompraCantidad}
          deshabilitado={enviando}
          minimo={0}
        />
      </div>

      <div className="flex flex-wrap items-end gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="regalo-tipo" className="text-sm font-medium">
            Qué regala
          </label>
          <select
            id="regalo-tipo"
            disabled={enviando}
            value={regaloTipo}
            onChange={(e) => setRegaloTipo(e.target.value as RegaloPromocion)}
            className={CLASE_SELECT}
          >
            <option value="mismo">Del mismo</option>
            <option value="producto">Un producto</option>
            <option value="presentacion">Una presentación</option>
          </select>
        </div>

        {regaloTipo === "producto" && (
          <SelectorProducto
            id="regalo-producto"
            etiqueta="Producto que regala"
            valor={regaloProductoId}
            alCambiar={setRegaloProductoId}
            deshabilitado={enviando}
            productos={productosVisibles}
          />
        )}
        {regaloTipo === "presentacion" && (
          <SelectorPresentacion
            id="regalo-presentacion"
            etiqueta="Presentación que regala"
            valor={regaloPresentacionId}
            alCambiar={setRegaloPresentacionId}
            deshabilitado={enviando}
            presentaciones={presentaciones}
          />
        )}

        <Cantidad
          id="regalo-cantidad"
          etiqueta="Cantidad que regala"
          valor={regaloCantidad}
          alCambiar={setRegaloCantidad}
          deshabilitado={enviando}
          minimo={1}
        />
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={seRepite}
          disabled={enviando}
          onChange={(e) => setSeRepite(e.target.checked)}
        />
        Se repite por bloques
      </label>

      {!esAlta && (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={activo}
            disabled={enviando}
            onChange={(e) => setActivo(e.target.checked)}
          />
          Activa
        </label>
      )}

      {/* La frase tal como la verá el vendedor (D11); si la regla no cuadra, en su lugar va el porqué. */}
      <p
        aria-live="polite"
        className={problema ? "text-sm text-destructive" : "rounded-md bg-muted px-3 py-2 text-sm"}
      >
        {problema ?? frase}
      </p>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="flex gap-2">
        <Button type="submit" disabled={enviando || problema !== null || falta}>
          {enviando ? "Guardando…" : "Guardar"}
        </Button>
        <Button type="button" variant="outline" disabled={enviando} onClick={alCancelar}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}

/** `problemaDeRegla` pide `null`s y el cuerpo de la API pide campos ausentes: este es el puente. */
function deNulos(r: ReglaCompleta): DatosPromocion {
  return {
    audiencia: r.audiencia,
    ...(r.clienteId ? { clienteId: r.clienteId } : {}),
    compraTipo: r.compraTipo,
    ...(r.compraProductoId ? { compraProductoId: r.compraProductoId } : {}),
    ...(r.compraPresentacionId ? { compraPresentacionId: r.compraPresentacionId } : {}),
    compraCantidad: r.compraCantidad,
    regaloTipo: r.regaloTipo,
    ...(r.regaloProductoId ? { regaloProductoId: r.regaloProductoId } : {}),
    ...(r.regaloPresentacionId ? { regaloPresentacionId: r.regaloPresentacionId } : {}),
    regaloCantidad: r.regaloCantidad,
    seRepite: r.seRepite,
  };
}

function SelectorProducto(p: {
  id: string;
  etiqueta: string;
  valor: string;
  alCambiar: (v: string) => void;
  deshabilitado: boolean;
  productos: Producto[];
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={p.id} className="text-sm font-medium">
        {p.etiqueta}
      </label>
      <select
        id={p.id}
        disabled={p.deshabilitado}
        value={p.valor}
        onChange={(e) => p.alCambiar(e.target.value)}
        className={CLASE_SELECT}
      >
        <option value="">Elige un producto…</option>
        {p.productos.map((x) => (
          <option key={x.id} value={x.id}>
            {x.nombre}
          </option>
        ))}
      </select>
    </div>
  );
}

function SelectorPresentacion(p: {
  id: string;
  etiqueta: string;
  valor: string;
  alCambiar: (v: string) => void;
  deshabilitado: boolean;
  presentaciones: { id: string; etiqueta: string }[];
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={p.id} className="text-sm font-medium">
        {p.etiqueta}
      </label>
      <select
        id={p.id}
        disabled={p.deshabilitado}
        value={p.valor}
        onChange={(e) => p.alCambiar(e.target.value)}
        className={CLASE_SELECT}
      >
        <option value="">Elige una presentación…</option>
        {p.presentaciones.map((x) => (
          <option key={x.id} value={x.id}>
            {x.etiqueta}
          </option>
        ))}
      </select>
    </div>
  );
}

function Cantidad(p: {
  id: string;
  etiqueta: string;
  valor: string;
  alCambiar: (v: string) => void;
  deshabilitado: boolean;
  minimo: number;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={p.id} className="text-sm font-medium">
        {p.etiqueta}
      </label>
      <input
        id={p.id}
        type="number"
        min={p.minimo}
        step={1}
        disabled={p.deshabilitado}
        value={p.valor}
        onChange={(e) => p.alCambiar(e.target.value)}
        className="w-28 rounded-md border px-3 py-2 text-sm"
      />
    </div>
  );
}
