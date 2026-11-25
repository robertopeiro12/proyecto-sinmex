import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { estadoMenuJornada } from '@/estado/menu-jornada';
import {
  consumoRestante,
  detalleMovimiento,
  ETIQUETA_TIPO_MOVIMIENTO,
  filtrarMovimientos,
  FILTROS_MOVIMIENTOS,
  lugarMovimiento,
  MENSAJE_CONSUMO_AGOTADO,
  ofreceConsumo,
  pastillaMovimiento,
  piezasDelMovimiento,
  textoConsumoRestante,
  textoMovimientos,
  textoPzas,
  totalPiezasDelDia,
  type FiltroMovimientos,
} from '@/estado/movimiento';
import { useJawa } from '@/estado/proveedor-jawa';
import { useSesion } from '@/estado/proveedor-sesion';
import { Boton } from '@/ui/boton';
import { Chip } from '@/ui/chip';
import { Cifra } from '@/ui/cifra';
import { MarcoMenu } from '@/ui/marco-menu';
import { formatearHora } from '@/ui/momento';
import { Pastilla } from '@/ui/pantalla';
import { useTema } from '@/ui/tema';
import { colores, espacio, fuente, grosor, radio, tipo } from '@/ui/tokens';

/**
 * Merma / Cambios (rediseño pieza 4, maqueta 15; spec §11): arriba "Merma del
 * vehículo" (principal) y "Consumo" (secundario, solo si la sucursal tiene
 * consumo, D4); "Hoy · N movimientos · X pzas"; el registro del dia, lo mas
 * nuevo arriba (hora, cliente o "Vehículo", tipo, motivo o resumen y piezas, con
 * su subida); abajo los filtros Todo / Merma / Cambios. La merma y los cambios
 * de un cliente se registran en su hoja. Un movimiento grabado no se edita ni
 * se borra (D6).
 */
