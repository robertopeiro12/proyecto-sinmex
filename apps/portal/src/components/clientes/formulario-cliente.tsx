"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/components/auth/auth-provider";
import { useEnvioFormulario } from "@/components/catalogo/use-envio-formulario";
import { listarSucursales, type Sucursal } from "@/lib/sucursales";
import { listarProductos, type Producto } from "@/lib/productos";
import { listarListasPrecio, type ListaPrecio } from "@/lib/precios";
import {
  crearCliente,
  editarCliente,
  type ClienteDetalle,
  type Promocion,
} from "@/lib/clientes";
import { SelectorTipoNegocio } from "./selector-tipo-negocio";

interface Props {
  /** El cliente a editar, o null para dar de alta uno nuevo. */
  cliente: ClienteDetalle | null;
  alGuardar: () => void;
  alCancelar: () => void;
}

export function FormularioCliente({ cliente, alGuardar, alCancelar }: Props) {
  const { usuario } = useAuth();
  const esAlta = cliente === null;

  // Mismo criterio que FormularioVehiculo (T-11, D3): solo un General elige
  // sucursal, y solo al dar de alta.
  const eligeSucursal = esAlta && usuario !== null && usuario.sucursal === null;

  const [nombre, setNombre] = useState(cliente?.nombre ?? "");
  const [domicilio, setDomicilio] = useState(cliente?.domicilio ?? "");
  const [telefono, setTelefono] = useState(cliente?.telefono ?? "");
  const [encargado, setEncargado] = useState(cliente?.encargado ?? "");
  const [factura, setFactura] = useState(cliente?.factura ?? false);
  const [tipo, setTipo] = useState<"cliente" | "prospecto">(cliente?.tipo ?? "cliente");
  const [tipoNegocioId, setTipoNegocioId] = useState(cliente?.tipoNegocioId ?? "");
  const [listaPrecioId, setListaPrecioId] = useState(cliente?.listaPrecioId ?? "");
  const [pctComision, setPctComision] = useState(
    cliente?.pctComision?.toString() ?? "",
  );
  const [promocion, setPromocion] = useState<Promocion>(cliente?.promocion ?? "ninguna");
  const [productosPromocion, setProductosPromocion] = useState<string[]>(
    cliente?.productosPromocion ?? [],
  );
  const [plazoCreditoDias, setPlazoCreditoDias] = useState(
    cliente?.plazoCreditoDias?.toString() ?? "",
  );
  const [lat, setLat] = useState(cliente?.lat?.toString() ?? "");
  const [lng, setLng] = useState(cliente?.lng?.toString() ?? "");
  const [comentarios, setComentarios] = useState(cliente?.comentarios ?? "");
  const [sucursalId, setSucursalId] = useState("");

  // Punto de partida de los overrides: presentacionId -> texto del input.
  // Se calcula UNA vez (no en un efecto) porque PantallaClientes remonta
  // este formulario con `key={cliente.id}` al cambiar de fila (mismo motivo
  // que documenta CeldaPrecio en T-18), asi que nunca hace falta
  // resincronizar con un prop que cambio por debajo.
  const [overridesIniciales] = useState(
    () =>
      new Map((cliente?.overridesPrecio ?? []).map((o) => [o.presentacionId, o.precio.toString()])),
  );
  const [overrides, setOverrides] = useState<Map<string, string>>(
    () => new Map(overridesIniciales),
  );

  const [sucursales, setSucursales] = useState<Sucursal[]>([]);
  const [productos, setProductos] = useState<Producto[]>([]);
  const [listas, setListas] = useState<ListaPrecio[]>([]);
  const { enviando, error, enviar } = useEnvioFormulario("No se pudo guardar el cliente.");

  useEffect(() => {
    if (!eligeSucursal) return;
    let vigente = true;
    listarSucursales()
      .then((lista) => {
        if (vigente) setSucursales(lista.filter((s) => s.activa));
      })
      .catch(() => {});
    return () => {
      vigente = false;
    };
  }, [eligeSucursal]);

  useEffect(() => {
    let vigente = true;
    Promise.all([listarProductos(), listarListasPrecio()])
      .then(([p, l]) => {
        if (vigente) {
          setProductos(p);
          setListas(l);
        }
      })
      .catch(() => {});
    return () => {
      vigente = false;
    };
  }, []);

  function alternarProducto(id: string) {
    setProductosPromocion((previos) =>
      previos.includes(id) ? previos.filter((p) => p !== id) : [...previos, id],
    );
  }

  function cambiarOverride(presentacionId: string, texto: string) {
    setOverrides((previos) => {
      const copia = new Map(previos);
      if (texto.trim() === "") {
        copia.delete(presentacionId);
      } else {
        copia.set(presentacionId, texto);
      }
      return copia;
    });
  }

  async function alEnviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();

    // Un override que existia al abrir el formulario y ya no aparece en
    // `overrides` (el usuario lo vacio) viaja como `precio: null` para que
    // el backend lo borre (D5 del spec); uno que sigue o es nuevo viaja con
    // su número.
    const overridesPrecio = Array.from(overridesIniciales.keys())
      .filter((id) => !overrides.has(id))
      .map((presentacionId) => ({ presentacionId, precio: null as number | null }))
      .concat(
        Array.from(overrides.entries()).map(([presentacionId, texto]) => ({
          presentacionId,
          precio: Number(texto),
        })),
      );

    const datos = {
      nombre,
      domicilio,
      telefono,
      encargado: encargado.trim() === "" ? undefined : encargado,
      factura,
      tipoNegocioId: tipoNegocioId === "" ? undefined : tipoNegocioId,
      listaPrecioId,
      pctComision: pctComision.trim() === "" ? undefined : Number(pctComision),
      promocion,
      productosPromocion,
      plazoCreditoDias:
        plazoCreditoDias.trim() === "" ? undefined : Number(plazoCreditoDias),
      lat: lat.trim() === "" ? undefined : Number(lat),
      lng: lng.trim() === "" ? undefined : Number(lng),
      comentarios: comentarios.trim() === "" ? undefined : comentarios,
      overridesPrecio,
    };

    await enviar(
      () =>
        cliente
          ? editarCliente(cliente.id, datos)
          : crearCliente({
              ...datos,
              tipo,
              ...(eligeSucursal ? { sucursalId } : {}),
            }),
      alGuardar,
    );
  }

  return (
    <form onSubmit={alEnviar} className="mb-6 flex flex-col gap-6 rounded-md border p-4">
      <h2 className="text-sm font-semibold">
        {esAlta ? "Nuevo cliente" : `Editar ${cliente.nombre}`}
      </h2>

      <fieldset className="flex flex-col gap-4">
        <legend className="mb-1 text-sm font-semibold text-muted-foreground">
          Datos básicos
        </legend>
        <div className="flex flex-wrap gap-4">
          <div className="flex flex-1 flex-col gap-1.5">
            <label htmlFor="nombre" className="text-sm font-medium">
              Nombre
            </label>
            <input
              id="nombre"
              required
              maxLength={120}
              disabled={enviando}
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              className="rounded-md border px-3 py-2 text-sm"
            />
          </div>
          <div className="flex flex-1 flex-col gap-1.5">
            <label htmlFor="domicilio" className="text-sm font-medium">
              Domicilio / referencia
            </label>
            <input
              id="domicilio"
              required
              maxLength={200}
              disabled={enviando}
              value={domicilio}
              onChange={(e) => setDomicilio(e.target.value)}
              className="rounded-md border px-3 py-2 text-sm"
            />
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="telefono" className="text-sm font-medium">
              Teléfono
            </label>
            <input
              id="telefono"
              required
              maxLength={30}
              disabled={enviando}
              value={telefono}
              onChange={(e) => setTelefono(e.target.value)}
              className="w-48 rounded-md border px-3 py-2 text-sm"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="encargado" className="text-sm font-medium">
              Encargado
            </label>
            <input
              id="encargado"
              maxLength={120}
              disabled={enviando}
              value={encargado}
              onChange={(e) => setEncargado(e.target.value)}
              className="w-48 rounded-md border px-3 py-2 text-sm"
            />
          </div>
          {esAlta && (
            <div className="flex flex-col gap-1.5">
              <label htmlFor="tipo" className="text-sm font-medium">
                Tipo
              </label>
              <select
                id="tipo"
                disabled={enviando}
                value={tipo}
                onChange={(e) => setTipo(e.target.value as "cliente" | "prospecto")}
                className="w-40 rounded-md border px-3 py-2 text-sm"
              >
                <option value="cliente">Cliente</option>
                <option value="prospecto">Prospecto</option>
              </select>
            </div>
          )}
          <label className="flex items-center gap-2 pb-2 text-sm">
            <input
              type="checkbox"
              checked={factura}
              disabled={enviando}
              onChange={(e) => setFactura(e.target.checked)}
            />
            ¿Requiere factura?
          </label>
        </div>
        <SelectorTipoNegocio
          value={tipoNegocioId}
          onChange={setTipoNegocioId}
          disabled={enviando}
        />
        {!esAlta && (
          <p className="text-xs text-muted-foreground">
            Sucursal: {cliente.sucursalCodigo}. La sucursal de un cliente no se
            puede cambiar.
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
              value={sucursalId}
              onChange={(e) => setSucursalId(e.target.value)}
              className="w-64 rounded-md border px-3 py-2 text-sm"
            >
              <option value="">Elige una sucursal…</option>
              {sucursales.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.codigo} · {s.nombre}
                </option>
              ))}
            </select>
          </div>
        )}
      </fieldset>

      <fieldset className="flex flex-col gap-4">
        <legend className="mb-1 text-sm font-semibold text-muted-foreground">
          Precio
        </legend>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="lista" className="text-sm font-medium">
            Lista de precios
          </label>
          <select
            id="lista"
            required
            disabled={enviando}
            value={listaPrecioId}
            onChange={(e) => setListaPrecioId(e.target.value)}
            className="w-64 rounded-md border px-3 py-2 text-sm"
          >
            <option value="">Elige una lista…</option>
            {listas.map((l) => (
              <option key={l.id} value={l.id}>
                {l.nombre}
              </option>
            ))}
          </select>
        </div>
        {productos.length > 0 && (
          <div>
            <p className="mb-2 text-sm font-medium">
              Precio especial (override), opcional por presentación
            </p>
            <div className="flex flex-col gap-2">
              {productos.flatMap((producto) =>
                producto.presentaciones.map((presentacion) => (
                  <div key={presentacion.id} className="flex items-center gap-2 text-sm">
                    <span className="w-56">
                      {producto.nombre} · {presentacion.volumen}
                    </span>
                    <input
                      type="number"
                      min={0.01}
                      step="0.01"
                      placeholder="Usa la lista"
                      aria-label={`Precio especial ${producto.nombre} ${presentacion.volumen}`}
                      disabled={enviando}
                      value={overrides.get(presentacion.id) ?? ""}
                      onChange={(e) => cambiarOverride(presentacion.id, e.target.value)}
                      className="w-32 rounded-md border px-2 py-1"
                    />
                  </div>
                )),
              )}
            </div>
          </div>
        )}
      </fieldset>

      <fieldset className="flex flex-col gap-4">
        <legend className="mb-1 text-sm font-semibold text-muted-foreground">
          Promoción y crédito
        </legend>
        <div className="flex flex-wrap gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="promocion" className="text-sm font-medium">
              Promoción
            </label>
            <select
              id="promocion"
              disabled={enviando}
              value={promocion}
              onChange={(e) => setPromocion(e.target.value as Promocion)}
              className="w-40 rounded-md border px-3 py-2 text-sm"
            >
              <option value="ninguna">Ninguna</option>
              <option value="10+1">10+1</option>
              <option value="20+1">20+1</option>
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="comision" className="text-sm font-medium">
              % Comisión
            </label>
            <input
              id="comision"
              type="number"
              min={0}
              max={100}
              step="0.01"
              disabled={enviando}
              value={pctComision}
              onChange={(e) => setPctComision(e.target.value)}
              className="w-32 rounded-md border px-3 py-2 text-sm"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="credito" className="text-sm font-medium">
              Plazo de crédito (días)
            </label>
            <input
              id="credito"
              type="number"
              min={0}
              step="1"
              disabled={enviando}
              value={plazoCreditoDias}
              onChange={(e) => setPlazoCreditoDias(e.target.value)}
              className="w-32 rounded-md border px-3 py-2 text-sm"
            />
          </div>
        </div>
        {promocion !== "ninguna" && (
          <div>
            <p className="mb-2 text-sm font-medium">Productos Jawa con promoción</p>
            <div className="flex flex-wrap gap-3">
              {productos.map((producto) => (
                <label key={producto.id} className="flex items-center gap-1.5 text-sm">
                  <input
                    type="checkbox"
                    disabled={enviando}
                    checked={productosPromocion.includes(producto.id)}
                    onChange={() => alternarProducto(producto.id)}
                  />
                  {producto.nombre}
                </label>
              ))}
            </div>
          </div>
        )}
      </fieldset>

      <fieldset className="flex flex-col gap-4">
        <legend className="mb-1 text-sm font-semibold text-muted-foreground">
          Ubicación y notas
        </legend>
        <div className="flex flex-wrap gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="lat" className="text-sm font-medium">
              Latitud
            </label>
            <input
              id="lat"
              type="number"
              step="0.000001"
              min={-90}
              max={90}
              disabled={enviando}
              value={lat}
              onChange={(e) => setLat(e.target.value)}
              className="w-40 rounded-md border px-3 py-2 text-sm"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="lng" className="text-sm font-medium">
              Longitud
            </label>
            <input
              id="lng"
              type="number"
              step="0.000001"
              min={-180}
              max={180}
              disabled={enviando}
              value={lng}
              onChange={(e) => setLng(e.target.value)}
              className="w-40 rounded-md border px-3 py-2 text-sm"
            />
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="comentarios" className="text-sm font-medium">
            Comentarios
          </label>
          <textarea
            id="comentarios"
            maxLength={2000}
            disabled={enviando}
            rows={3}
            value={comentarios}
            onChange={(e) => setComentarios(e.target.value)}
            className="rounded-md border px-3 py-2 text-sm"
          />
        </div>
      </fieldset>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="flex gap-2">
        <Button type="submit" disabled={enviando}>
          {enviando ? "Guardando…" : "Guardar"}
        </Button>
        <Button type="button" variant="outline" disabled={enviando} onClick={alCancelar}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}
