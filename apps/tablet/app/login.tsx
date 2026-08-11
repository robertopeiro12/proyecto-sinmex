import { Redirect, router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { relojSistema } from '@/datos/reloj';
import { useSesion } from '@/estado/proveedor-sesion';
import type { MotivoFalloEntrada } from '@/sesion/gestor';
import { colores, espacio, estilos } from '@/ui/tema';

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
      setError('No se pudo iniciar sesion. Intenta de nuevo.');
    } finally {
      setOcupado(false);
      setPassword('');
    }
  }

  return (
    <ScrollView style={estilos.pantalla} contentContainerStyle={{ maxWidth: 560 }}>
      <Text style={estilos.titulo}>JAWA · Entrar</Text>
      <Text style={estilos.subtitulo}>
        {guardado
          ? `Sesion guardada de ${guardado.vendedor.nombre}. Puedes entrar sin conexion.`
          : 'Escribe tu usuario y contrasena. La primera vez hace falta conexion.'}
      </Text>

      <Text style={estilos.etiqueta}>Usuario</Text>
      <TextInput
        style={estilos.campo}
        value={login}
        onChangeText={setLogin}
        autoCapitalize="none"
        autoCorrect={false}
        editable={!ocupado}
        placeholder="Tu usuario"
        placeholderTextColor={colores.textoSuave}
      />

      <View style={{ marginTop: espacio.md }}>
        <Text style={estilos.etiqueta}>Contrasena</Text>
        <TextInput
          style={estilos.campo}
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
      </View>

      {error ? <Text style={estilos.error}>{error}</Text> : null}

      <Pressable
        onPress={() => void intentar()}
        disabled={!puedeEntrar}
        style={[estilos.boton, { marginTop: espacio.lg }, !puedeEntrar && estilos.botonDeshabilitado]}
      >
        {ocupado ? (
          <ActivityIndicator color={colores.primarioTexto} />
        ) : (
          <Text style={estilos.botonTexto}>Entrar</Text>
        )}
      </Pressable>

      {ocupado ? (
        // El PBKDF2 del verificador local bloquea el hilo de JS unos segundos.
        // Sin este aviso, la tablet parece colgada y el vendedor vuelve a
        // apretar. Ver COSTE_PBKDF2 en `src/seguridad/verificador.ts`.
        <Text style={estilos.textoSuave}>Comprobando… esto puede tardar unos segundos.</Text>
      ) : null}

      {guardado ? (
        <View style={[estilos.tarjeta, { marginTop: espacio.lg }]}>
          <Text style={estilos.etiqueta}>Sin conexion</Text>
          <Text style={estilos.textoSuave}>
            Tu sesion sirve sin red durante {horasRestantes(guardado.validaHasta)} h mas. Despues
            tendras que conectarte al WiFi del negocio para volver a entrar.
          </Text>
        </View>
      ) : null}
    </ScrollView>
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
        ? 'Usuario o contrasena incorrectos.'
        : `Contrasena incorrecta. Te quedan ${intentosRestantes} intento(s) sin conexion.`;
    case 'otro-vendedor':
      return 'Esta tablet tiene la sesion de otro vendedor. Para cambiar de vendedor hace falta conexion al WiFi del negocio.';
    case 'sin-credenciales':
      return 'No hay sesion guardada en esta tablet. Conectate al WiFi del negocio para entrar por primera vez.';
    case 'sesion-vencida':
      return 'Tu sesion caduco. Conectate al WiFi del negocio para volver a entrar.';
    case 'ventana-vencida':
      return 'Esta tablet lleva demasiado tiempo sin conectarse. Conectate al WiFi del negocio para seguir trabajando.';
    case 'intentos-agotados':
      return 'Demasiados intentos fallidos. Por seguridad se borro la sesion guardada: hace falta conexion para entrar.';
    case 'reloj-inconsistente':
      return 'La fecha de la tablet no cuadra. Revisala en Ajustes o conectate al WiFi del negocio.';
  }
}
