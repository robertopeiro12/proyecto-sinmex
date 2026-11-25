import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import { Alert, BackHandler, Keyboard, Platform, ScrollView, Text, ToastAndroid, View } from 'react-native';

import { ErrorJornada, ErrorMovimiento } from '@/datos';
import { estadoMenuJornada } from '@/estado/menu-jornada';
import {
  capturar,
  consumoRestante,
  crearGuardiaRegistro,
  faltantesVisiblesMovimiento,
  LARGO_MAX_COMENTARIO_MOVIMIENTO,
  piezasCapturadas,
  piezasDelSentido,
  renglonesMovimiento,
  textoConsumoRestante,
  textoPiezasBarra,
  tipoDeCaptura,
  TITULO_MOVIMIENTO,
  topeTeclado,
  validarCapturaMovimiento,
  type CapturaMovimiento,
} from '@/estado/movimiento';
import { useJawa } from '@/estado/proveedor-jawa';
import { teclear, type TeclaNumerica } from '@/estado/venta-pasos';
import { Boton } from '@/ui/boton';
import { BarraAbajo, FlechaAtras, RenglonCantidad, SelectorMotivo } from '@/ui/captura-movimiento';
import { Campo } from '@/ui/campo';
import { Pantalla, Tarjeta } from '@/ui/pantalla';
import { TecladoCantidad } from '@/ui/teclado-cantidad';
import { useTema } from '@/ui/tema';
import { colores, espacio } from '@/ui/tokens';

function avisar(texto: string) {
  if (Platform.OS === 'android') ToastAndroid.show(texto, ToastAndroid.SHORT);
  else Alert.alert(texto);
}

/**
 * Merma del vehiculo (rediseño pieza 4, maqueta 16) y consumo propio (T-27 pieza
 * 2, D3), desde Merma / Cambios del menu. Los productos son los que trae el
 * vendedor (decision 4 del plan), con "te quedan N" si hay control de
 * inventario; se capturan con el renglon y el teclado de la venta (pieza 2).
 * La merma lleva "Motivo de la merma" (de la lista del portal con
 * `aplica_vehiculo`); el consumo no lleva motivo y dice "Te quedan N de consumo
 * hoy" (D4). Comentario opcional en los dos.
 */
