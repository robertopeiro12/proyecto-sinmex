import { useMemo } from 'react';
import { Text, View } from 'react-native';

import type { Cliente } from '@/datos/tipos';
import { useJawa } from '@/estado/proveedor-jawa';
import { BotonMenu } from '@/ui/boton-menu';
import { Cifra } from '@/ui/cifra';
import { Pantalla, Tarjeta } from '@/ui/pantalla';
import { useTema } from '@/ui/tema';

/**
 * Clientes a visitar. Se leen de SQLite, sin red: es la demostracion de que la
 * capa de datos local sirve para **consultar offline**.
 *
 * TODO: T-33 — el orden real es el de la [[Rutas|ruta diaria]] del vendedor,
 *       no alfabetico; la ruta baja del portal con la sincronizacion.
 */
export default function ListaClientes() {
  const { datos, sucursalId } = useJawa();
  const { estilos } = useTema();
  // `sucursalId` es null si no hay sesion. Aqui no puede pasar (el layout del
  // grupo ya redirige al login), pero el tipo lo admite y devolver la lista
  // vacia es mas honesto que forzar el tipo con un `!`.
  const clientes = useMemo<Cliente[]>(
    () => (sucursalId ? datos.catalogos.listarClientes(sucursalId) : []),
    [datos, sucursalId],
  );

  return (
    <Pantalla
      titulo="Clientes de hoy"
      subtitulo={
        <Text style={estilos.subtitulo}>
          <Cifra valor={clientes.length} tono="suave" /> cliente(s) en el catálogo local. Catálogos
          bajados: {datos.catalogos.frescuraCatalogos() ?? 'nunca'}
        </Text>
      }
    >
      {clientes.length === 0 ? (
        <Tarjeta estado="pendiente" etiqueta="Catálogo vacío">
          <Text style={estilos.textoTarjeta}>Sin clientes precargados</Text>
          <Text style={estilos.textoSuave}>
            Los clientes bajan del portal con la sincronización, que corre sola tras un login con
            WiFi.
          </Text>
        </Tarjeta>
      ) : (
        <View style={estilos.rejilla}>
          {clientes.map((cliente) => (
            <BotonMenu
              key={cliente.id}
              titulo={cliente.nombre}
              descripcion={`${cliente.domicilio} · promoción ${cliente.promocion}`}
              destino={{
                pathname: '/(jornada)/operacion/[clienteId]',
                params: { clienteId: cliente.id },
              }}
            />
          ))}
        </View>
      )}
    </Pantalla>
  );
}
