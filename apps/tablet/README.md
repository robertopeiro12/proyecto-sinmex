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

**Dependencias nativas.** `react-native-svg` (T-73, la firma del cliente) es nativa: después de instalarla o
actualizarla hace falta un APK nuevo (`expo prebuild -p android --clean` y `expo run:android`); Metro solo no basta.

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
│       ├── gastos/            # Gastos de hoy y Registrar gasto (T-30/T-31)
│       ├── pendiente/         # secciones del menu que aun no existen (inventario, merma)
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
| `repositorios/` | Repositorios tipados (`catalogos`, `jornadas`, `rutas`, `promociones`, ...) |
| `promociones-reglas.ts` | Regla de promociones (T-74): puro, sin base; ver la seccion de abajo |
| `../sincronizacion/fuentes.ts` | Orden de las fuentes del push (T-75: prospectos antes que ventas), con prueba |
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

- **La jornada abre en la ruta del día** (`app/(jornada)/index.tsx`). Desde el rediseño del 2026-10-18 dibuja su
  propia cabecera (la del Stack está oculta para esta pantalla): ☰ a la izquierda, el título centrado y, a la
  derecha, **+** (registrar prospecto) y **↻** (Refrescar, el "Sincronizar ahora" de siempre, con una burbuja con
  lo que falta por subir). *Agregar a mi ruta* es un botón a lo ancho debajo de la lista.
- **Menú lateral que empuja la pantalla** (`src/ui/menu-lateral.tsx`): al tocar ☰ la pantalla entera se desliza a
  la derecha el ancho del menu (`anchoMenuLateral`: 82% con tope de 320dp) y queda oscurecida; tocar la franja
  oscura o "atrás" de Android lo cierra. Arriba del menú van el vendedor, la jornada y la pastilla "por subir".
  Hecho con `Animated` de React Native (`useNativeDriver`), sin recompilar el APK.
- **Dos tablas locales** (migración 011): `ruta` la escribe el pull con su regla de fusión
  (`aplicarSnapshotRutas` en `src/datos/repositorios/rutas.ts`) y `ruta_orden_local` solo el dedo del vendedor.
  Ningún pull toca el orden local, y el orden **no sube** al servidor.
- **Las altas del vendedor suben como `ruta-alta`** (`src/sincronizacion/fuente-rutas.ts`). `ruta-duplicada` no es
  error: la fila queda sincronizada y el pull posterior la funde con la del servidor. Un alta rechazada por otro
  motivo se ve en rojo bajo la fila y el vendedor la puede quitar (`quitarRechazada`).
- **"Visitado" se deriva** (venta, cobro **o visita** de hoy en la tablet; T-39) y la **burbuja** cuenta las notas con saldo; los dos
  salen de `rutas.delDia()`.
- **"Visitados sin venta"** (T-39): el cliente de la ruta viva con visita hoy y sin venta ni cobro sale de la lista y
  aparece después de ella, con el motivo y la hora de la última visita y la subida de sus visitas (`agruparRuta`). Una fila que la oficina quitó se queda en "Fuera de ruta" solo si hoy tuvo actividad.
- **Reordenar**: mantener presionado y arrastrar (`PanResponder`, `src/ui/lista-ruta.tsx`), con ▲/▼ siempre como
  respaldo. Si el arrastre resulta frágil en un equipo, `ARRASTRE_HABILITADO = false` deja solo los botones.
- La lógica de la pantalla vive en `src/estado/ruta-del-dia.ts` (puro, con pruebas). "Abrir el día" purga la ruta
  de hace más de 7 días (`rutas.purgar`), conservando las altas `pendiente` (las rechazadas en `error` de esos días
  sí se borran: si no, se reintentarían en cada sincronización).
- **"Atendidos fuera de ruta"** (T-75): clientes y prospectos con venta del día en esta tablet que no están en la
  ruta de hoy; ver la sección de Prospectos más abajo.
- **El pull baja la ruta desde ayer en adelante**, sin tope (desde `current_date - 1` del servidor): una ruta futura
  debe bajar en el pull siguiente a su creación.