export default function RegistrarMovimiento() {
  const params = useLocalSearchParams<{ tipo?: string }>();
  const tipo = tipoDeCaptura(params.tipo);
  const { datos, vendedor, jornada, versionCatalogos } = useJawa();
  const { estilos } = useTema();
  const menu = estadoMenuJornada(jornada);

  const motivos = useMemo(() => {
    void versionCatalogos;
    return datos.catalogos.listarMotivosMerma('vehiculo');
  }, [datos, versionCatalogos]);

  // Solo para pintar: `movimientos.registrar` vuelve a calcular al grabar.
  const renglones = useMemo(() => {
    void versionCatalogos;
    if (!vendedor) return [];
    const inventario = datos.cargas.paraVenta(vendedor.id);
    return renglonesMovimiento({
      presentaciones: datos.movimientos.presentacionesQueTrae(vendedor.id),
      existencias: inventario.existencias,
      controlInventario: inventario.controlInventario,
    });
  }, [datos, vendedor, versionCatalogos]);

  const consumo = useMemo(() => {
    void versionCatalogos;
    return vendedor
      ? {
          limite: datos.movimientos.consumoDiarioMax(vendedor.id),
          consumoDeHoy: datos.movimientos.consumoDeHoy(vendedor.id),
        }
      : { limite: 0, consumoDeHoy: 0 };
  }, [datos, vendedor, versionCatalogos]);

  const [captura, setCaptura] = useState<CapturaMovimiento>({});
  const [motivoId, setMotivoId] = useState<string | null>(null);
  const [comentario, setComentario] = useState('');
  /** El renglon con el teclado abierto; `null` = cerrado. */
  const [activo, setActivo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [grabado, setGrabado] = useState(false);
  const [guardia] = useState(() => crearGuardiaRegistro());
  const lista = useRef<ScrollView>(null);
  const posiciones = useRef(new Map<string, number>());

  const atras = useCallback((): boolean => {
    if (activo === null) return false;
    setActivo(null);
    return true;
  }, [activo]);

  useFocusEffect(
    useCallback(() => {
      const sub = BackHandler.addEventListener('hardwareBackPress', atras);
      return () => sub.remove();
    }, [atras]),
  );

  if (tipo === null) {
    return (
      <Pantalla titulo="Sección no encontrada" subtitulo="Vuelve a Merma / Cambios.">
        <Text style={estilos.textoSuave}>Esta captura no existe.</Text>
      </Pantalla>
    );
  }

  const esMerma = tipo === 'merma_trayecto';
  const entrada = {
    tipo,
    clienteId: null,
    motivoMermaId: esMerma ? motivoId : null,
    captura,
    comentario,
    diaCerrado: !menu.operacionesHabilitadas,
    consumo: tipo === 'consumo' ? consumo : undefined,
  };
  const validacion = validarCapturaMovimiento(entrada);
  const faltantes = faltantesVisiblesMovimiento(entrada, validacion);
  const restante = consumoRestante(consumo);
  const piezas = piezasDelSentido(captura, 'entregado');

  const indiceActivo = activo === null ? -1 : renglones.findIndex((r) => r.presentacionId === activo);
  const siguienteRenglon = indiceActivo >= 0 ? renglones[indiceActivo + 1] : undefined;

  /** Desliza la lista para que el renglon del teclado quede a la vista (como la venta). */
  function mostrar(presentacionId: string) {
    const y = posiciones.current.get(presentacionId);
    if (y !== undefined) lista.current?.scrollTo({ y: Math.max(0, y - espacio.xxl), animated: true });
  }

  function abrirTeclado(presentacionId: string) {
    Keyboard.dismiss();
    setError(null);
    setActivo(presentacionId);
    mostrar(presentacionId);
  }

  function tecla(valor: TeclaNumerica | 'borrar') {
    if (activo === null) return;
    const id = activo;
    const maximo = topeTeclado('entregado', renglones.find((r) => r.presentacionId === id)?.quedan ?? null);
    setCaptura((c) => capturar(c, id, 'entregado', teclear(c[id]?.entregado ?? '', valor, maximo)));
  }

  function siguiente() {
    setActivo(siguienteRenglon ? siguienteRenglon.presentacionId : null);
    if (siguienteRenglon) mostrar(siguienteRenglon.presentacionId);
  }

  function registrar() {
    setError(null);
    if (!vendedor || tipo === null) {
      setError('No hay vendedor con sesión iniciada.');
      return;
    }
    if (!validacion.listo) return;
    try {
      const m = guardia.intentar(() =>
        datos.movimientos.registrar({
          vendedorId: vendedor.id,
          tipo,
          clienteId: null,
          motivoMermaId: esMerma ? motivoId : null,
          lineas: validacion.lineas,
          comentario: validacion.comentario,
        }),
      );
      if (m === null) return;
      setGrabado(true);
      avisar(esMerma ? 'Merma registrada' : 'Consumo registrado');
      router.back();
    } catch (e) {
      setError(e instanceof ErrorMovimiento || e instanceof ErrorJornada ? e.message : 'No se pudo registrar.');
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: colores.papel }}>
      <Stack.Screen
        options={{
          title: esMerma ? 'Merma del vehículo' : TITULO_MOVIMIENTO[tipo],
          headerLeft: () => <FlechaAtras atras={atras} />,
        }}
      />
      <ScrollView
        ref={lista}
        style={{ flex: 1 }}
        contentContainerStyle={[estilos.contenido, { paddingBottom: espacio.lg }]}
        keyboardShouldPersistTaps="handled"
      >
        {tipo === 'consumo' ? (
          <Tarjeta estado={restante > 0 ? 'listo' : 'pendiente'} etiqueta="Consumo de hoy">
            <Text style={estilos.textoTarjeta}>{textoConsumoRestante(restante)}</Text>
          </Tarjeta>
        ) : null}

        {esMerma ? (
          <SelectorMotivo motivos={motivos} elegido={motivoId} onElegir={setMotivoId} onAbrir={() => setActivo(null)} />
        ) : null}

        <Text style={estilos.etiqueta}>{esMerma ? 'Producto dañado' : 'Producto'}</Text>
        {renglones.length === 0 ? (
          <Tarjeta estado="pendiente" etiqueta="Sin productos">
            <Text style={estilos.textoTarjeta}>No traes producto con existencia.</Text>
            <Text style={estilos.textoSuave}>Los productos bajan del portal con la sincronización.</Text>
          </Tarjeta>
        ) : (
          renglones.map((r) => (
            <View
              key={r.presentacionId}
              onLayout={(e) => posiciones.current.set(r.presentacionId, e.nativeEvent.layout.y)}
            >
              <RenglonCantidad
                etiqueta={r.etiqueta}
                piezas={piezasCapturadas(captura, r.presentacionId, 'entregado')}
                quedan={r.quedan}
                activo={activo === r.presentacionId}
                onPress={() => abrirTeclado(r.presentacionId)}
              />
            </View>
          ))
        )}

        <Campo
          etiqueta="Comentario (opcional)"
          value={comentario}
          onChangeText={setComentario}
          onFocus={() => setActivo(null)}
          placeholder={esMerma ? 'Ej. se rompió al frenar' : 'Lo que haya que recordar'}
          maxLength={LARGO_MAX_COMENTARIO_MOVIMIENTO}
          multiline
        />
      </ScrollView>

      {activo !== null ? (
        <TecladoCantidad
          onTecla={tecla}
          onSiguiente={siguiente}
          etiquetaSiguiente={siguienteRenglon ? 'Siguiente' : 'Listo'}
        />
      ) : (
        <BarraAbajo>
          {faltantes.length > 0 ? <Text style={estilos.textoSuave}>{faltantes.join(' ')}</Text> : null}
          {menu.avisoDiaCerrado ? <Text style={estilos.error}>{menu.avisoDiaCerrado}</Text> : null}
          {error ? <Text style={estilos.error}>{error}</Text> : null}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: espacio.md }}>
            <View style={{ flex: 1 }}>
              <Text style={[estilos.etiqueta, { marginBottom: 0 }]}>{textoPiezasBarra(piezas)}</Text>
            </View>
            <View style={{ flex: 1.6 }}>
              <Boton
                etiqueta={esMerma ? 'Registrar merma' : 'Registrar consumo'}
                icono="palomita"
                deshabilitado={!validacion.listo || grabado}
                onPress={registrar}
              />
            </View>
          </View>
        </BarraAbajo>
      )}
    </View>
  );
}
