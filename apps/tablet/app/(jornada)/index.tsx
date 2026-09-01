import { useState } from 'react';
import { Alert, Text, View } from 'react-native';

import { useJawa } from '@/estado/proveedor-jawa';
import { useSesion } from '@/estado/proveedor-sesion';
import type { MotivoAbandono } from '@/sincronizacion/motor';
import { Boton } from '@/ui/boton';
import { BotonMenu } from '@/ui/boton-menu';
import { Cifra } from '@/ui/cifra';
import { Pantalla, Pastilla, Tarjeta } from '@/ui/pantalla';
import { useTema } from '@/ui/tema';
import { espacio } from '@/ui/tokens';

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
};

/**
 * Menu de la jornada: las 4 secciones que [[App Tablet]] describe como flujo
 * del dia, una vez abierto.
 */
export default function MenuJornada() {
  const { jornada, vendedor, datos } = useJawa();
  const { salir, sincronizar, ultimaSincronizacion } = useSesion();
  const { estilos } = useTema();
  const [sincronizando, setSincronizando] = useState(false);

  const pendientes = datos.jornadas.pendientesDeSincronizar().length;
  const falloUltima = ultimaSincronizacion !== null && !ultimaSincronizacion.ok;

  /**
   * Estado de la sincronizacion en un solo valor, en orden de gravedad: un
   * fallo manda sobre "quedan pendientes", y "quedan pendientes" manda sobre
   * "todo subido". Lo usan la tarjeta y la pastilla, asi que las dos no pueden
   * contradecirse.
   */
  const estadoSync = falloUltima ? 'error' : pendientes > 0 ? 'pendiente' : 'listo';

  /**
   * Sincronizacion manual.
   *
   * El modelo del negocio es sincronizar al volver al WiFi
   * ([[Sincronizacion offline]]), y hasta que exista el disparo automatico de
   * T-44 este boton es el unico camino a media jornada. Ademas **renueva la
   * sesion**, que es lo que corre hacia adelante la ventana de 72 h.
   */
  async function sincronizarAhora() {
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
    }
  }

  /**
   * Cerrar sesion borra el material que permite entrar sin red (ver
   * `gestor.salir()`). En ruta eso deja al vendedor fuera hasta volver al
   * WiFi del negocio, asi que se confirma antes: es el boton que no debe
   * apretar por error, y esta a un dedo de "Cerrar el dia".
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

  return (
    <Pantalla
      titulo={`Jornada del ${jornada?.fecha}`}
      subtitulo={
        <Text style={estilos.subtitulo}>
          {vendedor?.nombre ?? 'Sin vendedor'} · {vendedor?.sucursalCodigo ?? '—'} · km inicial{' '}
          <Cifra valor={jornada?.km_inicial ?? 0} tono="suave" /> · esquema local v
          <Cifra valor={datos.versionEsquema} tono="suave" />
        </Text>
      }
    >
      <View style={estilos.rejilla}>
        <BotonMenu
          titulo="Operación por cliente"
          descripcion="Venta, cobranza, visita sin venta y registros de campo"
          destino="/(jornada)/operacion"
        />
        <BotonMenu
          titulo="Prospectos"
          descripcion="Alta de prospectos (el vendedor ya no da de alta clientes)"
          destino="/(jornada)/prospectos"
        />
        <BotonMenu
          titulo="Ruta y GPS"
          descripcion="Mapa de clientes del día y orden real de la ruta"
          destino="/(jornada)/ruta"
        />
        <BotonMenu
          titulo="Cerrar el día"
          descripcion="Kilometraje final, corte e impresión"
          destino="/(jornada)/cerrar-dia"
        />
      </View>

      <Tarjeta estado={estadoSync} etiqueta="Sincronización">
        <Pastilla
          numero={pendientes}
          texto={pendientes === 1 ? 'registro por subir' : 'registros por subir'}
          estado={pendientes > 0 ? 'pendiente' : 'listo'}
        />
        <Text style={estilos.textoSuave}>
          Catálogos bajados: {datos.catalogos.frescuraCatalogos() ?? 'nunca'}
        </Text>
        {ultimaSincronizacion ? (
          ultimaSincronizacion.ok ? (
            <Text style={estilos.textoSuave}>
              Última sincronización correcta ·{' '}
              <Cifra valor={ultimaSincronizacion.pull?.filas ?? 0} tono="suave" /> bajados ·{' '}
              <Cifra valor={ultimaSincronizacion.push?.aplicadas ?? 0} tono="suave" /> subidos
            </Text>
          ) : (
            <Text style={estilos.textoSuave}>
              {MENSAJE[ultimaSincronizacion.motivo ?? 'sin-red']}
            </Text>
          )
        ) : null}
        {/* Unica accion primaria de la pantalla: lo demas son tarjetas de navegacion. */}
        <Boton
          etiqueta={sincronizando ? 'Sincronizando…' : 'Sincronizar ahora'}
          glifo="↻"
          onPress={() => void sincronizarAhora()}
          ocupado={sincronizando}
          estilo={{ marginTop: espacio.md }}
        />
      </Tarjeta>

      {/*
        Aislado del resto a proposito, y en `peligro` (contorno rojo, no
        relleno). Esta a un dedo de "Cerrar el dia", que suena parecido y hace
        algo completamente distinto: uno termina la jornada, el otro deja al
        vendedor fuera de la app hasta volver al WiFi. El hueco de arriba y el
        tono son lo que impide confundirlos con el pulgar en movimiento.
      */}
      <Boton
        etiqueta="Cerrar sesión"
        tono="peligro"
        glifo="×"
        onPress={confirmarSalida}
        estilo={{ marginTop: espacio.xl, marginBottom: espacio.xl }}
      />
    </Pantalla>
  );
}
