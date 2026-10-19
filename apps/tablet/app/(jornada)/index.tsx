import { router, useFocusEffect, type Href } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ErrorRuta } from '@/datos';
import { estadoMenuJornada } from '@/estado/menu-jornada';
import { useJawa } from '@/estado/proveedor-jawa';
import { useSesion } from '@/estado/proveedor-sesion';
import {
  agruparRuta,
  atendidosFueraDeRuta,
  sinRutaAsignada,
  entradasMenu,
  textoAvisoSinRuta,
} from '@/estado/ruta-del-dia';
import type { MotivoAbandono } from '@/sincronizacion/motor';
import { contarPendientesDeSubir } from '@/sincronizacion/pendientes';
import { Boton } from '@/ui/boton';
import { FilaAtendidoFueraDeRuta, FilaFueraDeRuta, FilaVisitadoSinVenta, ListaRuta } from '@/ui/lista-ruta';
import { BotonIcono } from '@/ui/boton-icono';
import { MenuLateral } from '@/ui/menu-lateral';
import { formatearMomento } from '@/ui/momento';
import { Pastilla, Tarjeta } from '@/ui/pantalla';
import { useTema } from '@/ui/tema';
import { colores, espacio, fuente, grosor, tipo } from '@/ui/tokens';

/**
 * Lo que se le dice al vendedor cuando la sincronizacion no sale.
 *
 * En su idioma y con la accion que le toca a el, no el motivo tecnico: en ruta
 * no puede hacer nada con un "409 contrato incompatible".
 */
const MENSAJE: Record<MotivoAbandono, string> = {
  'sin-sesion': 'Tu sesión ya no vale. Vuelve a entrar con el WiFi del negocio.',
  'sin-red': 'No hay conexión con el negocio. Lo capturado sigue guardado aquí.',
  contrato: 'Esta tablet y el servidor no coinciden de versión. Avisa a la oficina.',
  alcance: 'El servidor rechazó la petición. Avisa a la oficina.',
  'lote-grande':
    'Un envío salió demasiado grande. Avisa a la oficina; lo capturado sigue guardado aquí.',
};

/**
 * La jornada abre en la ruta del dia (T-37, D16): la que asigno la oficina mas
 * lo que agrego el vendedor, en el orden en que el la recorre.
 *
 * Todo lo que esta pantalla decide vive en funciones puras con prueba
 * (`src/estado/ruta-del-dia.ts`, `menu-jornada.ts`); aqui solo se pinta.
 */
