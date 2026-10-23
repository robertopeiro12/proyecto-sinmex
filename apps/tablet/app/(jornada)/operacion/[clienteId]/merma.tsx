import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { Alert, Platform, Text, ToastAndroid, View } from 'react-native';

import { ErrorJornada, ErrorMovimiento } from '@/datos';
import { textoTeQuedan } from '@/estado/inventario';
import { estadoMenuJornada } from '@/estado/menu-jornada';
import {
  capturar,
  crearGuardiaRegistro,
  faltantesVisiblesMovimiento,
  LARGO_MAX_COMENTARIO_MOVIMIENTO,
  piezasCapturadas,
  validarCapturaMovimiento,
  type CapturaMovimiento,
} from '@/estado/movimiento';
import { useJawa } from '@/estado/proveedor-jawa';
import { Boton } from '@/ui/boton';
import { Campo } from '@/ui/campo';
import { Pantalla, Tarjeta } from '@/ui/pantalla';
import { useTema } from '@/ui/tema';
import { espacio } from '@/ui/tokens';

/** El aviso breve al volver a la ficha (como "Gasto registrado"). En otra plataforma, un Alert. */
function avisar(texto: string) {
  if (Platform.OS === 'android') ToastAndroid.show(texto, ToastAndroid.SHORT);
  else Alert.alert(texto);
}

/**
 * Merma del cliente (T-27 pieza 2, D2): por presentacion, "Recibí dañado" (lo
 * que el cliente devuelve; al menos una pieza en total) y "Le entregué" (la
 * reposicion, opcional, de cualquier sabor y tamaño), y un comentario. Con el
 * control de inventario prendido, "Le entregué" dice "Te quedan N". Toda la
 * validacion es `validarCapturaMovimiento` (con pruebas); el repositorio vuelve
 * a revisar limite, carga pendiente y existencia al grabar.
 */
export default function MermaDelCliente() {
  const { clienteId } = useLocalSearchParams<{ clienteId: string }>();
  const { datos, vendedor, jornada, versionCatalogos } = useJawa();
  const { estilos } = useTema();
  const menu = estadoMenuJornada(jornada);

  const cliente = useMemo(() => {
    void versionCatalogos;
    return datos.catalogos.obtenerCliente(clienteId);
  }, [datos, clienteId, versionCatalogos]);

  const presentaciones = useMemo(() => {
    void versionCatalogos;
    return datos.movimientos.presentaciones();
  }, [datos, versionCatalogos]);

  // Solo para pintar "Te quedan N": `movimientos.registrar` vuelve a calcular al
  // grabar, con la base de ese momento.
  const inventario = useMemo(() => {
    void versionCatalogos;
    return vendedor ? datos.cargas.paraVenta(vendedor.id) : null;
  }, [datos, vendedor, versionCatalogos]);

  const [captura, setCaptura] = useState<CapturaMovimiento>({});
  const [comentario, setComentario] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [grabado, setGrabado] = useState(false);
  const [guardia] = useState(() => crearGuardiaRegistro());

  const entrada = {
    tipo: 'merma_cliente' as const,
    clienteId,
    captura,
    comentario,
    diaCerrado: !menu.operacionesHabilitadas,
  };
  const validacion = validarCapturaMovimiento(entrada);
  const faltantes = faltantesVisiblesMovimiento(entrada, validacion);

  function registrar() {
    setError(null);
    if (!vendedor) {
      setError('No hay vendedor con sesión iniciada.');
      return;
    }
    if (!validacion.listo) return;
    try {
      const m = guardia.intentar(() =>
        datos.movimientos.registrar({
          vendedorId: vendedor.id,
          tipo: 'merma_cliente',
          clienteId,
          lineas: validacion.lineas,
          comentario: validacion.comentario,
        }),
      );
      if (m === null) return;
      setGrabado(true);
      avisar('Merma registrada');
      router.back();
    } catch (e) {
      setError(
        e instanceof ErrorMovimiento || e instanceof ErrorJornada ? e.message : 'No se pudo registrar la merma.',
      );
    }
  }

  if (!cliente) {
    return (
      <Pantalla titulo="Cliente no encontrado" subtitulo="No está en el catálogo local de esta tablet.">
        <Text style={estilos.textoSuave}>Sincroniza y vuelve a abrir su ficha.</Text>
      </Pantalla>
    );
  }

  return (
    <Pantalla titulo="Merma" subtitulo={`${cliente.nombre} · producto dañado que te devuelve y lo que le repones`}>
      {presentaciones.length === 0 ? (
        <Tarjeta estado="pendiente" etiqueta="Catálogo vacío">
          <Text style={estilos.textoTarjeta}>Sin productos en el catálogo local</Text>
          <Text style={estilos.textoSuave}>Los productos bajan del portal con la sincronización.</Text>
        </Tarjeta>
      ) : (
        presentaciones.map((p) => {
          const entregado = piezasCapturadas(captura, p.presentacionId, 'entregado');
          const quedan = inventario?.controlInventario
            ? textoTeQuedan(inventario.existencias.get(p.presentacionId)?.existencia ?? 0, entregado)
            : null;
          return (
            <Tarjeta key={p.presentacionId} etiqueta={p.etiqueta}>
              <View style={{ flexDirection: 'row', gap: espacio.md }}>
                <View style={{ flex: 1 }}>
                  <Campo
                    etiqueta="Recibí dañado"
                    cifra
                    placeholder="0"
                    value={captura[p.presentacionId]?.recibido ?? ''}
                    onChangeText={(v) => setCaptura((c) => capturar(c, p.presentacionId, 'recibido', v))}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Campo
                    etiqueta="Le entregué"
                    cifra
                    placeholder="0"
                    value={captura[p.presentacionId]?.entregado ?? ''}
                    onChangeText={(v) => setCaptura((c) => capturar(c, p.presentacionId, 'entregado', v))}
                    invalido={quedan?.falta ?? false}
                  />
                  {quedan ? (
                    <Text style={quedan.falta ? estilos.error : estilos.textoSuave}>{quedan.texto}</Text>
                  ) : null}
                </View>
              </View>
            </Tarjeta>
          );
        })
      )}

      <Campo
        etiqueta="Comentario (opcional)"
        value={comentario}
        onChangeText={setComentario}
        placeholder="Lo que haya que recordar"
        maxLength={LARGO_MAX_COMENTARIO_MOVIMIENTO}
        multiline
      />

      {faltantes.length > 0 ? <Text style={estilos.textoSuave}>{faltantes.join(' ')}</Text> : null}
      {menu.avisoDiaCerrado ? <Text style={estilos.error}>{menu.avisoDiaCerrado}</Text> : null}
      {error ? <Text style={estilos.error}>{error}</Text> : null}

      <Boton
        etiqueta="Registrar merma"
        glifo="✓"
        deshabilitado={!validacion.listo || grabado || presentaciones.length === 0}
        onPress={registrar}
        estilo={{ marginTop: espacio.lg, marginBottom: espacio.xl }}
      />
    </Pantalla>
  );
}
