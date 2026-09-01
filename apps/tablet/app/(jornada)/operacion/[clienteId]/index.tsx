import { useLocalSearchParams } from 'expo-router';
import { Text, View } from 'react-native';

import { useJawa } from '@/estado/proveedor-jawa';
import { BotonMenu } from '@/ui/boton-menu';
import { Cifra } from '@/ui/cifra';
import { Pantalla } from '@/ui/pantalla';
import { useTema } from '@/ui/tema';

/**
 * Menu de operacion de un cliente: las 4 cosas que [[App Tablet]] permite hacer
 * frente a el.
 */
export default function OperacionCliente() {
  const { clienteId } = useLocalSearchParams<{ clienteId: string }>();
  const { datos } = useJawa();
  const { estilos } = useTema();
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
          descripcion="Seleccionar las notas pendientes que paga o abona"
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
    </Pantalla>
  );
}
