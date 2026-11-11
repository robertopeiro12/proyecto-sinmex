"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { Aviso } from "@/components/ui/aviso";
import { Button } from "@/components/ui/button";
import { Campo, Entrada } from "@/components/ui/campo";
import { useConfirmar } from "@/components/ui/confirmar";
import { EncabezadoPantalla, Pantalla } from "@/components/ui/encabezado-pantalla";
import { EstadoPantalla } from "@/components/ui/estado-pantalla";
import { Pestanas } from "@/components/ui/pestanas";
import { CajaTabla, FilaVacia, Tabla, Td, Th } from "@/components/ui/tabla";
import { Ventana } from "@/components/ui/ventana";
import { mensajeDe } from "@/lib/api";
import {
  crearRutaSemanal,
  diaDeHoy,
  DIAS_SEMANA,
  listarRutasSemanales,
  nombreDiaSemana,
  rutasDelDia,
  type RutaSemanalResumen,
} from "@/lib/rutas-semanales";
import { hoyEnTijuana } from "@/lib/ventas";
import { confirmarYEliminarRuta } from "./eliminar-ruta";
import { EditarRutaSemanal } from "./editar-ruta-semanal";

const TITULO = "Ruta Semanal";
const DESCRIPCION = "Las rutas con nombre de cada día de la semana y los clientes que visitan.";
const capitalizar = (texto: string) => texto.charAt(0).toUpperCase() + texto.slice(1);

/**
 * Operación → Ruta Semanal: una pestaña por día (lunes a sábado), las rutas de ese día
 * y "Crear ruta". Picar una ruta abre su edición a pantalla completa.
 */
export function PantallaRutaSemanal({ sucursal }: { sucursal: string | null }) {
  const { usuario, puede, cargando } = useAuth();

  if (cargando) return <EstadoPantalla titulo={TITULO} tipo="cargando" />;
  if (!puede("ruta_semanal.gestionar")) return <EstadoPantalla titulo={TITULO} tipo="sin-permiso" />;

  const codigo =
    usuario?.sucursal?.codigo ?? (sucursal && sucursal.toLowerCase() !== "todas" ? sucursal.toUpperCase() : null);
  if (!codigo) return <EstadoPantalla titulo={TITULO} tipo="elige-sucursal" />;

  return <RutasSemanales key={codigo} sucursal={codigo} />;
}

