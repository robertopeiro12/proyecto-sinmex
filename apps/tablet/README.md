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
│       ├── index.tsx          # menu de la jornada
│       ├── operacion/         # clientes -> venta / cobranza / visita / registros
│       ├── prospectos.tsx
│       ├── ruta.tsx
│       └── cerrar-dia.tsx     # km final (el corte es T-38)
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

### Convenciones del esquema local

- Nombres de tabla y columna iguales a `supabase/migrations/` (T-05), para que
  la sincronizacion de T-07 sea un mapeo 1:1.
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

Alta de credenciales: `npm run crear-vendedor --workspace=apps/backend` (el CRUD
de vendedores es **T-62**).

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
- **T-16 / T-20 / T-22 / T-24 / T-33 / T-34 / T-38** — los modulos de la jornada;
  hoy son placeholders.
