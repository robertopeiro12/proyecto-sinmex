"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { Aviso } from "@/components/ui/aviso";
import { useConfirmar } from "@/components/ui/confirmar";
import { EncabezadoPantalla, Pantalla } from "@/components/ui/encabezado-pantalla";
import { EstadoPantalla } from "@/components/ui/estado-pantalla";
import { Pestanas } from "@/components/ui/pestanas";
import { listarClientes, type ClienteResumen } from "@/lib/clientes";
import { presentacionesParaAgregar } from "@/lib/cortes";
import { llevaCliente, TIPOS_PROCESO, type MermaDe, type Proceso, type ProcesosDelDia, type TipoProceso } from "@/lib/procesos";
import { listarProductos, type Producto } from "@/lib/productos";
import { listarVendedores, type Vendedor } from "@/lib/vendedores";
import { hoyEnTijuana } from "@/lib/ventas";
import type { OpcionPresentacion } from "./caja-productos";
import { CapturaProceso, QUIEN_OFICINA, type ModoFecha } from "./captura-proceso";
import { ListaProcesos } from "./lista-procesos";
import { TarjetaCliente } from "./tarjeta-cliente";

const TITULO = "Procesos";
const DESCRIPCION = "Lo que la oficina captura de cada cliente: ventas, notas, merma, cambios, consumos y promoción.";

/**
 * Operación › Procesos (PR A, D0/D1): el cliente arriba y una pestaña por tipo (solo las
 * que el usuario puede usar); cada pestaña es la captura arriba y la lista del día abajo.
 * Cambiar de cliente o de pestaña limpia la captura: si hay algo escrito, pregunta antes.
 * La página la monta con `key={sucursal}`.
 */
export function PantallaProcesos({ sucursal }: { sucursal: string | null }) {
  const { usuario, puede, cargando } = useAuth();
  const [actual, setActual] = useState<string | null>(null);
  const [cliente, setCliente] = useState<ClienteResumen | null>(null);
  const [clientes, setClientes] = useState<ClienteResumen[]>([]);
  const [vendedores, setVendedores] = useState<Vendedor[]>([]);
  const [productos, setProductos] = useState<Producto[]>([]);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);
  const sucio = useRef(false);
  const avisarSucio = useCallback((s: boolean) => {
    sucio.current = s;
  }, []);
  const { confirmar, ventana } = useConfirmar();

  const codigo = usuario?.sucursal?.codigo ?? (sucursal && sucursal.toLowerCase() !== "todas" ? sucursal.toUpperCase() : null);
  const tipos = TIPOS_PROCESO.filter((t) => puede(t.permiso));
  const hayTipos = tipos.length > 0;

  useEffect(() => {
    if (!codigo || !hayTipos) return;
    let vigente = true;
    const fallo = (texto: string) => () => vigente && setErrorCarga(texto);
    listarClientes(codigo, "todos").then((c) => vigente && setClientes(c), fallo("No se pudieron cargar los clientes."));
    listarVendedores(codigo).then(
      (v) => vigente && setVendedores(v.filter((x) => x.sucursalCodigo === codigo)),
      fallo("No se pudieron cargar los vendedores."),
    );
    listarProductos().then((p) => vigente && setProductos(p), fallo("No se pudieron cargar los productos."));
    return () => {
      vigente = false;
    };
  }, [codigo, hayTipos]);

  const opciones: OpcionPresentacion[] = useMemo(() => presentacionesParaAgregar(productos, []), [productos]);

  /** ¿Se puede soltar lo escrito? Pregunta solo si hay algo. */
  async function soltarCaptura(): Promise<boolean> {
    if (!sucio.current) return true;
    const si = await confirmar({
      titulo: "¿Descartar lo que escribiste?",
      descripcion: "La captura en curso no se ha guardado y se pierde.",
      confirmar: "Descartar",
      tono: "normal",
    });
    if (si) sucio.current = false;
    return si;
  }

  async function cambiarCliente(nuevo: ClienteResumen | null) {
    if (!(await soltarCaptura())) return;
    setCliente(nuevo);
  }

  async function cambiarPestana(valor: string) {
    if (!(await soltarCaptura())) return;
    setActual(valor);
  }

  if (cargando) return <EstadoPantalla titulo={TITULO} tipo="cargando" />;
  if (!hayTipos) return <EstadoPantalla titulo={TITULO} tipo="sin-permiso" />;
  if (!codigo) return <EstadoPantalla titulo={TITULO} tipo="elige-sucursal" />;

  const visible = tipos.some((t) => t.tipo === actual) ? (actual as TipoProceso) : tipos[0].tipo;

  return (
    <Pantalla>
      <EncabezadoPantalla titulo={TITULO} descripcion={DESCRIPCION} />
      <TarjetaCliente
        clientes={clientes}
        cliente={cliente}
        onElegir={(c) => void cambiarCliente(c)}
        onQuitar={() => void cambiarCliente(null)}
      />
      {errorCarga && <Aviso tono="error">{errorCarga}</Aviso>}
      <Pestanas
        etiqueta="Tipo de proceso"
        valor={visible}
        onCambio={(v) => void cambiarPestana(v)}
        pestanas={tipos.map((t) => ({
          valor: t.tipo,
          etiqueta: t.etiqueta,
          contenido:
            visible !== t.tipo ? null : (
              <PestanaProceso
                key={`${t.tipo}|${cliente?.id ?? ""}`}
                tipo={t.tipo}
                sucursal={codigo}
                cliente={cliente}
                vendedores={vendedores}
                opciones={opciones}
                onSucio={avisarSucio}
                soltarCaptura={soltarCaptura}
              />
            ),
        }))}
      />
      {ventana}
    </Pantalla>
  );
}

