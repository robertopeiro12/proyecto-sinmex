"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/components/auth/auth-provider";
import { useEnvioFormulario } from "@/components/catalogo/use-envio-formulario";
import { listarSucursales, type Sucursal } from "@/lib/sucursales";
import { crearVehiculo, editarVehiculo, type Vehiculo } from "@/lib/vehiculos";

interface Props {
  /** El vehiculo a editar, o null para dar de alta uno nuevo. */
  vehiculo: Vehiculo | null;
  alGuardar: () => void;
  alCancelar: () => void;
}

export function FormularioVehiculo({
  vehiculo,
  alGuardar,
  alCancelar,
}: Props) {
  const { usuario } = useAuth();
  const esAlta = vehiculo === null;

  // `usuario.sucursal === null` = General (D3). Es el mismo dato que el backend
  // usa para resolver el alcance, asi que el formulario no puede discrepar de lo
  // que la API va a hacer: /auth/me ya lo devuelve desde T-06.
  //
  // `usuario` puede ser null mientras la sesion carga; ahi NO se pinta el
  // desplegable, que es lo conservador: el boton "Nuevo vehiculo" tampoco existe
  // todavia porque `puede()` devuelve false mientras carga, asi que este
  // formulario ni siquiera se puede abrir en ese estado.
  const eligeSucursal = esAlta && usuario !== null && usuario.sucursal === null;

  const [nombre, setNombre] = useState(vehiculo?.nombre ?? "");
  const [km, setKm] = useState(vehiculo?.kmInicial?.toString() ?? "");
  const [activo, setActivo] = useState(vehiculo?.activo ?? true);
  const [sucursalId, setSucursalId] = useState("");
  const [sucursales, setSucursales] = useState<Sucursal[]>([]);
  const { enviando, error, enviar } = useEnvioFormulario(
    "No se pudo guardar el vehículo.",
  );

  useEffect(() => {
    if (!eligeSucursal) return;
    let vigente = true;

    // Solo las activas: dar de alta un vehiculo en una sucursal desactivada no
    // tiene sentido. El fallo se ignora a proposito — el desplegable se queda
    // vacio, el boton Guardar deshabilitado, y el usuario ve que algo falta sin
    // un segundo mensaje de error compitiendo con el del formulario.
    void listarSucursales()
      .then((lista) => {
        if (vigente) setSucursales(lista.filter((s) => s.activa));
      })
      .catch(() => {});

    return () => {
      vigente = false;
    };
  }, [eligeSucursal]);

  async function alEnviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const kmNumero = Number(km);

    await enviar(
      () =>
        vehiculo
          ? editarVehiculo(vehiculo.id, {
              nombre,
              kmInicial: kmNumero,
              activo,
            })
          : crearVehiculo({
              nombre,
              kmInicial: kmNumero,
              // Solo va cuando el usuario de verdad eligio una. A un usuario
              // atado el backend se lo ignoraria igual, pero mandarlo seria
              // mentir sobre lo que la pantalla hizo.
              ...(eligeSucursal ? { sucursalId } : {}),
            }),
      alGuardar,
    );
  }

  return (
    <form
      onSubmit={alEnviar}
      className="mb-6 flex flex-col gap-4 rounded-md border p-4"
    >
      <h2 className="text-sm font-semibold">
        {esAlta ? "Nuevo vehículo" : `Editar ${vehiculo.nombre}`}
      </h2>

      <div className="flex flex-wrap gap-4">
        <div className="flex flex-1 flex-col gap-1.5">
          <label htmlFor="nombre" className="text-sm font-medium">
            Nombre del vehículo
          </label>
          <input
            id="nombre"
            name="nombre"
            required
            maxLength={80}
            disabled={enviando}
            placeholder="Nissan 2019"
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            className="rounded-md border px-3 py-2 text-sm"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="km" className="text-sm font-medium">
            Kilometraje {esAlta ? "al alta" : "de alta"}
          </label>
          <input
            id="km"
            name="km"
            type="number"
            required
            min={0}
            step="0.01"
            disabled={enviando}
            value={km}
            onChange={(e) => setKm(e.target.value)}
            className="w-40 rounded-md border px-3 py-2 text-sm"
          />
        </div>
      </div>

      {eligeSucursal && (
        <div className="flex flex-col gap-1.5">
          <label htmlFor="sucursal" className="text-sm font-medium">
            Sucursal
          </label>
          <select
            id="sucursal"
            name="sucursal"
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

      {!esAlta && (
        <p className="text-xs text-muted-foreground">
          Sucursal: {vehiculo.sucursalCodigo}. La sucursal de un vehículo no se
          puede cambiar.
        </p>
      )}

      {!esAlta && (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={activo}
            disabled={enviando}
            onChange={(e) => setActivo(e.target.checked)}
          />
          Activo
        </label>
      )}

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="flex gap-2">
        <Button type="submit" disabled={enviando}>
          {enviando ? "Guardando…" : "Guardar"}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={enviando}
          onClick={alCancelar}
        >
          Cancelar
        </Button>
      </div>
    </form>
  );
}
