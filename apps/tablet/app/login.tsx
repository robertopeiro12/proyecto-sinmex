import { Redirect, router } from 'expo-router';
import { useState } from 'react';
import { Text } from 'react-native';

import { relojSistema } from '@/datos/reloj';
import { useSesion } from '@/estado/proveedor-sesion';
import type { MotivoFalloEntrada } from '@/sesion/gestor';
import { Boton } from '@/ui/boton';
import { Campo } from '@/ui/campo';
import { Cifra } from '@/ui/cifra';
import { Pantalla, Tarjeta } from '@/ui/pantalla';
import { useTema } from '@/ui/tema';
import { espacio } from '@/ui/tokens';

/**
 * Login del [[Vendedor]].
 *
 * > [!important] Una sola pantalla, haya red o no
 * > El vendedor teclea siempre lo mismo. Quien decide si esto va contra el
 * > servidor o contra el verificador guardado es el gestor de sesion, no el
 * > vendedor: en ruta no tiene forma de saber si la tablet tiene senal, y
 * > obligarlo a elegir "modo sin conexion" en un menu es como se pierden
 * > jornadas. Ver `src/sesion/gestor.ts`.
 *
 * La pantalla si le **dice** en cual de los dos modos esta, porque cambia lo
 * que puede esperar: sin red no podra cambiar de vendedor ni recuperar una
 * sesion vencida.
 */
export default function Login() {
  const { vendedor, material, entrar } = useSesion();
  const { estilos } = useTema();

  const guardado = material.tipo === 'reautenticacion-local' ? material : null;
  const [login, setLogin] = useState(guardado?.vendedor.login ?? '');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  // Ya entro: no tiene nada que hacer aqui.
  if (vendedor) return <Redirect href="/" />;

  const puedeEntrar = login.trim() !== '' && password !== '' && !ocupado;

  async function intentar() {
    setError(null);
    setOcupado(true);
    try {
      const resultado = await entrar(login.trim(), password);
      if (resultado.ok) {
        setPassword('');
        router.replace('/');
        return;
      }
      setError(mensajeDeFallo(resultado.motivo, resultado.intentosRestantes));
    } catch {
      // Cualquier cosa inesperada: no se traga en silencio, pero tampoco tumba
      // la app en manos del vendedor.
      setError('No se pudo iniciar sesión. Intenta de nuevo.');
    } finally {
      setOcupado(false);
      setPassword('');
    }
  }

  return (
    <Pantalla
      formulario
      titulo="JAWA · Entrar"
      subtitulo={
        guardado
          ? `Sesión guardada de ${guardado.vendedor.nombre}. Puedes entrar sin conexión.`
          : 'Escribe tu usuario y contraseña. La primera vez hace falta conexión.'
      }
    >
      <Campo
        etiqueta="Usuario"
        value={login}
        onChangeText={setLogin}
        autoCapitalize="none"
        autoCorrect={false}
        editable={!ocupado}
        placeholder="Tu usuario"
      />

      <Campo
        etiqueta="Contraseña"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        editable={!ocupado}
        onSubmitEditing={() => {
          if (puedeEntrar) void intentar();
        }}
      />

      {error ? <Text style={estilos.error}>{error}</Text> : null}

      {/*
        Unica accion primaria de la pantalla. `ocupado` ya bloquea el toque y
        pinta el indicador, asi que el doble toque durante el PBKDF2 no dispara
        dos intentos.
      */}
      <Boton
        etiqueta="Entrar"
        onPress={() => void intentar()}
        ocupado={ocupado}
        deshabilitado={!puedeEntrar}
        estilo={{ marginTop: espacio.lg }}
      />

      {ocupado ? (
        // El PBKDF2 del verificador local bloquea el hilo de JS unos segundos.
        // Sin este aviso, la tablet parece colgada y el vendedor vuelve a
        // apretar. Ver COSTE_PBKDF2 en `src/seguridad/verificador.ts`.
        <Text style={estilos.textoSuave}>Comprobando… esto puede tardar unos segundos.</Text>
      ) : null}

      {guardado ? (
        <Tarjeta estado="pendiente" etiqueta="Sin conexión">
          <Text style={estilos.textoSuave}>
            Tu sesión sirve sin red durante{' '}
            <Cifra valor={horasRestantes(guardado.validaHasta)} tono="aviso" /> h más. Después
            tendrás que conectarte al WiFi del negocio para volver a entrar.
          </Text>
        </Tarjeta>
      ) : null}
    </Pantalla>
  );
}

/**
 * Horas enteras que le quedan a la sesion offline.
 *
 * `validaHasta` ya viene resuelto por `evaluarSesion()` como el mas estricto de
 * los dos limites (vencimiento de la sesion y ventana sin contacto), asi que
 * aqui solo hay una resta.
 */
function horasRestantes(validaHasta: string): number {
  const restante = Date.parse(validaHasta) - Date.parse(relojSistema.ahora());
  return Math.max(0, Math.floor(restante / (60 * 60 * 1000)));
}

function mensajeDeFallo(motivo: MotivoFalloEntrada, intentosRestantes?: number): string {
  switch (motivo) {
    case 'credenciales':
      return intentosRestantes === undefined
        ? 'Usuario o contraseña incorrectos.'
        : `Contraseña incorrecta. Te quedan ${intentosRestantes} intento(s) sin conexión.`;
    case 'otro-vendedor':
      return 'Esta tablet tiene la sesión de otro vendedor. Para cambiar de vendedor hace falta conexión al WiFi del negocio.';
    case 'sin-credenciales':
      return 'No hay sesión guardada en esta tablet. Conéctate al WiFi del negocio para entrar por primera vez.';
    case 'sesion-vencida':
      return 'Tu sesión caducó. Conéctate al WiFi del negocio para volver a entrar.';
    case 'ventana-vencida':
      return 'Esta tablet lleva demasiado tiempo sin conectarse. Conéctate al WiFi del negocio para seguir trabajando.';
    case 'intentos-agotados':
      return 'Demasiados intentos fallidos. Por seguridad se borró la sesión guardada: hace falta conexión para entrar.';
    case 'reloj-inconsistente':
      return 'La fecha de la tablet no cuadra. Revísala en Ajustes o conéctate al WiFi del negocio.';
  }
}
