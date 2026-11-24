"use client";

import { useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { EncabezadoPantalla, Pantalla } from "@/components/ui/encabezado-pantalla";
import { EstadoPantalla } from "@/components/ui/estado-pantalla";
import { Pestanas } from "@/components/ui/pestanas";
import { infoDeTipo, TIPOS_OPERACION, type OperacionAlmacen, type TipoOperacion } from "@/lib/operaciones-almacen";
import { diaAnterior } from "@/lib/fechas";
import { hoyEnTijuana } from "@/lib/ventas";
import { CapturaOperacion } from "./captura-operacion";
import { ListaOperaciones } from "./lista-operaciones";

const TITULO = "Registro de Operación";
const DESCRIPCION = "Anota lo que entra, sale o se pierde del almacén cada día.";

interface Captura {
  tipo: TipoOperacion;
  operacion: OperacionAlmacen | null;
  fecha: string;
}

/** Un envío nuevo solo admite hoy o ayer: con un día más viejo en la pestaña, abre en hoy. */
function fechaDeNueva(tipo: TipoOperacion, fecha: string): string {
  const hoy = hoyEnTijuana();
  if (tipo === "envio" && fecha < diaAnterior(hoy)) return hoy;
  return fecha;
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

  if (cargando) return <EstadoPantalla titulo={TITULO} tipo="cargando" />;
  const tipos = TIPOS_OPERACION.filter((t) => puede(t.permiso));
  if (tipos.length === 0) return <EstadoPantalla titulo={TITULO} tipo="sin-permiso" />;

  const codigo = usuario?.sucursal?.codigo ?? (sucursal && sucursal.toLowerCase() !== "todas" ? sucursal.toUpperCase() : null);
  if (!codigo) return <EstadoPantalla titulo={TITULO} tipo="elige-sucursal" />;

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
          etiqueta: infoDeTipo(t.tipo).etiqueta,
          contenido: (
            <ListaOperaciones
              key={`${t.tipo}-${version}`}
              tipo={t.tipo}
              sucursal={codigo}
              fecha={fecha}
              onFecha={setFecha}
              onCapturar={(operacion) => setCaptura({ tipo: t.tipo, operacion, fecha: operacion?.fecha ?? fechaDeNueva(t.tipo, fecha) })}
            />
          ),
        }))}
      />
    </Pantalla>
  );
}
