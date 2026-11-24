"use client";

import { useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { EncabezadoPantalla, Pantalla } from "@/components/ui/encabezado-pantalla";
import { EstadoPantalla } from "@/components/ui/estado-pantalla";
import { Pestanas } from "@/components/ui/pestanas";
import { infoDeTipo, TIPOS_OPERACION, type OperacionAlmacen, type TipoOperacion } from "@/lib/operaciones-almacen";
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

/**
 * Producción › Registro de Operación (parte 1): una pestaña por tipo de operación de
 * almacén, solo las que el usuario puede usar. La lista de cada una es de un día; capturar
 * o corregir abre una pantalla completa. La página la monta con `key={sucursal}`.
 */
export function PantallaRegistroOperacion({ sucursal, pestana }: { sucursal: string | null; pestana: string | null }) {
  const { usuario, puede, cargando } = useAuth();
  const [captura, setCaptura] = useState<Captura | null>(null);
  const [actual, setActual] = useState<string | null>(pestana);
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
        onVolver={() => setCaptura(null)}
        onGuardado={() => {
          setCaptura(null);
          setVersion((v) => v + 1);
        }}
      />
    );
  }

  const inicial = tipos.some((t) => t.tipo === (actual ?? pestana)) ? ((actual ?? pestana) as string) : tipos[0].tipo;

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
              onCapturar={(operacion) => setCaptura({ tipo: t.tipo, operacion, fecha: operacion?.fecha ?? fecha })}
            />
          ),
        }))}
      />
    </Pantalla>
  );
}
