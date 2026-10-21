"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { AreaTexto, Campo, Casilla, Entrada, Lista } from "@/components/ui/campo";
import { useAuth } from "@/components/auth/auth-provider";
import { useEnvioFormulario } from "@/components/catalogo/use-envio-formulario";
import { listarSucursales, type Sucursal } from "@/lib/sucursales";
import { listarProductos, type Producto } from "@/lib/productos";
import { listarListasPrecio, type ListaPrecio } from "@/lib/precios";
import {
  crearCliente,
  editarCliente,
  ubicarCliente,
  type ClienteDetalle,
} from "@/lib/clientes";
import { mensajeDe } from "@/lib/api";
import {
  coordenadaAEnviar,
  domicilioSinGuardar,
  etiquetaOrigenUbicacion,
  muestraBotonUbicar,
  type CamposCoordenada,
  type UbicacionReferencia,
} from "@/lib/ubicacion-cliente";
import { FotoProspecto } from "./foto-prospecto";
import { PromocionesDeCliente } from "./promociones-de-cliente";
import { SelectorTipoNegocio } from "./selector-tipo-negocio";

interface Props {
  /** El cliente a editar, o null para dar de alta uno nuevo. */
  cliente: ClienteDetalle | null;
  alGuardar: () => void;
  alCancelar: () => void;
}

export function FormularioCliente(props: Props) {
  const { cliente } = props;
  return (
    <>
      <FormularioDatosCliente {...props} />
      {/*
        Fuera del <form> de los datos: FormularioPromocion trae el suyo y un form dentro de otro
        es HTML inválido. Solo al editar: en un alta no hay `id` con el que pedir sus promociones.
      */}
      {cliente !== null && (
        <PromocionesDeCliente clienteId={cliente.id} clienteNombre={cliente.nombre} />
      )}
    </>
  );
}

