import { router } from 'expo-router';
import { useMemo } from 'react';
import { Text, View } from 'react-native';

import type { CampoEgreso } from '@/datos/tipos';
import { camposParaGasto, pastillaGasto, puedeRegistrarGasto } from '@/estado/gasto';
import { estadoMenuJornada } from '@/estado/menu-jornada';
import { useJawa } from '@/estado/proveedor-jawa';
import { useSesion } from '@/estado/proveedor-sesion';
import { Boton } from '@/ui/boton';
import { Cifra, pesos } from '@/ui/cifra';
import { formatearHora } from '@/ui/momento';
import { Pantalla, Pastilla, Tarjeta } from '@/ui/pantalla';
import { useTema } from '@/ui/tema';
import { espacio } from '@/ui/tokens';

/**
 * Gastos (T-30/T-31, D9): lo que el vendedor pago hoy con la cobranza (hielo,
 * gasolina, una reparacion, un adelanto). Arriba "Gastos de hoy" con su
 * subida; abajo el total del dia, que suma TODOS (el efectivo ya salio aunque
 * el servidor no lo tenga). Un gasto grabado no se edita ni se borra aqui: las
 * correcciones son del portal.
 */
export default function Gastos() {
  const { datos, vendedor, jornada, versionCatalogos } = useJawa();
  const { ultimaSincronizacion } = useSesion();
  const { estilos } = useTema();
  const menu = estadoMenuJornada(jornada);

  const campos = useMemo<CampoEgreso[]>(() => {
    void versionCatalogos;
    return camposParaGasto(datos.catalogos.listarCamposEgreso());
  }, [datos, versionCatalogos]);

  // Se relee UNA vez por cambio, sin `useFocusEffect`: `gastos.registrar` mueve
  // `versionCatalogos` (`publicarCambio`) mientras esta pantalla sigue montada
  // debajo del formulario, asi que al volver con `router.back()` ya esta al dia;
  // y la subida cambia la pastilla con `ultimaSincronizacion`. Con un contador
  // de foco ademas, cada vuelta releeria dos veces.
  const hoy = useMemo(() => {
    void ultimaSincronizacion;
    void versionCatalogos;
    if (!vendedor) return { gastos: [], total: 0 };
    return {
      gastos: datos.gastos.delDia(vendedor.id),
      total: datos.gastos.totalDelDia(vendedor.id),
    };
  }, [datos, vendedor, ultimaSincronizacion, versionCatalogos]);

  const sinCatalogo = campos.length === 0;

  return (
    <Pantalla titulo="Gastos" subtitulo="Lo que pagaste hoy con la cobranza del día">
      <Tarjeta etiqueta="Gastos de hoy">
        {hoy.gastos.length === 0 ? (
          <Text style={estilos.textoSuave}>Todavía no registras gastos hoy.</Text>
        ) : (
          hoy.gastos.map((g) => {
            const p = pastillaGasto(g);
            return (
              <View key={g.id} style={{ gap: espacio.xs, marginBottom: espacio.sm }}>
                <Text style={estilos.textoTarjeta}>
                  {g.campo_nombre} · <Cifra valor={pesos(g.monto_centavos)} /> ·{' '}
                  <Cifra valor={formatearHora(g.registrado_en)} />
                </Text>
                {g.comentario ? <Text style={estilos.textoSuave}>{g.comentario}</Text> : null}
                <Pastilla texto={p.texto} estado={p.estado} />
                {p.detalle ? <Text style={estilos.error}>{p.detalle}</Text> : null}
              </View>
            );
          })
        )}
      </Tarjeta>

      <Tarjeta estado={hoy.total > 0 ? 'accion' : 'neutro'} etiqueta="Total del día">
        <Cifra valor={pesos(hoy.total)} tamano="destacado" />
      </Tarjeta>

      {sinCatalogo ? (
        // Sin campos con "Se usa en la app" (nunca ha sincronizado, o la oficina
        // no marco ninguno): lo dice y no deja registrar.
        <Tarjeta estado="pendiente" etiqueta="Sin catálogo de gastos">
          <Text style={estilos.textoTarjeta}>
            Los campos de gasto bajan del portal con la sincronización. Sincroniza para poder registrar un gasto.
          </Text>
        </Tarjeta>
      ) : null}
      {menu.avisoDiaCerrado ? <Text style={estilos.error}>{menu.avisoDiaCerrado}</Text> : null}

      <Boton
        etiqueta="Registrar gasto"
        glifo="+"
        deshabilitado={
          !puedeRegistrarGasto({ camposDisponibles: campos.length, diaCerrado: !menu.operacionesHabilitadas })
        }
        onPress={() => router.push('/(jornada)/gastos/registrar')}
        estilo={{ marginTop: espacio.lg, marginBottom: espacio.xl }}
      />
    </Pantalla>
  );
}
