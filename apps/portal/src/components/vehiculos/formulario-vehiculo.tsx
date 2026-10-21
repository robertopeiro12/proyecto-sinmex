"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Campo, Casilla, Entrada, Lista } from "@/components/ui/campo";
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
  const [placas, setPlacas] = useState(vehiculo?.placas ?? "");
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
              // Un vehiculo anterior a T-68 puede no tener placas: si se deja
              // vacio no se manda, para que editarlo no truene (el backend
              // rechaza "" con 400). Uno que ya las tiene no puede borrarlas.
              ...(placas.trim() !== "" ? { placas } : {}),
              kmInicial: kmNumero,
              activo,
            })
          : crearVehiculo({
              nombre,
              placas,
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
    <form onSubmit={alEnviar} className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-4">
        <Campo id="nombre" etiqueta="Nombre del vehículo" className="flex-1">
          <Entrada
            id="nombre"
            name="nombre"
            required
            maxLength={80}
            disabled={enviando}
            placeholder="Nissan 2019"
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
          />
        </Campo>

        <Campo id="placas" etiqueta="Placas">
          <Entrada
            id="placas"
            name="placas"
            required={esAlta || vehiculo.placas !== null}
            maxLength={20}
            disabled={enviando}
            placeholder="ABC-123"
            value={placas}
            onChange={(e) => setPlacas(e.target.value)}
            className="w-40"
          />
        </Campo>

        <Campo id="km" etiqueta={`Kilometraje ${esAlta ? "al alta" : "de alta"}`}>
          <Entrada
            id="km"
            name="km"
            type="number"
            required
            min={0}
            max={99999999.99}
            step="0.01"
            disabled={enviando}
            value={km}
            onChange={(e) => setKm(e.target.value)}
            className="w-40"
          />
        </Campo>
      </div>

      {eligeSucursal && (
        <Campo id="sucursal" etiqueta="Sucursal">
          <Lista
            id="sucursal"
            name="sucursal"
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

      {!esAlta && (
        <p className="text-xs text-muted-foreground">
          Sucursal: {vehiculo.sucursalCodigo}. La sucursal de un vehículo no se
          puede cambiar.
        </p>
      )}

      {!esAlta && (
        <Casilla
          etiqueta="Activo"
          checked={activo}
          disabled={enviando}
          onChange={(e) => setActivo(e.target.checked)}
        />
      )}

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" disabled={enviando} onClick={alCancelar}>
          Cancelar
        </Button>
        <Button type="submit" disabled={enviando}>
          {enviando ? "Guardando…" : "Guardar"}
        </Button>
      </div>
    </form>
  );
}
