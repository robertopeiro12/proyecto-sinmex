import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Alert, BackHandler, Platform, ScrollView, Text, ToastAndroid, View } from 'react-native';

import { ErrorJornada, ErrorMovimiento } from '@/datos';
import type { SentidoMovimiento } from '@/datos/tipos';
import { estadoMenuJornada } from '@/estado/menu-jornada';
import {
  capturar,
  crearGuardiaRegistro,
  faltantesVisiblesMovimiento,
  piezasCapturadas,
  piezasDelSentido,
  renglonesMovimiento,
  textoPestana,
  TIPO_DE_PESTANA,
  topeTeclado,
  validarCapturaMovimiento,
  type CapturaMovimiento,
  type PestanaMovimiento,
  type RenglonMovimiento,
} from '@/estado/movimiento';
import { useJawa } from '@/estado/proveedor-jawa';
import { teclear, type TeclaNumerica } from '@/estado/venta-pasos';
import { Boton } from '@/ui/boton';
import {
  AgregarProducto,
  BarraAbajo,
  EncabezadoSeccion,
  RenglonCantidad,
  SelectorMotivo,
} from '@/ui/captura-movimiento';
import { Chip } from '@/ui/chip';
import { Pantalla, Tarjeta } from '@/ui/pantalla';
import { TecladoCantidad } from '@/ui/teclado-cantidad';
import { useTema } from '@/ui/tema';
import { colores, espacio } from '@/ui/tokens';

/** El aviso breve al grabar (como "Gasto registrado"). En otra plataforma, un Alert. */
function avisar(texto: string) {
  if (Platform.OS === 'android') ToastAndroid.show(texto, ToastAndroid.SHORT);
  else Alert.alert(texto);
}

const TITULO_SECCION: Record<PestanaMovimiento, Record<SentidoMovimiento, string>> = {
  merma: { recibido: 'Me entregó el cliente (dañado)', entregado: 'Le entregué' },
  cambios: { recibido: 'Me entregó el cliente', entregado: 'Le entregué' },
};

const SIN_CAPTURA: Record<PestanaMovimiento, CapturaMovimiento> = { merma: {}, cambios: {} };

/**
 * Merma y cambios del cliente (rediseño pieza 4, maqueta 14; spec §11). Dos
 * pestañas que no comparten captura y graban cada una su movimiento:
 *
 * - **Merma** (`merma_cliente`): "Motivo de la merma" (de la lista del portal),
 *   "Me entregó el cliente (dañado)" —de todo el catalogo— y "Le entregué"
 *   (opcional, de lo que trae el vendedor).
 * - **Cambios** (`cambio`): "Me entregó el cliente" (producto bueno, de todo el
 *   catalogo: regresa a su inventario) y "Le entregué" (de lo que trae).
 *
 * "Agregar producto" abre la lista de ese lado con el renglon y el teclado de la
 * venta (pieza 2). La validacion es `validarCapturaMovimiento`; el repositorio
 * vuelve a revisar motivo, carga pendiente y existencia al grabar.
 */