- **Tablet compartida:** el cursor de pull es global: las filas del vendedor anterior se quedan hasta la purga y las
  del nuevo vendedor anteriores al cursor no bajan; pendiente (reiniciar el cursor al cambiar de vendedor).
  Con T-75 hay un caso más: si el push del vendedor A se aplicó y la respuesta se perdió, y luego B reenvía desde la misma
  tablet, el buzón (único por vendedor + clave) no da `duplicada`: choca con `cliente_pkey` y queda `id-ocupado`
  permanente aunque el alta sí entró. Antes de T-75 duplicaba el prospecto.

## Promociones por regla (T-74)

- **Migración 012**: tabla `promocion` (la escribe el pull, baja como bandera `activo`), tabla `venta_promocion`
  (qué promoción regaló qué presentación en cada venta local, con la frase congelada) y `cliente.primera_venta_en`
  (lo marca el servidor, D14). La columna vieja `cliente.promocion` se queda sin uso: SQLite no la quita sin
  rehacer la tabla.
- **La regla vive en `src/datos/promociones-reglas.ts`** (puro, con pruebas): `promocionesAplicables` (D5, D7),
  `calcularRegalos` (D1-D3, D16, D18), `aplicarRegalos` (D6) y `textoPromocion`. El repositorio `promociones`
  (`repositorios/promociones.ts`) solo lee de SQLite y arma el catálogo; `ventas` guarda los regalos en
  `venta_promocion`.
- **El campo libre "Promoción" de la captura de venta desapareció** (D6): la app calcula las piezas gratis y el
  vendedor solo puede quitarlas. La ficha del cliente y la pantalla de venta muestran las promociones en lenguaje
  llano.
- **Sube como `regalos`** dentro de la venta (`fuente-ventas.ts`); si la venta no tiene filas en `venta_promocion`
  el campo se **omite** (no se manda `[]`).
- La frase está copiada en tres sitios (backend, esta app y portal) con pruebas compartidas; ver `CLAUDE.md`.
- **Despliegue:** tras el `db push` de la migración de promociones (`20261014130000_promociones.sql`) a
  `sinmex dev`, reinstala o limpia las tablets de demo (`adb shell pm clear mx.jawa.tablet`) **antes** de que la
  oficina cree promociones: el cursor del pull solo avanza, y una tablet que sincronizó entre el deploy y su
  actualización no recibe las promociones creadas en esa ventana hasta que cada una se edite.

## Prospectos: venderles desde que se capturan (T-75)

Spec: `docs/superpowers/specs/2026-10-14-t-75-camino-prospecto-design.md`. Flujo:

1. **Captura** (sin red): "Guardar prospecto" inserta la fila de `prospecto` **y** su espejo en `cliente` (mismo id,
   `tipo = 'prospecto'`, sin precios) en una transacción (`repositorios/prospectos.ts`).
2. **Ficha**: "Abrir su ficha" en la tarjeta "Listo", o la fila de "Prospectos de hoy", o la pestaña Prospectos de
   "Todos los clientes" (`listarProspectos`). La ficha muestra la bienvenida y la pastilla del alta (`pastillaAlta`);
   botones Vender y Visita, **sin Cobrar**.
3. **Venta de solo regalo**: nota en $0 con folio y `venta_promocion`. Aparece en "Atendidos fuera de ruta" de la
   jornada (`ventas.delDiaDelVendedor` + `atendidosFueraDeRuta`), con su estado de subida (`estadoSubida`).
4. **Sincroniza**: `src/sincronizacion/fuentes.ts` (`fuentesDelPush`) sube **prospectos antes que ventas**; no lo
   reordenes (el servidor comprueba el alcance una vez por lote). El servidor adopta el id de la tablet.
5. **Pull**: baja el cliente con el mismo id y lo pisa sin duplicar; el prospecto sigue sin entrar a la ruta hasta que
   el administrador lo convierta en el portal.

