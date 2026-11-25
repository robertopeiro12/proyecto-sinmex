package mx.jawa.impresorabluetooth

import android.Manifest
import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothSocket
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.util.Base64
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.IOException
import java.util.Timer
import java.util.UUID
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.concurrent.schedule

/** Serial Port Profile: el perfil que hablan las térmicas portátiles (PT-210, MTP-II). */
private val UUID_SPP: UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB")
private const val LIMITE_CONEXION_MS = 10_000L

/**
 * Cerrar el socket justo después de `flush()` puede tirar lo que la pila
 * Bluetooth aún no mandó y el ticket sale cortado. Se espera un poco antes de
 * cerrar: una base más ~1 ms por cada 10 bytes, con tope.
 */
private fun esperaAntesDeCerrarMs(bytes: Int) = minOf(200L + bytes / 10, 2_000L)

private fun error(code: String, mensaje: String, causa: Throwable? = null) =
  CodedException(code, mensaje, causa)

/**
 * Lista impresoras Bluetooth emparejadas y les manda bytes ESC/POS crudos por
 * RFCOMM. Conectar y escribir bloquean (hasta 10 s si la impresora está
 * apagada), así que corren en `Dispatchers.IO`: una `AsyncFunction` simple
 * ocuparía la cola única que comparten todos los módulos de Expo (expo-sqlite,
 * secure-store…) y los congelaría mientras tanto. Los errores llevan `code`
 * estable para que el JS decida qué mostrar.
 */
class ImpresoraBluetoothModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ImpresoraBluetooth")

    AsyncFunction("emparejadas") Coroutine { -> withContext(Dispatchers.IO) { emparejadas() } }

    AsyncFunction("imprimir") Coroutine { direccion: String, bytesBase64: String ->
      withContext(Dispatchers.IO) { imprimir(direccion, bytesBase64) }
    }
  }

  private fun emparejadas(): List<Map<String, String>> {
    val adaptador = adaptadorListo()
    return try {
      adaptador.bondedDevices.orEmpty().map { dispositivo ->
        mapOf(
          "nombre" to (dispositivo.name ?: dispositivo.address),
          "direccion" to dispositivo.address,
        )
      }
    } catch (e: SecurityException) {
      throw error("sin-permiso", "Falta el permiso de Bluetooth", e)
    }
  }

  private fun imprimir(direccion: String, bytesBase64: String) {
    val adaptador = adaptadorListo()
    val bytes = try {
      Base64.decode(bytesBase64, Base64.DEFAULT)
    } catch (e: IllegalArgumentException) {
      throw error("fallo-envio", "Los bytes del ticket no son base64 válido", e)
    }
    try {
      imprimirEn(adaptador, direccion, bytes)
    } catch (e: SecurityException) {
      throw error("sin-permiso", "Falta el permiso de Bluetooth", e)
    }
  }

  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  /** Adaptador presente, encendido y con permiso; si no, el error con su código. */
  private fun adaptadorListo(): BluetoothAdapter {
    val manager = context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
    val adaptador = manager?.adapter
      ?: throw error("sin-bluetooth", "Este dispositivo no tiene Bluetooth")
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S &&
      context.checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) !=
      PackageManager.PERMISSION_GRANTED
    ) {
      throw error("sin-permiso", "Falta el permiso BLUETOOTH_CONNECT")
    }
    if (!adaptador.isEnabled) {
      throw error("bluetooth-apagado", "El Bluetooth está apagado")
    }
    return adaptador
  }

  @SuppressLint("MissingPermission") // revisado en adaptadorListo(); SecurityException se mapea
  private fun imprimirEn(adaptador: BluetoothAdapter, direccion: String, bytes: ByteArray) {
    val socket: BluetoothSocket = try {
      adaptador.getRemoteDevice(direccion).createRfcommSocketToServiceRecord(UUID_SPP)
    } catch (e: IllegalArgumentException) {
      throw error("no-conecta", "Dirección de impresora inválida: $direccion", e)
    } catch (e: IOException) {
      throw error("no-conecta", "No se pudo abrir el canal con la impresora", e)
    }

    try {
      // El descubrimiento en curso hace la conexión RFCOMM lenta o fallida. En
      // API 31+ cancelarlo pide BLUETOOTH_SCAN, que la app no declara (nunca
      // inicia un descubrimiento): es de mejor esfuerzo.
      try { adaptador.cancelDiscovery() } catch (_: SecurityException) {}

      // `connect()` no tiene límite propio: si pasan 10 s, se cierra el socket
      // desde otro hilo y `connect()` sale con IOException.
      val vigilante = Timer("impresora-bt-limite", true)
      val agotado = AtomicBoolean(false)
      vigilante.schedule(LIMITE_CONEXION_MS) {
        agotado.set(true)
        try { socket.close() } catch (_: IOException) {}
      }
      try {
        socket.connect()
      } catch (e: IOException) {
        val mensaje = if (agotado.get()) "La impresora no respondió en 10 s" else "No se pudo conectar con la impresora"
        throw error("no-conecta", mensaje, e)
      } finally {
        vigilante.cancel()
      }
      // El limite pudo vencer justo cuando `connect()` volvia bien: el socket ya
      // quedo cerrado y escribir daria un `fallo-envio` engañoso.
      if (agotado.get()) throw error("no-conecta", "La impresora no respondió en 10 s")

      try {
        socket.outputStream.apply {
          write(bytes)
          flush()
        }
        Thread.sleep(esperaAntesDeCerrarMs(bytes.size))
      } catch (e: IOException) {
        throw error("fallo-envio", "Se perdió la conexión al mandar el ticket", e)
      }
    } finally {
      try { socket.close() } catch (_: IOException) {}
    }
  }
}
