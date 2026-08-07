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
│   ├── _layout.tsx            # abre la BD, corre migraciones, monta el Stack
│   ├── index.tsx              # redirige a abrir-dia o a la jornada
│   ├── abrir-dia.tsx          # vehiculo + km inicial (BLOQUEANTE)
│   └── (jornada)/             # todo lo que exige jornada abierta
│       ├── _layout.tsx        # el guardia del kilometraje inicial
│       ├── index.tsx          # menu de la jornada
│       ├── operacion/         # clientes -> venta / cobranza / visita / registros
│       ├── prospectos.tsx
│       ├── ruta.tsx
│       └── cerrar-dia.tsx     # km final (el corte es T-38)
├── src/
│   ├── datos/                 # capa de datos local (SQLite)
│   ├── estado/                # contexto de React
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

## Pruebas

`npm test --workspace=apps/tablet` corre Jest con `ts-jest` en Node puro y prueba
**solo la capa de datos** (migraciones + repositorios) contra `better-sqlite3`.

No hay pruebas de componentes ni de navegacion: necesitarian `jest-expo` y el
transform de React Native, y quedaron fuera del alcance de T-04.

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

- **T-06** — login del vendedor con sesion valida offline. Hoy se toma el primer
  vendedor de la semilla de desarrollo.
- **T-07** — sincronizacion `pull`/`push` por WiFi. Hoy los catalogos salen de
  `src/datos/semilla-dev.ts`, que se borra al implementarla.
- **T-14** — folios (ver `ADR-0001`).
- **T-16 / T-20 / T-22 / T-24 / T-33 / T-34 / T-38** — los modulos de la jornada;
  hoy son placeholders.
