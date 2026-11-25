import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { BackHandler, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  aplicarRegalos,
  calcularRegalos,
  ErrorFolio,
  ErrorJornada,
  ErrorVenta,
  leerCantidad,
  problemasDeCaptura,
  problemasDeRegalos,
  resumirCaptura,
  type LineaCaptura,
  type Venta,
} from '@/datos';
import { motivoBloqueoVenta } from '@/datos/notas-asignadas-reglas';
import { LARGO_MAX_ATENDIO } from '@/datos/ventas-reglas';
import { montoACentavos } from '@/estado/gasto';
import { faltantesDeCaptura, textoTeQuedan } from '@/estado/inventario';
import { crearGuardiaRegistro } from '@/estado/movimiento';
import { notaParaCobrar } from '@/estado/notas-asignadas';
import { useJawa } from '@/estado/proveedor-jawa';
import {
  alternarTodas,
  checklistPromociones,
  opcionesCobranza,
  pasoAnterior,
  filasNota,
  presentacionPorOmision,
  promocionesSinRenglon,
  primerPaso,
  renglonesVenta,
  teclear,
  textoSaldoPendiente,
  validarCobranzaVenta,
  type OpcionCobranza,
  type PasoVenta,
  type TeclaNumerica,
} from '@/estado/venta-pasos';
import { AVISO_NO_IMPRESO, ticketDeVenta } from '@/impresion/datos-ticket';
import { useImpresion } from '@/impresion/usar-impresion';
import { Boton } from '@/ui/boton';
import { Campo } from '@/ui/campo';
import { Palomita, Renglon } from '@/ui/checklist';
import { Chip } from '@/ui/chip';
import { Cifra, pesos } from '@/ui/cifra';
import { Icono } from '@/ui/icono';
import { Pantalla, Tarjeta } from '@/ui/pantalla';
import { TecladoCantidad } from '@/ui/teclado-cantidad';
import { useTema } from '@/ui/tema';
import { colores, espacio, fuente, grosor, radio, tipo } from '@/ui/tokens';

const TITULO_PASO: Record<PasoVenta, string> = {
  promociones: 'Promociones',
  lista: 'Vender',
  cobranza: 'Cobranza',
  grabada: 'Venta grabada',
};

const ETIQUETA_COBRANZA: Record<OpcionCobranza, string> = {
  liquidar: 'Liquidar',
  abonar: 'Abonar',
  credito: 'Crédito',
};

/**
 * Venta a un cliente (rediseno pieza 2, maquetas 8 a 12): Promociones (solo si
 * el cliente tiene) → lista con teclado propio → Cobranza → grabada. Sin firma:
 * el cliente firma a mano la nota impresa, y aqui se escribe quien atendio.
 *
 * Un solo componente con estado, para que ir y volver entre pasos no pierda lo
 * palomeado, lo elegido ni lo capturado. Toda decision vive en
 * `src/estado/venta-pasos.ts` y en las reglas de promociones y de venta; la
 * pantalla solo pinta. Los precios se **muestran** pero no se envian:
 * `datos.ventas.registrar()` los pone desde el catalogo local (D15) y vuelve a
 * revisar bloqueo, existencias y regalos dentro de su transaccion.
 *
 * Atras (flecha de la cabecera y del sistema): con el teclado abierto lo cierra;
 * si no, regresa al paso anterior (`pasoAnterior`) y, en el primero o ya
 * grabada, sale de la venta.
 */
