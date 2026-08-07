import { Alert, Pressable, ScrollView, Text, View } from 'react-native';

import { useJawa } from '@/estado/proveedor-jawa';
import { useSesion } from '@/estado/proveedor-sesion';
import { BotonMenu } from '@/ui/boton-menu';
import { colores, espacio, estilos } from '@/ui/tema';

/**
 * Menu de la jornada: las 4 secciones que [[App Tablet]] describe como flujo
 * del dia, una vez abierto.
 */
export default function MenuJornada() {
  const { jornada, vendedor, datos } = useJawa();
  const { salir } = useSesion();

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
          La subida por WiFi al volver al negocio se implementa en T-07.
        </Text>
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
