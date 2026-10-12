# App Tablet (JAWA)

App del vendedor/repartidor en ruta (React Native + Expo). Scaffold de **T-04**:
almacenamiento SQLite local con migraciones, capa de datos offline y la
navegacion base de la jornada con pantallas placeholder.

Orientada a **tablet Android en horizontal** (`"orientation": "landscape"`).

## Desarrollo

Desde la raiz del repo (no entres a esta carpeta a mano, usa los scripts del workspace):

```
npm run tablet                              # levanta el bundler de Expo
npm run lint      --workspace=apps/tablet
npm run typecheck --workspace=apps/tablet   # tsc --noEmit
npm test          --workspace=apps/tablet   # pruebas de la capa de datos
npm run export    --workspace=apps/tablet   # bundle de Metro (sin SDK de Android)
```

## Estructura

```
apps/tablet/
├── app/                       # rutas de expo-router (navegacion basada en archivos)
│   ├── _layout.tsx            # abre la BD, migra, lee la sesion, monta el Stack
│   ├── index.tsx              # login -> abrir-dia -> jornada (en ese orden)
│   ├── login.tsx              # login del vendedor (en linea o sin red)
│   ├── abrir-dia.tsx          # vehiculo + km inicial (BLOQUEANTE)
│   └── (jornada)/             # todo lo que exige sesion + jornada abierta
│       ├── _layout.tsx        # guardia de sesion + del kilometraje inicial
│       ├── index.tsx          # la ruta del dia (pantalla principal, T-37)
│       ├── agregar-a-ruta.tsx # clientes existentes que el vendedor suma a su ruta
│       ├── operacion/         # todos los clientes -> ficha -> venta / cobranza / visita
│       ├── pendiente/         # secciones del menu que aun no existen (gastos, inventario, merma)
│       ├── prospectos.tsx
│       ├── ruta.tsx           # Ruta y GPS (T-41)
│       └── cerrar-dia.tsx     # km final (el corte es T-33)
├── src/
│   ├── datos/                 # capa de datos local (SQLite)
│   ├── seguridad/             # SHA-256 / PBKDF2 / verificador local (T-06)
│   ├── sesion/                # politica offline, almacen cifrado y API de auth
│   ├── estado/                # contextos de React
│   └── ui/                    # tema y componentes del shell
└── metro.config.js            # resolucion de modulos dentro del monorepo
```

## Capa de datos local

Todo vive en `src/datos/`:

| Archivo | Que hace |
|---|---|
| `base-datos.ts` | Interfaz `BaseDatos`: subconjunto **sincrono** de la API de expo-sqlite |
| `driver-expo.ts` | Driver real de la tablet (`expo-sqlite`) |
| `driver-node.ts` | Driver de **pruebas** (`better-sqlite3`). No importar desde la app |
| `migraciones/motor.ts` | Motor de migraciones sobre `PRAGMA user_version` |
| `migraciones/001-*.ts` | Esquema inicial |
| `repositorios/` | Repositorios tipados (`catalogos`, `jornadas`) |
| `reloj.ts` | Reloj inyectable (la fecha decide el corte de la jornada) |

Nada de `src/datos/` importa React Native: habla contra `BaseDatos` y recibe sus
dependencias (`bd`, `reloj`, `generarId`) inyectadas. Por eso se puede probar en
Node sin dispositivo ni emulador. El porque esta en
`30-Decisiones/ADR-0004 Capa de datos local de la tablet` del vault.

### Agregar una migracion

1. Crea `src/datos/migraciones/NNN-descripcion.ts` con la version = indice + 1.
2. Agregalo **al final** del arreglo de `migraciones/index.ts`.
3. **Nunca edites una migracion ya publicada**: hay tablets en la calle con ese
   esquema aplicado.
4. **Para rehacer una tabla** (quitar un `not null`, cambiar un `check`: nada
   que `ALTER TABLE` sepa hacer solo) usa `sinLlavesForaneas`: crea la tabla
   nueva, copia las filas **por nombre de columna** (nunca `select *`),
   `drop table` de la vieja, `alter table ... rename to`, y recrea a mano los
   indices (no viajan con el `rename`). Declara
   `sinLlavesForaneas: { comprobar: ['hija1', 'hija2', ...] }` con las tablas
   hijas que le apuntan (`pragma foreign_key_list` te las da): el motor corre
   `pragma foreign_key_check` acotado a ellas antes del commit, no a toda la
   base, para que un huerfano en una tabla ajena no bloquee el arranque. Usa
   `true` solo si de verdad no se conocen las hijas. Detalle completo en el
   docstring de `Migracion.sinLlavesForaneas` en `motor.ts`.

### Convenciones del esquema local

- Nombres de tabla y columna iguales a `supabase/migrations/` (T-05), para que
  la sincronizacion de T-07 sea un mapeo 1:1.
  - Excepcion (T-16): la venta local se llama `venta` / `venta_linea` y no
    `venta_nota` / `venta_nota_detalle`; el sobre del push la traduce campo a
    campo (`src/sincronizacion/fuente-ventas.ts`).
