import { useLocalSearchParams } from 'expo-router';
import { ScrollView, Text, View } from 'react-native';

import { useJawa } from '@/estado/proveedor-jawa';
import { BotonMenu } from '@/ui/boton-menu';
import { estilos } from '@/ui/tema';

/**
 * Menu de operacion de un cliente: las 4 cosas que [[App Tablet]] permite hacer
 * frente a el.
 */
export default function OperacionCliente() {
  const { clienteId } = useLocalSearchParams<{ clienteId: string }>();
  const { datos } = useJawa();
  const cliente = datos.catalogos.obtenerCliente(clienteId);

  if (!cliente) {
    return (
      <View style={estilos.pantalla}>
        <Text style={estilos.titulo}>Cliente no encontrado</Text>
        <Text style={estilos.subtitulo}>No esta en el catalogo local de esta tablet.</Text>
      </View>
    );
  }

  const params = { clienteId };

  return (
    <ScrollView style={estilos.pantalla}>
      <Text style={estilos.titulo}>{cliente.nombre}</Text>
      <Text style={estilos.subtitulo}>
        {cliente.domicilio}
        {cliente.encargado ? ` · atiende ${cliente.encargado}` : ''}
        {cliente.plazo_credito_dias ? ` · credito ${cliente.plazo_credito_dias} dias` : ''}
      </Text>

      <View style={estilos.rejilla}>
        <BotonMenu
          titulo="Venta"
          descripcion="Capturar cantidades; el total se calcula con el precio del cliente"
          destino={{ pathname: '/(jornada)/operacion/[clienteId]/venta', params }}
        />
        <BotonMenu
          titulo="Cobranza / abono"
          descripcion="Seleccionar las notas pendientes que paga o abona"
          destino={{ pathname: '/(jornada)/operacion/[clienteId]/cobranza', params }}
        />
        <BotonMenu
          titulo="Visita sin venta"
          descripcion="Registrar el motivo por el que no se surtio"
          destino={{ pathname: '/(jornada)/operacion/[clienteId]/visita-sin-venta', params }}
        />
        <BotonMenu
          titulo="Merma, promocion, consumo y gasto"
          descripcion="Registros de campo que afectan el inventario y el corte"
          destino={{ pathname: '/(jornada)/operacion/[clienteId]/registros', params }}
        />
      </View>
    </ScrollView>
  );
}
