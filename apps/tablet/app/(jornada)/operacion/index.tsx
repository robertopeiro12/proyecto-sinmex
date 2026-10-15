import { useMemo, useState } from 'react';
import { Text, View } from 'react-native';

import type { Cliente } from '@/datos/tipos';
import { useJawa } from '@/estado/proveedor-jawa';
import { primeraLineaDomicilio } from '@/estado/ruta-del-dia';
import { BotonMenu } from '@/ui/boton-menu';
import { Cifra } from '@/ui/cifra';
import { formatearMomento } from '@/ui/momento';
import { Opcion } from '@/ui/opcion';
import { Pantalla, Tarjeta } from '@/ui/pantalla';
import { useTema } from '@/ui/tema';
import { espacio } from '@/ui/tokens';

/**
 * Todos los clientes de la sucursal (T-37: sale del menu hamburguesa; el camino
 * principal es la ruta del dia). Se leen de SQLite, sin red.
 *
 * T-75: pestanas Clientes | Prospectos; un prospecto llega aqui desde que se
 * captura (espejo local) o cuando lo captura otra tablet y baja por pull.
 */
export default function ListaClientes() {
  const { datos, sucursalId, versionCatalogos } = useJawa();
  const { estilos } = useTema();
  const [pestana, setPestana] = useState<'clientes' | 'prospectos'>('clientes');
  // `sucursalId` es null si no hay sesion. Aqui no puede pasar (el layout del
  // grupo ya redirige al login), pero el tipo lo admite y devolver la lista
  // vacia es mas honesto que forzar el tipo con un `!`.
  //
  // `versionCatalogos` hace que la lista se rehaga cuando el `pull` escribe.
  // Aqui el sintoma es menos grave que en "Abrir el dia" (no bloquea), pero es
  // el mismo defecto, y con el refresco automatico de las 11:00/14:00 (T-44)
  // sera el caso normal: el vendedor mirando la lista mientras baja la nueva.
  const lista = useMemo<Cliente[]>(() => {
    // Ver la nota gemela en `abrir-dia.tsx`: la lectura es para que el linter
    // no marque como sobrante la dependencia que evita el defecto.
    void versionCatalogos;
    if (!sucursalId) return [];
    return pestana === 'clientes'
      ? datos.catalogos.listarClientes(sucursalId)
      : datos.catalogos.listarProspectos(sucursalId);
  }, [datos, sucursalId, versionCatalogos, pestana]);

  return (
    <Pantalla
      titulo="Todos los clientes"
      subtitulo={
        <Text style={estilos.subtitulo}>
          <Cifra valor={lista.length} tono="suave" />{' '}
          {pestana === 'clientes' ? 'cliente(s)' : 'prospecto(s)'} en el catálogo local. Catálogos
          bajados: {formatearMomento(datos.catalogos.frescuraCatalogos())}
        </Text>
      }
    >
      <View style={{ flexDirection: 'row', gap: espacio.sm }}>
        <Opcion
          etiqueta="Clientes"
          seleccionada={pestana === 'clientes'}
          onPress={() => setPestana('clientes')}
        />
        <Opcion
          etiqueta="Prospectos"
          seleccionada={pestana === 'prospectos'}
          onPress={() => setPestana('prospectos')}
        />
      </View>

      {lista.length === 0 ? (
        pestana === 'clientes' ? (
          <Tarjeta estado="pendiente" etiqueta="Catálogo vacío">
            <Text style={estilos.textoTarjeta}>Sin clientes precargados</Text>
            <Text style={estilos.textoSuave}>
              Los clientes bajan del portal con la sincronización, que corre sola tras un login con
              WiFi.
            </Text>
          </Tarjeta>
        ) : (
          <Tarjeta estado="pendiente" etiqueta="Sin prospectos">
            <Text style={estilos.textoSuave}>
              No hay prospectos en el catálogo local. Los que captures en Prospectos aparecen aquí
              al guardarlos.
            </Text>
          </Tarjeta>
        )
      ) : (
        <View style={estilos.rejilla}>
          {lista.map((cliente) => (
            <BotonMenu
              key={cliente.id}
              titulo={cliente.nombre}
              descripcion={primeraLineaDomicilio(cliente.domicilio)}
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