export default function PantallaVenta() {
  const { clienteId } = useLocalSearchParams<{ clienteId: string }>();
  const { datos, vendedor, versionCatalogos } = useJawa();
  const { estilos, t } = useTema();
  const insets = useSafeAreaInsets();

  const hoy = datos.deps.reloj.hoy();

  // `versionCatalogos` en las lecturas: sin ella, la pantalla no ve lo que
  // escribe el pull. Se lee con `void` para que `exhaustive-deps` no la marque.
  const cliente = useMemo(() => {
    void versionCatalogos;
    return datos.catalogos.obtenerCliente(clienteId);
  }, [datos, clienteId, versionCatalogos]);

  const presentaciones = useMemo(() => {
    void versionCatalogos;
    return datos.catalogos.presentacionesParaVenta(clienteId, hoy);
  }, [datos, clienteId, hoy, versionCatalogos]);

  const catalogoPromos = useMemo(() => {
    void versionCatalogos;
    return datos.promociones.catalogo();
  }, [datos, versionCatalogos]);

  const promociones = useMemo(() => {
    void versionCatalogos;
    return datos.promociones.aplicablesPara(clienteId);
  }, [datos, clienteId, versionCatalogos]);

  // T-27 (D3, D4): bloqueo y existencias. Solo para pintar: `ventas.registrar`
  // vuelve a calcular al grabar, con la base de ese momento.
  const inventario = useMemo(() => {
    void versionCatalogos;
    return vendedor ? datos.cargas.paraVenta(vendedor.id) : null;
  }, [datos, vendedor, versionCatalogos]);

  // Spec 2026-11-13: la nota asignada sin cumplir su condicion no deja vender.
  // Se relee al volver de "Ir a cobrar" (cobrar no publica cambio de catalogo).
  const [vueltas, setVueltas] = useState(0);
  const asignadas = useMemo(() => {
    void vueltas;
    void versionCatalogos;
    return datos.notasAsignadas.deHoyDelCliente(clienteId);
  }, [datos, clienteId, vueltas, versionCatalogos]);
  const motivoNota = motivoBloqueoVenta(asignadas);

  const hayPromociones = promociones.length > 0;
  const [paso, setPaso] = useState<PasoVenta>(() => primerPaso(hayPromociones));
  /** Promociones sin palomita (D6): el vendedor solo puede quitarlas. */
  const [descartados, setDescartados] = useState<Set<string>>(new Set());
  /** promocion_id -> presentacion que eligio el vendedor (D16); sin eleccion va la de omision. */
  const [elecciones, setElecciones] = useState<Map<string, string>>(new Map());
  /** presentacion_id -> lo tecleado, tal cual sale de `teclear` (solo digitos). */
  const [cantidades, setCantidades] = useState<Record<string, string>>({});
  /** El renglon con el teclado abierto; `null` = teclado cerrado. */
  const [activo, setActivo] = useState<string | null>(null);
  const [opcion, setOpcion] = useState<OpcionCobranza | null>('liquidar');
  const [abonoTexto, setAbonoTexto] = useState('');
  const [atendio, setAtendio] = useState('');
  const [problemas, setProblemas] = useState<string[]>([]);
  const [grabada, setGrabada] = useState<Venta | null>(null);
  /** Rediseño pieza 7: la nota se imprime despues de grabar; un fallo solo avisa. */
  const [impresion, setImpresion] = useState<'imprimiendo' | 'enviada' | 'no-impresa' | null>(null);
  const { imprimirTickets } = useImpresion();
  /** Guardia de doble toque: un segundo toque en "Grabar" no emite otro folio. */
  const [guardia] = useState(() => crearGuardiaRegistro());

  const lista = useRef<ScrollView>(null);
  const posiciones = useRef(new Map<string, number>());

  // La presentacion de omision viene elegida (con control de inventario, la
  // primera que el vendedor trae): asi ningun regalo queda sin presentacion y
  // "Continuar a vender" no se apaga.
  const eleccionesEfectivas = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of promociones) {
      if (p.regalo_tipo !== 'producto' || !p.regalo_producto_id) continue;
      const elegida =
        elecciones.get(p.id) ?? presentacionPorOmision(p.regalo_producto_id, catalogoPromos, inventario);
      if (elegida) m.set(p.id, elegida);
    }
    return m;
  }, [promociones, elecciones, catalogoPromos, inventario]);

  const renglones = useMemo(
    () =>
      renglonesVenta({
        presentaciones: presentaciones.map((p) => ({
          presentacionId: p.presentacion_id,
          etiqueta: `${p.producto_nombre} · ${p.volumen}`,
          precioCentavos: p.precio_centavos,
        })),
        existencias: inventario?.existencias ?? new Map(),
        controlInventario: inventario?.controlInventario ?? false,
      }),
    [presentaciones, inventario],
  );

  // Todas las presentaciones van como base, aunque no esten en la lista: una
  // pieza de promocion a una presentacion sin renglon necesita su linea.
  const lineasBase = useMemo<LineaCaptura[]>(
    () =>
      presentaciones.map((p) => ({
        presentacionId: p.presentacion_id,
        etiqueta: `${p.producto_nombre} ${p.volumen}`,
        cantidad: leerCantidad(cantidades[p.presentacion_id] ?? '') ?? 0,
        cantidadPromocion: 0,
        precioCentavos: p.precio_centavos,
      })),
    [presentaciones, cantidades],
  );

  const regalosPosibles = useMemo(
    () => calcularRegalos(lineasBase, promociones, catalogoPromos, eleccionesEfectivas),
    [lineasBase, promociones, catalogoPromos, eleccionesEfectivas],
  );
  const { lineas, regalos } = useMemo(
    () => aplicarRegalos(lineasBase, regalosPosibles, descartados),
    [lineasBase, regalosPosibles, descartados],
  );
  const resumen = useMemo(() => resumirCaptura(lineas), [lineas]);
  /** Piezas de promocion por presentacion. */
  const promoPor = useMemo(
    () => new Map(lineas.map((l) => [l.presentacionId, l.cantidadPromocion] as const)),
    [lineas],
  );
  // El tope del teclado no basta: una pieza de promocion que se gana DESPUES de
  // teclear puede pasar de la existencia. Se revisa en vivo con la regla de siempre.
  const faltantes = useMemo(
    () =>
      faltantesDeCaptura({
        controlInventario: inventario?.controlInventario ?? false,
        existencias: inventario?.existencias ?? new Map(),
        lineas: lineas.map((l) => ({ presentacionId: l.presentacionId, etiqueta: l.etiqueta, cantidad: l.cantidad })),
        regalos,
      }),
    [inventario, lineas, regalos],
  );

  const totalCentavos = resumen.totalCentavos;
  const opciones = opcionesCobranza(totalCentavos);
  // Si al volver a la lista cambio el total, lo elegido puede ya no valer (total 0 = solo Liquidar).
  const opcionVigente: OpcionCobranza | null =
    opcion !== null && opciones.includes(opcion) ? opcion : opciones.length === 1 ? (opciones[0] ?? null) : null;

  /** Atras: `true` = se atendio aqui; `false` = salir de la venta. */
  const atras = useCallback((): boolean => {
    if (activo !== null) {
      setActivo(null);
      return true;
    }
    const anterior = pasoAnterior(paso, hayPromociones);
    if (anterior === null) return false;
    setProblemas([]);
    setPaso(anterior);
    return true;
  }, [activo, paso, hayPromociones]);

  // Se relee la nota asignada cada que la venta vuelve a enfocarse.
  useFocusEffect(
    useCallback(() => {
      setVueltas((n) => n + 1);
    }, []),
  );

  // Solo con la pantalla enfocada: encima pueden abrirse Inventario o Cobrar,
  // y su "atras" no es de esta venta.
  useFocusEffect(
    useCallback(() => {
      const sub = BackHandler.addEventListener('hardwareBackPress', atras);
      return () => sub.remove();
    }, [atras]),
  );

  const cabecera = (
    <Stack.Screen
      options={{
        headerTitle: () => (
          <View>
            <Text style={{ fontFamily: fuente.tituloMedio, fontSize: t(tipo.subtitulo), color: colores.tinta }}>
              {TITULO_PASO[paso]}
            </Text>
            {cliente ? (
              <Text style={{ fontFamily: fuente.cuerpo, fontSize: t(tipo.menor), color: colores.tintaSuave }}>
                {cliente.nombre}
              </Text>
            ) : null}
          </View>
        ),
        headerLeft: () => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Atrás"
            hitSlop={espacio.sm}
            onPress={() => {
              if (!atras()) router.back();
            }}
            style={{ paddingRight: espacio.md, paddingVertical: espacio.xs }}
          >
            <Icono nombre="atras" tamano={t(tipo.subtitulo)} color={colores.tinta} />
          </Pressable>
        ),
      }}
    />
  );

  // Antes de este punto solo hay hooks: se llaman siempre, en el mismo orden.
  if (!cliente || !vendedor) {
    return (
      <Pantalla titulo="Cliente no encontrado" subtitulo="No está en el catálogo local de esta tablet.">
        {cabecera}
        <Text style={estilos.textoSuave}>
          Puede que lo hayan dado de alta después de tu última sincronización.
        </Text>
      </Pantalla>
    );
  }

  const vendedorId = vendedor.id;
  const nombreCliente = cliente.nombre;

  /** Marco de un paso: lo que se desliza arriba y una barra fija abajo. */
  function marco(cuerpo: ReactNode, abajo: ReactNode, conLista = false) {
    return (
      <View style={{ flex: 1, backgroundColor: colores.papel }}>
        {cabecera}
        <ScrollView
          ref={conLista ? lista : undefined}
          style={{ flex: 1 }}
          contentContainerStyle={[estilos.contenido, { paddingBottom: espacio.lg }]}
          keyboardShouldPersistTaps="handled"
        >
          {cuerpo}
        </ScrollView>
        {abajo}
      </View>
    );
  }

  const barra = (children: ReactNode) => (
    <View
      style={{
        gap: espacio.sm,
        paddingHorizontal: espacio.md,
        paddingTop: espacio.sm,
        paddingBottom: espacio.sm + insets.bottom,
        backgroundColor: colores.superficie,
        borderTopWidth: grosor.fuerte,
        borderTopColor: colores.bordeFuerte,
      }}
    >
      {children}
    </View>
  );

  const avisos = problemas.map((p) => (
    <Text key={p} style={estilos.error}>
      {p}
    </Text>
  ));

  /* ---------------------------------------------------------------- */
  /* 4. Grabada: el folio en grande                                    */
  /* ---------------------------------------------------------------- */

  if (paso === 'grabada' && grabada) {
    const abono = grabada.abono_centavos;
    return (
      <Pantalla subtitulo={nombreCliente}>
        {cabecera}
        <Tarjeta estado="listo" etiqueta="Folio">
          <Cifra valor={grabada.folio} tamano="grande" />
          <Text style={estilos.textoSuave}>
            Total <Cifra valor={pesos(grabada.monto_total_centavos)} tono="suave" /> ·{' '}
            {grabada.contado_credito === 'contado' ? 'liquidada' : abono !== null ? 'abonada' : 'a crédito'}
          </Text>
          {abono !== null ? (
            <Text style={estilos.textoSuave}>
              Abonó <Cifra valor={pesos(abono)} tono="suave" /> ·{' '}
              {textoSaldoPendiente(grabada.monto_total_centavos - abono)}
            </Text>
          ) : null}
          {grabada.atendio_nombre ? (
            <Text style={estilos.textoTarjeta}>Atendió {grabada.atendio_nombre}</Text>
          ) : null}
          <Text style={estilos.textoSuave}>
            Quedó guardada en la tablet y sube sola al sincronizar. Una venta grabada no se edita: si hay
            un error, se corrige desde el portal.
          </Text>
        </Tarjeta>
        {impresion === 'imprimiendo' ? <Text style={estilos.textoSuave}>Imprimiendo la nota…</Text> : null}
        {impresion === 'no-impresa' ? (
          <Tarjeta estado="pendiente" etiqueta="Nota sin imprimir">
            <Text style={estilos.textoTarjeta}>{AVISO_NO_IMPRESO}</Text>
          </Tarjeta>
        ) : null}
        <Boton
          etiqueta="Volver a la ruta"
          icono="atras"
          onPress={() => router.dismissTo('/(jornada)')}
          estilo={{ marginTop: espacio.lg, marginBottom: espacio.xl }}
        />
      </Pantalla>
    );
  }

  /* ---------------------------------------------------------------- */
  /* 1. Promociones (maqueta 8)                                        */
  /* ---------------------------------------------------------------- */

  if (paso === 'promociones') {
    const check = checklistPromociones(promociones, descartados);
    return marco(
      <>
        <Text style={[estilos.textoSuave, { marginBottom: espacio.sm }]}>
          Vienen todas palomeadas. Quita la palomita a la que el cliente no quiera.
        </Text>
        <Renglon
          onPress={() => setDescartados(alternarTodas(promociones, descartados))}
          borde={colores.bordeFuerte}
          etiqueta="Seleccionar todas"
          estadoA11y={check.todas}
        >
          <Palomita encendida={check.todas} />
          <View style={{ flex: 1 }}>
            <Text style={estilos.textoTarjeta}>Seleccionar todas</Text>
            <Text style={estilos.textoSuave}>
              {check.palomeadas} de {check.total} palomeadas
            </Text>
          </View>
        </Renglon>
        {promociones.map((p) => {
          const palomeada = !descartados.has(p.id);
          const productoId = p.regalo_tipo === 'producto' ? p.regalo_producto_id : null;
          const opcionesPres = productoId
            ? [...catalogoPromos.presentaciones].filter(([, pres]) => pres.productoId === productoId)
            : [];
          const nombreProducto = productoId ? catalogoPromos.productos.get(productoId) : undefined;
          const frase = `${p.texto}${p.audiencia === 'prospecto' ? ' (primera venta)' : ''}`;
          return (
            <View
              key={p.id}
              style={{
                marginBottom: espacio.sm,
                borderRadius: radio.medio,
                borderWidth: grosor.fuerte,
                borderStyle: palomeada ? 'solid' : 'dashed',
                borderColor: palomeada ? colores.exito : colores.borde,
                backgroundColor: palomeada ? colores.superficie : colores.superficieHundida,
              }}
            >
              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{ checked: palomeada }}
                accessibilityLabel={frase}
                onPress={() =>
                  setDescartados((previos) => {
                    const s = new Set(previos);
                    if (s.has(p.id)) s.delete(p.id);
                    else s.add(p.id);
                    return s;
                  })
                }
                style={{ flexDirection: 'row', gap: espacio.sm, alignItems: 'flex-start', padding: espacio.sm }}
              >
                <Palomita encendida={palomeada} />
                <Text style={[estilos.textoTarjeta, { flex: 1 }, !palomeada && { color: colores.tintaSuave }]}>
                  {frase}
                </Text>
              </Pressable>
              {palomeada && opcionesPres.length > 1 ? (
                <View style={{ paddingLeft: espacio.xl + espacio.xs, paddingRight: espacio.sm, paddingBottom: espacio.sm }}>
                  <Text style={estilos.etiqueta}>Presentación que se entrega</Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: espacio.sm }}>
                    {opcionesPres.map(([id, pres]) => (
                      <Chip
                        key={id}
                        etiqueta={
                          nombreProducto && pres.etiqueta.startsWith(`${nombreProducto} `)
                            ? pres.etiqueta.slice(nombreProducto.length + 1)
                            : pres.etiqueta
                        }
                        elegida={eleccionesEfectivas.get(p.id) === id}
                        onPress={() => setElecciones((previas) => new Map(previas).set(p.id, id))}
                      />
                    ))}
                  </View>
                </View>
              ) : null}
            </View>
          );
        })}
      </>,
      barra(
        <Boton etiqueta="Continuar a vender" icono="adelante" onPress={() => setPaso('lista')} />,
      ),
    );
  }

  /* ---------------------------------------------------------------- */
  /* 3. Cobranza (maquetas 11 y 12)                                    */
  /* ---------------------------------------------------------------- */

  if (paso === 'cobranza') {
    const abonoCentavos = montoACentavos(abonoTexto) ?? 0;
    const etiquetaDe = (l: LineaCaptura) =>
      l.etiqueta !== '' ? l.etiqueta : (catalogoPromos.presentaciones.get(l.presentacionId)?.etiqueta ?? '');

    // Fuera del try de grabar: la venta ya esta firme; armar o imprimir la nota
    // nunca puede decir "no se consumió ningún folio" ni invitar a grabar otra vez.
    async function imprimir(ventaId: string) {
      setImpresion('imprimiendo');
      let ticket: ReturnType<typeof ticketDeVenta> = null;
      try {
        ticket = ticketDeVenta(datos.deps.bd, ventaId);
      } catch {
        // Sin ticket: se avisa abajo, como cualquier impresion que no salio.
      }
      setImpresion((await imprimirTickets([ticket])) ? 'enviada' : 'no-impresa');
    }

    function grabar() {
      if (opcionVigente === null) {
        setProblemas(['Elige cómo paga el cliente: Liquidar, Abonar o Crédito.']);
        return;
      }
      const cobro = validarCobranzaVenta({ opcion: opcionVigente, abonoTexto, totalCentavos, atendio });
      if (cobro.problemas.length > 0) {
        setProblemas(cobro.problemas);
        return;
      }
      try {
        const venta = guardia.intentar(() =>
          datos.ventas.registrar({
            vendedorId,
            clienteId,
            contadoCredito: cobro.contadoCredito,
            abonoCentavos: cobro.abonoCentavos,
            atendio: atendio.trim(),
            // Sin precios: los pone el repositorio (D15).
            lineas: resumen.lineas.map((l) => ({
              presentacionId: l.presentacionId,
              cantidad: l.cantidad,
              cantidadPromocion: l.cantidadPromocion,
            })),
            // Solo con presentacion: la lista ya exigio elegirla (`problemasDeRegalos`).
            regalos: regalos.flatMap((r) =>
              r.presentacionId === null
                ? []
                : [{ promocionId: r.promocionId, presentacionId: r.presentacionId, cantidad: r.cantidad, texto: r.texto }],
            ),
          }),
        );
        // Segundo toque mientras el primero corre: el primero se encarga de todo.
        if (venta === null) return;
        setProblemas([]);
        setGrabada(venta);
        setPaso('grabada');
        void imprimir(venta.id);
      } catch (e) {
        setProblemas([
          e instanceof ErrorVenta || e instanceof ErrorFolio || e instanceof ErrorJornada
            ? e.message
            : 'No se pudo grabar la venta. No se consumió ningún folio; intenta de nuevo.',
        ]);
      }
    }

    return marco(
      <>
        <Tarjeta etiqueta={`Nota · ${nombreCliente}`}>
          {filasNota(
            resumen.lineas.map((l) => ({ ...l, etiqueta: etiquetaDe(l) })),
            renglones.map((r) => r.presentacionId),
          ).map((f) => (
            <LineaNota key={f.clave} texto={f.texto} importe={f.importeCentavos} />
          ))}
          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              marginTop: espacio.sm,
              paddingTop: espacio.sm,
              borderTopWidth: grosor.fuerte,
              borderTopColor: colores.bordeFuerte,
            }}
          >
            <Text style={estilos.textoTarjeta}>Total</Text>
            <Cifra valor={pesos(totalCentavos)} tamano="destacado" />
          </View>
        </Tarjeta>

        <Text style={estilos.seccion}>Cobranza</Text>
        <View style={{ flexDirection: 'row', gap: espacio.sm, marginBottom: espacio.md }}>
          {opciones.map((o) => (
            <Chip
              key={o}
              etiqueta={ETIQUETA_COBRANZA[o]}
              elegida={opcionVigente === o}
              onPress={() => {
                setProblemas([]);
                setOpcion(o);
              }}
              ancho
            />
          ))}
        </View>

        {opcionVigente === 'liquidar' ? (
          <View style={[estilos.campo, { backgroundColor: colores.superficieHundida, justifyContent: 'center' }]}>
            <Cifra valor={pesos(totalCentavos)} />
          </View>
        ) : null}
        {opcionVigente === 'abonar' ? (
          <>
            <Campo
              etiqueta="Cuánto abona"
              cifra
              keyboardType="decimal-pad"
              value={abonoTexto}
              onChangeText={(texto) => {
                setProblemas([]);
                setAbonoTexto(texto);
              }}
              placeholder="0.00"
            />
            <Tarjeta estado="pendiente">
              <Text style={estilos.textoTarjeta}>
                {textoSaldoPendiente(Math.max(0, totalCentavos - abonoCentavos))}
              </Text>
            </Tarjeta>
          </>
        ) : null}
        {opcionVigente === 'credito' ? (
          <Tarjeta estado="pendiente">
            <Text style={estilos.textoTarjeta}>{textoSaldoPendiente(totalCentavos)}</Text>
          </Tarjeta>
        ) : null}

        <View style={{ marginTop: espacio.md }}>
          <Campo
            etiqueta="Nombre de quien atiende"
            value={atendio}
            onChangeText={(texto) => {
              setProblemas([]);
              setAtendio(texto);
            }}
            maxLength={LARGO_MAX_ATENDIO}
            autoCapitalize="words"
          />
        </View>
      </>,
      // Los errores de validar y de grabar, pegados a "Grabar": al final del scroll no se veian.
      barra(
        <>
          {avisos}
          <Boton etiqueta="Grabar e imprimir" icono="impresora" onPress={grabar} deshabilitado={grabada !== null} />
        </>,
      ),
    );
  }

  /* ---------------------------------------------------------------- */
  /* 2. Lista con teclado (maquetas 9 y 10)                            */
  /* ---------------------------------------------------------------- */

  const bloqueoCarga = inventario?.bloqueo ?? null;
  const bloqueado = bloqueoCarga !== null || motivoNota !== null;
  const notaACobrar = motivoNota ? notaParaCobrar(asignadas) : null;
  const sinPiezas = resumen.piezas + resumen.piezasPromocion === 0;
  // Piezas de promocion sin renglon (la bienvenida de un prospecto no tiene precios):
  // se pintan de solo lectura para que el vendedor vea lo que entrega.
  const soloPromocion = promocionesSinRenglon(
    lineas.map((l) => ({
      presentacionId: l.presentacionId,
      etiqueta: l.etiqueta !== '' ? l.etiqueta : (catalogoPromos.presentaciones.get(l.presentacionId)?.etiqueta ?? ''),
      cantidadPromocion: l.cantidadPromocion,
    })),
    renglones,
  );

  /** Lo que el teclado deja capturar: lo que queda menos lo que ya va de promocion ahi. */
  function tope(presentacionId: string): number | null {
    const quedan = renglones.find((r) => r.presentacionId === presentacionId)?.quedan ?? null;
    return quedan === null ? null : Math.max(0, quedan - (promoPor.get(presentacionId) ?? 0));
  }

  function mostrar(presentacionId: string) {
    const y = posiciones.current.get(presentacionId);
    if (y !== undefined) lista.current?.scrollTo({ y: Math.max(0, y - espacio.xxl), animated: true });
  }

  function abrirTeclado(presentacionId: string) {
    setProblemas([]);
    setActivo(presentacionId);
    mostrar(presentacionId);
  }

  function tecla(valor: TeclaNumerica | 'borrar') {
    if (activo === null) return;
    const id = activo;
    const maximo = tope(id);
    setCantidades((previas) => {
      const nuevo = teclear(previas[id] ?? '', valor, maximo);
      return { ...previas, [id]: nuevo === '0' ? '' : nuevo };
    });
  }

  const indiceActivo = activo === null ? -1 : renglones.findIndex((r) => r.presentacionId === activo);
  const siguienteRenglon = indiceActivo >= 0 ? renglones[indiceActivo + 1] : undefined;

  function siguiente() {
    if (siguienteRenglon) {
      setActivo(siguienteRenglon.presentacionId);
      mostrar(siguienteRenglon.presentacionId);
    } else {
      setActivo(null);
    }
  }

  function irACobranza() {
    const encontrados = [
      // El pago se elige en Cobranza: aqui solo se revisan las cantidades.
      ...problemasDeCaptura({ numNota: '', contadoCredito: 'contado', comentarios: '', lineas }),
      ...problemasDeRegalos(regalos),
    ];
    setProblemas(encontrados);
    if (encontrados.length > 0) return;
    setActivo(null);
    setPaso('cobranza');
  }

  return marco(
    <>
      {/* T-27 (D3): con una carga por aceptar no se vende; `ventas.registrar` lo vuelve a exigir. */}
      {bloqueoCarga ? (
        <Tarjeta estado="pendiente" etiqueta="Carga por aceptar">
          <Text style={estilos.textoTarjeta}>{bloqueoCarga}.</Text>
          <Text style={estilos.textoSuave}>
            Revisa las piezas con el almacenista y acéptala en Inventario; después podrás vender.
          </Text>
          <Boton
            etiqueta="Ir a Inventario"
            tono="neutra"
            icono="adelante"
            onPress={() => router.push('/(jornada)/inventario')}
            estilo={{ marginTop: espacio.sm }}
          />
        </Tarjeta>
      ) : null}
      {/* Spec 2026-11-13 (regla 10): la nota asignada con condicion se cobra antes. */}
      {motivoNota ? (
        <Tarjeta estado="pendiente" etiqueta="Nota por cobrar">
          <Text style={estilos.textoTarjeta}>{motivoNota}</Text>
          <Text style={estilos.textoSuave}>Ve a cobrarla; después podrás vender.</Text>
          <Boton
            etiqueta="Ir a cobrar"
            tono="neutra"
            icono="adelante"
            onPress={() =>
              router.push({
                pathname: '/(jornada)/operacion/[clienteId]/cobranza',
                // `desde: 'venta'`: al grabar, Cobrar regresa aqui ("Seguir con la venta").
                params: notaACobrar
                  ? { clienteId, notaId: notaACobrar, desde: 'venta' }
                  : { clienteId, desde: 'venta' },
              })
            }
            estilo={{ marginTop: espacio.sm }}
          />
        </Tarjeta>
      ) : null}

      {renglones.length === 0 && soloPromocion.length > 0 ? (
        <Text style={[estilos.textoSuave, { marginBottom: espacio.sm }]}>Solo lleva la promoción.</Text>
      ) : null}
      {soloPromocion.map((f) => (
        <View
          key={f.presentacionId}
          style={{
            marginBottom: espacio.sm,
            padding: espacio.sm,
            borderRadius: radio.medio,
            borderWidth: grosor.fuerte,
            borderColor: colores.exito,
            backgroundColor: colores.superficieHundida,
          }}
        >
          <Text style={estilos.textoTarjeta}>{f.texto}</Text>
        </View>
      ))}

      {renglones.length === 0 && soloPromocion.length === 0 ? (
        <Tarjeta estado="pendiente" etiqueta="Sin productos para vender">
          <Text style={estilos.textoTarjeta}>
            {inventario?.controlInventario
              ? 'No traes producto con existencia para venderle a este cliente.'
              : 'Sin productos con precio en el catálogo local.'}
          </Text>
          <Text style={estilos.textoSuave}>Los productos y precios bajan del portal con la sincronización.</Text>
        </Tarjeta>
      ) : null}

      {renglones.map((r) => {
        const cantidad = leerCantidad(cantidades[r.presentacionId] ?? '') ?? 0;
        const promo = promoPor.get(r.presentacionId) ?? 0;
        const quedan = r.quedan === null ? null : textoTeQuedan(r.quedan, cantidad + promo);
        const esActivo = activo === r.presentacionId;
        const conAlgo = cantidad > 0;
        return (
          <View
            key={r.presentacionId}
            onLayout={(e) => posiciones.current.set(r.presentacionId, e.nativeEvent.layout.y)}
          >
            <Renglon
              onPress={() => abrirTeclado(r.presentacionId)}
              etiqueta={`${r.etiqueta}, cantidad ${cantidad}`}
              borde={esActivo || conAlgo ? colores.primario : colores.borde}
              fondo={conAlgo || esActivo ? colores.primarioTenue : colores.superficie}
            >
              <View style={{ flex: 1 }}>
                <Text style={estilos.textoTarjeta}>{r.etiqueta}</Text>
                <Text style={estilos.textoSuave}>
                  <Cifra valor={pesos(r.precioCentavos)} tono="suave" tamano="menor" />
                  {quedan ? (
                    <Text style={quedan.falta ? { color: colores.peligro } : undefined}>
                      {' · '}
                      {quedan.texto.charAt(0).toLowerCase() + quedan.texto.slice(1)}
                    </Text>
                  ) : null}
                </Text>
                {promo > 0 ? (
                  <Text style={[estilos.textoSuave, { color: colores.exito }]}>+{promo} de promoción</Text>
                ) : null}
              </View>
              <View
                style={{
                  minWidth: 64,
                  minHeight: 44,
                  paddingHorizontal: espacio.sm,
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: radio.chico,
                  borderWidth: grosor.fuerte,
                  borderColor: esActivo ? colores.primario : colores.borde,
                  backgroundColor: colores.superficie,
                }}
              >
                {conAlgo ? <Cifra valor={cantidad} tamano="destacado" /> : null}
              </View>
            </Renglon>
          </View>
        );
      })}
    </>,
    activo !== null ? (
      <TecladoCantidad
        onTecla={tecla}
        onSiguiente={siguiente}
        etiquetaSiguiente={siguienteRenglon ? 'Siguiente' : 'Listo'}
      />
    ) : (
      barra(
        <>
          {faltantes.map((f) => (
            <Text key={f} style={estilos.error}>
              {f}
            </Text>
          ))}
          {avisos}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: espacio.md }}>
            <View style={{ flex: 1 }}>
              <Text style={[estilos.etiqueta, { marginBottom: 0 }]}>
                {resumen.piezas} PIEZAS + {resumen.piezasPromocion} PROMO
              </Text>
              <Cifra valor={pesos(totalCentavos)} tamano="destacado" />
            </View>
            <View style={{ flex: 1.1 }}>
              <Boton
                etiqueta="Ir a cobranza"
                icono="adelante"
                onPress={irACobranza}
                deshabilitado={sinPiezas || bloqueado || faltantes.length > 0}
              />
            </View>
          </View>
        </>,
      )
    ),
    true,
  );
}

/** Un renglon de la nota: "12 × Jamaica 500 ml" y su importe. */
function LineaNota({ texto, importe }: { texto: string; importe: number }) {
  const { estilos } = useTema();
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: espacio.sm, marginBottom: espacio.xs }}>
      <Text style={[estilos.textoTarjeta, { flexShrink: 1 }]}>{texto}</Text>
      <Cifra valor={pesos(importe)} />
    </View>
  );
}
