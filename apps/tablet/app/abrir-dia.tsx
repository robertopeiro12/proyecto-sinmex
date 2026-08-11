import { Redirect, router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { ErrorJornada } from '@/datos';
import type { Vehiculo } from '@/datos/tipos';
import { useJawa } from '@/estado/proveedor-jawa';
import { colores, estilos } from '@/ui/tema';

/**
 * Abrir el dia: vehiculo + kilometraje inicial.
 *
 * > [!danger] Bloqueante
 * > Segun [[App Tablet]], el vendedor **no puede hacer ninguna operacion** hasta
 * > registrar el kilometraje del dia. Esta pantalla es la unica salida hacia el
 * > resto de la app mientras no exista jornada; el guardia que lo impone vive en
 * > `app/(jornada)/_layout.tsx`.
 *
 * Es de las pocas pantallas de T-04 con logica real, porque el bloqueo es
 * **estructural** (afecta la navegacion completa), no parte de un modulo.
 */
export default function AbrirDia() {
  const { datos, vendedor, sucursalId, jornada, refrescarJornada } = useJawa();
  const vehiculos = useMemo<Vehiculo[]>(
    () => (sucursalId ? datos.catalogos.listarVehiculos(sucursalId) : []),
    [datos, sucursalId],
  );

  const [vehiculoId, setVehiculoId] = useState<string | null>(vehiculos[0]?.id ?? null);
  const [km, setKm] = useState('');
  const [error, setError] = useState<string | null>(null);

  const kmNumero = Number(km.replace(',', '.'));
  const puedeAbrir = vehiculoId !== null && km.trim() !== '' && Number.isFinite(kmNumero);

  // Sin sesion no hay vendedor de quien abrir la jornada (T-06).
  if (!vendedor) return <Redirect href="/login" />;
  // Ya abrio el dia: no tiene nada que hacer aqui.
  if (jornada) return <Redirect href="/(jornada)" />;

  function abrir() {
    setError(null);
    if (!vendedor) {
      setError('No hay vendedor con sesion iniciada.');
      return;
    }
    if (!vehiculoId) {
      setError('Selecciona el vehiculo con el que sales a ruta.');
      return;
    }
    try {
      datos.jornadas.abrir({ vendedorId: vendedor.id, vehiculoId, kmInicial: kmNumero });
      refrescarJornada();
      router.replace('/(jornada)');
    } catch (e) {
      setError(e instanceof ErrorJornada ? e.message : 'No se pudo abrir el dia.');
    }
  }

  return (
    <ScrollView style={estilos.pantalla}>
      <Text style={estilos.titulo}>Abrir el dia</Text>
      <Text style={estilos.subtitulo}>
        Selecciona tu vehiculo y captura el kilometraje inicial. Sin esto no puedes operar.
      </Text>

      <Text style={estilos.etiqueta}>Vehiculo</Text>
      <View style={estilos.rejilla}>
        {vehiculos.length === 0 ? (
          <View style={[estilos.tarjeta, { flexGrow: 1 }]}>
            <Text style={estilos.textoTarjeta}>Sin vehiculos en el catalogo local</Text>
            <Text style={estilos.textoSuave}>
              Los vehiculos bajan del portal al sincronizar (TODO: T-07).
            </Text>
          </View>
        ) : (
          vehiculos.map((vehiculo) => {
            const seleccionado = vehiculo.id === vehiculoId;
            return (
              <Pressable
                key={vehiculo.id}
                onPress={() => setVehiculoId(vehiculo.id)}
                style={[
                  estilos.tarjeta,
                  estilos.celdaRejilla,
                  seleccionado && { borderColor: colores.primario, borderWidth: 2 },
                ]}
              >
                <Text style={estilos.textoTarjeta}>{vehiculo.nombre}</Text>
                {seleccionado ? <Text style={estilos.textoSuave}>Seleccionado</Text> : null}
              </Pressable>
            );
          })
        )}
      </View>

      <View style={{ marginTop: 24 }}>
        <Text style={estilos.etiqueta}>Kilometraje inicial</Text>
        <TextInput
          style={estilos.campo}
          value={km}
          onChangeText={setKm}
          keyboardType="numeric"
          inputMode="decimal"
          placeholder="Ej. 128450"
          placeholderTextColor={colores.textoSuave}
        />
      </View>

      {error ? <Text style={estilos.error}>{error}</Text> : null}

      <Pressable
        onPress={abrir}
        disabled={!puedeAbrir}
        style={[estilos.boton, { marginTop: 24 }, !puedeAbrir && estilos.botonDeshabilitado]}
      >
        <Text style={estilos.botonTexto}>Abrir el dia</Text>
      </Pressable>
    </ScrollView>
  );
}
