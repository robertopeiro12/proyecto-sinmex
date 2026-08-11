import { useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';

import { useJawa } from '@/estado/proveedor-jawa';
import { useSesion } from '@/estado/proveedor-sesion';
import type { MotivoAbandono } from '@/sincronizacion/motor';
import { BotonMenu } from '@/ui/boton-menu';
import { colores, espacio, estilos } from '@/ui/tema';

/**
 * Lo que se le dice al vendedor cuando la sincronizacion no sale.
 *
 * En su idioma y con la accion que le toca a el, no el motivo tecnico: en ruta
 * no puede hacer nada con un "409 contrato incompatible".
 */
const MENSAJE: Record<MotivoAbandono, string> = {
  'sin-sesion': 'Tu sesion ya no vale. Vuelve a entrar con el WiFi del negocio.',
  'sin-red': 'No hay conexion con el negocio. Lo capturado sigue guardado aqui.',
  contrato: 'Esta tablet y el servidor no coinciden de version. Avisa a la oficina.',
  alcance: 'El servidor rechazo la peticion. Avisa a la oficina.',
};

/**
 * Menu de la jornada: las 4 secciones que [[App Tablet]] describe como flujo
 * del dia, una vez abierto.
 */
export default function MenuJornada() {
  const { jornada, vendedor, datos } = useJawa();
  const { salir, sincronizar, ultimaSincronizacion } = useSesion();
  const [sincronizando, setSincronizando] = useState(false);

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
        r.ok ? 'Sincronizacion completa' : 'No se pudo terminar',
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
      'Cerrar sesion',
      'Se borrara tu sesion de esta tablet. Para volver a entrar necesitaras conectarte al WiFi del negocio. Lo capturado hoy NO se borra.',
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Cerrar sesion', style: 'destructive', onPress: () => void salir() },
      ],
    );
  }

  return (
    <ScrollView style={estilos.pantalla}>
      <Text style={estilos.titulo}>Jornada del {jornada?.fecha}</Text>
      <Text style={estilos.subtitulo}>
        {vendedor?.nombre ?? 'Sin vendedor'} · {vendedor?.sucursalCodigo ?? '—'} · km inicial{' '}
        {jornada?.km_inicial} · esquema local v{datos.versionEsquema}
      </Text>

      <View style={estilos.rejilla}>
        <BotonMenu
          titulo="Operacion por cliente"
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
          descripcion="Mapa de clientes del dia y orden real de la ruta"
          destino="/(jornada)/ruta"
        />
        <BotonMenu
          titulo="Cerrar el dia"
          descripcion="Kilometraje final, corte e impresion"
          destino="/(jornada)/cerrar-dia"
        />
      </View>

      <View style={estilos.tarjeta}>
        <Text style={estilos.etiqueta}>Sincronizacion</Text>
        <Text style={estilos.textoTarjeta}>
          {datos.jornadas.pendientesDeSincronizar().length} registro(s) pendiente(s) de subir
        </Text>
        <Text style={estilos.textoSuave}>
          Catalogos bajados: {datos.catalogos.frescuraCatalogos() ?? 'nunca'}
        </Text>
        {ultimaSincronizacion ? (
          <Text style={estilos.textoSuave}>
            {ultimaSincronizacion.ok
              ? `Ultima sincronizacion correcta · ${ultimaSincronizacion.pull?.filas ?? 0} bajados · ${ultimaSincronizacion.push?.aplicadas ?? 0} subidos`
              : MENSAJE[ultimaSincronizacion.motivo ?? 'sin-red']}
          </Text>
        ) : null}
        <Pressable
          onPress={() => void sincronizarAhora()}
          disabled={sincronizando}
          style={[
            estilos.boton,
            { marginTop: espacio.md },
            sincronizando ? { opacity: 0.5 } : null,
          ]}
        >
          <Text style={estilos.botonTexto}>
            {sincronizando ? 'Sincronizando...' : 'Sincronizar ahora'}
          </Text>
        </Pressable>
      </View>

      <Pressable
        onPress={confirmarSalida}
        style={[
          estilos.boton,
          { backgroundColor: colores.superficie, borderWidth: 1, borderColor: colores.alerta },
          { marginTop: espacio.md, marginBottom: espacio.xl },
        ]}
      >
        <Text style={[estilos.botonTexto, { color: colores.alerta }]}>Cerrar sesion</Text>
      </Pressable>
    </ScrollView>
  );
}