- La foto se liga por id (`fotoLocalDe`), con respaldo por nombre + teléfono.
- **Dirección del negocio (T-72)**: campo del alta, obligatorio cuando no hay coordenada válida (no se tomó, permiso
  negado, sin señal o lectura fuera de rango). La regla es `validarAltaProspecto` (`src/estado/alta-prospecto.ts`, con
  pruebas) y comparte con la visita `esCoordenadaValida` (`src/estado/coordenada.ts`). Se guarda en
  `prospecto.domicilio` y en el espejo (`cliente.domicilio`; migración 014), sube como `domicilio` en la operación y
  el servidor la geocodifica después del commit, sin que el push espere; la coordenada baja en el pull con
  `ubicacion_origen` (se guarda, no se muestra).
- **Prospectos capturados antes de T-75** no tienen espejo local con su id: "Prospectos de hoy" los muestra sin
  enlace (`enlaceAFicha` da `null`) y se alcanzan por la pestaña Prospectos cuando el pull los baje.
- Un alta rechazada (p. ej. tipo de negocio dado de baja) deja alta y venta en `error`; con `tipo-negocio-inexistente` entran solas
  cuando la oficina reactive el tipo de negocio (la tablet reenvía el mismo id); con cualquier otro rechazo hay que
  avisar a la oficina: la tablet no tiene cómo descartar ni corregir un alta. El vendedor **no debe volver a capturar**
  al prospecto (nacería un segundo espejo y la venta original seguiría en error). La pastilla de la ficha muestra el motivo.

## Visita sin venta (T-39)

Spec: `docs/superpowers/specs/2026-10-18-t-39-visita-sin-venta-design.md`. Pantalla:
`app/(jornada)/operacion/[clienteId]/visita-sin-venta.tsx`, desde el botón Visita de la ficha (cliente o prospecto).

- **Guardar** (sin red): `visitas.registrar` inserta la fila de `visita` (migración 013) en una transacción, con
  `motivo_nombre` copiado para pintar sin join. Toda la validación vive en `validarVisita` (`src/estado/visita.ts`,
  pura y con pruebas): el motivo se guarda aunque el catálogo lo haya dado de baja (no se revisa), la foto y quién atendió se exigen según el
  motivo, y la ubicación es GPS **o** dirección escrita. Una coordenada inválida (fuera de rango o no finita) cuenta
  como "sin GPS" (se pide la dirección y se guarda con `lat`/`lng` null) y una `precisionM` negativa se descarta.
  La pantalla ignora un segundo toque mientras guarda.
- **Catálogo**: `motivo_visita` baja con el pull (`catalogos.ts`); si lo dan de baja con la pantalla abierta, la
  visita se guarda igual y el servidor la acepta.
- **Foto de la visita**: `foto_local`, `foto_subida_en`, `foto_error` y `foto_descartada` (no hay `foto_estado`),
  y entra a la cola combinada de fotos junto con las de prospectos.
- **Sincroniza**: `fuente-visitas.ts` sube **visitas después de cobranzas y antes de rutas** (`fuentesDelPush`).
  La visita a un prospecto necesita que su alta ya esté en el servidor: el alcance se comprueba una vez por lote,
  así que alta y visita deben ir en lotes distintos (el motor los manda así).
- **Foto del cliente en la ficha**: se baja con `descargarFotoCliente` y se cachea por `cliente.foto_subida_en`
  (`foto_cache_subida_en`). **Nunca renueva la sesión** (la rotación del refresh token con detección de reuso podría
  revocar las sesiones del vendedor si chocara con una sincronización): un 401 deja "sin foto" hasta la siguiente
  sincronización. La URI lleva `?v=<foto_subida_en>` para que Android no reuse la imagen anterior (`uriFotoCliente`).
- **Ruta**: "Visitados sin venta" y "Visitas de hoy" en la ficha; ver la sección de la ruta del día.

## Gastos de la ruta (T-30/T-31)