- `id` es `text` (SQLite no tiene `uuid`).
- **El dinero se guarda en centavos** (`*_centavos integer`). SQLite solo tiene
  `real` para decimales y el corte de caja tiene que cuadrar contra efectivo.
- Fechas y horas como texto ISO-8601.
- Campos de sincronizacion: los catalogos llevan `sincronizado_en` (cuando
  bajaron); lo que se captura offline lleva `sync_estado` y
  `actualizado_local_en`.

## Sesion del vendedor (T-06)

El vendedor entra con **login y contrasena**, y su sesion **vale sin red durante
toda la jornada**. Todo lo que decide eso vive en dos carpetas, y ninguna importa
React Native — por eso se pueden probar enteras en Node:

| Archivo | Que hace |
|---|---|
| `src/seguridad/sha256.ts` | SHA-256 en TS puro (por que, en su cabecera) |
| `src/seguridad/pbkdf2.ts` | HMAC-SHA256 y PBKDF2, contrastados contra `node:crypto` |
| `src/seguridad/verificador.ts` | Deriva y comprueba el **verificador local** de la contrasena |
| `src/sesion/politica.ts` | Los tres limites de la sesion offline. **Manda el mas estricto** |
| `src/sesion/almacen.ts` | Interfaz del almacen cifrado (memoria en pruebas) |
| `src/sesion/almacen-secure-store.ts` | Implementacion real sobre `expo-secure-store` |
| `src/sesion/api.ts` | Cliente de `/auth/app/*` (tokens, nunca cookies) |
| `src/sesion/gestor.ts` | `entrar()`: intenta el servidor y cae a la sesion local |

Reglas que conviene tener presentes antes de tocar esto:

- **Nada de sesion en SQLite ni AsyncStorage.** Tokens y verificador van a
  `expo-secure-store` (Keystore de Android).
- **Con red manda el servidor.** `entrar()` prueba primero en linea; asi una baja
  o un cambio de contrasena surten efecto sin esperar a que caduque nada.
- **La contrasena se pide en cada arranque**, aunque haya sesion guardada.
- **Cerrar sesion borra el material local**: despues no hay entrada sin red.
- El **modelo de amenaza aceptado** esta en
  `30-Decisiones/ADR-0005 Sesion del vendedor valida offline` del vault. Leelo
  antes de relajar cualquiera de los limites.

Para que la app alcance el backend: `EXPO_PUBLIC_API_URL`. El default
(`http://localhost:3000`) **solo sirve en emulador**; en una tablet real hay que
apuntarlo a la IP del servidor en la red del negocio.

> [!warning] Trafico en claro en una compilacion de produccion
> Android 9+ **bloquea HTTP sin cifrar** en builds de release salvo que se
> habilite `usesCleartextTraffic`. Hoy el default de `EXPO_PUBLIC_API_URL` es
> `http://`, asi que un APK de produccion contra HTTP no conectaria. No se ha
> tocado a proposito: la salida correcta es **HTTPS**, y eso se decide junto con
> el hosting, que sigue pendiente en `ADR-0002`. Sin dispositivo tampoco se
> puede comprobar. Hay que resolverlo antes de entregar tablets.

> [!success] `minSdkVersion = 28` (Android 9) — decidido el 2026-09-18
> Los equipos son celulares **personales** del vendedor (de fabricantes
> distintos), no un modelo que la empresa compra y controla. Android 9 es el
> corte porque ahi el sistema **empieza a bloquear trafico sin cifrar por
> defecto** (ver el callout de arriba) y porque por debajo de Android 8 el
> Keystore —donde viven el token de sesion y el verificador del PIN, ver
> `src/sesion/almacen-secure-store.ts`— no cumple las suposiciones de
> `ADR-0010` sobre PIN de arranque. Sin este piso, un equipo con Android 7 u 8
> instala la app y queda fuera de todo lo que ese ADR decidio.
>
> Expo SDK 57 hereda un default de `minSdkVersion = 24` (Android 7.0) del
> plugin de Gradle `expo-root-project` (`expo-modules-autolinking`), que es
> menor que el piso decidido. `app.json` lo fija explicitamente con
> `expo-build-properties`. Ver `30-Decisiones/ADR-0010 Equipos personales del
> vendedor y PIN de arranque` en el vault.

Alta de credenciales: `npm run crear-vendedor --workspace=apps/backend` (el CRUD
de vendedores es **T-62**).

## Jornada: cerrar el día cierra las operaciones (T-38)

- **Cerrar el día no tiene vuelta atrás.** `cerrar-dia.tsx` pide confirmación; con la jornada de hoy `cerrada`,
  el menú deshabilita *Operación por cliente*, *Prospectos* y *Ruta y GPS* (`src/estado/menu-jornada.ts`) y
  `ventas`/`cobranzas`/`prospectos.registrar` lanzan `ErrorJornada` (`exigirJornadaAbierta` en
  `src/datos/repositorios/jornadas.ts`). El candado de datos es el que vale: las pantallas se pueden saltar.
