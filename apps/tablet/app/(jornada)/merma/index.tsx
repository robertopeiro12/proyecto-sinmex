import { useMemo } from 'react';
import { Text, View } from 'react-native';

import { estadoMenuJornada } from '@/estado/menu-jornada';
import {
  consumoRestante,
  MENSAJE_CONSUMO_AGOTADO,
  ofreceConsumo,
  pastillaMovimiento,
  resumenMovimiento,
  textoConsumoRestante,
  TITULO_MOVIMIENTO,
} from '@/estado/movimiento';
import { useJawa } from '@/estado/proveedor-jawa';
import { useSesion } from '@/estado/proveedor-sesion';
import { estadoSubida } from '@/estado/ruta-del-dia';
import { BotonMenu } from '@/ui/boton-menu';
import { Cifra } from '@/ui/cifra';
import { formatearHora } from '@/ui/momento';
import { Pantalla, Pastilla, Tarjeta } from '@/ui/pantalla';
import { useTema } from '@/ui/tema';
import { espacio } from '@/ui/tokens';

/**
 * Merma y consumo (T-27 pieza 2, D3, entrada del menu): "Merma del trayecto" y
 * "Consumo propio" (con el limite de su sucursal; con 0 no se ofrece, D4), y
 * debajo los movimientos de hoy —tambien la merma de los clientes— con su
 * subida. Un movimiento grabado no se edita ni se borra (D6).
 */
export default function MermaYConsumo() {
  const { datos, vendedor, jornada, versionCatalogos } = useJawa();
  const { ultimaSincronizacion } = useSesion();
  const { estilos } = useTema();
  const menu = estadoMenuJornada(jornada);

  // Se relee UNA vez por cambio (como Gastos): `movimientos.registrar` mueve
  // `versionCatalogos` mientras esta pantalla sigue montada debajo de la
  // captura; la subida cambia la pastilla con `ultimaSincronizacion`.
  const vista = useMemo(() => {
    void versionCatalogos;
    void ultimaSincronizacion;
    if (!vendedor) return { movimientos: [], limite: 0, consumoDeHoy: 0 };
    return {
      movimientos: datos.movimientos.delDia(vendedor.id),
      limite: datos.movimientos.consumoDiarioMax(vendedor.id),
      consumoDeHoy: datos.movimientos.consumoDeHoy(vendedor.id),
    };
  }, [datos, vendedor, versionCatalogos, ultimaSincronizacion]);

  const restante = consumoRestante({ limite: vista.limite, consumoDeHoy: vista.consumoDeHoy });
  const estado = estadoSubida(vista.movimientos.map((m) => m.sync_estado)) ?? 'neutro';

  return (
    <Pantalla titulo="Merma y consumo" subtitulo="Lo que sale de la camioneta sin venderse">
      <View style={estilos.rejilla}>
        <BotonMenu
          titulo="Merma del trayecto"
          descripcion="Producto que se te rompió o se echó a perder hoy"
          destino={{ pathname: '/(jornada)/merma/registrar', params: { tipo: 'merma_trayecto' } }}
          deshabilitado={!menu.operacionesHabilitadas}
          destacada
        />
        {ofreceConsumo(vista.limite) ? (
          <BotonMenu
            titulo="Consumo propio"
            descripcion={restante > 0 ? textoConsumoRestante(restante) : MENSAJE_CONSUMO_AGOTADO}
            destino={{ pathname: '/(jornada)/merma/registrar', params: { tipo: 'consumo' } }}
            deshabilitado={!menu.operacionesHabilitadas || restante === 0}
          />
        ) : null}
      </View>
      <Text style={[estilos.textoSuave, { marginTop: espacio.sm }]}>
        La merma de un cliente se registra en su ficha.
      </Text>
      {menu.avisoDiaCerrado ? <Text style={estilos.error}>{menu.avisoDiaCerrado}</Text> : null}

      <Tarjeta estado={estado} etiqueta="Movimientos de hoy">
        {vista.movimientos.length === 0 ? (
          <Text style={estilos.textoSuave}>Todavía no registras merma ni consumo hoy.</Text>
        ) : (
          vista.movimientos.map((m) => {
            const p = pastillaMovimiento(m);
            const cliente = m.cliente_id ? datos.catalogos.obtenerCliente(m.cliente_id) : null;
            return (
              <View key={m.id} style={{ gap: espacio.xs, marginBottom: espacio.sm }}>
                <Text style={estilos.textoTarjeta}>
                  {TITULO_MOVIMIENTO[m.tipo]}
                  {cliente ? ` · ${cliente.nombre}` : ''} · <Cifra valor={formatearHora(m.registrado_en)} />
                </Text>
                <Text style={estilos.textoSuave}>{resumenMovimiento(m)}</Text>
                {m.comentario ? <Text style={estilos.textoSuave}>{m.comentario}</Text> : null}
                <Pastilla texto={p.texto} estado={p.estado} />
                {p.detalle ? <Text style={estilos.error}>{p.detalle}</Text> : null}
              </View>
            );
          })
        )}
      </Tarjeta>
    </Pantalla>
  );
}