function FormularioDatosCliente({ cliente, alGuardar, alCancelar }: Props) {
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
  const [plazoCreditoDias, setPlazoCreditoDias] = useState(
    cliente?.plazoCreditoDias?.toString() ?? "",
  );
  const [lat, setLat] = useState(cliente?.lat?.toString() ?? "");
  const [lng, setLng] = useState(cliente?.lng?.toString() ?? "");
  // T-72: los campos como se cargaron (null en un alta). Si siguen así al
  // guardar, la coordenada no viaja y el servidor conserva la que tenga
  // (ver `coordenadaAEnviar`). Mismo motivo de `useState` que `overridesIniciales`.
  const [coordenadaCargada] = useState<CamposCoordenada | null>(() =>
    cliente ? { lat: cliente.lat?.toString() ?? "", lng: cliente.lng?.toString() ?? "" } : null,
  );
  // T-72 (D6): la coordenada guardada (o la que acaba de dar Google) y su
  // origen. La etiqueta compara los campos contra esto.
  const [referencia, setReferencia] = useState<UbicacionReferencia>({
    lat: cliente?.lat ?? null,
    lng: cliente?.lng ?? null,
    origen: cliente?.ubicacionOrigen ?? null,
  });
  const [ubicando, setUbicando] = useState(false);
  const [avisoUbicar, setAvisoUbicar] = useState<string | null>(null);
  const [comentarios, setComentarios] = useState(cliente?.comentarios ?? "");
  const [sucursalId, setSucursalId] = useState("");

  // Punto de partida de los overrides: presentacionId -> texto del input.
  // Se calcula UNA vez (no en un efecto) porque PantallaClientes envuelve
  // este formulario en un `key` que cambia entre alta y cada cliente
  // distinto (ver pantalla-clientes.tsx), remontandolo al cambiar de fila
  // (mismo motivo que documenta CeldaPrecio en T-18), asi que nunca hace
  // falta resincronizar con un prop que cambio por debajo.
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

  /**
   * "Ubicar con la dirección" (T-72, D5): el servidor espera a Google (≤ 5 s).
   * Con éxito, la coordenada ya quedó guardada: se pinta en los campos y en la
   * referencia, así que la etiqueta dice "Ubicada por Google" y guardar después
   * no la vuelve "a mano". Un 409/502 trae el motivo en español.
   */
  async function ubicarConDireccion() {
    if (!cliente) return;
    setAvisoUbicar(null);
    setUbicando(true);
    try {
      const r = await ubicarCliente(cliente.id);
      setLat(r.lat.toString());
      setLng(r.lng.toString());
      setReferencia({ lat: r.lat, lng: r.lng, origen: r.ubicacionOrigen });
    } catch (err) {
      setAvisoUbicar(mensajeDe(err, "No se pudo ubicar al cliente."));
    } finally {
      setUbicando(false);
    }
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
    // el backend lo borre (D5 del spec); uno nuevo o realmente modificado
    // viaja con su número. Uno que sigue exactamente IGUAL a como estaba al
    // abrir el formulario se OMITE del payload: `vigenteDesde` siempre es
    // hoy, asi que reenviarlo sin cambios re-dataria su vigencia a hoy en
    // cada guardado y borraria el historial real de "vigente desde tal
    // fecha" sin que el usuario haya tocado ese precio.
    const overridesPrecio = Array.from(overridesIniciales.keys())
      .filter((id) => !overrides.has(id))
      .map((presentacionId) => ({ presentacionId, precio: null as number | null }))
      .concat(
        Array.from(overrides.entries())
          .filter(
            ([presentacionId, texto]) =>
              overridesIniciales.get(presentacionId) !== texto,
          )
          .map(([presentacionId, texto]) => ({
            presentacionId,
            precio: Number(texto),
          })),
      );

    const datos = {
      nombre,
      domicilio,
      telefono,
      // En edicion, omitir el encargado conserva el actual (el backend no lo borra).
      encargado: encargado.trim() === "" ? undefined : encargado,
      factura,
      tipoNegocioId: tipoNegocioId === "" ? undefined : tipoNegocioId,
      listaPrecioId,
      pctComision: pctComision.trim() === "" ? undefined : Number(pctComision),
      plazoCreditoDias:
        plazoCreditoDias.trim() === "" ? undefined : Number(plazoCreditoDias),
      ...coordenadaAEnviar({ lat, lng }, coordenadaCargada),
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
    <form onSubmit={alEnviar} className="flex flex-col gap-6">
      <fieldset className="flex flex-col gap-4">
        <legend className="mb-1 text-sm font-semibold text-muted-foreground">
          Datos básicos
        </legend>
        <div className="flex flex-wrap gap-4">
          <Campo id="nombre" etiqueta="Nombre" className="flex-1">
            <Entrada
              id="nombre"
              required
              maxLength={120}
              disabled={enviando}
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
            />
          </Campo>
          <Campo id="domicilio" etiqueta="Domicilio / referencia" className="flex-1">
            <Entrada
              id="domicilio"
              required
              maxLength={300}
              disabled={enviando}
              value={domicilio}
              onChange={(e) => setDomicilio(e.target.value)}
            />
          </Campo>
        </div>
        <div className="flex flex-wrap items-end gap-4">
          <Campo id="telefono" etiqueta="Teléfono">
            <Entrada
              id="telefono"
              required
              maxLength={30}
              disabled={enviando}
              value={telefono}
              onChange={(e) => setTelefono(e.target.value)}
              className="w-48"
            />
          </Campo>
          <Campo id="encargado" etiqueta="Encargado">
            <Entrada
              id="encargado"
              required={esAlta || cliente.encargado !== null}
              maxLength={120}
              disabled={enviando}
              value={encargado}
              onChange={(e) => setEncargado(e.target.value)}
              className="w-48"
            />
          </Campo>
          {esAlta && (
            <Campo id="tipo" etiqueta="Tipo">
              <Lista
                id="tipo"
                disabled={enviando}
                value={tipo}
                onChange={(e) => setTipo(e.target.value as "cliente" | "prospecto")}
                className="w-40"
              >
                <option value="cliente">Cliente</option>
                <option value="prospecto">Prospecto</option>
              </Lista>
            </Campo>
          )}
          <div className="flex h-9 items-center">
            <Casilla
              etiqueta="¿Requiere factura?"
              checked={factura}
              disabled={enviando}
              onChange={(e) => setFactura(e.target.checked)}
            />
          </div>
        </div>
        <SelectorTipoNegocio
          value={tipoNegocioId}
          onChange={setTipoNegocioId}
          disabled={enviando}
        />
        {/*
          La foto del lugar (T-40). Va aquí, con los datos básicos, porque es lo
          que el administrador mira para reconocer el negocio del que le están
          hablando — junto al nombre y al giro, no al final entre los precios.

          Solo al editar: en un alta no hay `id` con el que pedirla, y la foto
          nunca nace en el portal (la toma el vendedor en campo). Si el
          prospecto no tiene foto, `FotoProspecto` no dibuja NADA: sin hueco.
        */}
        {!esAlta && (
          <FotoProspecto
            clienteId={cliente.id}
            tieneFoto={cliente.tieneFoto}
            fotoSubidaEn={cliente.fotoSubidaEn}
            nombre={cliente.nombre}
          />
        )}
        {!esAlta && (
          <p className="text-xs text-muted-foreground">
            Sucursal: {cliente.sucursalCodigo}. La sucursal de un cliente no se
            puede cambiar.
          </p>
        )}
        {eligeSucursal && (
          <Campo id="sucursal" etiqueta="Sucursal">
            <Lista
              id="sucursal"
              required
              disabled={enviando}
              value={sucursalId}
              onChange={(e) => setSucursalId(e.target.value)}
              className="w-64"
            >
              <option value="">Elige una sucursal…</option>
              {sucursales.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.codigo} · {s.nombre}
                </option>
              ))}
            </Lista>
          </Campo>
        )}
      </fieldset>

      <fieldset className="flex flex-col gap-4">
        <legend className="mb-1 text-sm font-semibold text-muted-foreground">
          Precio
        </legend>
        <Campo id="lista" etiqueta="Lista de precios">
          <Lista
            id="lista"
            required
            disabled={enviando}
            value={listaPrecioId}
            onChange={(e) => setListaPrecioId(e.target.value)}
            className="w-64"
          >
            <option value="">Elige una lista…</option>
            {listas.map((l) => (
              <option key={l.id} value={l.id}>
                {l.nombre}
              </option>
            ))}
          </Lista>
        </Campo>
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
                      {!producto.activo && (
                        <span className="ml-2 text-xs text-muted-foreground">
                          Inactivo
                        </span>
                      )}
                    </span>
                    <Entrada
                      type="number"
                      min={0.01}
                      step="0.01"
                      placeholder="Usa la lista"
                      aria-label={`Precio especial ${producto.nombre} ${presentacion.volumen}`}
                      disabled={enviando}
                      value={overrides.get(presentacion.id) ?? ""}
                      onChange={(e) => cambiarOverride(presentacion.id, e.target.value)}
                      className="w-32"
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
          Comisión y crédito
        </legend>
        <div className="flex flex-wrap gap-4">
          <Campo opcional id="comision" etiqueta="% Comisión">
            <Entrada
              id="comision"
              type="number"
              min={0}
              max={100}
              step="0.01"
              disabled={enviando}
              value={pctComision}
              onChange={(e) => setPctComision(e.target.value)}
              className="w-32"
            />
          </Campo>
          <Campo opcional id="credito" etiqueta="Plazo de crédito (días)">
            <Entrada
              id="credito"
              type="number"
              min={0}
              step="1"
              disabled={enviando}
              value={plazoCreditoDias}
              onChange={(e) => setPlazoCreditoDias(e.target.value)}
              className="w-32"
            />
          </Campo>
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-4">
        <legend className="mb-1 text-sm font-semibold text-muted-foreground">
          Ubicación y notas
        </legend>
        <div className="flex flex-wrap gap-4">
          <Campo opcional id="lat" etiqueta="Latitud">
            <Entrada
              id="lat"
              type="number"
              step="0.000001"
              min={-90}
              max={90}
              disabled={enviando}
              value={lat}
              onChange={(e) => setLat(e.target.value)}
              className="w-40"
            />
          </Campo>
          <Campo opcional id="lng" etiqueta="Longitud">
            <Entrada
              id="lng"
              type="number"
              step="0.000001"
              min={-180}
              max={180}
              disabled={enviando}
              value={lng}
              onChange={(e) => setLng(e.target.value)}
              className="w-40"
            />
          </Campo>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm text-muted-foreground">
            Origen de la ubicación: {etiquetaOrigenUbicacion(lat, lng, referencia)}
          </p>
          {!esAlta && muestraBotonUbicar(lat, lng, cliente.domicilio) && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={enviando || ubicando || domicilioSinGuardar(domicilio, cliente.domicilio)}
              onClick={ubicarConDireccion}
            >
              {ubicando ? "Ubicando…" : "Ubicar con la dirección"}
            </Button>
          )}
          {/* El servidor geocodifica el domicilio GUARDADO, no el del campo. */}
          {!esAlta &&
            muestraBotonUbicar(lat, lng, cliente.domicilio) &&
            domicilioSinGuardar(domicilio, cliente.domicilio) && (
              <p className="text-xs text-muted-foreground">
                Guarda el domicilio antes de ubicarlo.
              </p>
            )}
        </div>
        {avisoUbicar && (
          <p role="status" className="text-sm text-destructive">
            {avisoUbicar}
          </p>
        )}
        <Campo opcional id="comentarios" etiqueta="Comentarios">
          <AreaTexto
            id="comentarios"
            maxLength={2000}
            disabled={enviando}
            rows={3}
            value={comentarios}
            onChange={(e) => setComentarios(e.target.value)}
          />
        </Campo>
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
