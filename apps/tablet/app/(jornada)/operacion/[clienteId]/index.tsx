import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Text, View } from 'react-native';

import type { SyncEstado } from '@/datos/tipos';
import { useJawa } from '@/estado/proveedor-jawa';
import { useSesion } from '@/estado/proveedor-sesion';
import { BotonMenu } from '@/ui/boton-menu';
import { Cifra, pesos } from '@/ui/cifra';
import { Pantalla, Pastilla, Tarjeta, type Estado } from '@/ui/pantalla';
import { useTema } from '@/ui/tema';
import { espacio } from '@/ui/tokens';

/** Como se le dice al vendedor en que va cada venta. */
const ETIQUETA_SYNC: Record<SyncEstado, string> = {
  pendiente: 'Por subir',
  enviando: 'Subiendo',
  sincronizado: 'Sincronizada',
  error: 'Con error',
};

const ESTADO_SYNC: Record<SyncEstado, Estado> = {
  pendiente: 'pendiente',
  enviando: 'pendiente',
  sincronizado: 'listo',
  error: 'error',
};

/**
 * Menu de operacion de un cliente: las 4 cosas que [[App Tablet]] permite hacer
 * frente a el, y lo que ya se le vendio hoy.
 */
export default function OperacionCliente() {
  const { clienteId } = useLocalSearchParams<{ clienteId: string }>();
  const { datos } = useJawa();
  const { ultimaSincronizacion } = useSesion();
  const { estilos } = useTema();

  /**
   * "Ventas de hoy" (D18): una venta a credito grabada hoy no aparece como nota
   * pendiente hasta que el servidor la proyecta, asi que el vendedor la ve aqui
   * mientras tanto.
   *
   * Se relee al volver a esta pantalla (`useFocusEffect`): grabar no mueve
   * `versionCatalogos` y `router.back()` no la vuelve a montar.
   * `ultimaSincronizacion` cubre el push que cambia su estado.
   */
  const [vueltas, setVueltas] = useState(0);
  useFocusEffect(
    useCallback(() => {
      setVueltas((n) => n + 1);
    }, []),
  );

  const ventasDeHoy = useMemo(() => {
    void vueltas;
    void ultimaSincronizacion;
    return datos.ventas.delDia(clienteId);
  }, [datos, clienteId, vueltas, ultimaSincronizacion]);

  const cliente = datos.catalogos.obtenerCliente(clienteId);

  if (!cliente) {
    return (
      <Pantalla
        titulo="Cliente no encontrado"
        subtitulo="No está en el catálogo local de esta tablet."
      >
        <Text style={estilos.textoSuave}>
          Puede que lo hayan dado de alta después de tu última sincronización.
        </Text>
      </Pantalla>
    );
  }

  const params = { clienteId };

  // Lo mas grave manda: un error sobre "falta subir", y "falta subir" sobre "todo subido".
  const estadoVentas: Estado = ventasDeHoy.some((v) => v.sync_estado === 'error')
    ? 'error'
    : ventasDeHoy.some((v) => v.sync_estado !== 'sincronizado')
      ? 'pendiente'
      : ventasDeHoy.length > 0
        ? 'listo'
        : 'neutro';

  return (
    <Pantalla
      titulo={cliente.nombre}
      subtitulo={
        <Text style={estilos.subtitulo}>
          {cliente.domicilio}
          {cliente.encargado ? ` · atiende ${cliente.encargado}` : ''}
          {cliente.plazo_credito_dias ? (
            <>
              {' · crédito '}
              <Cifra valor={cliente.plazo_credito_dias} tono="suave" />
              {' días'}
            </>
          ) : null}
        </Text>
      }
    >
      <View style={estilos.rejilla}>
        <BotonMenu
          titulo="Venta"
          descripcion="Capturar cantidades; el total se calcula con el precio del cliente"
          destino={{ pathname: '/(jornada)/operacion/[clienteId]/venta', params }}
        />
        <BotonMenu
          titulo="Cobranza / abono"
          descripcion="Cobrar o abonar una nota pendiente; lo que sobre va a sus otras notas"
          destino={{ pathname: '/(jornada)/operacion/[clienteId]/cobranza', params }}
        />
        <BotonMenu
          titulo="Visita sin venta"
          descripcion="Registrar el motivo por el que no se surtió"
          destino={{ pathname: '/(jornada)/operacion/[clienteId]/visita-sin-venta', params }}
        />
        <BotonMenu
          titulo="Merma, promoción, consumo y gasto"
          descripcion="Registros de campo que afectan el inventario y el corte"
          destino={{ pathname: '/(jornada)/operacion/[clienteId]/registros', params }}
        />
      </View>

      {/* T-20 (D5): se crea al cobrar de mas; usarlo es del portal. */}
      {cliente.saldo_favor_centavos > 0 ? (
        <Tarjeta estado="listo" etiqueta="Saldo a favor">
          <Cifra valor={pesos(cliente.saldo_favor_centavos)} tamano="destacado" tono="exito" />
          <Text style={estilos.textoSuave}>Lo aplica la oficina desde el portal.</Text>
        </Tarjeta>
      ) : null}

      <Tarjeta estado={estadoVentas} etiqueta="Ventas de hoy">
        {ventasDeHoy.length === 0 ? (
          <Text style={estilos.textoSuave}>Todavía no le has vendido hoy.</Text>
        ) : (
          ventasDeHoy.map((v) => (
            <View key={v.id} style={{ gap: espacio.xs, marginBottom: espacio.sm }}>
              <Text style={estilos.textoTarjeta}>
                <Cifra valor={v.folio} /> · <Cifra valor={pesos(v.monto_total_centavos)} /> ·{' '}
                {v.contado_credito === 'contado' ? 'contado' : 'crédito'}
              </Text>
              <Pastilla texto={ETIQUETA_SYNC[v.sync_estado]} estado={ESTADO_SYNC[v.sync_estado]} />
              {v.sync_estado === 'error' && v.sync_error ? (
                <Text style={estilos.error}>{v.sync_error}</Text>
              ) : null}
            </View>
          ))
        )}
      </Tarjeta>
    </Pantalla>
  );
}
