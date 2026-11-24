import { router, type Href } from 'expo-router';
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { Alert, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useJawa } from '@/estado/proveedor-jawa';
import { useSesion } from '@/estado/proveedor-sesion';
import { textoHaceCuanto, textoSinSincronizar } from '@/estado/pie-menu';
import { estadoMenuJornada } from '@/estado/menu-jornada';
import { accionMenu, entradasMenu, type ClaveMenu } from '@/estado/ruta-del-dia';
import { contarPendientesDeSubir } from '@/sincronizacion/pendientes';

import { BotonIcono } from './boton-icono';
import { MenuLateral } from './menu-lateral';
import { useTema } from './tema';
import { colores, espacio, fuente, grosor, tipo } from './tokens';

/**
 * Cerrar sesion borra el material que permite entrar sin red (ver
 * `gestor.salir()`). En ruta eso deja al vendedor fuera hasta volver al WiFi
 * del negocio, asi que se confirma antes.
 */
export function confirmarSalida(salir: () => Promise<void> | void) {
  Alert.alert(
    'Cerrar sesión',
    'Se borrará tu sesión de esta tablet. Para volver a entrar necesitarás conectarte al WiFi del negocio. Lo capturado hoy NO se borra.',
    [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Cerrar sesión', style: 'destructive', onPress: () => void salir() },
    ],
  );
}

/**
 * Marco de las pantallas del menu: cabecera propia (menu a la izquierda, titulo,
 * `derecha`), el `MenuLateral` con las entradas y su pie (indicador de
 * sincronizacion, vendedor, vehiculo y sucursal). Toma todo de `useJawa()` y
 * `useSesion()`: las pantallas solo le pasan titulo y contenido.
 *
 * El `Stack` oculta su cabecera para estas pantallas (`_layout.tsx`): esta se
 * desliza junto con el contenido al abrir el menu.
 *
 * `clave` es la entrada del menu de la pantalla: con ella `accionMenu` decide
 * si elegir otra entrada hace `push`, `replace` o `dismissTo` a la Ruta, para
 * que el menu no apile pantallas.
 */
export function MarcoMenu({
  clave,
  titulo,
  derecha,
  children,
}: {
  clave: ClaveMenu;
  titulo: string;
  derecha?: ReactNode;
  children: ReactNode;
}) {
  const { jornada, datos, versionCatalogos } = useJawa();
  const { salir, vendedor, ultimaSincronizacion } = useSesion();
  const { t } = useTema();
  const insets = useSafeAreaInsets();
  const [abierto, setAbierto] = useState(false);

  const diaCerrado = !estadoMenuJornada(jornada).operacionesHabilitadas;
  // `jornada` es la de HOY (la misma que mira la guardia de `(jornada)/_layout.tsx`).
  const sinJornada = jornada === null;

  // Se relee al abrir el menu y cuando el pull o una sincronizacion mueven datos.
  const pie = useMemo(() => {
    void abierto;
    void versionCatalogos;
    void ultimaSincronizacion;
    const vehiculoId = jornada?.vehiculo_id;
    const vehiculo =
      vehiculoId && vendedor
        ? datos.catalogos.listarVehiculos(vendedor.sucursalId).find((v) => v.id === vehiculoId)
        : undefined;
    return {
      sinSubir: contarPendientesDeSubir(datos),
      frescura: datos.catalogos.frescuraCatalogos(),
      vehiculo: vehiculo?.nombre ?? null,
    };
  }, [abierto, datos, jornada, vendedor, versionCatalogos, ultimaSincronizacion]);

  const abrir = useCallback(() => setAbierto(true), []);
  const cerrar = useCallback(() => setAbierto(false), []);

  const lineaPie = {
    fontFamily: fuente.cuerpo,
    fontSize: t(tipo.menor),
    color: colores.tintaSuave,
  } as const;

  return (
    <MenuLateral
      abierto={abierto}
      onCerrar={cerrar}
      // El candado de Corte NO se prende en la pieza 1: aqui va `porVisitar: 0`.
      // Mientras Corte sea el `cerrar-dia` de hoy, el candado puede dejar el dia
      // sin cerrar: con control de inventario prendido y sin carga aceptada los
      // clientes no se abren (ni para Visita), "faltan N" nunca llega a 0 y la
      // jornada no sube. La regla ya esta en `entradasMenu` y probada; la pieza 6
      // la conecta junto con el Corte nuevo
      // (`agruparRutaEnCurso(...).porVisitar.length`).
      entradas={entradasMenu({ porVisitar: 0, diaCerrado, sinJornada })}
      onElegir={(entrada) => {
        setAbierto(false);
        const accion = accionMenu(clave, entrada);
        switch (accion.tipo) {
          case 'salir':
            confirmarSalida(salir);
            return;
          case 'nada':
            return;
          case 'dismissTo':
            router.dismissTo(accion.destino as Href);
            return;
          case 'push':
            router.push(accion.destino as Href);
            return;
          case 'replace':
            router.replace(accion.destino as Href);
            return;
        }
      }}
      pie={
        <View
          style={{
            gap: espacio.xs,
            paddingTop: espacio.md,
            borderTopWidth: grosor.hairline,
            borderTopColor: colores.borde,
          }}
        >
          <Text style={{ ...lineaPie, color: pie.sinSubir > 0 ? colores.aviso : colores.exito }}>
            {textoSinSincronizar(pie.sinSubir)} · {textoHaceCuanto(pie.frescura, new Date().toISOString())}
          </Text>
          <Text style={{ ...lineaPie, fontFamily: fuente.cuerpoFuerte, color: colores.tinta }}>
            {vendedor?.nombre ?? 'Vendedor'}
          </Text>
          {pie.vehiculo ? <Text style={lineaPie}>Vehículo: {pie.vehiculo}</Text> : null}
          {vendedor ? <Text style={lineaPie}>Sucursal: {vendedor.sucursalNombre}</Text> : null}
        </View>
      }
    >
      <View style={{ flex: 1, backgroundColor: colores.papel }}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: espacio.sm,
            paddingTop: insets.top + espacio.sm,
            paddingBottom: espacio.sm,
            paddingHorizontal: espacio.md,
            backgroundColor: colores.superficie,
            borderBottomWidth: grosor.hairline,
            borderBottomColor: colores.borde,
          }}
        >
          <BotonIcono icono="menu" etiqueta="Abrir el menú" onPress={abrir} />
          <Text
            accessibilityRole="header"
            numberOfLines={1}
            style={{
              flex: 1,
              fontFamily: fuente.tituloMedio,
              fontSize: t(tipo.subtitulo),
              color: colores.tinta,
            }}
          >
            {titulo}
          </Text>
          {derecha}
        </View>
        <View style={{ flex: 1 }}>{children}</View>
      </View>
    </MenuLateral>
  );
}