/**
 * Una pestaña: la captura arriba y la lista del día abajo. Fecha, "Merma de" y "¿Quién?"
 * viven aquí para que guardar o cancelar una corrección los conserve.
 */
function PestanaProceso({
  tipo,
  sucursal,
  cliente,
  vendedores,
  opciones,
  onSucio,
  soltarCaptura,
}: {
  tipo: TipoProceso;
  sucursal: string;
  cliente: ClienteResumen | null;
  vendedores: Vendedor[];
  opciones: OpcionPresentacion[];
  onSucio: (sucio: boolean) => void;
  /** Pregunta antes de perder lo escrito; `true` = se puede soltar. */
  soltarCaptura: () => Promise<boolean>;
}) {
  const hoy = hoyEnTijuana();
  const [fecha, setFecha] = useState(hoy);
  const [modoFecha, setModoFecha] = useState<ModoFecha>("hoy");
  const [mermaDe, setMermaDe] = useState<MermaDe>("cliente");
  const [quien, setQuien] = useState(tipo === "descuento" ? "" : QUIEN_OFICINA);
  const [editando, setEditando] = useState<Proceso | null>(null);
  // `captura` vuelve a montar la captura (limpia) al guardar; `version` vuelve a pedir la lista.
  const [captura, setCaptura] = useState(0);
  const [version, setVersion] = useState(0);
  const [delDia, setDelDia] = useState<ProcesosDelDia | null>(null);

  const mermaDeTipo = tipo === "merma" ? mermaDe : null;
  const conCliente = llevaCliente(tipo, mermaDeTipo);
  // La lista: de este cliente en Merma de cliente, Cambios y Promoción (sin cliente, solo el
  // aviso "Elige un cliente arriba."); de la sucursal en lo demás.
  const filtro = conCliente && cliente ? { id: cliente.id } : null;
  const mostrarLista = !conCliente || cliente !== null;

  // m-2: un descuento no cambia el corte, así que volver a elegir al mismo vendedor y día
  // precarga los mismos faltantes. Se avisa (sin bloquear) con la lista que ya se cargó.
  const yaDescontado =
    tipo === "descuento" && !editando && quien !== "" && delDia?.fecha === fecha
      ? delDia.procesos.find((p) => p.vendedor?.id === quien)?.vendedor ?? null
      : null;

  async function editar(p: Proceso) {
    if (editando?.id === p.id) return;
    if (!(await soltarCaptura())) return;
    setEditando(p);
    setFecha(p.fecha);
    setModoFecha(p.fecha === hoy ? "hoy" : "otro");
    if (p.mermaDe) setMermaDe(p.mermaDe);
    setQuien(p.vendedor?.id ?? (tipo === "descuento" ? "" : QUIEN_OFICINA));
  }

  function terminar() {
    setEditando(null);
    setCaptura((c) => c + 1);
  }

  return (
    <div className="flex flex-col gap-6">
      <CapturaProceso
        key={editando ? `editar-${editando.id}` : `nueva-${captura}`}
        tipo={tipo}
        sucursal={sucursal}
        hoy={hoy}
        cliente={editando ? editando.cliente : cliente}
        fecha={fecha}
        modoFecha={modoFecha}
        onFecha={(f, m) => {
          setFecha(f);
          setModoFecha(m);
        }}
        mermaDe={mermaDe}
        onMermaDe={setMermaDe}
        quien={quien}
        onQuien={setQuien}
        vendedores={vendedores}
        opciones={opciones}
        editando={editando}
        onCancelar={terminar}
        onGuardado={() => {
          terminar();
          setVersion((v) => v + 1);
        }}
        onSucio={onSucio}
        avisoQuien={yaDescontado ? `Ya hay un descuento de ${yaDescontado.nombre} para ese día.` : null}
      />
      {mostrarLista && (
        <ListaProcesos
          tipo={tipo}
          sucursal={sucursal}
          fecha={fecha}
          hoy={hoy}
          cliente={filtro}
          version={version}
          editandoId={editando?.id ?? null}
          onEditar={(p) => void editar(p)}
          onEliminado={(p) => {
            if (editando?.id === p.id) terminar();
          }}
          onCargada={setDelDia}
        />
      )}
    </div>
  );
}
