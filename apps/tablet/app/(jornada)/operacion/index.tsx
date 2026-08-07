import { useMemo } from 'react';
import { ScrollView, Text, View } from 'react-native';

import type { Cliente } from '@/datos/tipos';
import { useJawa } from '@/estado/proveedor-jawa';
import { BotonMenu } from '@/ui/boton-menu';
import { estilos } from '@/ui/tema';

/**
 * Clientes a visitar. Se leen de SQLite, sin red: es la demostracion de que la
 * capa de datos local sirve para **consultar offline**.
 *
 * TODO: T-33 — el orden real es el de la [[Rutas|ruta diaria]] del vendedor,
 *       no alfabetico; la ruta baja del portal con la sincronizacion.
 */
export default function ListaClientes() {
  const { datos, sucursalId } = useJawa();
  const clientes = useMemo<Cliente[]>(
    () => datos.catalogos.listarClientes(sucursalId),
    [datos, sucursalId],
  );

  return (
    <ScrollView style={estilos.pantalla}>
      <Text style={estilos.titulo}>Clientes de hoy</Text>
      <Text style={estilos.subtitulo}>
        {clientes.length} cliente(s) en el catalogo local. Catalogos bajados:{' '}
        {datos.catalogos.frescuraCatalogos() ?? 'nunca'}
      </Text>

      {clientes.length === 0 ? (
        <View style={estilos.tarjeta}>
          <Text style={estilos.textoTarjeta}>Sin clientes precargados</Text>
          <Text style={estilos.textoSuave}>Los clientes bajan del portal (TODO: T-07).</Text>
        </View>
      ) : (
        <View style={estilos.rejilla}>
          {clientes.map((cliente) => (
            <BotonMenu
              key={cliente.id}
              titulo={cliente.nombre}
              descripcion={`${cliente.domicilio} · promocion ${cliente.promocion}`}
              destino={{
                pathname: '/(jornada)/operacion/[clienteId]',
                params: { clienteId: cliente.id },
              }}
            />
          ))}
        </View>
      )}
    </ScrollView>
  );
}