export default function MermaYCambios() {
  const { datos, vendedor, jornada, versionCatalogos } = useJawa();
  const { ultimaSincronizacion } = useSesion();
  const { estilos, t } = useTema();
  const insets = useSafeAreaInsets();
  const menu = estadoMenuJornada(jornada);
  const [filtro, setFiltro] = useState<FiltroMovimientos>('todo');

  // Se relee UNA vez por cambio (como Gastos): `movimientos.registrar` mueve
  // `versionCatalogos` mientras esta pantalla sigue montada debajo de la
  // captura; la subida cambia la pastilla con `ultimaSincronizacion`.
  const vista = useMemo(() => {
    void versionCatalogos;
    void ultimaSincronizacion;
    if (!vendedor) return { movimientos: [], limite: 0, consumoDeHoy: 0 };
    return {
      // Lo mas nuevo arriba (maqueta 17: "la misma forma").
      movimientos: datos.movimientos.delDia(vendedor.id).reverse(),
      limite: datos.movimientos.consumoDiarioMax(vendedor.id),
      consumoDeHoy: datos.movimientos.consumoDeHoy(vendedor.id),
    };
  }, [datos, vendedor, versionCatalogos, ultimaSincronizacion]);

  const restante = consumoRestante({ limite: vista.limite, consumoDeHoy: vista.consumoDeHoy });
  const filas = filtrarMovimientos(vista.movimientos, filtro);
  const deshabilitado = !menu.operacionesHabilitadas;

  return (
    <MarcoMenu clave="merma" titulo="Merma / Cambios">
      <View style={{ flex: 1, backgroundColor: colores.papel }}>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={[estilos.contenido, { paddingBottom: espacio.lg }]}>
          <View style={{ gap: espacio.sm, marginBottom: espacio.md }}>
            <Boton
              etiqueta="Merma del vehículo"
              icono="camion"
              deshabilitado={deshabilitado}
              onPress={() => router.push({ pathname: '/(jornada)/merma/registrar', params: { tipo: 'merma_trayecto' } })}
            />
            {ofreceConsumo(vista.limite) ? (
              <>
                <Boton
                  etiqueta="Consumo"
                  icono="vender"
                  tono="neutra"
                  deshabilitado={deshabilitado || restante === 0}
                  onPress={() => router.push({ pathname: '/(jornada)/merma/registrar', params: { tipo: 'consumo' } })}
                />
                <Text style={estilos.textoSuave}>
                  {restante > 0 ? textoConsumoRestante(restante) : MENSAJE_CONSUMO_AGOTADO}
                </Text>
              </>
            ) : null}
            {menu.avisoDiaCerrado ? <Text style={estilos.error}>{menu.avisoDiaCerrado}</Text> : null}
          </View>

          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: espacio.md,
              marginBottom: espacio.md,
              borderRadius: radio.medio,
              borderWidth: grosor.fuerte,
              borderColor: colores.borde,
              backgroundColor: colores.superficie,
            }}
          >
            <Text style={estilos.textoTarjeta}>Hoy · {textoMovimientos(filas.length)}</Text>
            <Cifra valor={textoPzas(totalPiezasDelDia(filas))} tamano="destacado" />
          </View>

          {filas.length === 0 ? (
            <Text style={estilos.textoSuave}>
              {filtro === 'cambios'
                ? 'Todavía no registras cambios hoy.'
                : filtro === 'merma'
                  ? 'Todavía no registras merma hoy.'
                  : 'Todavía no registras merma, cambios ni consumo hoy. La merma y los cambios de un cliente se registran en su hoja.'}
            </Text>
          ) : (
            filas.map((m) => {
              const p = pastillaMovimiento(m);
              const cliente = m.cliente_id ? datos.catalogos.obtenerCliente(m.cliente_id) : null;
              const esCambio = m.tipo === 'cambio';
              return (
                <View
                  key={m.id}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: espacio.md,
                    paddingVertical: espacio.sm,
                    borderBottomWidth: grosor.hairline,
                    borderBottomColor: colores.borde,
                  }}
                >
                  <Cifra valor={formatearHora(m.registrado_en)} tono="suave" />
                  <View style={{ flex: 1, gap: espacio.xs }}>
                    <Text style={estilos.textoTarjeta}>{lugarMovimiento(cliente?.nombre)}</Text>
                    <Text style={estilos.textoSuave}>
                      <Text
                        style={{
                          fontFamily: fuente.cuerpoFuerte,
                          fontSize: t(tipo.menor),
                          color: esCambio ? colores.exito : colores.peligro,
                        }}
                      >
                        {ETIQUETA_TIPO_MOVIMIENTO[m.tipo]}
                      </Text>
                      {'  '}
                      {detalleMovimiento(m)}
                    </Text>
                    {m.comentario ? <Text style={estilos.textoSuave}>{m.comentario}</Text> : null}
                    {p.estado === 'listo' ? null : <Pastilla texto={p.texto} estado={p.estado} />}
                    {p.detalle ? <Text style={estilos.error}>{p.detalle}</Text> : null}
                  </View>
                  <Cifra valor={textoPzas(piezasDelMovimiento(m))} />
                </View>
              );
            })
          )}
        </ScrollView>

        <View
          style={{
            flexDirection: 'row',
            gap: espacio.sm,
            paddingHorizontal: espacio.md,
            paddingTop: espacio.sm,
            paddingBottom: espacio.sm + insets.bottom,
            backgroundColor: colores.superficie,
            borderTopWidth: grosor.fuerte,
            borderTopColor: colores.bordeFuerte,
          }}
        >
          {FILTROS_MOVIMIENTOS.map((f) => (
            <Chip
              key={f.clave}
              etiqueta={f.etiqueta}
              elegida={filtro === f.clave}
              onPress={() => setFiltro(f.clave)}
              ancho
            />
          ))}
        </View>
      </View>
    </MarcoMenu>
  );
}
