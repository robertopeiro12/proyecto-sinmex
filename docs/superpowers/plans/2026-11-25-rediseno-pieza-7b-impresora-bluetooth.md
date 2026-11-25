# Rediseño app del vendedor — Pieza 7b: Impresora térmica por Bluetooth — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** La app imprime directo, sin diálogo, en la impresora térmica portátil de 58 mm por Bluetooth que eligió Mario (tipo PT-210 / MTP-II, ESC/POS), emparejada desde "Seleccionar impresora".

**Architecture:** Un codificador ESC/POS puro convierte los renglones de `armarTicket` (pieza 7) en bytes. Un módulo nativo local de Expo (`apps/tablet/modules/impresora-bluetooth`, Kotlin) lista las impresoras emparejadas y manda los bytes por RFCOMM (SPP). Un controlador nuevo `crearControladorBluetooth` implementa la misma interfaz `ControladorImpresion`; `useImpresion` lo usa cuando hay impresora elegida. El controlador de `expo-print` (diálogo de Android) se queda como opción "Diálogo de Android" para el emulador y otras impresoras.

**Tech Stack:** Expo SDK 57 (Expo Modules API, módulo local en `modules/`), Kotlin, Android Bluetooth clásico.

**Spec:** `docs/superpowers/specs/2026-11-18-rediseno-app-vendedor-design.md` §12 (impresión). Decisión de Mario (2026-11-25): impresora "Impresora Térmica Tickets 58mm Portátil Bluetooth", conexión directa por Bluetooth.

## Global Constraints

