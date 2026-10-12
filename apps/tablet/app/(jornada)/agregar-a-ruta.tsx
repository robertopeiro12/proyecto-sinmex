import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Alert, Platform, Pressable, Text, ToastAndroid, View } from 'react-native';

import { ErrorJornada, ErrorRuta } from '@/datos';
import type { Cliente } from '@/datos/tipos';
import { estadoMenuJornada } from '@/estado/menu-jornada';
import { useJawa } from '@/estado/proveedor-jawa';
import { filtrarParaAgregar, primeraLineaDomicilio, textoAgregado } from '@/estado/ruta-del-dia';
import { Campo } from '@/ui/campo';
import { Pantalla, Tarjeta } from '@/ui/pantalla';
import { useTema } from '@/ui/tema';
import { colores, espacio, fuente, grosor, radio, tipo } from '@/ui/tokens';

/** El aviso breve al volver a la lista (D16). La app es Android; en otra plataforma, un Alert. */
function avisar(texto: string) {
  if (Platform.OS === 'android') ToastAndroid.show(texto, ToastAndroid.SHORT);
  else Alert.alert(texto);
}

/**
 * "Agregar a mi ruta" (T-37, D2, D7): clientes EXISTENTES de la sucursal que no
 * estan en la ruta de hoy. El vendedor no da de alta clientes; para eso esta
 * Prospecto. Tocar uno lo agrega al final y vuelve a la lista.
 */
export default function AgregarARuta() {
  const { datos, vendedor, sucursalId, jornada, versionCatalogos } = useJawa();
  const { estilos, t } = useTema();
  const [busqueda, setBusqueda] = useState('');
  const [error, setError] = useState<string | null>(null);
  const menu = estadoMenuJornada(jornada);

  const candidatos = useMemo<Cliente[]>(() => {
    void versionCatalogos;
    if (!sucursalId) return [];
    const enRuta = new Set(
      datos.rutas
        .delDia()
        .filter((f) => f.activo === 1)
        .map((f) => f.cliente_id),
    );
    return filtrarParaAgregar(datos.catalogos.listarClientes(sucursalId), enRuta, busqueda);
  }, [datos, sucursalId, busqueda, versionCatalogos]);

  function agregar(cliente: Cliente) {
    setError(null);
    if (!vendedor || !sucursalId) {
      setError('No hay vendedor con sesión iniciada.');
      return;
    }
    try {
      datos.rutas.agregar(cliente.id, { vendedorId: vendedor.id, sucursalId });
      avisar(textoAgregado(cliente.nombre));
      router.back();
    } catch (e) {
      setError(
        e instanceof ErrorRuta || e instanceof ErrorJornada
          ? e.message
          : 'No se pudo agregar el cliente a la ruta.',
      );
    }
  }

  return (
    <Pantalla
      titulo="Agregar a mi ruta"
      subtitulo="Clientes de tu sucursal que no están en la ruta de hoy. Se agregan al final."
    >
      {menu.avisoDiaCerrado ? (
        <Tarjeta estado="listo" etiqueta="Día cerrado">
          <Text style={estilos.textoTarjeta}>{menu.avisoDiaCerrado}</Text>
        </Tarjeta>
      ) : null}

      <Campo
        etiqueta="Buscar por nombre"
        value={busqueda}
        onChangeText={setBusqueda}
        placeholder="Escribe parte del nombre"
        autoCorrect={false}
      />

      {error ? <Text style={estilos.error}>{error}</Text> : null}

      {candidatos.length === 0 ? (
        <Text style={estilos.textoSuave}>
          {busqueda.trim() === ''
            ? 'Todos los clientes de la sucursal ya están en tu ruta de hoy.'
            : 'Ningún cliente coincide con esa búsqueda.'}
        </Text>
      ) : (
        <View style={{ gap: espacio.sm }}>
          {candidatos.map((cliente) => (
            <Pressable
              key={cliente.id}
              disabled={!menu.operacionesHabilitadas}
              onPress={() => agregar(cliente)}
              accessibilityRole="button"
              accessibilityLabel={`Agregar ${cliente.nombre} a mi ruta`}
              accessibilityState={{ disabled: !menu.operacionesHabilitadas }}
              style={({ pressed }) => [
                {
                  padding: espacio.md,
                  gap: espacio.xs,
                  borderRadius: radio.medio,
                  borderWidth: grosor.fuerte,
                  borderColor: colores.bordeFuerte,
                  backgroundColor: colores.superficie,
                },
                pressed && { backgroundColor: colores.primarioTenue },
                !menu.operacionesHabilitadas && { opacity: 0.35 },
              ]}
            >
              <Text style={{ fontFamily: fuente.cuerpoFuerte, fontSize: t(tipo.destacado), color: colores.tinta }}>
                {cliente.nombre}
              </Text>
              <Text style={estilos.textoSuave}>{primeraLineaDomicilio(cliente.domicilio)}</Text>
            </Pressable>
          ))}
        </View>
      )}
    </Pantalla>
  );
}