export default function MermaYCambiosDelCliente() {
  const { clienteId } = useLocalSearchParams<{ clienteId: string }>();
  const { datos, vendedor, jornada, versionCatalogos } = useJawa();
  const { estilos } = useTema();
  const menu = estadoMenuJornada(jornada);

  const cliente = useMemo(() => {
    void versionCatalogos;
    return datos.catalogos.obtenerCliente(clienteId);
  }, [datos, clienteId, versionCatalogos]);

  const motivos = useMemo(() => {
    void versionCatalogos;
    return datos.catalogos.listarMotivosMerma('cliente');
  }, [datos, versionCatalogos]);

  // Solo para pintar "te quedan N" y topar el teclado: `movimientos.registrar`
  // vuelve a calcular al grabar, con la base de ese momento.
  const inventario = useMemo(() => {
    void versionCatalogos;
    return vendedor ? datos.cargas.paraVenta(vendedor.id) : null;
  }, [datos, vendedor, versionCatalogos]);

  /** Lo que entrega el cliente: todo el catalogo activo (decision 2 del plan). */
  const todoElCatalogo = useMemo(() => {
    void versionCatalogos;
    return renglonesMovimiento({
      presentaciones: datos.movimientos.presentaciones(),
      existencias: new Map(),
      controlInventario: false,
    });
  }, [datos, versionCatalogos]);

  /** Lo que se le entrega: lo que trae el vendedor, con "te quedan N" si hay control. */
  const loQueTrae = useMemo(() => {
    void versionCatalogos;
    return vendedor
      ? renglonesMovimiento({
          presentaciones: datos.movimientos.presentacionesQueTrae(vendedor.id),
          existencias: inventario?.existencias ?? new Map(),
          controlInventario: inventario?.controlInventario ?? false,
        })
      : [];
  }, [datos, vendedor, inventario, versionCatalogos]);

  const [pestana, setPestana] = useState<PestanaMovimiento>('merma');
  const [capturas, setCapturas] = useState<Record<PestanaMovimiento, CapturaMovimiento>>(SIN_CAPTURA);
  const [motivoId, setMotivoId] = useState<string | null>(null);
  /** El lado cuyo "Agregar producto" esta abierto; `null` = la vista de la pestaña. */
  const [selector, setSelector] = useState<SentidoMovimiento | null>(null);
  /** El renglon con el teclado abierto. */
  const [activo, setActivo] = useState<{ sentido: SentidoMovimiento; presentacionId: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Una guardia por pestaña (se cierra al grabar); tras grabar se pone una nueva.
  const [guardias, setGuardias] = useState(() => ({
    merma: crearGuardiaRegistro(),
    cambios: crearGuardiaRegistro(),
  }));

  const captura = capturas[pestana];
  const candidatos = (sentido: SentidoMovimiento): RenglonMovimiento[] =>
    sentido === 'recibido' ? todoElCatalogo : loQueTrae;

  const atras = useCallback((): boolean => {
    if (activo !== null) {
      setActivo(null);
      return true;
    }
    if (selector !== null) {
      setSelector(null);
      return true;
    }
    return false;
  }, [activo, selector]);

  useFocusEffect(
    useCallback(() => {
      const sub = BackHandler.addEventListener('hardwareBackPress', atras);
      return () => sub.remove();
    }, [atras]),
  );

  if (!cliente) {
    return (
      <Pantalla titulo="Cliente no encontrado" subtitulo="No está en el catálogo local de esta tablet.">
        <Text style={estilos.textoSuave}>Sincroniza y vuelve a abrir su ficha.</Text>
      </Pantalla>
    );
  }

  const tipo = TIPO_DE_PESTANA[pestana];
  const entrada = {
    tipo,
    clienteId,
    motivoMermaId: pestana === 'merma' ? motivoId : null,
    captura,
    comentario: '',
    diaCerrado: !menu.operacionesHabilitadas,
  };
  const validacion = validarCapturaMovimiento(entrada);
  const faltantes = faltantesVisiblesMovimiento(entrada, validacion);

  /** Los renglones visibles de un lado: los capturados y el que se esta tecleando. */
  function visibles(sentido: SentidoMovimiento): RenglonMovimiento[] {
    return candidatos(sentido).filter(
      (r) =>
        piezasCapturadas(captura, r.presentacionId, sentido) > 0 ||
        (activo?.sentido === sentido && activo.presentacionId === r.presentacionId),
    );
  }

  /** La lista por la que avanza "Siguiente": la del selector abierto o la del lado. */
  const filasDelTeclado = activo === null ? [] : selector !== null ? candidatos(selector) : visibles(activo.sentido);
  const indiceActivo = activo === null ? -1 : filasDelTeclado.findIndex((r) => r.presentacionId === activo.presentacionId);
  const siguienteRenglon = indiceActivo >= 0 ? filasDelTeclado[indiceActivo + 1] : undefined;

  function abrirTeclado(sentido: SentidoMovimiento, presentacionId: string) {
    setError(null);
    setActivo({ sentido, presentacionId });
  }

  function tecla(valor: TeclaNumerica | 'borrar') {
    if (activo === null) return;
    const { sentido, presentacionId } = activo;
    const fila = candidatos(sentido).find((r) => r.presentacionId === presentacionId);
    const maximo = topeTeclado(sentido, fila?.quedan ?? null);
    setCapturas((todas) => {
      const actual = todas[pestana][presentacionId]?.[sentido] ?? '';
      return { ...todas, [pestana]: capturar(todas[pestana], presentacionId, sentido, teclear(actual, valor, maximo)) };
    });
  }

  function siguiente() {
    if (activo !== null && siguienteRenglon) {
      setActivo({ sentido: activo.sentido, presentacionId: siguienteRenglon.presentacionId });
    } else {
      setActivo(null);
    }
  }

  function cambiarPestana(nueva: PestanaMovimiento) {
    setActivo(null);
    setSelector(null);
    setError(null);
    setPestana(nueva);
  }

  function grabar() {
    setError(null);
    if (!vendedor) {
      setError('No hay vendedor con sesión iniciada.');
      return;
    }
    if (!validacion.listo) return;
    const otra: PestanaMovimiento = pestana === 'merma' ? 'cambios' : 'merma';
    try {
      const m = guardias[pestana].intentar(() =>
        datos.movimientos.registrar({
          vendedorId: vendedor.id,
          tipo,
          clienteId,
          motivoMermaId: pestana === 'merma' ? motivoId : null,
          lineas: validacion.lineas,
          comentario: null,
        }),
      );
      if (m === null) return;
      avisar(pestana === 'merma' ? 'Merma registrada' : 'Cambio registrado');
      const quedaOtra =
        piezasDelSentido(capturas[otra], 'recibido') + piezasDelSentido(capturas[otra], 'entregado') > 0;
      if (!quedaOtra) {
        router.back();
        return;
      }
      // Lo de la otra pestaña sigue capturado: se queda para grabarlo.
      setCapturas((todas) => ({ ...todas, [pestana]: {} }));
      if (pestana === 'merma') setMotivoId(null);
      setGuardias((g) => ({ ...g, [pestana]: crearGuardiaRegistro() }));
      setPestana(otra);
    } catch (e) {
      setError(
        e instanceof ErrorMovimiento || e instanceof ErrorJornada
          ? e.message
          : `No se pudo registrar ${pestana === 'merma' ? 'la merma' : 'el cambio'}.`,
      );
    }
  }

  const teclado =
    activo !== null ? (
      <TecladoCantidad
        onTecla={tecla}
        onSiguiente={siguiente}
        etiquetaSiguiente={siguienteRenglon ? 'Siguiente' : 'Listo'}
      />
    ) : null;

  const renglon = (sentido: SentidoMovimiento, r: RenglonMovimiento) => (
    <RenglonCantidad
      key={`${sentido}-${r.presentacionId}`}
      etiqueta={r.etiqueta}
      piezas={piezasCapturadas(captura, r.presentacionId, sentido)}
      quedan={sentido === 'entregado' ? r.quedan : null}
      activo={activo?.sentido === sentido && activo.presentacionId === r.presentacionId}
      onPress={() => abrirTeclado(sentido, r.presentacionId)}
    />
  );

  /* ---------------------------------------------------------------- */
  /* "Agregar producto": la lista de un lado, como la de la venta       */
  /* ---------------------------------------------------------------- */
  if (selector !== null) {
    const filas = candidatos(selector);
    return (
      <View style={{ flex: 1, backgroundColor: colores.papel }}>
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={[estilos.contenido, { paddingBottom: espacio.lg }]}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={estilos.etiqueta}>{cliente.nombre}</Text>
          <EncabezadoSeccion titulo={`Agregar producto · ${TITULO_SECCION[pestana][selector]}`} />
          {filas.length === 0 ? (
            <Tarjeta estado="pendiente" etiqueta="Sin productos">
              <Text style={estilos.textoTarjeta}>
                {selector === 'entregado'
                  ? 'No traes producto con existencia para entregarle.'
                  : 'Sin productos en el catálogo local.'}
              </Text>
              <Text style={estilos.textoSuave}>Los productos bajan del portal con la sincronización.</Text>
            </Tarjeta>
          ) : (
            filas.map((r) => renglon(selector, r))
          )}
        </ScrollView>
        {teclado ?? (
          <BarraAbajo>
            <Boton etiqueta="Listo" icono="palomita" onPress={() => setSelector(null)} />
          </BarraAbajo>
        )}
      </View>
    );
  }

  /* ---------------------------------------------------------------- */
  /* La pestaña: motivo (merma), los dos lados y Grabar                 */
  /* ---------------------------------------------------------------- */
  const seccion = (sentido: SentidoMovimiento) => (
    <>
      <EncabezadoSeccion
        titulo={TITULO_SECCION[pestana][sentido]}
        nota={pestana === 'merma' && sentido === 'entregado' ? 'opcional' : undefined}
      />
      {visibles(sentido).map((r) => renglon(sentido, r))}
      <AgregarProducto
        onPress={() => {
          setActivo(null);
          setError(null);
          setSelector(sentido);
        }}
      />
    </>
  );

  return (
    <View style={{ flex: 1, backgroundColor: colores.papel }}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[estilos.contenido, { paddingBottom: espacio.lg }]}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={estilos.etiqueta}>{cliente.nombre}</Text>
        <View style={{ flexDirection: 'row', gap: espacio.sm, marginBottom: espacio.md }}>
          {(['merma', 'cambios'] as const).map((p) => (
            <Chip
              key={p}
              etiqueta={textoPestana(p, capturas[p])}
              elegida={pestana === p}
              onPress={() => cambiarPestana(p)}
              ancho
            />
          ))}
        </View>

        {pestana === 'merma' ? (
          <SelectorMotivo
            motivos={motivos}
            elegido={motivoId}
            onElegir={setMotivoId}
            onAbrir={() => setActivo(null)}
          />
        ) : null}

        {seccion('recibido')}
        {seccion('entregado')}
      </ScrollView>

      {teclado ?? (
        <BarraAbajo>
          {faltantes.length > 0 ? <Text style={estilos.textoSuave}>{faltantes.join(' ')}</Text> : null}
          {menu.avisoDiaCerrado ? <Text style={estilos.error}>{menu.avisoDiaCerrado}</Text> : null}
          {error ? <Text style={estilos.error}>{error}</Text> : null}
          <Boton etiqueta="Grabar" icono="palomita" deshabilitado={!validacion.listo} onPress={grabar} />
        </BarraAbajo>
      )}
    </View>
  );
}
