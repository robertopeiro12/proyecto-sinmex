import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  destinoRenglon,
  FILTROS_REGISTRO,
  MENSAJE_REGISTRO_VACIO,
  textoResumenRegistro,
} from '@/estado/detalle-registro';
import { useJawa } from '@/estado/proveedor-jawa';
import { useSesion } from '@/estado/proveedor-sesion';
import { armarRegistro, type FiltroRegistro, type RenglonRegistro } from '@/estado/registros';
import { Chip } from '@/ui/chip';
import { Cifra, pesos } from '@/ui/cifra';
import { Icono } from '@/ui/icono';
import { MarcoMenu } from '@/ui/marco-menu';
import { Pastilla } from '@/ui/pantalla';
import { useTema } from '@/ui/tema';
import { colores, espacio, fuente, grosor, radio, tipo } from '@/ui/tokens';

const TEXTO_SUBIDA = { error: 'con error', pendiente: 'por subir' } as const;

/**
 * Ventas / Cobranza (rediseño pieza 5, maqueta 17; spec §11 y §16-bis): lo
 * hecho hoy en esta tablet, lo mas nuevo arriba (hora, cliente, tipo y monto,
 * con su subida); arriba "Hoy · N movimientos" con la suma de lo que el filtro
 * muestra; abajo los filtros Todo / Ventas del día / Cobranza / Notas
 * pendientes. Tocar un renglon abre su detalle (solo lectura); una nota
 * pendiente abre su venta si se vendio aqui, si no la hoja del cliente.
 */
export default function Registros() {
  const { datos, vendedor, versionCatalogos } = useJawa();
  const { ultimaSincronizacion } = useSesion();
  const { estilos } = useTema();
  const insets = useSafeAreaInsets();
  const [filtro, setFiltro] = useState<FiltroRegistro>('todo');

  // Se relee una vez por cambio (como Merma / Cambios): grabar una venta o un
  // cobro mueve `versionCatalogos`; la subida cambia la pastilla con
  // `ultimaSincronizacion`.
  const entrada = useMemo(() => {
    void versionCatalogos;
    void ultimaSincronizacion;
    const nombres = new Map<string, string>();
    const nombreCliente = (id: string) => {
      let n = nombres.get(id);
      if (n === undefined) {
        n = datos.catalogos.obtenerCliente(id)?.nombre ?? 'Cliente';
        nombres.set(id, n);
      }
      return n;
    };
    return {
      ventas: vendedor ? datos.ventas.delDiaDelVendedor(vendedor.id) : [],
      cobros: vendedor ? datos.cobranzas.delDiaDelVendedor(vendedor.id) : [],
      notas: vendedor ? datos.notasAsignadas.queTraeDelVendedor(vendedor.id) : [],
      nombreCliente,
      folioDeNota: (id: string) => datos.catalogos.folioDeNota(id),
    };
  }, [datos, vendedor, versionCatalogos, ultimaSincronizacion]);

  const { renglones, total } = armarRegistro(entrada, filtro);

  const abrir = (r: RenglonRegistro) => {
    const destino = destinoRenglon(r, (id) => datos.ventas.porId(id) !== null);
    if (destino.tipo === 'cliente') {
      router.push({ pathname: '/(jornada)/operacion/[clienteId]', params: { clienteId: destino.clienteId } });
      return;
    }
    router.push({ pathname: '/(jornada)/registros/[tipo]/[id]', params: { tipo: destino.detalle, id: destino.id } });
  };

  return (
    <MarcoMenu clave="registros" titulo="Ventas / Cobranza">
      <View style={{ flex: 1, backgroundColor: colores.papel }}>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={[estilos.contenido, { paddingBottom: espacio.lg }]}>
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
            <Text style={estilos.textoTarjeta}>{textoResumenRegistro(filtro, renglones.length)}</Text>
            <Cifra valor={pesos(total)} tamano="destacado" />
          </View>

          {renglones.length === 0 ? (
            <Text style={estilos.textoSuave}>{MENSAJE_REGISTRO_VACIO}</Text>
          ) : (
            renglones.map((r) => <Renglon key={r.clave} renglon={r} onTocar={() => abrir(r)} />)
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
          {FILTROS_REGISTRO.map((f) => (
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

/** Un renglon de la maqueta 17: hora, cliente, tipo y texto, monto y la flecha. */
function Renglon({ renglon: r, onTocar }: { renglon: RenglonRegistro; onTocar: () => void }) {
  const { estilos, t } = useTema();
  const [tipoTexto, ...resto] = r.texto.split(' ');
  const colorTipo = r.tipo === 'cobro' ? colores.exito : colores.primario;
  const subida = r.estado === 'error' || r.estado === 'pendiente' ? r.estado : null;
  return (
    <Pressable
      onPress={onTocar}
      accessibilityRole="button"
      accessibilityLabel={`${r.hora ?? ''} ${r.cliente}, ${r.texto}, ${pesos(r.montoCentavos)}${subida ? `, ${TEXTO_SUBIDA[subida]}` : ''}`}
      style={({ pressed }) => [
        {
          flexDirection: 'row',
          alignItems: 'center',
          gap: espacio.md,
          paddingVertical: espacio.sm,
          borderBottomWidth: grosor.hairline,
          borderBottomColor: colores.borde,
        },
        pressed && { opacity: 0.6 },
      ]}
    >
      {r.hora !== null ? <Cifra valor={r.hora} tono="suave" /> : null}
      <View style={{ flex: 1, gap: espacio.xs }}>
        <Text style={estilos.textoTarjeta} numberOfLines={1}>
          {r.cliente}
        </Text>
        <Text style={estilos.textoSuave}>
          <Text style={{ fontFamily: fuente.cuerpoFuerte, fontSize: t(tipo.menor), color: colorTipo }}>{tipoTexto}</Text>
          {resto.length > 0 ? ` ${resto.join(' ')}` : ''}
        </Text>
        {subida ? <Pastilla texto={TEXTO_SUBIDA[subida]} estado={subida} /> : null}
      </View>
      <Cifra valor={pesos(r.montoCentavos)} />
      <Icono nombre="adelante" tamano={16} color={colores.tintaSuave} />
    </Pressable>
  );
}
