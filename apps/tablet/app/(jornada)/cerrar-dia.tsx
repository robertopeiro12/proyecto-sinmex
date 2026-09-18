import { useState } from 'react';
import { Text } from 'react-native';

import { ErrorJornada } from '@/datos';
import { useJawa } from '@/estado/proveedor-jawa';
import { contarPendientesDeSubir } from '@/sincronizacion/pendientes';
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
 * gastos, tesoreria, comision, efectividad de ruta e impresion— es T-33.
 *
 * > [!important] T-38: como queda el candado del km final, y que le toca a T-33
 * > "Km final obligatorio antes de enviar el corte" ([[App Tablet]], §5) no se
 * > puede cablear contra la pantalla del corte porque esa pantalla **no existe
 * > todavia**. Lo que si queda montado hoy, y es donde T-33 se apoya:
 * >
 * > 1. `jornadas.cerrar()` es la unica escritura de `km_final` y no admite
 * >    cerrar sin el (ni con uno menor al inicial). Ver su comentario.
 * > 2. Esta pantalla solo pinta la tarjeta del corte en la rama de
 * >    `estado === 'cerrada'`, de modo que el corte es inalcanzable mientras el
 * >    km final falte.
 * >
 * > **Lo que T-33 tiene que conectar:** su accion de *enviar* el corte exige
 * > `jornada.estado === 'cerrada'`. Si T-33 lleva el corte a su propia ruta, que
 * > repita la condicion alli —el guardia de `(jornada)/_layout.tsx` exige
 * > jornada, **no** jornada cerrada, asi que no la cubre— o que la suba al
 * > guardia. Lo que no puede es dar el candado por hecho: hoy lo sostiene el
 * > `if` de abajo, que vive en esta pantalla y no en la navegacion.
 */
export default function CerrarDia() {
  const { datos, jornada, refrescarJornada } = useJawa();
  const { estilos } = useTema();
  const [km, setKm] = useState('');
  const [error, setError] = useState<string | null>(null);

  const kmNumero = Number(km.replace(',', '.'));
  const puedeCerrar = km.trim() !== '' && Number.isFinite(kmNumero);
  // Suma jornada, venta y prospecto (`contarPendientesDeSubir`, T-07/T-16/T-40):
  // si algo de eso queda sin subir, el cierre no puede decir "listo" aunque la
  // jornada misma ya este sincronizada, o el vendedor cierra el dia sin WiFi
  // creyendo que ya subio todo.
  const pendientes = contarPendientesDeSubir(datos);

  function cerrar() {
    setError(null);
    if (!jornada) return;

    // El cierre y el refresco van en try separados **a proposito**. Si los dos
    // comparten uno, un fallo al refrescar la pantalla hace decir "No se pudo
    // cerrar el dia" con el dia YA cerrado en SQLite: el kilometraje quedo
    // escrito y el vendedor lee que no. Al reintentar, `cerrar()` le responde
    // "La jornada ya esta cerrada" y se queda sin saber cual de los dos
    // mensajes es cierto, al final de una jornada de 12 h y sin nadie a quien
    // preguntar.
    //
    // La escritura es la que puede fallar por una razon que el vendedor
    // entiende y puede corregir (kilometraje menor al inicial); el refresco no.
    // Que el refresco truene es un problema de la pantalla, no del cierre, y no
    // debe desmentir un dato que ya esta guardado.
    //
    // Patron detectado en la revision de T-20, donde la misma forma era peor:
    // ahi invitaba a cobrar dos veces. Aqui no llega a eso porque `cerrar()`
    // rechaza una jornada ya cerrada, pero el mensaje sigue siendo falso.
    try {
      datos.jornadas.cerrar(jornada.id, kmNumero);
    } catch (e) {
      setError(e instanceof ErrorJornada ? e.message : 'No se pudo cerrar el día.');
      return;
    }

    refrescarJornada();
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
          <Text style={estilos.textoTarjeta}>El corte del día se implementa en T-33</Text>
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