function RutasSemanales({ sucursal }: { sucursal: string }) {
  const [rutas, setRutas] = useState<RutaSemanalResumen[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dia, setDia] = useState(() => diaDeHoy(hoyEnTijuana()));
  // Las pestañas no son controladas: su valor inicial se fija al montarlas y no cambia con
  // `onCambio` (Base UI avisa en la consola si cambia). Se actualiza solo al abrir la edición,
  // porque entonces las pestañas se desmontan y al volver se montan en el día que se dejó.
  const [diaInicial, setDiaInicial] = useState(dia);
  const [editando, setEditando] = useState<string | null>(null);
  const [creando, setCreando] = useState(false);
  const [errorEliminar, setErrorEliminar] = useState<string | null>(null);
  const [eliminando, setEliminando] = useState(false);
  const [creada, setCreada] = useState<string | null>(null);
  const { confirmar, ventana } = useConfirmar();

  function abrir(id: string) {
    setDiaInicial(dia);
    setCreada(null);
    setEditando(id);
  }

  const cargar = useCallback(() => {
    setError(null);
    return listarRutasSemanales(sucursal)
      .then(setRutas)
      .catch((err: unknown) => setError(mensajeDe(err, "No se pudieron cargar las rutas.")));
  }, [sucursal]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  async function eliminar(ruta: RutaSemanalResumen) {
    setErrorEliminar(null);
    setEliminando(true);
    try {
      const resultado = await confirmarYEliminarRuta(confirmar, ruta);
      if (resultado.estado === "eliminada") await cargar();
      else if (resultado.estado === "error") setErrorEliminar(resultado.mensaje);
    } finally {
      setEliminando(false);
    }
  }

  if (editando) {
    return (
      <EditarRutaSemanal
        key={editando}
        id={editando}
        sucursal={sucursal}
        onVolver={() => {
          setEditando(null);
          void cargar();
        }}
      />
    );
  }

  return (
    <Pantalla>
      <EncabezadoPantalla
        titulo={TITULO}
        descripcion={DESCRIPCION}
        acciones={
          <Button type="button" onClick={() => setCreando(true)}>
            Crear ruta
          </Button>
        }
      />
      {error ? <Aviso tono="error">{error}</Aviso> : null}
      {errorEliminar ? <Aviso tono="error">{errorEliminar}</Aviso> : null}
      {creada ? <Aviso tono="exito">{creada}</Aviso> : null}
      {rutas === null ? (
        error ? null : (
          <EstadoPantalla tipo="cargando" />
        )
      ) : (
        <Pestanas
          etiqueta="Día de la semana"
          valorInicial={String(diaInicial)}
          onCambio={(valor) => setDia(Number(valor))}
          pestanas={DIAS_SEMANA.map((nombre, i) => ({
            valor: String(i + 1),
            etiqueta: capitalizar(nombre),
            contenido: <RutasDelDia rutas={rutasDelDia(rutas, i + 1)} eliminando={eliminando} onAbrir={abrir} onEliminar={(r) => void eliminar(r)} />,
          }))}
        />
      )}
      <VentanaCrear
        abierta={creando}
        sucursal={sucursal}
        diaSemana={dia}
        alCerrar={() => setCreando(false)}
        alCrear={(nueva) => {
          // Se queda en la lista, en la pestaña del día en que se creó, con la confirmación.
          setCreando(false);
          setCreada(`Se creó la ruta «${nueva.nombre}» del ${nombreDiaSemana(nueva.diaSemana)}. Agrégale sus clientes con Editar.`);
          void cargar();
        }}
      />
      {ventana}
    </Pantalla>
  );
}

function RutasDelDia({
  rutas,
  eliminando,
  onAbrir,
  onEliminar,
}: {
  rutas: RutaSemanalResumen[];
  eliminando: boolean;
  onAbrir: (id: string) => void;
  onEliminar: (ruta: RutaSemanalResumen) => void;
}) {
  return (
    <CajaTabla>
      <Tabla className="table-fixed">
        <colgroup>
          <col />
          <col className="w-32" />
          <col className="w-[200px]" />
        </colgroup>
        <thead>
          <tr>
            <Th>Ruta</Th>
            <Th alinear="derecha">Clientes</Th>
            <Th>Acciones</Th>
          </tr>
        </thead>
        <tbody>
          {rutas.length === 0 ? (
            <FilaVacia columnas={3}>Sin rutas este día.</FilaVacia>
          ) : (
            rutas.map((r) => (
              <tr key={r.id}>
                <Td>
                  <button
                    type="button"
                    className="cursor-pointer font-medium underline-offset-2 hover:underline focus-visible:underline"
                    onClick={() => onAbrir(r.id)}
                  >
                    {r.nombre}
                  </button>
                </Td>
                <Td alinear="derecha">{r.clientes}</Td>
                <Td>
                  <div className="flex gap-1.5">
                    <Button type="button" size="sm" variant="outline" onClick={() => onAbrir(r.id)}>
                      Editar
                    </Button>
                    <Button type="button" size="sm" variant="outline" disabled={eliminando} onClick={() => onEliminar(r)}>
                      Eliminar
                    </Button>
                  </div>
                </Td>
              </tr>
            ))
          )}
        </tbody>
      </Tabla>
    </CajaTabla>
  );
}

function VentanaCrear({
  abierta,
  sucursal,
  diaSemana,
  alCerrar,
  alCrear,
}: {
  abierta: boolean;
  sucursal: string;
  diaSemana: number;
  alCerrar: () => void;
  alCrear: (nueva: RutaSemanalResumen) => void;
}) {
  const [nombre, setNombre] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  function cerrar() {
    setNombre("");
    setError(null);
    alCerrar();
  }

  async function crear(e: React.FormEvent) {
    e.preventDefault();
    setGuardando(true);
    setError(null);
    try {
      const nueva = await crearRutaSemanal({ sucursal, diaSemana, nombre: nombre.trim() });
      setNombre("");
      alCrear(nueva);
    } catch (err) {
      setError(mensajeDe(err, "No se pudo crear la ruta."));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Ventana abierta={abierta} alCerrar={cerrar} titulo={`Crear ruta del ${nombreDiaSemana(diaSemana)}`}>
      <form onSubmit={(e) => void crear(e)} className="flex flex-col gap-3">
        <Campo id="nueva-ruta-nombre" etiqueta="Nombre">
          <Entrada
            autoComplete="off"
            maxLength={80}
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
          />
        </Campo>
        {error ? <Aviso tono="error">{error}</Aviso> : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={cerrar}>
            Cancelar
          </Button>
          <Button type="submit" disabled={guardando || nombre.trim() === ""}>
            Crear ruta
          </Button>
        </div>
      </form>
    </Ventana>
  );
}
