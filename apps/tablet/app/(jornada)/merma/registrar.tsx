import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { Alert, Platform, Text, ToastAndroid } from 'react-native';

import { ErrorJornada, ErrorMovimiento } from '@/datos';
import { textoTeQuedan } from '@/estado/inventario';
import { estadoMenuJornada } from '@/estado/menu-jornada';
import {
  capturar,
  consumoRestante,
  crearGuardiaRegistro,
  faltantesVisiblesMovimiento,
  LARGO_MAX_COMENTARIO_MOVIMIENTO,
  piezasCapturadas,
  textoConsumoRestante,
  tipoDeCaptura,
  TITULO_MOVIMIENTO,
  validarCapturaMovimiento,
  type CapturaMovimiento,
} from '@/estado/movimiento';
import { useJawa } from '@/estado/proveedor-jawa';
import { Boton } from '@/ui/boton';
import { Campo } from '@/ui/campo';
import { Pantalla, Tarjeta } from '@/ui/pantalla';
import { useTema } from '@/ui/tema';
import { espacio } from '@/ui/tokens';

function avisar(texto: string) {
  if (Platform.OS === 'android') ToastAndroid.show(texto, ToastAndroid.SHORT);
  else Alert.alert(texto);
}

/**
 * Captura de la merma del trayecto o del consumo propio (T-27 pieza 2, D3): una
 * fila por presentacion con las piezas que salen de la camioneta, y un
 * comentario. El consumo dice "Te quedan N de consumo hoy" y no deja pasar el
 * limite (D4); con el control prendido, cada fila dice "Te quedan N" (D5).
 */
export default function RegistrarMovimiento() {
  const params = useLocalSearchParams<{ tipo?: string }>();
  const tipo = tipoDeCaptura(params.tipo);
  const { datos, vendedor, jornada, versionCatalogos } = useJawa();
  const { estilos } = useTema();
  const menu = estadoMenuJornada(jornada);

  const presentaciones = useMemo(() => {
    void versionCatalogos;
    return datos.movimientos.presentaciones();
  }, [datos, versionCatalogos]);

  const inventario = useMemo(() => {
    void versionCatalogos;
    return vendedor ? datos.cargas.paraVenta(vendedor.id) : null;
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
  const [comentario, setComentario] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [grabado, setGrabado] = useState(false);
  const [guardia] = useState(() => crearGuardiaRegistro());

  if (tipo === null) {
    return (
      <Pantalla titulo="Sección no encontrada" subtitulo="Vuelve a Merma y consumo.">
        <Text style={estilos.textoSuave}>Esta captura no existe.</Text>
      </Pantalla>
    );
  }

  const entrada = {
    tipo,
    clienteId: null,
    captura,
    comentario,
    diaCerrado: !menu.operacionesHabilitadas,
    consumo: tipo === 'consumo' ? consumo : undefined,
  };
  const validacion = validarCapturaMovimiento(entrada);
  const faltantes = faltantesVisiblesMovimiento(entrada, validacion);
  const restante = consumoRestante(consumo);

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
          lineas: validacion.lineas,
          comentario: validacion.comentario,
        }),
      );
      if (m === null) return;
      setGrabado(true);
      avisar(tipo === 'consumo' ? 'Consumo registrado' : 'Merma registrada');
      router.back();
    } catch (e) {
      setError(e instanceof ErrorMovimiento || e instanceof ErrorJornada ? e.message : 'No se pudo registrar.');
    }
  }

  return (
    <Pantalla
      titulo={TITULO_MOVIMIENTO[tipo]}
      subtitulo={tipo === 'consumo' ? 'Lo que tomas para ti de la camioneta' : 'Lo que se rompió o se echó a perder'}
    >
      {tipo === 'consumo' ? (
        <Tarjeta estado={restante > 0 ? 'listo' : 'pendiente'} etiqueta="Consumo de hoy">
          <Text style={estilos.textoTarjeta}>{textoConsumoRestante(restante)}</Text>
        </Tarjeta>
      ) : null}

      {presentaciones.map((p) => {
        const sale = piezasCapturadas(captura, p.presentacionId, 'entregado');
        const quedan = inventario?.controlInventario
          ? textoTeQuedan(inventario.existencias.get(p.presentacionId)?.existencia ?? 0, sale)
          : null;
        return (
          <Tarjeta key={p.presentacionId} etiqueta={p.etiqueta}>
            <Campo
              etiqueta="Piezas"
              cifra
              placeholder="0"
              value={captura[p.presentacionId]?.entregado ?? ''}
              onChangeText={(v) => setCaptura((c) => capturar(c, p.presentacionId, 'entregado', v))}
              invalido={quedan?.falta ?? false}
            />
            {quedan ? <Text style={quedan.falta ? estilos.error : estilos.textoSuave}>{quedan.texto}</Text> : null}
          </Tarjeta>
        );
      })}

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
        etiqueta={tipo === 'consumo' ? 'Registrar consumo' : 'Registrar merma del trayecto'}
        glifo="✓"
        deshabilitado={!validacion.listo || grabado || presentaciones.length === 0}
        onPress={registrar}
        estilo={{ marginTop: espacio.lg, marginBottom: espacio.xl }}
      />
    </Pantalla>
  );
}
