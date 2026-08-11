import { useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { ErrorJornada } from '@/datos';
import { useJawa } from '@/estado/proveedor-jawa';
import { colores, estilos } from '@/ui/tema';

/**
 * Cerrar el dia: kilometraje final y, despues, el corte.
 *
 * El **kilometraje final** si se implementa aqui porque es un campo de la
 * jornada (la misma entidad que abre el dia) y alimenta el reporte de
 * Kilometraje del portal. El **corte** —ventas por presentacion, cobranza,
 * gastos, tesoreria, comision, efectividad de ruta e impresion— es T-38.
 */
export default function CerrarDia() {
  const { datos, jornada, refrescarJornada } = useJawa();
  const [km, setKm] = useState('');
  const [error, setError] = useState<string | null>(null);

  const kmNumero = Number(km.replace(',', '.'));
  const puedeCerrar = km.trim() !== '' && Number.isFinite(kmNumero);

  function cerrar() {
    setError(null);
    if (!jornada) return;
    try {
      datos.jornadas.cerrar(jornada.id, kmNumero);
      refrescarJornada();
    } catch (e) {
      setError(e instanceof ErrorJornada ? e.message : 'No se pudo cerrar el dia.');
    }
  }

  if (jornada?.estado === 'cerrada') {
    return (
      <ScrollView style={estilos.pantalla}>
        <Text style={estilos.titulo}>Dia cerrado</Text>
        <Text style={estilos.subtitulo}>
          Kilometraje {jornada.km_inicial} → {jornada.km_final} (
          {(jornada.km_final ?? 0) - jornada.km_inicial} km recorridos).
        </Text>
        <View style={estilos.tarjeta}>
          <Text style={estilos.etiqueta}>Proximamente</Text>
          <Text style={estilos.textoTarjeta}>El corte del dia se implementa en T-38</Text>
          <Text style={estilos.textoSuave}>
            Incluira ventas por presentacion, cobranza, gastos, tesoreria (= cobranza − gastos),
            comision del dia, efectividad de ruta e impresion desde la tablet.
          </Text>
        </View>
        <View style={estilos.tarjeta}>
          <Text style={estilos.etiqueta}>Sincronizacion</Text>
          <Text style={estilos.textoTarjeta}>
            {datos.jornadas.pendientesDeSincronizar().length} registro(s) esperando WiFi
          </Text>
          <Text style={estilos.textoSuave}>La subida al portal se implementa en T-07.</Text>
        </View>
      </ScrollView>
    );
  }

  return (
    <ScrollView style={estilos.pantalla}>
      <Text style={estilos.titulo}>Cerrar el dia</Text>
      <Text style={estilos.subtitulo}>
        Captura el kilometraje final antes de enviar el corte. Abriste el dia con{' '}
        {jornada?.km_inicial} km.
      </Text>

      <Text style={estilos.etiqueta}>Kilometraje final</Text>
      <TextInput
        style={estilos.campo}
        value={km}
        onChangeText={setKm}
        keyboardType="numeric"
        inputMode="decimal"
        placeholder={`Mayor o igual a ${jornada?.km_inicial ?? 0}`}
        placeholderTextColor={colores.textoSuave}
      />

      {error ? <Text style={estilos.error}>{error}</Text> : null}

      <Pressable
        onPress={cerrar}
        disabled={!puedeCerrar}
        style={[estilos.boton, { marginTop: 24 }, !puedeCerrar && estilos.botonDeshabilitado]}
      >
        <Text style={estilos.botonTexto}>Cerrar el dia</Text>
      </Pressable>
    </ScrollView>
  );
}