- **El contador de "registros por subir" cuenta solo lo que viaja.** La jornada abierta no se sube (el buzón
  del servidor es de solo escritura hasta T-43), así que `jornadas.pendientesDeSincronizar()` solo devuelve
  cerradas.
- En el servidor la jornada cerrada se guarda en la tabla `jornada` (`rutas/jornadas.service.ts`). Si el
  servidor la rechaza (`vehiculo-inexistente`, `jornada-duplicada`, …), la fila queda en `error` con el motivo
  y se reintenta en cada sincronización.

## Ruta del día y pantalla principal (T-37)

- **La jornada abre en la ruta del día** (`app/(jornada)/index.tsx`): barra con *Prospecto*, *Refrescar* (es el
  "Sincronizar ahora" de siempre, con la pastilla de pendientes) y *Agregar a mi ruta*; menú hamburguesa en una
  hoja modal (`src/ui/menu-hoja.tsx`, sin cajón: la app no trae gesture-handler ni reanimated).
- **Dos tablas locales** (migración 011): `ruta` la escribe el pull con su regla de fusión
  (`aplicarSnapshotRutas` en `src/datos/repositorios/rutas.ts`) y `ruta_orden_local` solo el dedo del vendedor.
  Ningún pull toca el orden local, y el orden **no sube** al servidor.
- **Las altas del vendedor suben como `ruta-alta`** (`src/sincronizacion/fuente-rutas.ts`). `ruta-duplicada` no es
  error: la fila queda sincronizada y el pull posterior la funde con la del servidor. Un alta rechazada por otro
  motivo se ve en rojo bajo la fila y el vendedor la puede quitar (`quitarRechazada`).
- **"Visitado" se deriva** (venta o cobro de hoy en la tablet) y la **burbuja** cuenta las notas con saldo; los dos
  salen de `rutas.delDia()`. Una fila que la oficina quitó se queda en "Fuera de ruta" solo si hoy tuvo actividad.
- **Reordenar**: mantener presionado y arrastrar (`PanResponder`, `src/ui/lista-ruta.tsx`), con ▲/▼ siempre como
  respaldo. Si el arrastre resulta frágil en un equipo, `ARRASTRE_HABILITADO = false` deja solo los botones.
- La lógica de la pantalla vive en `src/estado/ruta-del-dia.ts` (puro, con pruebas). "Abrir el día" purga la ruta
  de hace más de 7 días (`rutas.purgar`), conservando las altas `pendiente` (las rechazadas en `error` de esos días
  sí se borran: si no, se reintentarían en cada sincronización).
- **El pull baja la ruta desde ayer en adelante**, sin tope (desde `current_date - 1` del servidor): una ruta futura
  debe bajar en el pull siguiente a su creación.
- **Tablet compartida:** el cursor de pull es global: las filas del vendedor anterior se quedan hasta la purga y las
  del nuevo vendedor anteriores al cursor no bajan; pendiente (reiniciar el cursor al cambiar de vendedor).

## Pruebas

`npm test --workspace=apps/tablet` corre Jest con `ts-jest` en Node puro y prueba
la **capa de datos** (migraciones + repositorios) contra `better-sqlite3`, la
**criptografia** (contra `node:crypto`) y la **politica de sesion offline**.

No hay pruebas de componentes ni de navegacion: necesitarian `jest-expo` y el
transform de React Native, y siguen fuera de alcance. Es decir: **la pantalla de
login no tiene pruebas automatizadas**, solo la logica que hay debajo.

## Nota sobre el monorepo

`npm install` reparte las dependencias entre la raiz y `apps/tablet/node_modules`
(hoy `react` se queda local porque el portal fija 19.1.0 y Expo SDK 57 exige
19.2.3). `metro.config.js` le dice a Metro que vigile la raiz y en que orden
resolver. Ver los comentarios de ese archivo.

Por eso `npx expo-doctor` reporta `react` duplicado: es el precio de tener dos
apps de React con versiones distintas en el mismo monorepo. El bundle resuelve
la copia local (verificado con `npx expo export --platform android`). Se resuelve
solo cuando el portal suba a React 19.2.x, que no es alcance de T-04.

## Pendiente (otros tickets)

- **T-07** — sincronizacion `pull`/`push` por WiFi. Hoy los catalogos (menos el
  vendedor y su sucursal, que salen del login) siguen viniendo de
  `src/datos/semilla-dev.ts`, que se aplica **solo en `__DEV__`** y se borra al
  implementar la sincronizacion. T-07 debe llamar a `gestor.renovar()` al
  conectarse: es lo que corre hacia adelante la ventana offline de la tablet.
- **T-14** — folios (ver `ADR-0001`).
- **T-20 / T-27 / T-31 / T-33 / T-39 / T-41** — módulos de la jornada que todavía son placeholders (gastos,
  inventario, merma, visita sin venta, Ruta y GPS).
