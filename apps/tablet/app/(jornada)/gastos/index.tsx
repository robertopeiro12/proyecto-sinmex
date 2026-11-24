import { useMemo, useRef, useState } from 'react';
import { Text, View } from 'react-native';

import { ErrorGasto, ErrorJornada } from '@/datos';
import type { CampoEgreso } from '@/datos/tipos';
import {
  camposParaGasto,
  faltantesVisiblesGasto,
  pastillaGasto,
  puedeGuardarGasto,
  validarGasto,
} from '@/estado/gasto';
import { estadoMenuJornada } from '@/estado/menu-jornada';
import { useJawa } from '@/estado/proveedor-jawa';
import { useSesion } from '@/estado/proveedor-sesion';
import { Boton } from '@/ui/boton';
import { Campo } from '@/ui/campo';
import { Cifra, pesos } from '@/ui/cifra';
import { formatearHora } from '@/ui/momento';
import { MarcoMenu } from '@/ui/marco-menu';
import { Opcion } from '@/ui/opcion';
import { Pantalla, Pastilla, Tarjeta } from '@/ui/pantalla';
import { useTema } from '@/ui/tema';
import { espacio } from '@/ui/tokens';

/**
 * Gastos (T-30/T-31, D9; maqueta 19): una sola pantalla. Arriba el formulario
 * (Motivo + Cantidad + "Guardar gasto"); abajo "Gastos de hoy" con su subida y el
 * total, que suma TODOS (el efectivo ya salio aunque el servidor no lo tenga).
 * Sin observaciones, metodo ni foto: la pantalla manda `comentario: ''` y
 * `fotoUri: null`. Un gasto grabado no se edita ni se borra aqui.
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

  // Se relee UNA vez por cambio: `gastos.registrar` mueve `versionCatalogos`
  // (`publicarCambio`) y la subida cambia la pastilla con `ultimaSincronizacion`.
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

  const [campoId, setCampoId] = useState<string | null>(null);
  const [monto, setMonto] = useState('');
  const [error, setError] = useState<string | null>(null);
  // Guardia contra doble toque (leccion de T-39): `registrar()` genera un id
  // nuevo cada vez. El ref corta en el mismo tick; el estado deshabilita el boton.
  const guardando = useRef(false);
  const [guardado, setGuardado] = useState(false);

  // El motivo elegido se lee por id, activo o no: si el pull lo da de baja con la
  // pantalla abierta, el gasto se guarda igual (D5).
  const campo = useMemo(() => {
    void versionCatalogos;
    return campoId === null
      ? null
      : datos.catalogos.obtenerCampoEgreso(campoId);
  }, [datos, campoId, versionCatalogos]);

  const entrada = {
    campo,
    monto,
    comentario: '',
    fotoUri: null,
    diaCerrado: !menu.operacionesHabilitadas,
  };
  const validacion = validarGasto(entrada);
  // Lo que falta, bajo el boton, en cuanto empieza a capturar (revision final
  // de la pieza 1). El dia cerrado ya lo dice `avisoDiaCerrado`.
  const faltantes = menu.operacionesHabilitadas
    ? faltantesVisiblesGasto(entrada, validacion)
    : [];

  function guardar() {
    setError(null);
    if (!vendedor) {
      setError('No hay vendedor con sesión iniciada.');
      return;
    }
    if (validacion.gasto === null) return;
    if (guardando.current) return;
    guardando.current = true;
    setGuardado(true);
    try {
      datos.gastos.registrar({ vendedorId: vendedor.id, ...validacion.gasto });
      // La lista de abajo se relee sola: `registrar` mueve `versionCatalogos`.
      setCampoId(null);
      setMonto('');
      // La guardia se queda puesta: un segundo toque en cola ve el formulario
      // viejo y grabaria otro gasto. Se suelta al elegir motivo o escribir cantidad.
    } catch (e) {
      // Solo el error suelta la guardia: el gasto no se grabo y se puede reintentar.
      guardando.current = false;
      setGuardado(false);
      setError(
        e instanceof ErrorGasto || e instanceof ErrorJornada
          ? e.message
          : 'No se pudo guardar el gasto.',
      );
    }
  }

  function soltarGuardia() {
    guardando.current = false;
    setGuardado(false);
  }

  return (
    <MarcoMenu clave="gastos" titulo="Gastos">
      <Pantalla subtitulo="Lo que pagaste hoy con la cobranza del día">
        {sinCatalogo ? (
          // Sin campos con "Se usa en la app" (nunca ha sincronizado, o la oficina
          // no marco ninguno): lo dice y no deja registrar.
          <Tarjeta estado="pendiente" etiqueta="Sin catálogo de gastos">
            <Text style={estilos.textoTarjeta}>
              Los campos de gasto bajan del portal con la sincronización.
              Sincroniza para poder registrar un gasto.
            </Text>
          </Tarjeta>
        ) : (
          <>
            <Text style={estilos.etiqueta}>Motivo</Text>
            {campos.map((c) => (
              <Opcion
                key={c.id}
                etiqueta={c.nombre}
                seleccionada={c.id === campoId}
                onPress={() => {
                  soltarGuardia();
                  setCampoId(c.id);
                }}
              />
            ))}

            <Campo
              etiqueta="Cantidad"
              value={monto}
              onChangeText={(t) => {
                soltarGuardia();
                setMonto(t);
              }}
              placeholder="0.00"
              keyboardType="decimal-pad"
              invalido={
                monto.trim() !== '' && validacion.montoCentavos === null
              }
            />
          </>
        )}

        {menu.avisoDiaCerrado ? (
          <Text style={estilos.error}>{menu.avisoDiaCerrado}</Text>
        ) : null}
        {error ? <Text style={estilos.error}>{error}</Text> : null}

        <Boton
          etiqueta="Guardar gasto"
          icono="palomita"
          deshabilitado={
            !puedeGuardarGasto({
              gastoValido: validacion.gasto !== null,
              hayCampos: campos.length > 0,
              diaAbierto: menu.operacionesHabilitadas,
              guardado,
            })
          }
          onPress={guardar}
          estilo={{ marginTop: espacio.md }}
        />
        {faltantes.map((f) => (
          <Text key={f} style={estilos.textoSuave}>
            {f}
          </Text>
        ))}

        <Text style={estilos.seccion}>Gastos de hoy</Text>
        <Tarjeta etiqueta="Gastos de hoy">
          {hoy.gastos.length === 0 ? (
            <Text style={estilos.textoSuave}>
              Todavía no registras gastos hoy.
            </Text>
          ) : (
            hoy.gastos.map((g) => {
              const p = pastillaGasto(g);
              return (
                <View
                  key={g.id}
                  style={{ gap: espacio.xs, marginBottom: espacio.sm }}
                >
                  <Text style={estilos.textoTarjeta}>
                    {g.campo_nombre} · <Cifra valor={pesos(g.monto_centavos)} />{' '}
                    · <Cifra valor={formatearHora(g.registrado_en)} />
                  </Text>
                  <Pastilla texto={p.texto} estado={p.estado} />
                  {p.detalle ? (
                    <Text style={estilos.error}>{p.detalle}</Text>
                  ) : null}
                </View>
              );
            })
          )}
        </Tarjeta>

        <Tarjeta
          estado={hoy.total > 0 ? 'accion' : 'neutro'}
          etiqueta="Total del día"
        >
          <Cifra valor={pesos(hoy.total)} tamano="destacado" />
        </Tarjeta>
      </Pantalla>
    </MarcoMenu>
  );
}
