import { useState } from 'react';
import { Text } from 'react-native';

import { ErrorJornada } from '@/datos';
import { useJawa } from '@/estado/proveedor-jawa';
import { Boton } from '@/ui/boton';
import { Campo } from '@/ui/campo';
import { Cifra } from '@/ui/cifra';
import { Pantalla, Pastilla, Tarjeta } from '@/ui/pantalla';
import { useTema } from '@/ui/tema';
import { espacio } from '@/ui/tokens';

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
  const { estilos } = useTema();
  const [km, setKm] = useState('');
  const [error, setError] = useState<string | null>(null);

  const kmNumero = Number(km.replace(',', '.'));
  const puedeCerrar = km.trim() !== '' && Number.isFinite(kmNumero);
  const pendientes = datos.jornadas.pendientesDeSincronizar().length;

  function cerrar() {
    setError(null);
    if (!jornada) return;
    try {
      datos.jornadas.cerrar(jornada.id, kmNumero);
      refrescarJornada();
    } catch (e) {
      setError(e instanceof ErrorJornada ? e.message : 'No se pudo cerrar el día.');
    }
  }

  if (jornada?.estado === 'cerrada') {
    return (
      <Pantalla
        titulo="Día cerrado"
        subtitulo={
          <Text style={estilos.subtitulo}>
            Kilometraje <Cifra valor={jornada.km_inicial} tono="suave" /> →{' '}
            <Cifra valor={jornada.km_final ?? 0} tono="suave" /> (
            <Cifra valor={(jornada.km_final ?? 0) - jornada.km_inicial} tono="suave" /> km
            recorridos).
          </Text>
        }
      >
        <Tarjeta estado="pendiente" etiqueta="Próximamente">
          <Text style={estilos.textoTarjeta}>El corte del día se implementa en T-38</Text>
          <Text style={estilos.textoSuave}>
            Incluirá ventas por presentación, cobranza, gastos, tesorería (= cobranza − gastos),
            comisión del día, efectividad de ruta e impresión desde la tablet.
          </Text>
        </Tarjeta>

        <Tarjeta
          estado={pendientes > 0 ? 'pendiente' : 'listo'}
          etiqueta="Sincronización"
        >
          <Pastilla
            numero={pendientes}
            texto={pendientes === 1 ? 'registro esperando WiFi' : 'registros esperando WiFi'}
            estado={pendientes > 0 ? 'pendiente' : 'listo'}
          />
          <Text style={estilos.textoSuave}>
            Suben solos al volver al WiFi del negocio, o con «Sincronizar ahora» desde la jornada.
          </Text>
        </Tarjeta>
      </Pantalla>
    );
  }

  return (
    <Pantalla
      formulario
      titulo="Cerrar el día"
      subtitulo={
        <Text style={estilos.subtitulo}>
          Captura el kilometraje final antes de enviar el corte. Abriste el día con{' '}
          <Cifra valor={jornada?.km_inicial ?? 0} tono="suave" /> km.
        </Text>
      }
    >
      <Campo
        etiqueta="Kilometraje final"
        cifra
        // Ver la nota gemela en `abrir-dia.tsx`: el odometro puede traer decimal.
        keyboardType="numeric"
        inputMode="decimal"
        value={km}
        onChangeText={setKm}
        placeholder={`Mayor o igual a ${jornada?.km_inicial ?? 0}`}
      />

      {error ? <Text style={estilos.error}>{error}</Text> : null}

      <Boton
        etiqueta="Cerrar el día"
        onPress={cerrar}
        deshabilitado={!puedeCerrar}
        estilo={{ marginTop: espacio.lg }}
      />
    </Pantalla>
  );
}
