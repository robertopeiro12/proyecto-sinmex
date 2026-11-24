"use client";

import { useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { EncabezadoPantalla, Pantalla } from "@/components/ui/encabezado-pantalla";
import { EstadoPantalla } from "@/components/ui/estado-pantalla";
import { Pestanas } from "@/components/ui/pestanas";
import { infoDeTipo, TIPOS_OPERACION, type OperacionAlmacen, type TipoOperacion } from "@/lib/operaciones-almacen";
import { hoyEnTijuana } from "@/lib/ventas";
import type { CargaRejilla, Rejilla } from "@/lib/cargas";
import { CapturaOperacion } from "./captura-operacion";
import { CapturaRecarga } from "./captura-recarga";
import { ListaRecargas } from "./lista-recargas";
import { ListaOperaciones } from "./lista-operaciones";
import { diaDeEnvio } from "./selector-dia-envio";

const TITULO = "Registro de Operación";
const DESCRIPCION = "Anota lo que entra, sale o se pierde del almacén cada día.";

interface Captura {
  tipo: TipoOperacion;
  operacion: OperacionAlmacen | null;
  fecha: string;
}

interface CapturaDeRecarga {
  rejilla: Rejilla;
  carga: CargaRejilla | null;
  vendedorId: string;
}

/**
 * Las pestañas de la pantalla, en el orden del cliente. Las recargas no son una operación
 * de almacén (usan /cargas): van aparte de TIPOS_OPERACION, que es del backend de operaciones.
 */
type PestanaPantalla = { valor: string; etiqueta: string; permiso: string; tipo: TipoOperacion | "recarga" };
const PESTANA_RECARGA: PestanaPantalla = { valor: "recarga", etiqueta: "Recargas", permiso: "carga.gestionar", tipo: "recarga" };

function pestanasDePantalla(): PestanaPantalla[] {
  const deOperacion = TIPOS_OPERACION.map((t): PestanaPantalla => ({ valor: t.tipo, etiqueta: infoDeTipo(t.tipo).etiqueta, permiso: t.permiso, tipo: t.tipo }));
  return [deOperacion[0], PESTANA_RECARGA, ...deOperacion.slice(1)];
}

/** Un envío nuevo solo admite hoy o ayer: con otro día en la pestaña, abre en hoy. */
function fechaDeNueva(tipo: TipoOperacion, fecha: string): string {
  return tipo === "envio" ? diaDeEnvio(fecha) : fecha;
}

/**
 * Producción › Registro de Operación (parte 1): una pestaña por tipo de operación de
 * almacén, solo las que el usuario puede usar. La lista de cada una es de un día; capturar
 * o corregir abre una pantalla completa. La página la monta con `key={sucursal}`.
 */
export function PantallaRegistroOperacion({ sucursal, pestana }: { sucursal: string | null; pestana: string | null }) {
  const { usuario, puede, cargando } = useAuth();
  const [captura, setCaptura] = useState<Captura | null>(null);
  const [actual, setActual] = useState<string | null>(pestana);
  // La pestaña con la que se monta la lista. Solo cambia al volver de una captura: si
  // siguiera a `actual`, las Pestanas (no controladas) recibirían otro valor inicial ya
  // montadas y base-ui avisa del cambio.
  const [inicialLista, setInicialLista] = useState<string | null>(pestana);
  // Cambia al guardar o dar de baja: las listas se vuelven a pedir.
  const [version, setVersion] = useState(0);
  const [fecha, setFecha] = useState(hoyEnTijuana());
  const [recarga, setRecarga] = useState<CapturaDeRecarga | null>(null);
  const [avisoRecarga, setAvisoRecarga] = useState<string | null>(null);

  if (cargando) return <EstadoPantalla titulo={TITULO} tipo="cargando" />;
  const tipos = pestanasDePantalla().filter((t) => puede(t.permiso));
  if (tipos.length === 0) return <EstadoPantalla titulo={TITULO} tipo="sin-permiso" />;

  const codigo = usuario?.sucursal?.codigo ?? (sucursal && sucursal.toLowerCase() !== "todas" ? sucursal.toUpperCase() : null);
  if (!codigo) return <EstadoPantalla titulo={TITULO} tipo="elige-sucursal" />;

  if (recarga) {
    return (
      <CapturaRecarga
        key={recarga.carga?.id ?? "nueva"}
        rejilla={recarga.rejilla}
        carga={recarga.carga}
        vendedorId={recarga.vendedorId}
        onVolver={() => {
          setInicialLista(actual);
          setRecarga(null);
        }}
        onGuardado={(aviso) => {
          setInicialLista(actual);
          setRecarga(null);
          setAvisoRecarga(aviso);
          setVersion((v) => v + 1);
        }}
      />
    );
  }

  if (captura) {
    return (
      <CapturaOperacion
        key={captura.operacion?.id ?? "nueva"}
        tipo={captura.tipo}
        sucursal={captura.operacion?.sucursal.codigo ?? codigo}
        operacion={captura.operacion}
        fecha={captura.fecha}
        onVolver={() => {
          setInicialLista(actual);
          setCaptura(null);
        }}
        onGuardado={() => {
          setInicialLista(actual);
          setCaptura(null);
          setVersion((v) => v + 1);
        }}
      />
    );
  }

  const inicial = tipos.some((t) => t.tipo === inicialLista) ? (inicialLista as string) : tipos[0].tipo;

  return (
    <Pantalla key="lista">
      <EncabezadoPantalla titulo={TITULO} descripcion={DESCRIPCION} />
      <Pestanas
        etiqueta="Tipo de operación"
        valorInicial={inicial}
        onCambio={setActual}
        pestanas={tipos.map((t) => ({
          valor: t.tipo,
          etiqueta: t.etiqueta,
          contenido:
            t.tipo === "recarga" ? (
              <ListaRecargas
                key={`recarga-${version}`}
                sucursal={codigo}
                aviso={avisoRecarga}
                onCapturar={(rejilla, carga, vendedorId) => setRecarga({ rejilla, carga, vendedorId })}
              />
            ) : (
            <ListaOperaciones
              key={`${t.tipo}-${version}`}
              tipo={t.tipo as TipoOperacion}
              sucursal={codigo}
              fecha={fecha}
              onFecha={setFecha}
              onCapturar={(operacion) => setCaptura({ tipo: t.tipo as TipoOperacion, operacion, fecha: operacion?.fecha ?? fechaDeNueva(t.tipo as TipoOperacion, fecha) })}
            />
            ),
        }))}
      />
    </Pantalla>
  );
}