Spec: `docs/superpowers/specs/2026-10-20-t-30-31-gastos-de-ruta-design.md`. Pantallas:
`app/(jornada)/gastos/index.tsx` (entrada **Gastos** del menú) y `app/(jornada)/gastos/registrar.tsx`.

- **Lista**: "Gastos de hoy" con campo, monto, hora y pastilla (por subir, subido, rechazado con su motivo) y el
  **total del día**, que suma todos los gastos de hoy sin importar si ya subieron (`gastos.totalDelDia`).
- **Registrar** (sin red): campo (solo los activos con "Se usa en la app", `camposParaGasto`), monto en pesos
  (`montoACentavos`: "12.5" → 1250; "12.345", "0", ".5" y la coma no valen), observaciones (≤ 200) y foto del ticket
  opcional (`capturarFoto('gasto')`). El método se muestra fijo: "Efectivo cobranza del día". Toda la validación es
  `validarGasto` (`src/estado/gasto.ts`, con pruebas). Ignora el segundo toque mientras guarda. Con el día cerrado o
  sin catálogo no deja registrar.
- **Datos** (migración 015, `src/datos/repositorios/gastos.ts`): `campo_egreso` baja con el pull (`campos_egreso`,
  casilla como 0/1); el gasto nace `pendiente` con `campo_nombre` copiado. Un campo dado de baja o sin la casilla
  después de elegirlo se guarda y sube igual. **Un gasto grabado no se edita ni se borra en la app**: las
  correcciones son del portal.
- **Sincroniza**: `fuente-gastos.ts` sube la operación `gasto` (sin `cliente_id` ni folio; clave = id) **después de
  visitas y antes de rutas** (`fuentesDelPush`). La foto sube por la cola combinada de fotos (`fuenteFotosGastos`)
  cuando el gasto ya está sincronizado; el servidor la guarda como `gasto-<id>.jpg`.

## Firma del cliente en la venta (T-73)

Spec: `docs/superpowers/specs/2026-10-21-t-73-firma-del-cliente-design.md`.

- **Revisión de la venta** (`app/(jornada)/operacion/[clienteId]/venta.tsx`): tarjeta "Firma del cliente" con el
  recuadro (`src/ui/recuadro-firma.tsx`), "Borrar firma" y "Nombre de quien firma (opcional)". "Grabar venta" solo se
  habilita con firma (`puedeGrabarVenta`); "Corregir" vuelve a captura y **borra** la firma (el cliente firmó un total).
  Mientras el dedo está en el recuadro la pantalla no se desplaza: el `PanResponder` reclama el toque y no lo suelta.
- **Al grabar** (`crearGrabadorVenta`, ignora el segundo toque): `exportarPng()` (`toDataURL`) → `guardarFirmaJpg`
  (`src/fotos/firma-expo.ts`: JPG 0.8, ≤ 1000 px, en `documentDirectory/firmas/firma-<id>.jpg`) → `ventas.registrar`
  con el id generado antes y `firma: { uri, nombre }`, en la misma transacción que la venta y su folio. Si la firma no
  se pudo guardar, la venta no se graba, no se quema folio y la pantalla sigue en revisión con la firma.
- **"Venta grabada"** dice "Firmada por {nombre}" o "Firmada"; la ficha marca "Firma por subir" mientras el servidor no
  tenga la imagen (`firmaPorSubir`).
- **Datos** (migración 016): `venta.firma_local`, `firma_nombre`, `firma_subida_en`, `firma_error`,
  `firma_descartada` (esquema derivado como la foto de la visita y del gasto; no tocan `sync_estado`).
- **Sincroniza**: la operación `venta` lleva `firma: { nombre }`; la imagen sube por la cola de fotos
  (`fuenteFirmasVentas`, después de los gastos) cuando la venta ya está sincronizada. Un 404 (la venta se eliminó en el
  portal) la descarta (`fallaDefinitiva`); un 409 se reintenta.

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
- **T-20 / T-27 / T-33 / T-41** — módulos de la jornada que todavía son placeholders (inventario, merma, Ruta y
  GPS). Los gastos ya tienen pantalla (T-30/T-31).