- Rama `feature/rediseno-pieza-1-cascara` (PR #171 abierto); sin PR nuevo. Nunca tocar `JAWA ANDROID/proyecto-sinmex`.
- Sin cambios al servidor, al contrato ni a la base local.
- Papel 58 mm = 32 columnas, 80 mm = 48 (ya en `html.ts`/`COLUMNAS`).
- Imprimir nunca deshace ni bloquea lo grabado (regla de la pieza 7; el aviso "No se pudo imprimir. Puedes reimprimir desde Ventas / Cobranza." sigue igual).
- Iconos SVG; textos en español de México.
- Sin dependencias nuevas de npm para Bluetooth: el módulo nativo es propio.

## Review Focus

1. Bluetooth apagado, permiso negado o impresora apagada: resultado `fallo` con un detalle legible ("Prende el Bluetooth", "Da permiso de Bluetooth", "No se pudo conectar con <nombre>"), nunca un cuelgue. → Task 2 y 3.
2. Impresora que tarda o no responde: la conexión tiene límite de tiempo (10 s) y el socket se cierra siempre. → Task 2.
3. Acentos y ñ: salen bien con la página de códigos CP850; lo que no exista en CP850 se translitera, nunca bytes basura. → Task 1.
4. Varios tickets de un cobro: un solo envío, separados por avance de papel, en orden. → Task 1 y 3.
5. Impresora elegida que ya no está emparejada: la pantalla lo dice y pide elegir otra. → Task 3.

---

### Task 1: Codificador ESC/POS puro

**Files:**
- Create: `apps/tablet/src/impresion/escpos.ts` (+ `escpos.spec.ts`)

**Interfaces:**
- Produces: `ticketsAEscPos(tickets: string[][]): Uint8Array` y `aCp850(texto: string): number[]`.

Bytes: `ESC @` (1B 40) al inicio; `ESC t 2` (1B 74 02, CP850); cada renglón codificado + `LF` (0A); entre tickets y al final, 4 `LF` de avance (la PT-210 no corta). Tabla CP850 para á é í ó ú Á É Í Ó Ú ñ Ñ ü Ü ¿ ¡ · ° ; ASCII imprimible tal cual; cualquier otro carácter se translitera sin acento (NFD sin marcas) y, si aun así no es ASCII, `?`.

- [ ] **Step 1: Failing tests** — `aCp850('Té')` = `[0x54, 0x82]`; `aCp850('Año')` = `[0x41, 0xA4, 0x6F]`; `aCp850('·')` = `[0xFA]`; un carácter fuera de tabla (`'€'`) → `?`; `ticketsAEscPos([['A'],['B']])` empieza con `1B 40 1B 74 02`, contiene `41 0A`, 4 `0A` entre tickets y termina en 4 `0A`; un ticket real de `armarTicket` a 32 columnas produce renglones de 32 bytes o menos.
- [ ] **Step 2–4:** implement; suite, typecheck, lint → PASS.
- [ ] **Step 5: Commit** — `Rediseño pieza 7b: codificador ESC/POS del ticket`

---

### Task 2: Módulo nativo `impresora-bluetooth`

**Files:**
- Create: `apps/tablet/modules/impresora-bluetooth/` (módulo local de Expo: `expo-module.config.json`, `android/build.gradle`, `android/src/main/java/.../ImpresoraBluetoothModule.kt`, `index.ts`, `src/ImpresoraBluetooth.types.ts`)
- Modify: `apps/tablet/app.json` (`android.permissions`: `BLUETOOTH_CONNECT`, y `BLUETOOTH` / `BLUETOOTH_ADMIN` para Android ≤ 11)

**Interfaces:**
- Produces (JS): `emparejadas(): Promise<{ nombre: string; direccion: string }[]>`; `imprimir(direccion: string, bytesBase64: string): Promise<void>`; `disponible(): boolean` (false si el módulo nativo no está, p. ej. APK viejo o iOS). Errores con `code`: `'sin-bluetooth' | 'bluetooth-apagado' | 'sin-permiso' | 'no-conecta' | 'fallo-envio'`.

Kotlin: `BluetoothManager.adapter`; `bondedDevices`; conexión `createRfcommSocketToServiceRecord(UUID 00001101-0000-1000-8000-00805F9B34FB)`, `cancelDiscovery()` antes de conectar, límite de 10 s, `outputStream.write` + `flush`, cierre en `finally`; todo en un hilo de fondo (`AsyncFunction` del Expo Modules API). El JS pide `PermissionsAndroid.BLUETOOTH_CONNECT` (API 31+) antes de llamar.

- [ ] **Step 1:** módulo + `index.ts` con `requireOptionalNativeModule` (así `disponible()` es false sin el nativo); `npx expo prebuild -p android --clean` y `./gradlew assembleDebug` compilan (git status limpio después).
- [ ] **Step 2:** typecheck, lint, suite → PASS.
- [ ] **Step 3: Commit** — `Rediseño pieza 7b: módulo nativo de impresora Bluetooth`

---

### Task 3: Controlador, preferencia y "Seleccionar impresora"

**Files:**
- Modify: `apps/tablet/src/impresion/controlador.ts` (`crearControladorBluetooth(direccion, nombre)`; el de expo-print queda), `preferencia.ts` / `preferencia-expo.ts` (+ spec: impresora elegida `{ tipo: 'bluetooth'; nombre; direccion } | { tipo: 'dialogo' } | null`, lectura dañada → null), `usar-impresion.ts`
- Modify: `apps/tablet/app/(jornada)/impresora.tsx`

Reglas: sin impresora elegida, imprimir devuelve `fallo` con detalle "Elige la impresora en Seleccionar impresora." (el aviso general de la pieza 7 se mantiene). Los errores del módulo se traducen a textos ("Prende el Bluetooth.", "Da permiso de Bluetooth a la app.", "No se pudo conectar con <nombre>. ¿Está prendida?"). `imprimirVarios` manda un solo envío con `ticketsAEscPos`.

Pantalla: lista de impresoras emparejadas (nombre y dirección) con la elegida marcada; opción "Diálogo de Android (otra impresora o PDF)"; papel 58/80; "Imprimir prueba" con el resultado; ayuda "Empareja la impresora en Ajustes > Bluetooth (PIN 0000 o 1234) y vuelve aquí."; botón "Actualizar lista"; si la elegida ya no está emparejada: "La impresora <nombre> ya no está emparejada. Elige otra."; si `disponible()` es false o no hay Bluetooth: "Este equipo no tiene Bluetooth disponible." y solo la opción del diálogo.

- [ ] **Step 1: Failing tests** — preferencia (las tres formas, dañada → null); traducción de códigos de error a textos (función pura).
- [ ] **Step 2–4:** implement; suite, typecheck, lint → PASS.
- [ ] **Step 5: Commit** — `Rediseño pieza 7b: imprimir directo por Bluetooth desde Seleccionar impresora`
- [ ] **Step 6 (controlador, emulador):** APK nuevo; el emulador no tiene Bluetooth: la pantalla dice "no tiene Bluetooth disponible", "Diálogo de Android" imprime la prueba y una venta. La prueba con la impresora física queda para Mario.

---

### Task 4: Cierre

- [ ] Suites; `CLAUDE.md` (bloque de impresión: Bluetooth directo, módulo local, permisos, prueba física pendiente), README de la tablet; descripción del PR #171; bóveda. Push de la rama.