export default function RutaDelDia() {
  const { jornada, datos, vendedor, versionCatalogos } = useJawa();
  const { salir, sincronizar, ultimaSincronizacion } = useSesion();
  const { estilos, t } = useTema();
  const insets = useSafeAreaInsets();
  const [sincronizando, setSincronizando] = useState(false);
  const [menuAbierto, setMenuAbierto] = useState(false);
  const [arrastrando, setArrastrando] = useState(false);

  // Se relee al volver a esta pantalla (`useFocusEffect`): vender o cobrar en
  // la ficha no mueve `datos`, y esta pantalla sigue montada debajo.
  const [vueltas, setVueltas] = useState(0);
  useFocusEffect(
    useCallback(() => {
      setVueltas((n) => n + 1);
    }, []),
  );

  // `versionCatalogos` sube cuando el pull escribe y cuando la ruta cambia
  // (agregar, reordenar, quitar publican el cambio).
  const filas = useMemo(() => {
    void vueltas;
    void versionCatalogos;
    void ultimaSincronizacion;
    return datos.rutas.delDia();
  }, [datos, vueltas, versionCatalogos, ultimaSincronizacion]);
  // Memoizado: un arreglo nuevo en cada render rehace el `PanResponder` de cada
  // fila (y reinicia su `dy`) en cuanto el arrastre cambia el estado de aqui.
  const { enRuta, visitadosSinVenta, fueraDeRuta } = useMemo(() => agruparRuta(filas), [filas]);

  // T-75 (D7): a quien se le vendio hoy sin estar en la ruta (prospectos de bienvenida incluidos).
  const atendidos = useMemo(() => {
    void vueltas;
    void versionCatalogos;
    void ultimaSincronizacion;
    if (!vendedor) return [];
    return atendidosFueraDeRuta(
      filas,
      datos.ventas.delDiaDelVendedor(vendedor.id),
      datos.visitas.delDiaDelVendedor(vendedor.id),
      (id) => datos.catalogos.obtenerCliente(id),
    );
  }, [datos, filas, vendedor, vueltas, versionCatalogos, ultimaSincronizacion]);

  // Suma las seis fuentes del push (T-37, T-39).
  const pendientes = useMemo(() => {
    void vueltas;
    void versionCatalogos;
    void ultimaSincronizacion;
    return contarPendientesDeSubir(datos);
  }, [datos, vueltas, versionCatalogos, ultimaSincronizacion]);

  // T-38 (D6 capa 2): con el dia cerrado, la lista queda en solo lectura.
  const menu = estadoMenuJornada(jornada);
  const soloLectura = !menu.operacionesHabilitadas;
  const sinRuta = sinRutaAsignada({ enRuta, visitadosSinVenta, fueraDeRuta });

  /**
   * "Refrescar" es el "Sincronizar ahora" de siempre (D6): pull, push, fotos y
   * pull posterior. No hay un segundo camino de red. Sin red, la lista no cambia.
   */
  async function refrescar() {
    setSincronizando(true);
    try {
      const r = await sincronizar();
      Alert.alert(
        r.ok ? 'Sincronización completa' : 'No se pudo terminar',
        r.ok
          ? `Se bajaron ${r.pull?.filas ?? 0} registro(s) y se subieron ${r.push?.aplicadas ?? 0}.` +
              (r.push?.rechazadas ? ` ${r.push.rechazadas} quedaron con error.` : '')
          : MENSAJE[r.motivo ?? 'sin-red'],
      );
    } finally {
      setSincronizando(false);
      // Se relee la ruta al terminar, salga bien o mal (incluso si `sincronizar`
      // lanza y no deja `ultimaSincronizacion` nueva): una alta que pasa de
      // `error` a `sincronizada` por `ruta-duplicada` no publica un cambio.
      setVueltas((n) => n + 1);
    }
  }

  const abrirCliente = useCallback((clienteId: string) => {
    router.push({ pathname: '/(jornada)/operacion/[clienteId]', params: { clienteId } });
  }, []);

  const reordenar = useCallback(
    (clienteIds: string[]) => {
      if (jornada) datos.rutas.reordenar(jornada.fecha, clienteIds);
    },
    [datos, jornada],
  );

  const quitar = useCallback(
    (id: string) => {
      try {
        datos.rutas.quitarRechazada(id);
      } catch (e) {
        Alert.alert('No se pudo quitar', e instanceof ErrorRuta ? e.message : 'Intenta de nuevo.');
      }
    },
    [datos],
  );

  /**
   * Cerrar sesion borra el material que permite entrar sin red (ver
   * `gestor.salir()`). En ruta eso deja al vendedor fuera hasta volver al WiFi
   * del negocio, asi que se confirma antes. Vive al pie del menu (T-37).
   */
  function confirmarSalida() {
    Alert.alert(
      'Cerrar sesión',
      'Se borrará tu sesión de esta tablet. Para volver a entrar necesitarás conectarte al WiFi del negocio. Lo capturado hoy NO se borra.',
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Cerrar sesión', style: 'destructive', onPress: () => void salir() },
      ],
    );
  }

  const abrirMenu = useCallback(() => setMenuAbierto(true), []);
  const cerrarMenu = useCallback(() => setMenuAbierto(false), []);

  return (
    <MenuLateral
      abierto={menuAbierto}
      onCerrar={cerrarMenu}
      entradas={entradasMenu(soloLectura)}
      onElegir={(entrada) => {
        setMenuAbierto(false);
        router.push(entrada.destino as Href);
      }}
      encabezado={
        <View style={{ gap: espacio.xs }}>
          <Text style={estilos.textoTarjeta}>{vendedor?.nombre ?? 'Vendedor'}</Text>
          <Text style={estilos.textoSuave}>Jornada del {jornada?.fecha}</Text>
          {/* Lo que falta por subir tambien vive aqui, con su palabra: en la
              cabecera solo queda la burbuja del boton de refrescar. */}
          <View style={{ marginTop: espacio.sm }}>
            <Pastilla
              numero={pendientes}
              texto="por subir"
              estado={pendientes > 0 ? 'pendiente' : 'listo'}
            />
          </View>
        </View>
      }
      pie={
        <Boton
          etiqueta="Cerrar sesión"
          tono="peligro"
          glifo="×"
          onPress={() => {
            setMenuAbierto(false);
            confirmarSalida();
          }}
        />
      }
    >
      <View style={{ flex: 1, backgroundColor: colores.papel }}>
        {/* Cabecera propia (la del Stack se oculta para esta pantalla, ver el
            layout): tiene que deslizarse junto con la ruta al abrir el menu. */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: espacio.sm,
            paddingTop: insets.top + espacio.sm,
            paddingBottom: espacio.sm,
            paddingHorizontal: espacio.md,
            backgroundColor: colores.superficie,
            borderBottomWidth: grosor.hairline,
            borderBottomColor: colores.borde,
          }}
        >
          <BotonIcono glifo="☰" etiqueta="Abrir el menú" onPress={abrirMenu} />
          {/* Mismo ancho que el segundo boton de la derecha: el titulo queda centrado. */}
          <View style={{ width: 48 }} />
          <Text
            accessibilityRole="header"
            numberOfLines={1}
            style={{
              flex: 1,
              textAlign: 'center',
              fontFamily: fuente.tituloMedio,
              fontSize: t(tipo.subtitulo),
              color: colores.tinta,
            }}
          >
            Ruta del día
          </Text>
          <BotonIcono
            glifo="+"
            etiqueta="Registrar prospecto"
            deshabilitado={soloLectura}
            onPress={() => router.push('/(jornada)/prospectos')}
          />
          <BotonIcono
            glifo="↻"
            etiqueta="Refrescar"
            ocupado={sincronizando}
            numero={pendientes}
            onPress={() => void refrescar()}
          />
        </View>

        <ScrollView
          style={estilos.pantalla}
          contentContainerStyle={estilos.contenido}
          scrollEnabled={!arrastrando}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={estilos.subtitulo}>
            Jornada del {jornada?.fecha} · Catálogos bajados:{' '}
            {formatearMomento(datos.catalogos.frescuraCatalogos())}
          </Text>

          {ultimaSincronizacion && !ultimaSincronizacion.ok ? (
            <Text style={estilos.error}>{MENSAJE[ultimaSincronizacion.motivo ?? 'sin-red']}</Text>
          ) : null}

          {menu.avisoDiaCerrado ? (
            <Tarjeta estado="listo" etiqueta="Día cerrado">
              <Text style={estilos.textoTarjeta}>{menu.avisoDiaCerrado}</Text>
            </Tarjeta>
          ) : null}

          {sinRuta ? (
            // D3: sin ruta asignada la tablet funciona igual.
            <Tarjeta estado="pendiente" etiqueta="Sin ruta">
              <Text style={estilos.textoTarjeta}>{textoAvisoSinRuta(datos.sync.leerCursor())}</Text>
              <View style={estilos.filaAcciones}>
                <Boton
                  etiqueta={sincronizando ? 'Sincronizando…' : 'Sincronizar'}
                  glifo="↻"
                  tono="neutra"
                  ancho="ajustado"
                  ocupado={sincronizando}
                  onPress={() => void refrescar()}
                />
                <Boton
                  etiqueta="Agregar a mi ruta"
                  glifo="+"
                  ancho="ajustado"
                  deshabilitado={soloLectura}
                  onPress={() => router.push('/(jornada)/agregar-a-ruta')}
                />
              </View>
            </Tarjeta>
          ) : (
            <>
              <ListaRuta
                filas={enRuta}
                soloLectura={soloLectura}
                onTocar={abrirCliente}
                onReordenar={reordenar}
                onQuitar={quitar}
                onArrastrando={setArrastrando}
              />
              {/* La accion principal de la pantalla, a lo ancho y al final de
                  la ruta: es donde el vendedor la busca cuando ya recorrio la lista. */}
              <Boton
                etiqueta="Agregar a mi ruta"
                glifo="+"
                deshabilitado={soloLectura}
                onPress={() => router.push('/(jornada)/agregar-a-ruta')}
                estilo={{ marginTop: espacio.sm }}
              />
            </>
          )}

          {/* T-39 (D8): despues de la lista y antes de "Fuera de ruta". */}
          {visitadosSinVenta.length > 0 ? (
            <View style={{ gap: espacio.sm, marginTop: espacio.lg }}>
              <Text style={estilos.seccion}>Visitados sin venta</Text>
              {visitadosSinVenta.map((fila) => (
                <FilaVisitadoSinVenta key={fila.id} fila={fila} onTocar={abrirCliente} />
              ))}
            </View>
          ) : null}

          {fueraDeRuta.length > 0 ? (
            <View style={{ gap: espacio.sm, marginTop: espacio.lg }}>
              <Text style={estilos.seccion}>Fuera de ruta</Text>
              {fueraDeRuta.map((fila) => (
                <FilaFueraDeRuta key={fila.id} fila={fila} onTocar={abrirCliente} />
              ))}
            </View>
          ) : null}

          {atendidos.length > 0 ? (
            <View style={{ gap: espacio.sm, marginTop: espacio.lg }}>
              <Text style={estilos.seccion}>Atendidos fuera de ruta</Text>
              {atendidos.map((a) => (
                <FilaAtendidoFueraDeRuta key={a.cliente_id} fila={a} onTocar={abrirCliente} />
              ))}
            </View>
          ) : null}
        </ScrollView>
      </View>
    </MenuLateral>
  );
}
