# proyecto-sinmex (JAWA)

Este repo es el código del sistema **JAWA**: distribución de bebidas (Té de Jazmín,
Jamaica, Horchata, Limonada, Tamarindo, etc.), con App de Tablet para vendedores/
repartidores y Portal Web para administración.

## Memoria del proyecto (Obsidian vault — fuente de verdad)

El conocimiento de negocio y arquitectura **no vive en este repo**. Vive en un vault de
Obsidian separado, versionado en git, compartido entre los 2 desarrolladores y los
agentes de IA:

- Repo: https://github.com/brg8607/jawa-obsidian-memory
- Ruta local (convención): carpeta hermana de esta, `../jawa-obsidian-memory`

**Antes de trabajar en cualquier tarea de dominio o arquitectura, lee
`../jawa-obsidian-memory/AGENTS.md`** — es el contrato completo de cómo navegar y,
sobre todo, cómo mantener esa memoria actualizada.

Resumen de las reglas de oro del vault (el detalle está en su `AGENTS.md`):

- Una idea, una nota. Enlaza con `[[ ]]` en vez de duplicar contenido.
- Toda nota lleva frontmatter (`tipo`, `estado`, `actualizado`, etc.).
- `90-Fuentes/` es solo lectura — nunca editar.
- Decisión técnica relevante → crear un ADR en `30-Decisiones/`.
- Tras cambios de código relevantes, actualiza la nota de dominio/arquitectura afectada
  y `00-Inicio/Estado del proyecto.md` en el vault.
- No inventes: si algo no está confirmado, márcalo como pendiente en vez de asumir.

Si `../jawa-obsidian-memory` no existe en esta máquina, avisa al usuario en vez de
asumir o inventar contexto de negocio.

## Estructura del repo (monorepo, npm workspaces)

```
proyecto-sinmex/
├── apps/
│   ├── backend/   — NestJS (T-02). Módulos en src/modules/, uno por módulo de dominio
│   │                (mismos slugs que el vault: ventas-cobranza, tesoreria, etc.).
│   │                Excepciones (no corresponden a un slug del vault porque atraviesan
│   │                los 12 módulos de dominio): `modules/sucursales/` (T-09) y
│   │                `modules/sincronizacion/` (T-07).
│   ├── portal/    — Next.js (T-03)
│   └── tablet/    — React Native/Expo + SQLite local (T-04). Rutas de expo-router
│                    en `app/`, capa de datos offline en `src/datos/`.
│                    Ver `apps/tablet/README.md`.
├── supabase/      — migraciones (T-01)
├── .env.example   — plantilla de variables; .env.development es local, nunca se sube
└── package.json   — raíz del workspace
```

## Comandos

Desde la raíz del repo (no entres a `apps/backend` a mano, usa los scripts del workspace):

```
npm install                  # instala todo el monorepo (un solo node_modules)
npm run backend               # levanta el backend en modo dev (watch)
npm run portal                 # levanta el portal (Next.js) en modo dev
npm run tablet                 # levanta el bundler de Expo (app de tablet)
npm run lint --workspace=apps/backend
npm run build --workspace=apps/backend
npm test --workspace=apps/backend
npm run test:e2e --workspace=apps/backend      # pruebas end-to-end (requieren Postgres real)
npm run db:types --workspace=apps/backend      # regenera apps/backend/src/database/schema.d.ts desde la BD local
npm run crear-usuario --workspace=apps/backend # da de alta un usuario del portal (input interactivo)
npm run crear-vendedor --workspace=apps/backend # da de alta (o restablece la contraseña de) un vendedor de la app

npm run typecheck --workspace=apps/tablet      # tsc --noEmit de la app de tablet
npm test --workspace=apps/tablet               # pruebas de la capa de datos local (SQLite)
npm run export --workspace=apps/tablet         # bundle de Metro; valida la resolucion del monorepo
```

**App de tablet dentro del monorepo:** `apps/tablet/metro.config.js` configura `watchFolders` a
la raiz y `nodeModulesPaths` (workspace + raiz) porque `npm install` reparte las dependencias
entre ambas carpetas. **No pongas `resolver.disableHierarchicalLookup = true`** (la receta que
circula para pnpm/yarn): con el layout de npm rompe el bundle. Ver los comentarios del archivo.

Health check una vez levantado: `GET http://localhost:3000/health`.

**No compiles (`npm run build`) el backend ni el portal con sus servidores de desarrollo prendidos:** el build borra `dist/` / `.next` y los tumba. Apágalos antes, o valida con lint, typecheck y pruebas.

**A qué base de datos apunta cada cosa (importante, no es obvio):**

| Comando | Archivo de entorno | Base de datos |
|---|---|---|
| `npm run backend`, `npm run crear-usuario` | `.env.development` | **`sinmex dev` en la nube** |
| `npm test`, `npm run test:e2e`, `npm run db:types` | `.env.test` | Postgres **local** (Docker) |

Es decir: **levantar el backend en modo dev escribe en la base compartida con el otro dev**, no en
la local. Los datos de prueba que crees haciendo clic en el portal se quedan ahí. Si quieres
trastear sin ensuciar, apunta `DATABASE_URL` de `.env.development` al Postgres local mientras tanto.

Descubierto en T-09, cuando una verificación "local" acabó creando una sucursal de prueba en
`sinmex dev`.

**Después de cada `git pull` / merge de `main`, actualiza el Postgres local — siempre, sin que te
lo pidan.** Las migraciones viajan por git (`supabase/migrations/`), pero nadie las aplica a tu
Docker por ti: tras un pull la base local se queda atrás y `test:e2e`, pgTAP y `db:types` corren
contra un esquema viejo. La rutina, con Docker corriendo, es:

```
npm run supabase start                          # solo si el stack no está arriba
npm run supabase -- migration list --local      # muestra cuáles faltan (columna "remote" vacía)
npm run supabase -- migration up --local        # aplica solo las pendientes; conserva tus datos
npm run db:types --workspace=apps/backend       # y comprueba que schema.d.ts no cambia (git diff)
```

Si el pull trajo migraciones y prefieres partir limpio, `npm run supabase -- db reset` reaplica las
23+ desde cero (las semillas base son una migración, así que vuelven solas). Descubierto el
2026-09-12: tras traer T-13 la local tenía 21 de 23 migraciones y nadie se había enterado.

Siempre con el `--`: `npm run supabase migration up --local` sin él se come `--local` en silencio
y aplica al destino equivocado. Es el mismo aviso de más abajo, repetido a propósito.

**Cada migración necesita una versión (el timestamp del nombre) única.** Supabase registra las migraciones por
versión: si dos archivos comparten timestamp, la segunda nunca se aplica (`migration up`/`db push` la dan por
hecha) y CI no lo detecta porque aplica los archivos uno por uno. Pasó el 2026-10-19 con T-29 y T-72 (los dos con
`20261019120000`); la de T-72 se renombró a `20261019130000`. Antes de crear una, revisa `ls supabase/migrations`
y la rama de tu compañero.

**La nube (`sinmex dev`) refleja `main`, nunca una rama — decidido el 2026-09-14.** Las migraciones
de un PR **no** se suben hasta que el PR se mergea. El motivo: si el PR cambia en revisión, la nube
queda con un esquema que `main` nunca tuvo, y una migración *correctiva* encima es peor que
esperar. Quien mergea un PR con migraciones las empuja siguiendo este protocolo, en este orden:

**En la práctica lo hace Roberto**, confirmado el 2026-09-14: él mergea y él empuja. Así llegó
T-62 a la nube. Si mergeas tú, el push es tuyo — el protocolo no cambia, solo quién lo corre.

1. **Pre-flight de solo lectura** contra la nube por cada `check`/`not null`/`unique` nuevo:
   una consulta que cuente las filas que lo violarían, y debe dar 0. `db push --dry-run` **no**
   sirve para esto — no ejecuta SQL, solo lista versiones. Y un push de varias versiones las
   aplica una por una: si falla la segunda, la primera ya quedó arriba. Pre-flight de todas antes
   de empujar ninguna.
2. `npm run supabase -- migration list --db-url "$SINMEX_DEV_DB_URL"` — anota la lista **antes**.
3. `npm run supabase -- db push --dry-run --db-url "$SINMEX_DEV_DB_URL"`, luego sin `--dry-run`.
4. `migration list` otra vez — la lista **después**, y va al comentario del PR mergeado.

La cadena vive en `.env.sinmex-dev` en la raíz (permisos 600, git lo ignora), como
`SINMEX_DEV_DB_URL=…`. Es la del **Session pooler** (IPv4): la conexión directa en la red del
equipo solo tiene IPv6. No hace falta `supabase link`; `--db-url` basta.

> [!warning] `--include-all` solo cuando `main` se adelantó, y siempre explicado
> Si la nube ya tiene un timestamp **posterior** al que vas a subir (pasó con T-62, mergeado y
> empujado antes que T-16, que tiene fecha anterior), `db push` se niega y hace falta
> `--include-all`. No es un atajo ni salta ninguna validación — es que el orden de merge no
> coincidió con el de creación. Pero **escríbelo** en el comentario del PR: un `--include-all`
> sin explicación es lo que dentro de dos meses nadie sabe justificar.

**Dos actores, dos autenticaciones (T-06) — no las mezcles:**

| | Portal Web | App de tablet |
|---|---|---|
| Actor | `Usuario` | `Vendedor` (entidades separadas, ver el vault) |
| Endpoints | `/auth/login`, `/auth/refresh`, `/auth/logout`, `/auth/me` | `/auth/app/login`, `/auth/app/refresh`, `/auth/app/logout`, `/auth/app/me` |
| Transporte | cookies httpOnly (exige dominio padre común) | **tokens** en el cuerpo + `Authorization: Bearer` |
| Claim `tipo` del JWT | `usuario` | `vendedor` |
| Sesión de refresh | tabla `sesion_refresh` | tabla `sesion_vendedor` |
| Guard | por defecto | endpoints marcados con `@SoloApp()` |

El guard global es estricto en los dos sentidos: un token de app **no** entra al portal ni al revés.
El de la app además vale offline — ver `ADR-0005` en el vault y `apps/tablet/src/sesion/`.

**Permisos del portal (T-08a) — el candado no es automatico:**

Un endpoint del portal nace exigiendo **solo sesion**. Para exigir un permiso concreto hay que
marcarlo: `@RequierePermiso('producto.gestionar')` sobre el handler. Sin esa marca, cualquier
usuario con sesion pasa.

- **Los 6 perfiles sembrados estan VACIOS** y siguen asi hasta T-08b: el cliente nunca dijo que
  permisos lleva cada uno, y la matriz la va a configurar el. Hoy el unico camino que pasa un
  `@RequierePermiso` es el perfil **`Administrador General`**, que recibe el catalogo completo, o
  una excepcion en `usuario_permiso`.
- **`usuario_permiso.habilitado` va en los dos sentidos:** `true` concede un permiso que el perfil
  no da, `false` quita uno que si da. La excepcion gana sobre el perfil.
- **Todo se resuelve en `permisos.repository.ts`**, y lo consultan tanto el guard como
  `GET /auth/me`. Si agregas una regla nueva de permisos, va ahi — no en el guard, o el portal y
  la API acabaran discrepando.
- **Los permisos aplican al portal, no a la tablet.** Un `@RequierePermiso` sobre un endpoint
  `@SoloApp()` truena a proposito: el vendedor no tiene perfil.

**Sincronización de la tablet (T-07) — el contrato está documentado, léelo antes de tocarlo:**

`docs/contrato-sincronizacion.md`. Endpoints `GET /sync/pull` y `POST /sync/push`, ambos con
`@SoloApp()`. Tres cosas que se rompen en silencio si no se saben:

- **El contrato lleva versión explícita** (`contrato: 1`) en cada petición y cada respuesta,
  porque tablet y servidor se despliegan por separado. Los tipos están **duplicados** a propósito
  en `apps/backend/src/modules/sincronizacion/contrato.ts` (normativo) y
  `apps/tablet/src/sincronizacion/contrato.ts` (la tablet no puede importar del backend: Metro).
  Si tocas uno, toca el otro y el `docs/` en el mismo commit.
- **`fecha_operacion` la calcula la tablet con su reloj local (Tijuana) y el servidor NUNCA la
  re-deriva de UTC.** A las 18:00 de Tijuana en UTC ya es el día siguiente, y eso partiría cada
  jornada en dos.
- **La idempotencia del push vive en un `unique (vendedor_id, clave_idempotencia)` de la base**,
  no en el servicio. La clave es el `id` local de la fila en SQLite. Una operación **rechazada no
  deja fila**, para que se pueda corregir y reenviar.

**Folios (T-14) — el folio lo emite la TABLET, offline:**

`ADR-0001` en el vault manda el formato: **12 caracteres en 6 segmentos**
(`TJ260322AP05` = sucursal + año + mes + día + vendedor + operación del día).

- **No lo emite el servidor.** T-07 había escrito lo contrario ("se emitirá al proyectar");
  ADR-0001 lo descarta explícitamente porque el folio se escribe en la nota física que el
  cliente firma, en campo, sin red. Ver `ADR-0007` del vault y el §7 de `docs/`.
- **El contador reinicia solo porque cuelga de la fecha.** `folio_contador` tiene llave
  primaria `(vendedor, sucursal, fecha)` en el SQLite de la tablet. No hay ninguna
  comprobación de "¿cambió el día?" que se pueda olvidar: un día nuevo es una fila nueva.
- **Emite dentro de la transacción que guarda la operación.** `folios.emitir()` usa
  `savepoint`, no `begin`, para poder anidarse. La venta (T-16) **debe** llamarlo dentro de su
  propia transacción, o un fallo a media captura quema un número. La cobranza ya no lo llama (T-21).
- **Folio ≠ clave de idempotencia** y hay que mantenerlos separados: la clave identifica el
  transporte, el folio el hecho de negocio.
- **La colisión se detecta con un `unique` global** en `sync_operacion.folio` (rechazo por
  operación, `folio-duplicado`). Al desempatar un `23505`, **mira primero la clave**: un
  reenvío legítimo trae la misma clave y el mismo folio y es `duplicada`, no colisión.
- **El segmento de vendedor (5º) lo asigna el SERVIDOR** y baja en el `pull`. La tablet no lo
  deriva de `nombre`: solo baja su propia ficha, así que no puede saber si comparte iniciales
  con un compañero. La colisión de iniciales se **rechaza** (no se cede), evaluada por sucursal — ver `ADR-0007` (enmienda 2026-09-12) y `modules/nomina-comisiones/vendedores.service.ts`.
- **Excepción: la venta del portal (T-17).** La oficina registra ventas desde el portal, y su folio
  lo emite el **servidor** con el segmento reservado **`OF`** (`TJ261006OF01`). Se emite dentro de la
  transacción de la venta (`folio_oficina_contador`, `ventas-cobranza/folios-oficina.repository.ts`).
  Ningún vendedor puede tener `OF`: lo impiden un check en la base y el rechazo en el alta. Ver `ADR-0011`
  en el vault.
- **El # de nota (`num_nota`) es OPCIONAL y se puede repetir** — el cliente lo aclaró el 2026-10-06. Es el
  número del block de papel, que solo se usa cuando falla el sistema; lo que identifica la venta es el
  **folio**. `null` = sin nota (nunca `''`), en Postgres y en el SQLite de la tablet (migración local 009).
  T-16 lo había hecho obligatorio y #95 único por sucursal (con el rechazo `num-nota-duplicada`): las dos
  reglas se quitaron. No las vuelvas a poner sin preguntar al cliente.
- **Una venta de mostrador no tiene vendedor** (`venta_nota.vendedor_id` null, "Oficina" en la
  pantalla). La base solo lo permite con `origen = 'portal'`, y entonces exige `capturo_usuario_id`
  (`ck_venta_nota_origen_actores`). Toda venta de la tablet sigue llevando vendedor.
- **Con `sucursal.control_inventario` prendida, el portal no le vende a un vendedor más de lo que trae cargado** (cliente,
  2026-11-12; la misma casilla y la misma regla que la app de T-27). Aplica a `POST /ventas` y a `PATCH /ventas/:id` solo
  si la venta tiene vendedor (Oficina nunca se revisa): existencia = las piezas teóricas por regresar del corte (cargados aceptados − vendidas − regaladas − merma entregada − merma de
  almacén − consumo − cambios entregados + cambios recibidos) de ese vendedor en la **fecha de la venta**, la misma cuenta del corte (`movimientosDelDia` de
  `produccion/cortes.repository.ts` + `existenciasPorPresentacion` de `reglas-corte.ts`; la merma **recibida** no suma a lo vendible). Si no alcanza → **409** "No le alcanza el producto a …: Horchata 1 L, faltan 3; …" antes del folio (no
  lo quema). Al editar se suman de vuelta las líneas de la propia venta si sigue con el mismo vendedor, y una presentación
  que no sube nunca se rechaza. Una carga **pendiente** no bloquea en el portal (la app sí). Reglas puras en
  `ventas-cobranza/inventario-venta.ts`, candado en `inventario-venta.service.ts`. **Orden de candados: `vendedor`
  (`for no key update`) → `venta_nota`**, el de la ruta del día: la edición bloquea al vendedor **antes** del
  `for update of vn` (al revés se abrazaría con la asignación de notas). Una venta de la tablet no toma ese candado.
- **Toda corrección de una venta va por el portal (T-17, parte 2)**, venga de la tablet o del
  portal: `PATCH`/`DELETE /ventas/:id` y `POST /ventas/:id/cuenta-perdida`
  (`ventas-cobranza/ventas-edicion.service.ts`), con el permiso `venta.editar_eliminar`.
  - Bloquean la venta con `for update of vn` y **nunca** cambian folio, cliente, fecha, sucursal ni
    origen. Un folio eliminado no se reutiliza.
  - Una venta con abonos vivos de `origen` `cobro` o `saldo_favor` (T-21), o en cuenta perdida, no se edita ni se elimina.
    Para quitarlos se pide el borrado del pago en Peticiones (T-34, abajo).
  - Las líneas existentes conservan su precio guardado; las nuevas toman el de la lista **a la fecha
    de la venta**.
  - `uq_venta_detalle_presentacion` es un índice **parcial** (`where deleted_at is null`), para poder
    volver a agregar una presentación que se quitó.
  - Una venta viva ya puede tener líneas borradas en `venta_nota_detalle` (y cobros de
    `venta_contado` borrados): todo lector (reportes, comisiones, corte) debe filtrar
    `deleted_at is null` también en líneas y cobros.
- **Facturas (T-19).** La factura se hace en el programa del SAT, **fuera** de JAWA; aquí solo se anota su
  número. Tabla `factura` (número único sin mayúsculas/espacios, de **un** cliente) y
  `venta_nota.factura` en `N/A` / `pendiente` / `facturada`; `facturada` ⇔ `factura_id` (check), y la
  llave compuesta `(factura_id, cliente_id)` impide apuntar a la factura de otro cliente. Endpoints en
  `ventas-cobranza/facturas.*` con el permiso `venta.asignar_factura`. Una venta **facturada no se edita
  ni se elimina** (`bloqueoDeEdicion`): primero se quita de la factura. Quitar la última venta borra la
  factura. La tablet solo manda `N/A`/`pendiente` y no recibe nada de esto.
- **Cobranza desde el portal (T-21) — y la cobranza NO lleva folio.** El cliente lo dijo el 2026-10-07
  (*"Un solo folio"*, *"Porque la cobranza no lleva folio"*): solo las ventas se numeran. No hay
  `cobranza_abono.folio` ni `saldo_favor_movimiento.folio`, la tablet ya no emite folio al cobrar (migración
  local 010) y una tablet sin actualizar que todavía lo mande se registra igual: `normalizarOperacion` lo
  **ignora sin validarlo** y no llega a `sync_operacion.folio`. No subió `CONTRATO_ACTUAL` (revisar al publicar).
  - **Una regla para los dos**: `repartirPagoEnNotas` (palomeadas por fecha y folio → demás notas → saldo a
    favor) vive solo en el servidor; `repartirPago` es esa misma con una nota y su copia de la tablet no cambió.
  - Endpoints `/cobranzas` (`ventas-cobranza/cobranzas-portal.*`, `cobranzas.controller.ts`) con el permiso
    `cobranza.registrar`. Cobrador `null` = Oficina o un vendedor activo de la sucursal del cliente;
    `capturo_usuario_id` = quien capturó; `fecha_operacion` = hoy en Tijuana.
  - **El portal SÍ rechaza** una nota marcada que ya no tiene saldo (409) — la tablet no (D9). La decisión se
    toma sobre las notas bloqueadas `for update` (`bloquearNotasDelCliente`), nunca sobre lo que leyó la pantalla.
  - **Aplicar saldo a favor** no es dinero nuevo: abono con `metodo_pago = origen = 'saldo_favor'` (un check
    exige los dos o ninguno) y un movimiento **negativo** `aplicacion` en `saldo_favor_movimiento`. Flujo de
    Efectivo y Tesorería **no** deben contarlo como ingreso.
  - Un cobro (de la tablet o del portal) se deshace **solo** con una petición autorizada (T-34, abajo).

- **Peticiones: borrar un pago con autorización (T-34).** Quien tiene `cobranza.editar_eliminar` **pide**
  (`POST /peticiones/eliminar-cobro`, con motivo); quien tiene `peticiones.gestionar` **autoriza o deniega** en
  *Operación → Peticiones*. Puede ser la misma persona (decisión de Roberto, 2026-10-13). Todo en
  `ventas-cobranza/peticiones.*`, `cobros-borrado.*`, `cobros.controller.ts` y `reglas-borrado-cobro.ts`.
  - **El pago es una entidad: tabla `cobro`.** Cada cobro (tablet, portal o aplicar saldo a favor) crea su fila
    en `cobro`, y sus filas de `cobranza_abono` y su `saldo_favor_movimiento` cuelgan de él con `cobro_id`. El
    cobro automático de una venta de **contado no es un pago**: `cobro_id` null (`ck_cobranza_abono_cobro`) y se
    corrige editando la venta. Quien escriba cobros por debajo del servicio (pruebas incluidas) crea su `cobro`
    (`apps/backend/test/apoyo-cobros.ts`). La entidad del push de cobranza en `sync_operacion` es el `cobro`.
  - **Se borra el pago completo**, nunca un pedazo: `deleted_at` en el `cobro` (+ `eliminado_por_usuario_id`),
    sus filas y su saldo a favor; cada nota recalcula su status (`cuenta_perdida` se queda). El status se
    escribe aunque no cambie (eso le toca `updated_at` a la nota y la tablet la vuelve a bajar) y, si el pago
    movió saldo a favor, se toca `cliente.updated_at`: así la tablet recibe la nota otra vez pendiente en
    el pull **sin cambiar la app**.
  - **Candados al autorizar:** la `peticion` (`for update`) → notas del cliente → su saldo a favor → el `cobro`.
    Mismo orden que el cobro: sin abrazo mortal con T-20/T-21. La vista previa toma los mismos candados.
  - **Se rechaza (409)** si el saldo a favor que dejó el pago ya se aplicó (quedaría negativo): primero se borra
    el pago que lo aplicó. La petición sigue pendiente.
  - Una sola petición **pendiente** por pago (`uq_peticion_cobro_pendiente`). El alcance (sucursal del cliente)
    se comprueba **antes** de decir si el pago está borrado o la petición resuelta.
  - **Corte, Flujo de Efectivo y Tesorería** (aún no existen) deben contar pagos de `cobro` **vivos** y excluir
    los de origen `saldo_favor` (no es dinero nuevo).
- **Jornada y kilometraje (T-38).** La jornada cerrada que sube la tablet (`tipo: 'jornada'`) se proyecta a la
  tabla `jornada` con `rutas/jornadas.service.ts` (`cerrarJornada`), dentro de la transacción de la operación.
  - Una **viva** por vendedor y día (`uq_jornada_vendedor_fecha`, parcial); el insert usa `on conflict … where
    deleted_at is null do nothing` y, si no insertó, rechaza `jornada-duplicada` (la misma clave es `duplicada`
    antes de llegar ahí).
  - El vehículo tiene que ser de la sucursal del vendedor del token y no estar dado de baja (`deleted_at`). Uno
    **desactivado** (`activo = false`) sí entra: el kilometraje se recorrió.
  - Forma y `km_final >= km_inicial` se validan **antes** de la transacción (`rutas/datos-jornada.ts`,
    `sincronizacion/despacho-jornada.ts`): `jornada-datos-invalidos`, `jornada-km-invalido`.
  - Solo jornadas **cerradas** hasta T-43. Las que llegaron antes de T-38 siguen en el buzón sin proyectar (sin
    backfill). El reporte de Kilometraje del portal es T-50 (ver el bloque Reportes y Excel, más abajo).
  - En la tablet, con la jornada de hoy cerrada **no se registra** venta, cobranza ni prospecto
    (`exigirJornadaAbierta`); no hay reabrir. Desde el rediseño (pieza 1, `docs/superpowers/specs/2026-11-18-rediseno-app-vendedor-design.md`) ya no hay pantalla
    `abrir-dia`: sin jornada de hoy la Ruta pinta la tarjeta "Empezar ruta" (vehículo + km inicial) y el menú apaga todo
    menos Ruta y Cerrar sesión ("Empieza tu ruta"); la guardia de `(jornada)/_layout.tsx` regresa a la Ruta cualquier
    otra pantalla. El día se cierra desde la pantalla **Corte** (`app/(jornada)/corte.tsx`; `cerrar-dia.tsx` ya no existe, rediseño
    pieza 6, spec §13): `jornadas.cerrarConCorte` guarda el corte y cierra la jornada en **una** transacción atómica.
    **Candado del Corte**: no se entra con clientes por visitar, salvo que el candado de inventario (sin carga aceptada)
    impida abrir clientes, caso en que el Corte sigue disponible para no dejar el día sin cerrar (`corteDisponible`);
    con el día cerrado queda disponible como resumen de solo lectura.
- **Corte del vendedor (rediseño pieza 6, spec §13 `docs/superpowers/specs/2026-11-18-rediseno-app-vendedor-design.md`).**
  Al cerrar el día la tablet sube la operación **`corte`** (`DatosCorte`, forma en `docs/contrato-sincronizacion.md`).
  - **Servidor**: `rutas/cortes-vendedor.service.ts` (`registrarCorte`) guarda en la tabla nueva `corte_vendedor`
    (migración `20261129120000`; uno vivo por vendedor y día). Rechazos: `datos-invalidos` (forma, validada antes de la
    transacción) y `corte-duplicado` (otra clave el mismo día; misma clave es `duplicada`).
  - **Nube / pre-flight**: tabla nueva y vacía, nada que contar. **Backend antes que la app**: un servidor viejo
    responde `tipo-desconocido` y la tablet reintenta en la siguiente sincronización.
  - **Es informativo**: no cambia saldos, existencias ni el corte de mercancía de la oficina (`corte_mercancia`).
  - **Tablet** (`src/estado/corte.ts`, funciones puras): tres apartados que se cierran por separado (Efectivo, Notas,
    Inventario) y el botón Corte solo se enciende con los tres cerrados.
    - **Efectivo esperado** = ventas de contado + abonos al vender (solo ventas a crédito) + cobros en **efectivo** −
      gastos. Cobros por transferencia o cheque se muestran aparte; puede salir negativo.
    - **Notas**: las asignadas de hoy (liquidadas salen con saldo $0.00) más las nuevas que trae el vendedor.
    - **Inventario**: un renglón por presentación con las buenas por regresar (`filasPorRegresar`) y **un** total de
      merma, que viaja dentro de `inventario` (`inventario.merma`).
    - **Huellas** (`huellaApartado`): al cerrar un apartado se guarda lo que decía el sistema; si después cambia (venta,
      cobro, gasto, merma) el apartado se **reabre** para que lo revise.
  - **Tablet, local**: migración 023 (tabla de cortes, `crearRepositorioCortes`); fuente de push `fuente-cortes.ts`.
  - **Candado de Corte**: falta(n) N cliente(s) por visitar. Una fila viva cuyo cliente está **dado de baja** en el
    catálogo de la tablet (`cliente_activo = 0` en `rutas.delDia`) no cuenta: va a "Dados de baja" en la Ruta, sin
    tocar (ninguna operación acepta un cliente inactivo; si contara, el día no se podría cerrar).
  - **Día del corte**: la pantalla lee todo con `jornada.fecha` (no el reloj) y el corte enviado por `jornada.id`
    (`cortes.deJornada`). El candado de inventario (`candadoDeHoy`) sí es del reloj.
  - **"Debes traer" ≠ Flujo diario de la oficina** (`flujo-diario.repository.ts`). Son cifras distintas a propósito;
    **no se concilian**:
    - **Abono al vender**: la tablet lo pone en "Abonos y cobros"; la oficina, dentro de `contado` (`cobranza_abono`
      con origen `venta_contado`).
    - **Forma de pago**: la tablet espera solo **efectivo** (transferencia y cheque aparte); la oficina suma todas las
      formas en `anteriores` + `a_favor`.
    - **Día del cobro**: la tablet usa `cobranza.fecha` (captura); la oficina, `fecha_pago`.
    - **Rechazado o sin subir**: la tablet lo cuenta (filas locales, cualquier `sync_estado`); la oficina no, hasta
      que se aplica (y lo borrado sale).
    - La "Cobranza" del resumen (todas las formas, sin abono al vender) sí equivale a `anteriores + a_favor` de la
      oficina, pero por `fecha` y no por `fecha_pago`.
- **Ruta semanal y Ruta diaria (T-37 + 2026-11-10).** La oficina tiene rutas fijas por día (*Operación → Ruta Semanal*), le
  asigna una a cada vendedor cada mañana (*Ruta Diaria*), la ajusta, le pone vehículo y le asigna notas por cobrar; el
  vendedor la complementa desde la tablet con la operación **`ruta-alta`** (no `ruta`, que sigue guardada sin proyectar; la
  visita de T-39 usa su propia operación `visita`). Todo en `modules/rutas/` (`rutas-semanales.*`, `rutas-diarias.*`,
  `notas-asignadas.*`). Spec: `docs/superpowers/specs/2026-11-10-ruta-semanal-y-diaria-design.md` (parte 1; el corte y
  las tres listas de notas del Flujo diario son parte 2).
  - **Tablas.** `ruta_semanal` (`dia_semana` 1 = lunes … 6 = sábado, **sin domingo**; nombre único vivo por sucursal y día)
    y `ruta_semanal_cliente` (orden = en que se agregaron). **`ruta_dia`** es el encabezado del día: ruta semanal +
    vehículo + `nombre_ruta` (copia del nombre al asignar, para que la historia no cambie si la renombran); **un vivo por
    vendedor y fecha** y **la misma semanal no va a dos vendedores el mismo día** (ambos únicos parciales). Las rutas
    de T-37 sin encabezado cuentan como "Sin ruta"; el encabezado se crea al guardar (un `PUT` vacío no lo crea).
  - **Origen.** `ruta.origen` admite `semanal` (check `ck_ruta_origen` ampliado). **Lo decide el servidor, no el
    portal** (el `PUT` solo manda ids, orden y recado): una fila existente **conserva** su origen (ya no se "adopta" como
    `oficina` lo del vendedor, como decía T-37); una nueva es `semanal` si el cliente está en la semanal asignada y
    `oficina` si no. `recado` ≤ 200, recortado, vacío = `null`. La vieja `tipo = 'semanal'` de T-36 nunca se usó y se deja.
    Lo agregado por el vendedor no se quita desde el portal, solo se reordena.
  - **`quitado_por`** al dar de baja una fila: `oficina` (la quitó a mano: **bloquea** que un cambio de la semanal la
    vuelva a poner ese día) o `cambio_ruta` (salió por cambio o por Quitar ruta: **no** bloquea).
  - **Propagación**: guardar la semanal (`PUT /rutas/semanales/:id/clientes`) la aplica en **su misma transacción** a las
    `ruta_dia` de **hoy en adelante** (reglas puras en `reglas-ruta-semanal.ts`, `planearPropagacion`): agrega al final,
    quita solo lo `origen = semanal`, no toca lo demás y **nunca** un día pasado. Un cliente no válido (baja, prospecto,
    otra sucursal) se salta sin hacer fallar el guardado. Renombrar cambia `nombre_ruta` de hoy en adelante.
    Eliminar una semanal asignada hoy o después = 409 con el motivo.
  - **Candados, siempre en este orden: `ruta_semanal` (en orden de id; la anterior y la nueva de la `ruta_dia`) →
    `vendedor` (`for no key update`) → `venta_nota`.** Alta de la tablet, `PUT` diario y guardado de la semanal se
    serializan así; invertirlo abre un abrazo mortal o propaga desde la ruta equivocada.
  - **Día pasado = solo lectura** (400) para guardar, quitar y notas; **"hoy" es el de Tijuana** y sale del reloj
    inyectable **`RELOJ_RUTAS`** (`rutas/reloj.ts`), no de `new Date()`: las pruebas lo fijan a las 23:30 de Tijuana
    (en UTC ya es mañana). `esFechaEditable` en `reglas-ruta-semanal.ts`.
  - **`nota_asignada`**: una nota por **un solo vendedor y día** (`unique` vivo `(venta_nota_id, fecha)`); **pasar = baja
    de la de A + alta de la de B** en una transacción. Se asigna a media jornada, incluso notas del mismo día. "Nota con
    saldo" = venta **viva a crédito** en `pendiente`/`abonado` con saldo > 0 y fuera de cuenta perdida; **una sola
    consulta** en `rutas/notas-ruta.repository.ts` que usan el conteo de la lista y la ventana de notas (no la dupliques).
    Una nota que se termina de pagar deja de salir en "pendientes" pero **sigue contando como asignada**. Solo se asignan
    notas de clientes de la ruta del día. Sale un cliente de la ruta (quitado, cambio de ruta o propagación) = se dan de
    baja sus notas asignadas a ese vendedor ese día; **Quitar ruta** baja **todas** las del vendedor ese día. El servidor
    **no** rechaza cobrar una nota no asignada (cobranza offline, como D9 de T-21).
  - Endpoints (permiso `ruta_semanal.gestionar` o `ruta_diaria.gestionar`, alcance de sucursal, **otra = 404**):
    Ruta Semanal: `GET|POST /rutas/semanales`, `GET|PATCH|DELETE /rutas/semanales/:id`, `PUT /rutas/semanales/:id/clientes`.
    Ruta Diaria: `GET /rutas/diaria/dia`, `GET /rutas/diaria/opciones` (rutas semanales del día con **`clientes`** —su
    lista en orden con `valido`, la misma regla de la Ruta Semanal— y vehículos), `GET|PUT|DELETE /rutas/diaria`,
    `GET /rutas/diaria/notas`, `PUT|DELETE /rutas/diaria/notas/:ventaNotaId`. **La pantalla de Ruta Diaria solo usa
    endpoints de `ruta_diaria.gestionar`**: los clientes de la ruta que escoge salen de `/opciones`, no de
    `GET /rutas/semanales/:id`. **Ya no hay "Copiar de ayer"** (`/anterior` se quitó). Una semanal que ya trae otro
    vendedor = 409; de otro día de la semana o de otra sucursal = 400 "no es del …"; dada de baja o inexistente = 400
    "Esa ruta ya no existe.". El vehículo repetido solo avisa.
  - **Alta de la tablet** (`ruta-alta`): `cliente_id` viaja en **`datos`**, no en el sobre (así un prospecto o un cliente
    borrado sale `cliente-inexistente` y no `cliente-fuera-de-alcance`); el alta usa `on conflict … do nothing` y, si no
    insertó, rechaza `ruta-duplicada`, que **la tablet trata como aplicada**. Un único vivo por vendedor, fecha y cliente
    (`uq_ruta_diaria_vendedor_fecha_cliente`, parcial).
  - **Pull** (aditivo, `CONTRATO_ACTUAL` sigue en 1; copia a mano en la nota del PR, **no** se tocó
    `apps/tablet/.../contrato.ts`): `rutas` del vendedor del token desde `current_date - 1` en adelante (reloj de
    Postgres, UTC), sin tope, baja con `activo: 0`; **`origen: 'semanal'` baja como `oficina`** (el SQLite de la tablet
    tiene un check de dos valores y uno nuevo tumbaría todos los pulls); `RutaPull.recado`; colecciones **`rutas_dia`**
    (`fecha`, `nombre_ruta`, `vehiculo_id`) y **`notas_asignadas`** (`venta_nota_id`, `fecha`). Desde el rediseño de la app
    (pieza 1, `docs/superpowers/specs/2026-11-18-rediseno-app-vendedor-design.md` §4) **el vendedor ya no reordena**: la ruta sale en el orden del portal; la columna local
    `ruta_orden_local` sigue en la base pero nadie la escribe ni la lee, y nunca subió. **Eliminar una venta (T-17) da de baja sus `nota_asignada`
    vivas** en la misma transacción (`ventas-edicion.repository.ts`, `eliminarVenta`, tras el `for update of vn` y sin
    bloquear `vendedor`), así que la baja viaja en el pull incremental como `activo: 0`.
  - **Dashboard y Flujo diario**: "Ruta asignada" muestra `nombre_ruta` ("Sin ruta · N clientes"); vehículo de la
    jornada, con "(asignado: X)" si difiere.
  - **Nube**: `20261110120000_ruta_semanal_y_dia.sql` y `20261110130000_ruta_semanal_ajustes.sql` (índice parcial de
    `ruta_semanal_cliente (cliente_id)` y el check `ck_nota_asignada_quitada`) se suben a `sinmex dev` después del merge, con
    el protocolo de push (pre-flight de la primera: tablas nuevas, columnas nulas y el check de origen ampliado; de la
    segunda: `select count(*) from nota_asignada where quitada_por_usuario_id is not null and deleted_at is null` debe dar 0). **Backend antes que
    la app.** Lo que le toca a Mario va en la nota del PR (spec §9).
  - **Condición de venta y comentario de no cobro (2026-11-13).** `nota_asignada.condicion_venta` (`ninguna` por omisión,
    `liquidar` o `abonar`, con check) y la tabla `nota_no_cobrada` (comentario 1..300) nacen en
    `20261113120000_nota_asignada_condicion.sql`. La condición viaja **dentro de `asignadaA`** (`NotaDeRuta`); cambiarla es
    Quitar + Asignar, porque el `PUT` del mismo vendedor no edita. La operación de push **`nota-no-cobrada`** (proyección en
    `rutas/notas-no-cobradas.service.ts`, forma en `datos-nota-no-cobrada.ts`, sobre revisado en
    `sincronizacion/despacho-nota-no-cobrada.ts`) no lleva folio, `cliente_id` va en el sobre, la clave es el id y se acepta
    aunque la asignación ya no exista; rechazos `nota-no-encontrada` y `nota-no-cobrada-id-ocupado`. El servidor **no**
    rechaza la venta (lo hace la tablet, PR 2). La revisión de notas une el último comentario vivo por nota y fecha, de
    cualquier vendedor, y muestra el nombre del autor; la pestaña Ruta pinta "Nota sin cobrar · <folio>" sin contarla como
    visita sin venta. **Nube**: se sube con el protocolo (pre-flight: nada que contar), backend y portal juntos.
    En Ruta Diaria el botón "Asignar notas" (columna Acciones de la lista y dentro de la pantalla de ruta del vendedor)
    abre la ventana de notas.
    **Tablet (PR 2).** Migración local 019 (`019-notas-asignadas.ts`): `ruta.recado`, `ruta_dia`, `nota_asignada` (sin FK a
    `nota_pendiente`), `nota_no_cobrada` y `cobranza.reparto_json` (líneas `{venta_nota_id, monto_centavos,
    saldo_despues_centavos}`); borra el cursor del pull, así que la primera sincronización tras instalar es completa, sin
    `pm clear`. Reglas puras en `src/datos/notas-asignadas-reglas.ts`; repositorio `repositorios/notas-asignadas.ts`
    (`deHoyDelCliente`, `bloqueoDeVenta`, `queTraePorCliente`, `registrarNoCobradas` atómico); estado de pantallas en
    `src/estado/notas-asignadas.ts`. "Cobro de hoy" = `cobranza.fecha` + `reparto_json` (tocadaHoy / liquidadaHoy), nunca
    `fecha_pago` ni `abonos_json` (el pull los pisa y trae cobros de la oficina; el pull va antes del push). La nota sale al
    abrir la ficha y al picar Vender (`operacion/[clienteId]/notas-asignadas.tsx`): Cobrar o Continuar sin cobrar
    (comentario obligatorio, una fila por nota e intento); vuelve a salir al reabrir hasta que un cobro de hoy la toque.
    Vender se bloquea según la condición, también dentro de `ventas.registrar()` antes del folio; el servidor no rechaza la
    venta. Push `nota-no-cobrada` después de cobranzas; la ruta muestra el recado ("Mensaje de la oficina") y el comentario
    cuenta como visita. Desde el rediseño (pieza 1, §4 y §6 del spec) la fila de la ruta dice "Trae N notas por cobrar"
    (`rutas.delDia(vendedorId).notas_que_trae` = `queTraePorCliente`: asignadas con saldo no liquidadas hoy más las
    ventas a crédito de hoy del vendedor) y la hoja del cliente apaga Vender con "Cobra primero" mientras una asignada
    traiga la condición sin cumplir (`accionesCliente`, `src/estado/hoja-cliente.ts`).
    **Pieza 5 (Ventas / Cobranza, §11 de `docs/superpowers/specs/2026-11-18-rediseno-app-vendedor-design.md`).**
    `queTraeDelVendedor` es la regla única (la lista de notas que trae el vendedor) y `queTraePorCliente` es su conteo.
    La pantalla `registros/index.tsx` lista ventas y cobros de hoy (`cobranzas.delDiaDelVendedor`); el detalle es
    `registros/[tipo]/[id].tsx` (un `sync_error` se muestra con `motivoDeRechazo`). `catalogos.folioDeNota` ignora `activo`
    (una nota dada de baja sigue mostrando su folio).

- **Impresión de notas (rediseño pieza 7, spec §12 `docs/superpowers/specs/2026-11-18-rediseno-app-vendedor-design.md`).**
  La tablet imprime la nota con `expo-print` (módulo **nativo**: hace falta `expo prebuild` y una **APK nueva**). Imprime por la
  impresora que el vendedor tenga configurada en Android; en Android `ok` solo significa que **el diálogo se abrió**, no que
  salió papel. Código en `apps/tablet/src/impresion/`.
  - **Papel**: preferencia 58 o 80 mm en "Seleccionar impresora" (`impresora.tsx`), guardada en SecureStore
    (`preferencia.ts`, clave `jawa.impresion.papel`); sin dato o dato ilegible, 58.
  - **Ticket**: `armarTicket(datos, 32 | 48)` es **puro** (32 columnas en 58 mm, 48 en 80 mm). El nombre del producto se
    **parte en renglones, nunca se corta**. `datos-ticket.ts` arma `DatosTicket` desde lo guardado; `html.ts` lo vuelve HTML.
  - **Cuándo imprime**: "Grabar e imprimir" en Vender y en Cobrar; el cobro **reimprime cada nota de su reparto** (con
    "Reimpresión" / "Cobró" en el ticket); "Reimprimir" en el detalle de Ventas / Cobranza (`registros/[tipo]/[id].tsx`).
    Varias notas salen en **un solo trabajo de impresión** (`imprimirTickets` → `ticketsAHtml`, salto de página entre
    notas): en Android `printAsync` vuelve al abrir el diálogo y dos trabajos seguidos no están garantizados.
  - **Imprimir nunca deshace lo grabado**: si falla o se cancela solo avisa; la nota ya está guardada y se reimprime después.
  - **Pull**: `NotaPendientePull.detalle` (aditivo, ver `docs/contrato-sincronizacion.md`) trae líneas, promociones y
    nombres para reimprimir una nota que no se vendió en esa tablet; la migración local **024** (`nota_pendiente.detalle_json`)
    **reinicia el cursor del pull** para bajar el detalle de todas las notas. **Backend antes que la APK**: un servidor
    viejo no manda `detalle` y la reimpresión de una nota no local sale **sin renglones**. **Backend antes que la APK: el
    cursor se reinicia una sola vez; si la APK llega primero, las notas no traen detalle hasta que cambien.**
    `detalle.creada_en` es la hora de la venta en la tablet (`ocurrido_en` de `sync_operacion`, como la oficina); en
    una nota de la oficina (sin operación) es solo la fecha `YYYY-MM-DD` y el ticket imprime solo el día.
  - **Antes de instalar el APK con la migración 024, sincronizar la tablet**; el pull completo no baja notas
    cerradas/borradas entre el último pull y la actualización (mismo patrón que 019/022).
  - **LIQUIDADA** (Mario, 2026-11-25; spec §12): **nunca** lleva espacio para firma. Pagada completa al vender (contado,
    sin abonos) imprime "Pagó $total" y saldo $0.00 (maqueta 25). Liquidada **con abonos** (abono al vender y cobros, o
    la reimpresión del cobro que la liquida) lista **cada abono con su fecha**, como la ABONADO, con SALDO PENDIENTE
    $0.00 (`armarTicket` decide por `abonos.length`). `ticketDeNota` lee los abonos de la nota aunque esté inactiva y
    los deja vacíos si la venta de esta tablet con ese folio es de contado (el servidor guarda un abono `venta_contado`
    por el total; una de contado solo baja si la oficina la editó o la borró).
  - **Pregunta abierta para Mario**: modelo de la impresora térmica real (no se ha probado con papel).

- **Promociones (T-74).** Regla de regalo por compra, configurada en el portal (*Operación → Promociones*, permiso
  `promocion.gestionar`; backend en `cartera-clientes/promociones.*`, `/promociones`) y **aplicada solo por la
  tablet**. Reemplaza al enum `cliente.promocion` y a `cliente_promocion_producto`. Spec:
  `docs/superpowers/specs/2026-10-14-t-74-promociones-por-regla-design.md`.
  - Tabla `promocion`, una regla por fila: compra de N piezas de un producto, una presentación o lo que sea
    (D1, D3); regalo de M piezas del mismo, de un producto o de una presentación; `se_repite` (D2); audiencia
    `todos` / `cliente` / `prospecto`: `todos` y `prospecto` son de una sucursal, `cliente` sigue al cliente y se
    crea en su sucursal (D4); la de prospecto nunca se repite por bloques; la propia del cliente **desplaza** a la
    general que comparte su producto (una propia "de lo que sea" desplaza a toda general; una de un producto no desplaza
    a la "de lo que sea") y las demás se aplican **todas** (D5); el vendedor solo puede **quitar**
    un regalo (D6); la de prospecto aplica solo en su primera venta y puede regalar sin compra (D7); sin fechas,
    baja lógica y nunca se borra (D8).
  - `venta_nota_promocion` guarda por nota qué promoción dio qué presentación, con la **frase congelada** (D12): si
    la oficina cambia la promoción después, la nota conserva su texto. `promocion_id` nulo si la tablet manda un id
    desconocido.
  - `cliente.primera_venta_en` lo marca `VentasService` al proyectar la primera nota viva del cliente (tablet o
    portal) y **toca `updated_at`** para que el pull incremental lo baje (D14).
  - **La regla de aplicación vive solo en la tablet** (`apps/tablet/src/datos/promociones-reglas.ts`, puro). El
    servidor valida la **forma** de `regalos` (uuids, cantidades, sumas por presentación = `cantidad_promocion`) y
    **no** la regla (D13): las piezas ya se entregaron.
  - Editar una nota desde el portal **borra** sus filas de `venta_nota_promocion` (D15). El portal registra ventas
    con piezas de promoción **libres** (D9); la regla ata a la app, no a la oficina.
  - **La frase está copiada en tres sitios** (`cartera-clientes/promociones-texto.ts`, `promociones-reglas.ts` de la
    tablet y `apps/portal/src/lib/promociones.ts`) y las tres comparten la misma tabla de casos en sus pruebas.
    Si cambias una, cambia las tres.
  - Pull: colección `promociones` de nivel superior (por sucursal del vendedor, baja como `activo: 0`); push:
    `regalos` opcional en `venta`. `ClientePull.promocion` salió y entró `primera_venta_en` sin subir
    `CONTRATO_ACTUAL` (D17). Migración local 012 (`promocion`, `venta_promocion`).
  - **Pre-flight de D10 para quien empuje la migración a la nube:** la migración se niega a correr si hay datos del
    esquema viejo. Antes: `select count(*) from cliente where promocion <> 'ninguna'; select count(*) from
    cliente_promocion_producto;` → debe dar 0 y 0 (además del pre-flight del protocolo de arriba).
  - **Orden del despliegue en `sinmex dev`:** después del `db push` de `20261014130000_promociones.sql`, las
    tablets de demo se **reinstalan o se limpian** (`adb shell pm clear mx.jawa.tablet`) **antes** de que la oficina
    dé de alta promociones. Una tablet que sincronizó entre el deploy y su propia actualización ya movió su cursor
    de pull (`updated_at`, solo avanza) y no recibe las promociones creadas en esa ventana hasta que cada una se edite.

- **Prospectos desde la app: venta desde que se capturan (T-75).** El vendedor no crea clientes, crea prospectos
  (convertirlos sigue siendo del administrador en el portal), pero ya puede **venderle al prospecto en cuanto lo
  captura**. Spec: `docs/superpowers/specs/2026-10-14-t-75-camino-prospecto-design.md`. Sin migración (local ni de
  servidor) y **sin cambio del cable**: `CONTRATO_ACTUAL` sigue en 1.
  - **La tablet crea el espejo en `cliente` con el mismo id** al guardar el alta (D1): `prospectos.registrar()`
    inserta la fila de `prospecto` y la de `cliente` (`tipo = 'prospecto'`, sin precios) en una sola transacción. Desde
    ese momento tiene ficha, bienvenida y venta de solo regalo, sin red. El pull posterior la pisa por id sin duplicar.
  - **T-72**: el alta gana "Dirección del negocio" (obligatoria sin GPS) y el espejo la guarda en `cliente.domicilio`,
    así que la ficha abre Maps por domicilio mientras el servidor no la geocodifique. Ver el bloque de T-72.
  - **El servidor adopta la clave como `cliente.id`** (D2, `despacho-prospecto.ts`, `clientes.service.ts`): la clave
    debe ser uuid (si no, `datos-invalidos`) y un id ya ocupado se rechaza con razón `id-ocupado` (código
    `datos-invalidos`, nunca un 500). El motivo es **neutro a propósito**: no confirma que exista un cliente, que podría
    ser de otra sucursal. La regla está en `contrato.ts` y en `docs/contrato-sincronizacion.md`.
  - **El push sube prospectos antes que ventas** (D3, `apps/tablet/src/sincronizacion/fuentes.ts`, `fuentesDelPush`,
    con prueba): el servidor comprueba el alcance de los clientes **una vez por lote**, y la venta de bienvenida
    caería `cliente-fuera-de-alcance` si su alta no estuviera ya aplicada. No reordenes las fuentes. Un alta rechazada
    arrastra a su venta (queda en `error`): con `tipo-negocio-inexistente` ambas entran solas cuando la oficina reactive el
    tipo de negocio; con otro rechazo hay que avisar a la oficina (la tablet no puede descartar ni corregir un alta) y el
    vendedor no debe volver a capturar al prospecto.
  - **El prospecto no entra a la ruta** (D5, D7): se atiende desde su hoja (sin Cobrar), desde "Abrir su ficha" o la lista de
    la pantalla Prospectos, y la sección **"Atendidos fuera de ruta"** de la jornada lo muestra con el estado de subida
    de sus ventas (puros en `src/estado/ruta-del-dia.ts`: `atendidosFueraDeRuta`, `pastillaAlta`, `enlaceAFicha`,
    `estadoSubida`). "Todos los clientes" ya no existe (rediseño, pieza 1, `docs/superpowers/specs/2026-11-18-rediseno-app-vendedor-design.md` §5 y §16-bis): la pantalla
    Prospectos lista lo capturado hoy en esta tablet y, debajo, **todos los prospectos vivos de la sucursal**
    (`catalogos.listarProspectos`, regla en `listaProspectos`), para abrir la hoja del capturado otro día o en otra
    tablet; la pastilla de subida solo sale en lo capturado en esta tablet. Los prospectos capturados antes de T-75
    no tienen espejo local: salen en "Capturados hoy" sin enlace. La foto se liga por id (`fotoLocalDe`, con respaldo
    por nombre + teléfono). e2e: `apps/backend/test/prospecto-venta.e2e-spec.ts`.

- **Tesorería (T-28 / T-29).** *Finanzas → Tesorería* (`/finanzas/tesoreria`), backend en `modules/tesoreria/`
  (`/tesoreria`). **Fuera del menú desde 2026-11-07** (`oculto: true` en `nav-config.ts`; ADR-0015 del vault): el
  cliente llama "Tesorería" a lo que cobra el vendedor − lo que gasta, por día, y no quiere las cuentas del negocio. El
  código se queda y la pantalla sigue entrando por su dirección. Lo mismo con Flujo de Efectivo. Permisos: `tesoreria.ver` (la vista) y `tesoreria.gestionar` (cuentas, saldos, movimientos y destinos de la cobranza). Spec:
  `docs/superpowers/specs/2026-10-15-t28-tesoreria-cuentas-saldo-inicial-design.md`.
  - **Dos "tesorerías":** la del repartidor (`Cobranza − Gastos`) se cuenta **en persona** y no es de aquí; esto
    son las **cuentas del negocio** (Efectivo, Caja Chica, bancos) que pidió el cliente.
  - `tesoreria_cuenta`: de una sucursal o **general** (`sucursal_id` null); nombre único entre vivas
    (`lower(btrim)`), en toda la empresa. Un usuario atado ve las suyas + las generales, pero las generales solo
    las **modifica** un General (403). Otra sucursal = 404.
  - `tesoreria_saldo`: saldo **fijado** de una cuenta en una fecha, uno vivo por cuenta y fecha (`PUT` en lote,
    todo o nada, corrige en vez de duplicar, sin fechas futuras de Tijuana). Vale al **inicio** del día: los
    movimientos de ese día van encima. El más antiguo es el saldo inicial; uno nuevo es el nuevo punto de partida.
  - **El cálculo vive solo en `tesoreria/reglas-saldo.ts`** (`saldoDeCuenta`, `armarVista`). Sin saldo fijado →
    `null` ("Sin saldo inicial"), nunca 0. El final de D no es "el inicio de D+1". T-29 agrega movimientos
    (depósitos, retiros, traspasos, cobranza) alimentando `movimientos`, sin tocar la firma.
  - Montos en **centavos enteros con signo** en la API (pueden ser negativos: sobregiro).
  - **Movimientos (T-29):** `tesoreria_movimiento` — depósito, retiro y traspaso (de una cuenta a otra), monto
    positivo (el tipo da el signo), sin fechas futuras; se corrigen (no el tipo) y se eliminan con baja lógica. Las
    cuentas tienen que ser **visibles**: un usuario atado puede usar una **general** en un movimiento (llevar el
    efectivo al banco), pero dar de alta/renombrar/eliminar una general y fijarle saldo sigue siendo de un General.
  - **La cobranza NO se copia a Tesorería: se lee al consultar** (`tesoreria/cobranza-tesoreria.repository.ts`):
    `cobro` vivo de origen `cobro` (sucursal del cliente) + abonos vivos `venta_contado` de ventas vivas (sucursal
    de la venta), por `fecha_pago` y método; **nunca** `saldo_favor`. Un cobro borrado (T-34) o una venta
    editada/eliminada (T-17) se corrigen solos.
  - **Destinos** (`tesoreria_destino_cobranza`): sucursal + método → cuenta, con vigencia `desde`; se usa la más
    reciente ≤ fecha del pago. Sin destino, el dinero no suma a ninguna cuenta y sale en `sinCuenta`. No se elimina
    la cuenta que **hoy** recibe cobranza (409).
  - **Gastos de la ruta (T-30/T-31)**: se **leen** de `gasto` (`tesoreria/gastos-tesoreria.repository.ts`, vivos con
    `metodo = 'efectivo_cobranza_dia'`, por fecha y sucursal del gasto) y restan en la cuenta destino vigente de
    `(sucursal, 'efectivo')`, la misma de la cobranza en efectivo (`destinoDe`). Sin destino salen en la lista aparte
    `gastosSinCuenta`. Evento `gasto-ruta` ("Gastos de ruta") con la forma del de cobranza (`id`, `fecha`, `cuentaId`,
    `cuentaNombre`, `sucursalCodigo`, `cantidad`, `montoCentavos`), un total por día, cuenta y sucursal. Las compras de
    oficina del resto de T-31 entrarán igual.

- **Flujo de Efectivo (T-32).** *Finanzas → Flujo de Efectivo* (`/flujo-efectivo`, permiso `flujo_efectivo.ver`,
  `modules/flujo-efectivo/`). Solo lectura. Ventas Totales por **fecha de la venta** (cualquier status, sucursal de la
  venta); Ventas Cobradas = la **misma** cobranza que lee Tesorería, por **fecha del pago**, separada por **quién cobró**
  (con vendedor = repartidor; sin vendedor / venta de mostrador = oficina); abonos por lo abonado; nunca saldo a favor.
  `% de cobro` con 1 decimal, `null` sin ventas. **Gastos** = la tabla `gasto` de T-30/T-31, vivos, por su `fecha` y
  sucursal, sumados por `tipo` en `reglas-flujo.ts`, de **todos** los métodos (Tesorería solo resta los del efectivo de
  la cobranza); sus comentarios salen en egresos como `Gasto`. `gastosDisponibles` ya es siempre `true`. Total Tesorería
  sale de `TesoreriaService.vista` (exportado), no se recalcula.

- **Visita sin venta (T-39).** El vendedor deja constancia, sin red, de por qué un cliente no compró: motivo del
  catálogo, hora, quién atendió, ubicación (GPS o dirección escrita) y foto si el motivo la exige. Spec:
  `docs/superpowers/specs/2026-10-18-t-39-visita-sin-venta-design.md`. Absorbe T-78 (#129).
  - **Catálogo `motivo_visita`** global (como `tipo_negocio`), con `exige_foto`/`exige_atendio`, baja lógica y nombre
    único entre vivos (`uq_motivo_visita_nombre`). Sus tiempos se llaman `creado_en`/`actualizado_en`; un trigger
    `set_actualizado_en()` mueve el segundo. Backend: `rutas/motivos-visita.*` (`/motivos-visita`, permiso
    `motivo_visita.gestionar`, grupo General). Portal: *Catálogo → Motivos de visita*
    (`/catalogo/motivos-de-visita`). Baja en el pull como `motivos_visita`.
  - **Operación `visita`** en el push (no `ruta`), sin subir `CONTRATO_ACTUAL`. La clave **es** `visita.id` (uuid,
    como el prospecto de T-75); `cliente_id` va en el sobre. `prepararVisita` (`sincronizacion/despacho-visita.ts`) valida la
    forma (ubicación obligatoria) y `rutas/visitas.service.ts` proyecta. Rechazos nuevos:
    `motivo-visita-inexistente` (uno **dado de baja sí entra**) y `visita-id-ocupado` (motivo neutro). **El servidor
    no revisa "exige foto/nombre"**: lo exige la tablet (`src/estado/visita.ts`, `validarVisita`).
  - **Orden del push**: `jornadas → prospectos → ventas → cobranzas → visitas → gastos → movimientos → cortes → rutas` (`fuentesDelPush`, con
    prueba). El alcance se comprueba **una vez por lote**: una visita a un prospecto cuya alta viaja en el mismo
    lote cae `cliente-fuera-de-alcance`; la tablet sube alta y visita en lotes consecutivos de una sincronización.
  - **GPS**: una coordenada inválida (fuera de rango o no finita) es "sin GPS" (se pide la dirección y se guarda con
    `lat`/`lng` null); una `precisionM` negativa o no finita se descarta a null.
  - **Fotos**: `POST /sync/foto/:clave` acepta prospectos y visitas; los archivos nuevos se llaman `cliente-<id>.jpg`
    y `visita-<id>.jpg` (T-78; los viejos `<clave>.jpg` no se migran, siempre se lee `foto_archivo`).
    `GET /sync/foto/cliente/:clienteId` (`@SoloApp`) baja la foto del cliente de la sucursal del vendedor (404 si no
    tiene o no es suya); la ficha de la tablet la cachea por `cliente.foto_subida_en`, que ahora baja en el pull.
    **Esa descarga nunca renueva la sesión** (la rotación del refresh token con detección de reuso podría revocar
    todas las sesiones del vendedor si chocara con una sincronización): un 401 se ve como "sin foto" hasta la
    siguiente sincronización. La URI que se pinta lleva `?v=<foto_subida_en>` (caché de imágenes de Android).
  - **Tablet** (migración local 013): `motivo_visita`, `visita` (la foto usa `foto_local`/`foto_subida_en`/
    `foto_error`/`foto_descartada`, como la del prospecto; **no** hay `foto_estado`) y
    `cliente.foto_subida_en`/`foto_cache_subida_en`. El cliente de la ruta visitado sin venta pasa a
    **"Visitados"** con su palomita, igual que el que compró (rediseño, pieza 1, `docs/superpowers/specs/2026-11-18-rediseno-app-vendedor-design.md` §4: ya no hay una sección
    "Visitados sin venta"; la fila lo resume). La
    lógica vive en `src/estado/ruta-del-dia.ts` y `src/estado/visita.ts`, con pruebas. Sin pantalla de visitas en el
    portal (T-55 y reportes leen la tabla `visita`).
  - **Nube**: la migración `20261018120000_visita_sin_venta.sql` debe subirse a `sinmex dev` después del merge,
    siguiendo el protocolo de push de migraciones (pre-flight: solo tablas nuevas).

- **Geocodificación de prospectos (T-72).** El alta de prospecto de la tablet gana "Dirección del negocio" (obligatoria
  sin GPS válido; una coordenada inválida cuenta como sin GPS, con la misma `esCoordenadaValida` de la visita de T-39) y
  el servidor convierte direcciones en coordenadas con la Geocoding API de Google. Spec:
  `docs/superpowers/specs/2026-10-19-t-72-geocodificacion-design.md`.
  - **`GOOGLE_MAPS_API_KEY`** (opcional, solo en el servidor; ver `.env.example`). Sin ella nada falla: el intento da
    `sin-configurar` (se loguea una vez por arranque) y el portal lo dice. La clave **nunca** se loguea ni sale en
    respuestas; se loguea el `status` de Google o el código HTTP, nunca la URL.
  - **`GEOCODIFICADOR_FALSO=1`** (solo desarrollo) ubica toda dirección en el centro de Tijuana sin llamar a Google. Se
    **ignora si `NODE_ENV=production`** (se usa Google y se loguea un `warn`). Ojo: esa guarda solo funciona si el
    despliegue **fija `NODE_ENV=production`**; hoy nada en el repo lo fija (el backend solo lo lee para elegir el
    `.env.<entorno>` y para `/health`), así que quien despliegue debe ponerlo.
  - Módulo `modules/integraciones/geocodificacion/` (token `GEOCODIFICADOR`, `fetch` nativo, **5 s** con
    `AbortController`; solo `ROOFTOP`/`RANGE_INTERPOLATED`/`GEOMETRIC_CENTER`, `APPROXIMATE` = `imprecisa`). **Bajo
    `NODE_ENV=test` la fábrica siempre da un geocodificador `sin-configurar`**: ninguna prueba puede llamar a Google
    aunque haya clave en el `.env`. Los e2e que necesitan geocodificar sustituyen el proveedor
    (`overrideProvider(GEOCODIFICADOR)`) con el falso compartido de `apps/backend/test/apoyo-geocodificador.ts`
    (`retener` mantiene una respuesta en espera para probar las carreras).
  - **Después del commit y sin bloquear**: `SincronizacionService` dispara
    `UbicacionClientesService.geocodificarEnSegundoPlano` tras aplicar un prospecto con `domicilio` y sin GPS (nunca en
    `duplicada` ni `rechazada`) y **no lo espera**; `ClientesService` lo dispara al guardar desde el portal si el
    domicilio cambió y no hay coordenada. Nunca dentro de una transacción. La escritura es `… where lat is null` con
    `updated_at = now()`: no pisa una coordenada capturada mientras tanto y baja sola en el pull. Sin reintentos, cola
    ni cron.
  - `cliente.ubicacion_origen` (`gps`/`geocodificada`/`manual`; nula ⇔ `lat` nula, por check; backfill `manual`).
    El portal conserva el origen si reenvía la misma coordenada y pone `manual` si cambia (`ubicacion-origen.ts`).
    En `PATCH /clientes/:id`, **omitir `lat` y `lng` conserva la coordenada y `null` la borra**: el formulario solo las
    manda si la oficina tocó los campos (`coordenadaAEnviar`), para no borrar la que Google puso con el formulario
    abierto. "Ubicar con la dirección" se deshabilita mientras el domicilio del campo no esté guardado.
    Baja en el pull; la tablet la guarda (migración local 014, junto con `prospecto.domicilio`, sin check para que un
    origen nuevo del servidor no tumbe el pull) y todavía no la muestra.
  - Portal: "Ubicar con la dirección" → `POST /clientes/:id/ubicar` (permiso `cliente.gestionar`, espera ≤ 5 s):
    200 con la coordenada, 409/502 con el motivo en español. **Otra sucursal = 404** (a diferencia de otros endpoints
    de clientes, que contestan 403: no confirma que el cliente exista). El domicilio admite 300 caracteres (antes 200),
    igual que la tablet.
  - `DatosProspecto.domicilio` (≤ 300) es aditivo: `CONTRATO_ACTUAL` sigue en 1.
  - **Nube**: `20261019130000_cliente_ubicacion_origen.sql` se sube a `sinmex dev` después del merge, con el protocolo
    de push (su comentario trae el pre-flight: `select count(*) from cliente where lat is not null` cuenta las filas
    que el backfill va a marcar `manual`, para el comentario del PR; los dos checks nuevos no pueden fallar porque el
    backfill corre antes de crearlos. Después de migrar,
    `select count(*) from cliente where (ubicacion_origen is null) <> (lat is null)` debe dar 0. El backfill mueve
    `updated_at` de los clientes con coordenada a propósito, para que las tablets reciban el origen).

- **Gastos de la ruta y campos de egreso (T-30 / T-31).** El vendedor registra, sin red, lo que paga con la cobranza
  (hielo, gasolina, reparación, adelanto); el gasto sube como operación `gasto`, resta en Tesorería y la oficina lo
  consulta en *Finanzas → Gastos*. Spec: `docs/superpowers/specs/2026-10-20-t-30-31-gastos-de-ruta-design.md`. Las
  compras de oficina desde el portal (cualquier método, días anteriores) son el resto de T-31, otro ticket.
  - **Catálogo `campo_egreso`** global, con `tipo` fijo (`produccion`/`operacion`/`financiero`, un check, no tabla) y
    la casilla `se_usa_en_app`; baja lógica, nombre único entre vivos (`uq_campo_egreso_nombre`) y
    `creado_en`/`actualizado_en` con `set_actualizado_en()`. La baja se **rechaza con 409** si el campo tiene gastos
    vivos en el año en curso de Tijuana ("podrás darlo de baja el próximo año"). Backend en `compras-egresos/`
    (`/campos-egreso`, permiso `campo_egreso.gestionar`, grupo General); portal *Catálogo → Campos de egreso*
    (`/catalogo/campos-de-egreso`). Baja en el pull como `campos_egreso`.
  - **Tabla `gasto`**: `id` = clave de la operación; copia `campo_nombre` y `tipo` al proyectar; `metodo` fijo
    `efectivo_cobranza_dia`, `origen = 'app'`, `quien` = nombre del vendedor, `fecha` = `fecha_operacion` del sobre
    (nunca re-derivada de UTC). `vendedor_id` nulo y `origen = 'portal'` quedan para las compras de oficina.
  - **Operación `gasto`** (ya estaba en `TIPOS_OPERACION`; dejó de guardarse sin proyectar), sin subir
    `CONTRATO_ACTUAL`. Sin `cliente_id` ni folio. `prepararGasto` (`sincronizacion/despacho-gasto.ts`) valida la forma
    y `compras-egresos/gastos.service.ts` proyecta. Rechazos nuevos: `campo-egreso-inexistente` (uno **dado de baja sí
    entra**) y `gasto-id-ocupado` (motivo neutro). **El servidor no revisa "Se usa en la app"**: lo filtra la tablet.
    Las operaciones `gasto` viejas del buzón se quedan sin proyectar (sin relleno).
  - **Fotos**: `POST /sync/foto/:clave` acepta gastos (`gasto-<id>.jpg`, opcional). El portal la sirve en
    `GET /gastos/:id/foto` (permiso `gasto.ver`; otra sucursal = 404).
  - **Portal** *Finanzas → Gastos* (`/finanzas/gastos`): `GET /gastos?desde&hasta&sucursal&vendedor&campo` (permiso
    `gasto.ver`, grupo Finanzas; alcance de sucursal; máximo 366 días), con total. Diseñada para 1366 px (`table-fixed` + `colgroup`, 736 px fijos y Comentario flexible); medir en navegador.
  - **Tablet** (migración local 015): `campo_egreso` y `gasto` (foto con el esquema derivado de la visita). Pantalla
    `app/(jornada)/gastos/index.tsx` (entrada Gastos del menú): desde el rediseño (pieza 1, `docs/superpowers/specs/2026-11-18-rediseno-app-vendedor-design.md`) es **una
    sola pantalla** con Motivo + Cantidad + "Guardar gasto" arriba y "Gastos de hoy" con su total abajo; ya no hay
    `registrar.tsx`, ni observaciones, ni foto del ticket en la app (manda `comentario: ''` y `fotoUri: null`; el
    contrato y el servidor no cambian). La lista se refresca con `versionCatalogos`/`ultimaSincronizacion` (no al
    enfocar). Los topes compartidos viven en `src/datos/reglas-gasto.ts` y la lógica pura en `src/estado/gasto.ts`
    (`montoACentavos` exacto, `validarGasto`, `camposParaGasto`, `faltantesVisiblesGasto`, `puedeGuardarGasto`), con
    pruebas. Un gasto grabado no se edita ni
    se borra en la app. La ficha ya no tiene ese botón: su "Merma" es de T-27 pieza 2.
  - **Nube**: la migración `20261020120000_gastos_ruta.sql` se sube a `sinmex dev` después del merge, con el protocolo
    de push (pre-flight: tablas nuevas, inserts de permisos y semilla; no hay nada que contar). Esta rama lleva el
    fix de PR #139 (migración de T-72 renombrada a `20261019130000`).
- **Firma del cliente en la nota (T-73).** El cliente firma con el dedo en la tablet **toda** venta (contado y crédito,
  sin poder omitirla) antes de grabarla; la firma complementa la nota de papel. Spec:
  `docs/superpowers/specs/2026-10-21-t-73-firma-del-cliente-design.md`.
  - **Desde el rediseño (pieza 2, spec `docs/superpowers/specs/2026-11-18-rediseno-app-vendedor-design.md` §9) la tablet
    ya NO captura la firma dibujada**: se quitaron `recuadro-firma.tsx`, `firma-expo.ts`, `puedeGrabarVenta` y `crearGrabadorVenta` (queda `firmaPorSubir`); el cliente
    firma a mano la nota impresa. Lo de abajo describe el contrato y la tablet de T-73 (016); una venta vieja con imagen
    pendiente **sigue subiendo** su firma por la cola de fotos. En su lugar, la venta lleva **`atendio`** (quien atendió
    al vendedor; **obligatorio en la app**, opcional y aditivo en el contrato; `venta_nota.atendio_nombre`, migración
    `20261126120000_venta_atendio.sql`) y **`abono_centavos`** opcional (venta **a crédito** con abono al vender,
    `0 < abono < total`): nace `abonado` y el servidor escribe un abono `venta_contado` en efectivo, `fecha_pago =
    fecha_operacion` y `cobro_id` **null** (por eso editar la venta en el portal no se bloquea, T-17: la edición lo
    conserva y da **409** si el nuevo total es ≤ el abono; borrarla lo borra). Tesorería y comisiones lo leen como
    cualquier abono `venta_contado` (T-21). Migración local de la tablet **020** (`atendio`, `abono_centavos`; la venta
    local conserva las columnas de firma). El portal muestra "Atendió" en el detalle. Cobrar no firma ni pide quien
    atiende, y conserva los chips Efectivo / Transferencia / Cheque con la fecha de pago de hoy.
  - **Tablet (T-73, histórico)**: la revisión de la venta lleva el recuadro (`src/ui/recuadro-firma.tsx`, `react-native-svg` +
    `PanResponder`, papel **blanco** como `<Rect>` dentro del `Svg` para que el PNG no salga transparente) y el nombre
    opcional (≤ 80). "Grabar venta" no se habilita sin firma; "Corregir" la borra. Toda decisión vive en
    `src/estado/firma.ts` (`puedeGrabarVenta`, `crearGrabadorVenta` con la guardia de doble toque), con pruebas.
  - **El id de la venta se genera antes de grabar**: `toDataURL` → PNG → JPG (`src/fotos/firma-expo.ts`,
    `expo-image-manipulator`, 0.8, ≤ 1000 px) en `documentDirectory/firmas/firma-<id>.jpg`, y `ventas.registrar({ id,
    …, firma: { uri, nombre } })` guarda `firma_local`/`firma_nombre` en la **misma transacción** que la venta y el
    folio (migración local 016). Si exportar o convertir falla, no se graba ni se quema folio.
  - **`react-native-svg` es nativa: hace falta un APK nuevo.** Una app vieja sigue funcionando: sus ventas llegan sin
    `firma` y el portal las muestra "sin firma".
  - **Contrato**: `firma: { nombre }` opcional en `datos` de la operación `venta` (aditivo, `CONTRATO_ACTUAL` sigue en
    1). Presencia = la venta espera imagen (`venta_nota.firma_esperada`); `nombre` > 80 o de otro tipo →
    `datos-invalidos` (`firma.nombre`). Las ventas del portal quedan con `firma_esperada = false`.
  - **Imagen**: sube por `POST /sync/foto/:clave` (rama `venta`) como `venta-<venta_nota.id>-firma.jpg`; 409 si aún
    no está proyectada o no espera firma, 404 si la venta se eliminó. Las columnas son de `ventas-cobranza`
    (`FirmasVentaService`/`FirmasVentaRepository`). La tablet trata **solo** el 404 de una firma como definitivo
    (`fuenteFirmasVentas.fallaDefinitiva`; `FotoTemporalError.status`) y la descarta; la cola sube las firmas después
    de las fotos de gastos y solo de ventas ya sincronizadas.
  - **Portal**: `VentaDetalle.firma { esperada, nombre, subidaEn }` y `editada` (`actualizado_por_usuario_id is not
    null`); bloque "Firma del cliente" en el detalle (imagen por `GET /ventas/:id/firma`, mismo alcance que el detalle,
    `Cache-Control: private, no-store`), "pendiente de subir" o "sin firma", y el aviso si la nota se editó después
    de firmarse. Editar en el portal **no** vuelve a pedir la firma.
  - **Nube**: `20261021120000_venta_firma.sql` se sube a `sinmex dev` después del merge y **antes** del backend (y el
    backend antes de la app), con el protocolo de push (pre-flight: columnas nuevas con default; nada que contar).
  - **Nube (pieza 2)**: `20261126120000_venta_atendio.sql` se sube a `sinmex dev` después del merge, con el protocolo de push.
    Pre-flight: columna nula y check que toda fila cumple en null; nada que contar. **Backend antes que la app**
    (migración → backend + portal juntos → APK): un backend anterior ignora `abono_centavos` (y `atendio`) **sin
    avisar**; la venta "Abonar" entraría `pendiente` por el total, la tablet la daría por sincronizada y el abono que
    el vendedor recibió no existiría en el servidor.
  - **Nube (pieza 3)**: **backend antes que la APK**: un APK nuevo contra un backend anterior recibe 400 en cada
    aceptación (el cuerpo trae los renglones aceptados). Y una vez que exista una aceptación parcial, **no se revierte el
    backend por debajo de la pieza 3**: la consulta vieja del corte contaría los renglones rechazados.
- **Carga y recarga del vendedor (T-27 pieza 1 / T-26).** Producción registra en el portal la carga de la mañana y cada
  recarga; la carga baja a la tablet, el vendedor la **acepta o la rechaza, renglón por renglón** (rediseño pieza 3, spec `docs/superpowers/specs/2026-11-18-rediseno-app-vendedor-design.md` §7), con red y, con el control de inventario de
  su sucursal prendido, no vende con una carga pendiente ni deja una presentación en negativo. Spec:
  `docs/superpowers/specs/2026-10-22-t-27-carga-y-recarga-design.md`. La pieza 2 (merma y consumo) está abajo; la 3 (corte de
  inventario) es otro PR.
  - **Servidor**: `sucursal.control_inventario` (apagada por defecto, D7), `carga` (numerada por vendedor y día;
    `uq_carga_vendedor_fecha_numero` parcial: una baja libera su número; `ck_carga_motivo`, `ck_carga_respondida`) y
    `carga_detalle` (piezas > 0). Permiso `carga.gestionar` (ya existía, grupo Produccion/Almacen). Backend en
    `modules/produccion/` (`/cargas`, reglas puras en `reglas-carga.ts`): solo cargas de **hoy en Tijuana** (D8);
    editar o eliminar solo pendiente/rechazada, de hoy y con la `version` (si no, 409 con la carga actual; una de un día anterior también es 409 en PATCH/DELETE); editar la
    regresa a pendiente y sube la versión; una **aceptada no se toca** (D5). El número se calcula con la fila del
    vendedor bloqueada (`for no key update`); otra sucursal = 404.
  - **App**: `POST /sync/cargas/:id/respuesta` (`@SoloApp`, `sincronizacion/cargas-app.controller.ts` →
    `CargasService.responder`): cuerpo nuevo `{ version, aceptadas: [presentacion_id…] }` (todas o una parte = `aceptada`;
    lista vacía = `rechazada`, sin motivo); el cuerpo viejo `{ version, accion, motivo? }` se sigue aceptando (tablets sin
    actualizar). La misma respuesta otra vez es 200 sin reescribir; otra versión o ya respondida = 409 con la carga; de otro
    vendedor, inexistente o eliminada = 404; un cuerpo mal formado = 400, que se evalúa **después** del 404 y del 409. La
    **aceptación parcial es definitiva**: lo no aceptado llega, si hace falta, en una recarga nueva. No renueva la sesión.
  - **Por renglón** (migración `20261127120000_carga_renglon_aceptado.sql`): `carga_detalle.aceptada boolean` nullable
    (`null` = pendiente o respondida antes de la pieza 3); `carga.estado` conserva sus tres valores (`aceptada` si al menos
    un renglón, `rechazada` si ninguno). Los lectores (corte, inventario del vendedor, venta del portal, rejilla) cuentan
    `coalesce(aceptada, true)` en una carga `aceptada`: una aceptada vieja es "todo", una rechazada vieja "nada". El
    portal etiqueta "Aceptada N de M" cuando fue parcial. `ck_carga_motivo` se relajó (el motivo ya no es obligatorio al
    rechazar; solo una rechazada puede llevarlo).
  - **Contrato** (aditivo, `CONTRATO_ACTUAL` sigue en 1): colección `cargas` en el pull (las del vendedor desde
    `current_date - 1`, baja con `activo: 0`) y `VendedorPull.control_inventario`. Cambiar la casilla toca
    `vendedor.updated_at` de esa sucursal (`SucursalesRepository.actualizar`).
  - **Portal**: pestaña **Recargas** de *Producción → Registro de Operación* (`components/registro-operacion/rejilla-recargas.tsx`;
    `lib/cargas.ts`), con el permiso `carga.gestionar` y en el lugar que pidió el cliente (Entradas · Recargas · Envíos · …).
    **Solo hoy** (sin fecha) y con la **sucursal del menú lateral**, sin selector propio. Es **una sola rejilla de todos los
    vendedores a la vez**, como el portal viejo pero volteada ("Cambios v2.0" del cliente): renglones = presentaciones por
    tamaño y, dentro, por producto alfabético; columnas = vendedores, cada uno con una subcolumna por carga de hoy (n.º, estado,
    motivo del rechazo en rojo; solo lectura) y una **"Nueva"**. **Fijos**: el `thead` (vendedores, `sticky top-0`) y la columna
    de productos (`sticky left-0`) dentro de una `CajaTabla` con alto máximo; la página no se desplaza de lado a 1366 px, la caja
    sí. **TAB baja por la columna del vendedor** (manejado con `onKeyDown`, no con `tabIndex`) y al terminar pasa al primer
    producto del siguiente vendedor. Un solo **"Guardar recarga"** crea una carga por vendedor con piezas, una por una; si alguna
    falla, las guardadas se limpian y la fallida conserva lo escrito con su mensaje en rojo bajo el nombre del vendedor.
    "Descartar" confirma con `useConfirmar`. Un pie fijo (`tfoot sticky bottom-0`) da el total de cada subcolumna; la caja
    lleva sombra a la derecha si hay más vendedores y `scroll-padding` para que el campo al que llega TAB no quede bajo lo fijo.
    **Lo escrito no se pierde**: las pestañas quedan montadas (`conservarMontadas`; las listas de operaciones solo se pintan en
    la suya), `beforeunload` avisa al salir y abrir la captura de otra pestaña pregunta antes. Un "0" cuenta como vacío. Editar (lápiz) / Eliminar (bote) solo en pendiente o rechazada, con `aria-label`
    que dice cuál: editar convierte esa subcolumna en campos con Guardar/Cancelar propios y bloquea lo demás; una presentación
    dada de baja que traía la carga avisa que se quita al guardar (las dadas de baja salen como renglón sin campo). Un 409 deja
    el mensaje en rojo (no se borra al recargar) y recarga la rejilla. `/produccion/recarga` **redirige** a la pestaña (conserva
    `?sucursal`) y "Recarga" salió del menú; el historial de días anteriores se ve en *Inventario por vendedor → Recargas*.
    *Catálogo › Sucursales*: casilla "Control de inventario en la app".
  - **Tablet** (migración local 017): `carga`, `carga_detalle`, `vendedor.control_inventario` (el login sin red no la
    pisa: `NO_BORRAR_CON_NULO` ahora lleva el valor con que nace una fila nueva). La mezcla del pull
    (`repositorios/cargas.ts`) reemplaza las líneas y **no deja que un pull viejo deshaga una respuesta**. Reglas puras
    en `src/datos/inventario-reglas.ts` (`existencias`, `bloqueoDeVenta`, `faltantesDeVenta`), reexportadas en
    `src/estado/inventario.ts` con la respuesta (`crearRespondedorCarga`, guardia de doble toque; 409 aplica la nueva y
    sincroniza; 404 sincroniza; 401 sincroniza y reintenta una vez). El `sincronizar` del proveedor reutiliza la corrida en
    curso (`src/sincronizacion/una-a-la-vez.ts`) para no renovar dos veces el refresh token a la vez, y
    `ventas.registrar()` publica un cambio de catálogo tras grabar para que Inventario relea. **`ventas.registrar()` recalcula bloqueo y
    faltantes dentro de su transacción, antes del folio** (vale la existencia del momento de grabar). Pantallas:
    Inventario (menú), detalle con la carga como checklist (migración local **021**, `carga_detalle.aceptada`), aviso "Tienes una carga por aceptar" en la ruta, y la venta con
    bloqueo, "Te quedan N" y faltantes congelados en la revisión.
  - **Nube**: `20261022120000_carga_vendedor.sql` se sube a `sinmex dev` después del merge, con el protocolo de push
    (pre-flight: tablas nuevas y una columna con default; nada que contar). La pieza 3 suma
    `20261127120000_carga_renglon_aceptado.sql` (columna nullable y `ck_carga_motivo` relajado: pre-flight, nada que contar).
    **Backend antes que la app** (la tablet nueva manda `aceptadas`). **No prender la
    casilla de una sucursal hasta que sus tablets tengan la versión nueva** y producción esté capturando cargas.
- **Merma y consumo en la tablet (T-27 pieza 2).** La tablet registra lo que sale o entra a la camioneta sin ser venta:
  **merma del cliente** (en la ficha, también de un prospecto, "Merma": "Recibí dañado" —al menos una pieza— y "Le
  entregué", la reposición de cualquier sabor), **merma del trayecto** y **consumo propio** (menú → "Merma y consumo").
  Una sola operación `movimiento` con `tipo`; un movimiento grabado no se edita ni se borra en la app (D6). Spec:
  `docs/superpowers/specs/2026-10-23-t-27-merma-y-consumo-design.md`.
  - **Servidor**: `sucursal.consumo_diario_max` (0–99, default 1), `movimiento_inventario` (`id` = clave, `fecha` =
    `fecha_operacion`, `ck_movimiento_cliente`: solo la merma del cliente lleva cliente, trigger de `updated_at`) y
    `movimiento_inventario_linea` (`sentido` recibido|entregado, `uq_movimiento_linea`). Proyección en
    `modules/inventario/` (`datos-movimiento.ts`, `movimientos.service.ts`, exportado por `InventarioModule`);
    `sincronizacion/despacho-movimiento.ts` revisa el sobre (la forma, antes de la transacción y sin leer la base;
    máximo 200 líneas). Rechazos: `datos-invalidos` (forma, cliente según el tipo, presentación que nunca existió),
    `cliente-fuera-de-alcance` (nunca `cliente-inexistente`) y el nuevo `movimiento-id-ocupado`. **El servidor no
    revisa el límite de consumo ni la existencia** (lo exige la tablet).
  - **Contrato** (aditivo, `CONTRATO_ACTUAL` sigue en 1): tipo `movimiento` (el tipo `merma` queda reservado, sin
    proyección), `VendedorPull.consumo_diario_max`. Cambiar el límite en el portal toca `vendedor.updated_at` de la
    sucursal (como `control_inventario`). Orden del push: `… → gastos → movimientos → cortes → rutas`.
  - **Portal**: *Catálogo › Sucursales*: "Consumo propio máximo por día" (0–99) en la edición
    (`components/sucursales/consumo-diario.ts`).
  - **Tablet** (migración local 018): `movimiento`, `movimiento_linea`, `vendedor.consumo_diario_max` (el login sin red
    no lo pisa). Reglas en `src/datos/inventario-reglas.ts` (`existencias` resta merma entregada, del trayecto y consumo,
    y da `mermaPorRegresar`; `faltantesDeMovimiento`, `consumoDelDia`) y `src/datos/movimientos-reglas.ts`
    (`validarMovimiento`, `consumoRestante`, `motivoDeConsumo`); pantalla en `src/estado/movimiento.ts` (guardia de doble
    toque `crearGuardiaRegistro`). **`movimientos.registrar()` revisa forma, límite de consumo (piezas), carga pendiente
    y faltantes dentro de su transacción**; lo que solo recibe merma no se bloquea. `ventas.registrar()` también resta
    los movimientos. Pantallas: ficha → "Merma" y "Movimientos de hoy"; menú → "Merma y consumo" (+ `merma/registrar`;
    con límite de consumo 0 el botón no aparece); Inventario con Merma entregada, Merma del trayecto, Consumo y "Por
    regresar a la planta". La pantalla "Próximamente" (`pendiente/[seccion]`) ya no existe.
  - **Rediseño pieza 4: cambios y motivo de merma** (spec `docs/superpowers/specs/2026-11-18-rediseno-app-vendedor-design.md` §11;
    issue #162 T-81; plan `docs/superpowers/plans/2026-11-25-rediseno-pieza-4-merma-y-cambios.md`).
    - **Tipo `cambio`** (`movimiento_inventario.tipo`, mismo sobre `movimiento`): cambio físico con un cliente; lo
      **recibido suma a la existencia** del vendedor y lo **entregado resta**, sin cobrar diferencia. Lleva cliente
      (**obligatorio**, `ck_movimiento_cliente` = `merma_cliente` o `cambio`) y exige **al menos una línea recibida y al
      menos una entregada** (`datos-invalidos` si no). `existencias` de la tablet y la teórica del corte lo cuentan.
    - **`motivo_merma_id`** (migración `20261128120000_movimiento_cambio_motivo.sql`, columna nula + `ck_movimiento_motivo`:
      solo `merma_cliente` y `merma_trayecto`). **Opcional para el servidor** (una tablet vieja entra con `null`); **obligatorio
      en la app**, que ofrece los motivos con `aplica_cliente` (merma del cliente) o `aplica_vehiculo` (del trayecto). Un
      motivo que nunca existió se rechaza con `motivo-merma-inexistente`; uno dado de baja o sin la bandera **sí entra**
      (se capturó sin red). El servidor no revisa `aplica_*`.
    - **Pull `motivos_merma`** (colección aditiva, por `actualizado_en`; ver `docs/contrato-sincronizacion.md`). Tablet:
      **migración 022** (`022-cambios-motivo-merma.ts`) reconstruye `movimiento` (admite `cambio` y `motivo_merma_id`) y
      **reinicia el cursor del pull** para bajar el catálogo nuevo.
    - **Pantallas**: ficha → **"Merma y cambios"** (`operacion/[clienteId]/merma.tsx`, dos pestañas: merma y cambio);
      menú → **"Merma / Cambios"** (`merma/index.tsx`: "Merma del vehículo", "Consumo" —solo si el límite > 0— y los
      movimientos de hoy con filtros Todo / Merma / Cambios) → `merma/registrar.tsx`.
    - **Nube**: `20261128120000_movimiento_cambio_motivo.sql` se sube a `sinmex dev` después del merge, con el protocolo de push
      (pre-flight: nada que contar; los checks solo se ensanchan y la columna es nula). **Backend antes que la app.**
      Si la APK se instaló antes que el backend, el pull incremental no trae los motivos sembrados (no cambian de
      `actualizado_en`) y la merma queda sin motivos que elegir; el motor lo cura solo: si al empezar a sincronizar la tabla
      local `motivo_merma` está vacía, olvida el cursor y el pull sale completo (`debeOlvidarCursor`, `motor.ts`). Remedio
      manual equivalente: borrar el cursor (`olvidarCursor`) o reinstalar. Con un backend sin motivos cada sync sale completo.
  - **Nube**: `20261025120000_movimiento_inventario.sql` se sube a `sinmex dev` después del merge, con el protocolo de
    push (pre-flight: tablas nuevas y una columna con default; nada que contar). Backend antes que la app.
- **Registro de Operación (parte 1).** *Producción → Registro de Operación* (`/produccion/registro-operacion`, pestañas
  Entradas/Compras · Envíos · Merma · Consumo · Descuentos): el almacén captura por día lo que entra, sale o se pierde, con la
  rejilla de productos por tamaño (TAB pasa a la siguiente casilla). **Reemplaza a Producción del día (T-25)**: su pantalla y
  los endpoints `/produccion` se retiraron y `/produccion/produccion-del-dia` redirige a la pestaña Entradas. **Aún no alimenta
  inventario** (T-24) ni almacenes (T-63). Issue #162 (T-81); spec
  `docs/superpowers/specs/2026-11-24-registro-de-operacion-parte-1-design.md`. La **parte 2** (Retiro de merma y Recargas) está abajo.
  - **Tablas.** `operacion_almacen` (`tipo` en un solo check: `entrada|envio|merma|consumo|descuento`, para agregar
    `retiro_merma` sin tocar más) + `operacion_almacen_linea` (piezas 1..100000, máx. 200 por operación, una por presentación).
    Checks por tipo: `origen` (`produccion|compra`) solo en entrada; `sucursal_destino_id` solo en envío y distinto de la
    sucursal; `motivo_merma_id` solo en merma; `trabajador` (1..120) solo en descuento. Baja lógica.
  - **Fechas (Tijuana, reloj de Postgres).** Entrada, merma, consumo y descuento: hoy o antes. **Envío: solo hoy o ayer**, y la
    regla vale para crear, editar y dar de baja (un envío de antier = 400). Reglas puras en `produccion/reglas-operacion.ts`;
    lo que comparte con cargas y cortes (hoy de Tijuana, fecha futura) en `reglas-comunes.ts`.
  - **Permisos por tipo, exigidos en el servicio**, no con `@RequierePermiso` (depende del tipo): `operacion.entrada`,
    `.envio`, `.merma`, `.consumo`, `.descuento` (grupo Produccion/Almacen), consultados con `PermisosRepository.permisosDe`
    (no se duplica la resolución). Sin el del tipo: 403 al listar, crear y editar. Los grants de `almacen_general.gestionar`
    pasaron a `operacion.entrada`. Endpoints: `/operaciones-almacen` en `produccion/operaciones-almacen.*`.
  - **Alcance** como el corte: atado solo ve la suya (ajena al listar = 403, operación de otra sucursal = 404); `todas` = 400
    "Elige una sucursal.".
  - **El envío se ve en el destino.** `GET ?tipo=entrada&sucursal=X` incluye los envíos con destino X (con
    `envio: { origen: {id, codigo} }`, "Envío desde TJ" en el portal), **de solo lectura** allá (sin Editar ni Eliminar); un
    usuario atado a X con `operacion.entrada` los ve aunque no alcance la sucursal de origen.
  - **Catálogo `motivo_merma`** global (como `motivo_visita`), con `aplica_almacen`/`aplica_cliente`/`aplica_vehiculo`, baja
    lógica y semilla de 4 motivos; `/motivos-merma`, permiso `motivo_merma.gestionar` (grupo General); portal *Catálogo →
    Motivos de merma*; la tablet también lo baja (pull `motivos_merma`, rediseño pieza 4: ver *Merma y consumo en la tablet*). Un motivo dado de baja o sin "almacén" no se acepta en una merma nueva, pero una existente lo conserva
    al editar si no se cambia.
  - Tipos duplicados backend ↔ portal (`lib/operaciones-almacen.ts`, `lib/motivos-merma.ts`): si cambias uno, cambia el otro.
  - **Nube**: `20261124120000_registro_operacion.sql` se sube a `sinmex dev` después del merge, con el protocolo de push.
    Copia **una sola vez** `produccion` a entradas (una por fecha y sucursal, solo filas vivas, con la hora de la fila más
    antigua del grupo). **Backend y portal juntos** (el portal nuevo ya no llama a `/produccion`). Pre-flight (cada una debe
    dar 0): `select count(*) from produccion where deleted_at is null and piezas > 100000;` y
    `select count(*) from (select 1 from produccion where deleted_at is null group by fecha, sucursal_id having count(*) > 200) t;`.
    Antes del push, anota para comparar después: los grants vivos de `almacen_general.gestionar`
    (`select count(*) from perfil_permiso pp join permiso p on p.id = pp.permiso_id where p.clave = 'almacen_general.gestionar'
    and pp.deleted_at is null;` y lo mismo con `usuario_permiso`), las entradas que va a crear la copia
    (`select count(*) from (select distinct fecha, sucursal_id from produccion where deleted_at is null) t;`) y la hora del
    push; todo va al comentario del PR. **Avisa a Mario** que no corra un backend viejo contra `sinmex dev` durante el push
    (escribiría en `produccion` y la copia es única). Post-flight: `select count(*) from produccion where greatest(created_at,
    updated_at, coalesce(deleted_at, created_at)) > '<hora del push>';` debe dar 0 (lo que se escriba en `produccion` después
    se pierde) y los grants vivos de `operacion.entrada` deben ser al menos los conteos de antes.
- **Registro de Operación (parte 2): Retiro de merma y Recargas.** Spec:
  `docs/superpowers/specs/2026-11-25-retiro-de-merma-design.md`. **Recargas ya es pestaña** del Registro (rejilla
  presentaciones × vendedores, PR #167; el tío confirmó que vaya ahí) y los Envíos eligen Hoy/Ayer con fecha (PR #166).
  - **Retiro de merma** = tipo `retiro_merma` en `operacion_almacen` (sin tabla nueva) con `estado` (`pendiente|autorizado|
    rechazado`, nulo en los demás tipos), `motivo_rechazo` (1..300, solo y obligatorio en `rechazado`) y `resuelto_por_usuario_id`/
    `resuelto_en` (presentes en autorizado/rechazado, nulos en pendiente): todo con **checks totales** (cubren todos los estados).
    Fecha: hoy o antes (Tijuana).
  - **Transiciones.** pendiente → autorizado | rechazado (Administración); **rechazado → pendiente al editar** (el aviso sale en la
    pantalla de corregir); **autorizado es final** (editar, eliminar, autorizar o rechazar = 409). Toda transición bloquea la fila
    `for update` y lee dentro de la transacción: dos autorizaciones a la vez, una gana y la otra recibe 409.
  - **Autorizar y rechazar lo que se vio.** Producción puede corregir un pendiente mientras Administración lo revisa, así que
    `POST /:id/autorizar` y `/rechazar` **exigen `actualizadoEn`** (sin él = 400): el `updated_at` de la fila como texto ISO UTC
    con **microsegundos** (`2026-11-24T16:15:00.123456Z`, formateado en SQL; un `Date` de JS los recorta). Cada operación lo trae
    como `OperacionAlmacen.actualizadoEn` y la bandeja manda el de la fila que muestra. Sobre la fila bloqueada, si ya no está
    pendiente = 409 del estado; si la marca no coincide = **409** "El retiro cambió desde que lo viste; revisa la cantidad
    nueva." con la `operacion` actual (no se resuelve nada). Cualquier edición mueve `updated_at` (trigger), así que la marca
    cubre cantidades, comentario y fecha. La bandeja recarga con 409 **y** con 404; la lista del Registro recarga si Eliminar da 409.
  - **Fechas de la resolución en formato largo**: "Autorizó Roberto el martes 24 de noviembre a las 12:08" (y "Rechazó …:
    motivo"). El servidor sigue mandando `AAAA-MM-DD hh:mm` de Tijuana; el portal lo pinta con `formatearDiaHoraTijuana`
    (`lib/formato.ts`, la misma que `textoHecho` del Corte; una forma desconocida sale tal cual). La bandeja muestra "Pidió" así y
    el comentario del retiro bajo Productos.
  - **Permisos.** Pedir, corregir y eliminar: `operacion.retiro_merma` (grupo Produccion/Almacen, con su ⓘ en
    `lib/explicacion-permisos.ts`; exigido en el servicio, como los otros tipos). Autorizar y rechazar: `peticiones.gestionar`
    (el mismo de T-34). Los perfiles siguen vacíos: los configura el cliente. Alcance de sucursal como el resto; un atado a TJ no
    ve ni resuelve retiros de MX.
  - **Endpoints** (`produccion/operaciones-almacen.*`): los de siempre con `tipo=retiro_merma`, más
    `GET /operaciones-almacen/retiros-pendientes` (bandeja), `POST /:id/autorizar` y `POST /:id/rechazar` (`{ motivo }`).
  - **Portal.** Pestaña *Retiro de merma* en el Registro (columna Estado con quién resolvió, cuándo y el motivo del rechazo; sin
    Editar/Eliminar cuando está autorizado) y pestaña *Retiro de merma* en *Operación → Peticiones* (`bandeja-retiros-merma.tsx`:
    Autorizar con confirmación, Rechazar con ventana de motivo). Un rechazado corregido vuelve a la bandeja. `resuelto.en` viaja
    como texto de Tijuana. Tipos duplicados en `lib/operaciones-almacen.ts`. Revisado en navegador a 1366 px, sin scroll horizontal.
  - **Aún no alimenta inventario** (T-24): autorizar solo cambia el estado.
  - **Nube**: `20261125120000_retiro_merma.sql` se sube a `sinmex dev` después del merge, con el protocolo de push. Pre-flight:
    nada que contar (columnas nulas, checks que todas las filas cumplen en null y un permiso nuevo). **Backend y portal juntos.**
- **Corte de mercancía (pieza 3).** *Producción → Corte* (`/produccion/corte`) absorbe al Retorno: por vendedor y día, el
  almacenista cuenta lo que regresó (**buenas** y **merma**) y el portal le muestra cuánto **faltó**. La vieja
  `/produccion/retorno` redirige a Corte (conserva `?sucursal`) y los endpoints `/retornos` **se quitaron** (404). Spec:
  `docs/superpowers/specs/2026-11-12-corte-de-mercancia-design.md` (D1–D13); respuestas del cliente en el vault
  (`Respuestas del cliente 2026-11-12 Corte de mercancía`).
  - **Tablas.** `retorno` gana `piezas_merma` (default 0) y el check `ck_retorno_piezas` (`piezas >= 0`, `piezas_merma >= 0`
    y la suma > 0; reemplaza a `retorno_piezas_check`). **`corte_mercancia`** es el encabezado: un vivo por vendedor y fecha
    (`uq_corte_mercancia_fecha_vendedor`, parcial), con quién lo hizo y cuándo (`hecho_por_usuario_id`, `hecho_en`) y
    `actualizado_por_usuario_id` para las correcciones. La migración **rellena** un encabezado por cada (fecha, vendedor)
    con `retorno` vivo, así que un día capturado antes sale como "Corte hecho" con sus buenas.
  - **Endpoints** (`modules/produccion/cortes.*`, `reglas-corte.ts`; permiso **`retorno.gestionar`**, el mismo de antes, no se
    tocaron perfiles): `GET /cortes?fecha&sucursal` (lista del día; `sucursal` = código o `todas`, atado a otra = 403),
    `GET`/`PUT /cortes/vendedor` (vendedor ajeno o dado de baja = 404). Fecha futura = 400 con `hoyEnTijuana`, también en los
    GET. El `PUT` reemplaza el día del vendedor y **siempre** marca el corte hecho, aunque no haya piezas (un vendedor que
    vendió todo); 0/0 en un renglón lo da de baja.
  - **La regla (por tamaño, 2026-11-18; spec `2026-11-18-corte-por-tamano-y-merma-design.md`).** La pantalla agrupa por
    **tamaño** (`presentacion.volumen`, clave en minúsculas sin espacios; orden por mililitros, `L` = ×1000, lo ilegible al
    final; `claveTamano`/`compararTamano` duplicadas en `lib/cortes.ts`) con un renglón de Total por tamaño. Dos bloques:
    **producto terminado** y **merma**, cada uno teórica · real · resultado (resultado = teórica − real; **> 0 falta**, en
    rojo; negativo se muestra y no bloquea).
    - **Teórica (C3)** = cargadas aceptadas − vendidas − regaladas − merma entregada al cliente − merma de almacén − consumo
      − cambios entregados + cambios recibidos, **en vivo** y sin recortar (negativo = "Salió más de lo cargado").
      **Merma teórica (C4)** = merma recibida del cliente + merma de almacén. Los movimientos salen de `movimiento_inventario`
      vivo (`merma_cliente` entregado/recibido, `merma_trayecto` = de almacén, `consumo`) por `fecha` y vendedor. **Cambios
      físicos** = movimientos `cambio` de `movimiento_inventario` (rediseño pieza 4): lo entregado resta y lo recibido suma
      a la teórica de producto terminado; la merma teórica (C4) no los cuenta.
    - Cargadas = solo **renglones aceptados** (`coalesce(carga_detalle.aceptada, true)` en una carga `aceptada`; rediseño pieza 3); vendidas/regaladas = `cantidad`/`cantidad_promocion` de líneas **vivas** de
      ventas **vivas** del vendedor con esa `fecha`, de cualquier status. Un vendedor con solo merma o consumo ese día también
      sale en la lista.
    - **D1: un tamaño no compensa a otro.** Dentro de un tamaño sí (lo que sobra de un sabor tapa lo que falta de otro); el
      total del día = suma por tamaño de `max(0, suma con signo de sus resultados)`, en cada bloque. "Faltan N" y "N de
      merma" (`faltante`, `faltanteMerma`; la lista trae `piezasFaltantes` y `mermaFaltante`). Los resultados **solo existen
      si el corte está hecho** (o el renglón se tocó en la captura; sin corte, `null`, nunca 0). Los campos vacíos no se
      llenan con la teórica: es un conteo.
    - **Una sola cuenta:** `reglas-corte.ts` es la única fuente de la teórica; la venta del portal la usa.
  - **D13 (lo no obvio).** Se serializa bloqueando la fila de `vendedor` (`for no key update`), como cargas y retorno; el `23505`
    queda como 409 de red de seguridad. Una presentación **desactivada o dada de baja** con movimiento ese día sigue saliendo
    y aceptándose; sin movimiento ni fila viva = 400. `hecho.en`/`hecho.por` son del **primer** guardado (o del relleno), las
    correcciones solo llenan `actualizado_por_usuario_id`. **`hecho.en` / `hechoEn` viajan como texto en hora de Tijuana**
    (`AAAA-MM-DD hh:mm`, formateado en SQL): el portal lo pinta tal cual, no lo reinterpreta con el reloj del navegador.
    Los tipos están duplicados en `apps/portal/src/lib/cortes.ts` y `cortes.service.ts`/`reglas-corte.ts`: si cambias uno,
    cambia el otro en el mismo commit. No se tocó la tablet ni el contrato de sincronización.
  - **Fuera de alcance.** El **dinero** que entrega el vendedor (R-5) sigue **pendiente de decidir**. Un faltante **no** se
    registra solo como descuento (lo hará Administración a mano en Procesos → Descuentos, pieza futura). Cambios físicos
    (T-33), Info de inventario por vendedor y los inventarios de producto terminado son otros pasos; T-24 leerá este corte.
  - **Con la casilla de inventario prendida, el portal tampoco vende más de lo cargado** (ver el bloque de la venta del
    portal, T-17): el aviso "Salió más de lo cargado" queda como red de seguridad (ventas de la tablet sin red, o de
    cuando la casilla estaba apagada).
  - **Nube**: `20261112120000_corte_mercancia.sql` se sube a `sinmex dev` después del merge, con el protocolo de push.
    Pre-flight: `select count(*) from retorno where piezas <= 0` debe dar 0 (el check nuevo admite 0 solo con merma > 0, y
    las filas viejas son > 0), y `select count(*) from (select distinct fecha, vendedor_id from retorno where deleted_at is
    null) t` cuenta los encabezados que el relleno va a crear (va al comentario del PR). Backend antes que el portal.
- **Inventario por vendedor (2026-11-24).** *Producción → Inventario por vendedor* (`/produccion/inventario-vendedor`):
  lo que cargó, vendió y regresó cada vendedor, **por tamaño**, en tres pestañas (Inventario, Recargas, Merma). Solo lectura,
  sin migración. Spec: `docs/superpowers/specs/2026-11-24-inventario-por-vendedor-design.md`.
  - `GET /inventario-vendedor?fecha&sucursal&vendedor` (`modules/produccion/`), permiso **`inventario.ver`** (ya existía).
    Alcance como el corte: sucursal ajena 403, vendedor ajeno o dado de baja 404, fecha futura 400 con `hoyEnTijuana`.
    Una sola cuenta: teórica, merma teórica, resultados, faltantes y tamaños salen de `reglas-corte.ts` (portal: `lib/cortes.ts`).
  - **"Todos los vendedores"** = suma por presentación de los vendedores de la sucursal. *Operación del vendedor* suma a
    todos; la *Validación por almacén* (`deberiaRegresar`, `buenas`, `faltante`, `mermaTeorica`, `merma`, `resultadoMerma`)
    **solo a los vendedores con corte hecho** (teóricas − reales = resultado siempre cuadra) y es `null` = celda vacía si
    ninguno con corte tuvo la presentación; `vendedoresSinCorte` los cuenta (aviso "N vendedores sin corte: no entran en la
    validación por almacén."). Con **un solo vendedor** la teórica sale aunque no tenga corte (`teoricaSinCorte`); reales y
    resultado, vacíos. Resultado > 0 en rojo; negativo sin rojo. Pie **"Faltantes del día"** (`fraseFaltan`: "Faltan: N pz p/Almacen"
    y "Faltan: N pz merma", cliente 2026-11-24); con "Todos" es la suma de `totales.faltante`/`faltanteMerma` del corte de **cada** vendedor con corte
    hecho (lo mismo que `faltantesDeCortes`; lo que sobra a uno no compensa lo que falta a otro, Roberto 2026-11-24).
    `vendedor` que no es uuid ni `todos` = 400 "Elige un vendedor válido.". Recargas muestra también las pendientes y
    rechazadas, con su estado, pero Inventario solo cuenta los renglones aceptados. Sin filas: "No hubo recargas ese día." (Recargas) y
    "Sin carga aceptada ni venta ese día." (Inventario y Merma).
  - **Dashboard y Flujo diario**: la columna Inventario trae la **pastilla del corte** (`FilaVendedorDia.corte`: Sin corte /
    Corte hecho / "Faltan: N pz p/Almacen · N pz merma", cliente 2026-11-24) y `ResumenDia.faltantesCorte`; picarla abre el detalle en la pestaña **Inventario**
    (la misma tabla; sin `inventario.ver` dice "No tienes permiso" y el resto del detalle sigue). En Flujo con varios días,
    cada renglón (vendedor, fecha) trae el estado de **su** corte.
  - **Tipos duplicados** backend ↔ portal en `apps/portal/src/lib/inventario-vendedor.ts` y `lib/flujo-diario.ts`: si cambias
    uno, cambia el otro en el mismo commit. La segunda fila del encabezado es `sticky` con `TOP2` (`top-[32.5px]`, medido:
    la primera fila mide 32,5 px a 1366 y 1920); si cambias el texto del encabezado, vuelve a medir.
- **Reportes y Excel (T-50 / T-15).** `GET /reportes/kilometraje` (`modules/estadisticas/`, permiso `reportes.ver`)
  lee la `jornada` de T-38; no escribe nada.
  - Kilómetros en **décimas de km enteras** (`round(km * 10)::int` en SQL; las columnas son `numeric(10,1)`).
  - **Salto** = `km_inicial` − `km_final` de la jornada anterior **del mismo vehículo** (orden `fecha, cerrada_en,
    id`), buscada aunque caiga antes de `desde` (`lag` sobre todo lo anterior a `hasta`; el `desde` se aplica
    después). Las jornadas borradas no cuentan.
  - Rango máximo de 366 días; vehículos desactivados o dados de baja sí aparecen.
  - **Todo reporte del portal exporta con `apps/portal/src/lib/excel/`** (`exportarExcel(definición)`), que carga
    `exceljs` solo al exportar. `uuid` de `exceljs` va forzado a `^11.1.1` con `overrides` en el `package.json`
    raíz (aviso de seguridad heredado).
  - **Flujo diario y Dashboard (2026-11-09; reemplazan a la pantalla del Reporte de Ventas de T-49).** Spec:
    `docs/superpowers/specs/2026-11-09-dashboard-flujo-diario-design.md`. Backend en `modules/estadisticas/`
    (`flujo-diario.*`, `dashboard.*`, `detalle.repository.ts`; reglas puras en `reglas-flujo-diario.ts` y
    `reglas-detalle.ts`). Solo lectura.
    - **Endpoints.** *Operación → Flujo diario* (`/operacion/reporte-de-ventas`, pestañas *Por vendedor* y *Por día*):
      `GET /reportes/flujo-diario`, `/reportes/flujo-diario/vendedor` y `/reportes/flujo-diario/dia`, permiso
      `reporte_ventas.ver`. *Operación → Dashboard* (`/operacion`, el de **hoy**): `GET /dashboard` y
      `/dashboard/vendedor`, permiso **`dashboard.ver`** (migración `20261109120000_permiso_dashboard.sql`).
    - **"Hoy" y "ayer" de Tijuana los calcula el servidor** para el Dashboard (nunca el reloj del navegador ni UTC);
      Flujo diario abre en ayer.
    - **Cobranza = contado + cobro de notas de días anteriores + lo que quedó a favor**, de **todos** los métodos de pago
      (efectivo, transferencia y cheque), y **nunca** `saldo_favor` (no es dinero nuevo). La misma lectura de `cobro` /
      abonos de contado que usan Tesorería y Flujo de Efectivo. Tesorería del día = cobranza − gastos. La cobranza de
      la **oficina** (cobros sin vendedor, por la sucursal del cliente) solo suma en la pestaña *Por día*; las ventas de
      mostrador (sin vendedor) **no entran** al Flujo diario. *Por día* es de **toda la sucursal** (Roberto, 2026-11-09):
      el selector de vendedor solo aparece en *Por vendedor*, y con un vendedor elegido el portal consulta dos veces (el
      filtrado para *Por vendedor*, sin vendedor para *Por día*). El backend acepta `vendedor` opcional en
      `/reportes/flujo-diario/dia` (ajeno = 404, sin oficina), pero el portal no lo manda. Las cifras de arriba siguen
      a la pestaña y la Cobranza dice de quién es en una línea bajo la cifra ("Solo lo que cobraron los vendedores" /
      "Vendedores $X · Oficina $Y"), en vez de avisos bajo la tabla.
    - **Dashboard:** `/dashboard/vendedor` acepta `fecha` (solo hoy o ayer de Tijuana; otra = 400) y el portal manda la
      del Dashboard pintado, para que a la medianoche el detalle no cambie de día. No lista a un vendedor inactivo o
      dado de baja cuya única razón para salir es la ruta diaria (el Flujo diario sí, es historia).
    - **Casilla "Entregada" (nota de papel):** `venta_nota.papel_entregado` (null = sin revisar) +
      `papel_revisado_en`/`papel_revisado_por_usuario_id`. `PUT /dashboard/notas-entregadas` (permiso
      `nota_papel.revisar`, 204) manda **todas** las notas a crédito del día (sin marcar = `false`); un folio que no es
      venta viva a crédito de ese vendedor de hoy o antes = 400 y no se guarda nada. **No mueve `updated_at`**: el
      trigger `set_updated_at_venta_nota()` lo conserva cuando solo cambian las columnas `papel_*`. El detalle trae
      `notasCredito[].entregada` y `notasNoEntregadas` (días anteriores, `false` y con pendiente).
    - **Revisión de notas en la tarde (Ruta Diaria parte 2).** Spec:
      `docs/superpowers/specs/2026-11-11-ruta-diaria-parte-2-revision-notas-design.md`. La pestaña "Notas de ventas" del
      detalle (Dashboard y Flujo diario, la misma `PestanaNotas` en `detalle-vendedor-pestanas.tsx`) trae **tres listas**:
      "Notas Asignadas Cobradas" (`asignadasCobradas`, pendiente 0, solo se ven), "Notas Asignadas NO cobradas por
      Entregar" (`asignadasPorEntregar`, con saldo, abonadas incluidas) y "Notas Nuevas x Cobrar Entregadas"
      (`notasCredito`), más "Notas de Ventas NO Entregadas". Las casillas salen **palomeadas si `entregada` es null**
      (se puede guardar "todo llegó" sin tocar nada).
      - **Solo se piden notas con saldo y status `pendiente`/`abonado`** (`cuenta_perdida` no, ni entra al conteo). Una
        nueva que también es asignada ese día sale una vez, como asignada. Las **ya revisadas se conservan** aunque se
        paguen después (ventana y columna cuadran).
      - `PUT /dashboard/notas-entregadas` ahora lleva `fecha` (AAAA-MM-DD, formato inválido = 400), `notas` y
        `asignadas: {ventaNotaId, entregada}[]`; permite **hoy o ayer de Tijuana** (otra = 400) y **no requiere jornada
        cerrada**. Sin `fecha` conserva la regla vieja (`<= hoy`). Todo o nada; lote vacío = 400.
      - **Migración** `20261111120000_nota_asignada_papel.sql`: `nota_asignada.papel_entregado`/`papel_revisado_en`/
        `papel_revisado_por_usuario_id` + check de que van juntos. A diferencia de `venta_nota`, el update **sí mueve
        `updated_at`** de la asignación (trigger genérico): inofensivo, la tablet ignora el papel.
      - `FilaVendedorDia.notasNoEntregadas` (Dashboard y Flujo diario; `null` = sin revisar o sin nada que revisar (columna vacía, el tío prefiere vacío a un "0"), en rojo si > 0;
        `contarNotasNoEntregadas` en `reglas-flujo-diario.ts`). Tipos duplicados en `lib/flujo-diario.ts` del portal.
        `useCerrarConPendientes` (`use-detalle-abierto.ts`) pregunta antes de cerrar con casillas cambiadas a mano.
      - **Nube**: la migración se sube a `sinmex dev` después del merge, con el protocolo de push (pre-flight: columnas
        nulas y un check que todas las filas cumplen en null; nada que contar).
    - **Pestaña "Ruta"** (la ventana "Visitas" del viejo, que se abre al picar *Ruta*, también el "x / y" del
      Dashboard): los clientes de su **ruta diaria en su orden** con lo que pasó en cada uno, o `visitado: false` →
      "Cliente no visitado"; después los atendidos fuera de ruta, por hora (`armarDetalleVendedor`).
    - **Liquidada** se lee de `abono.saldo_pendiente` (la nota quedó en cero con ese abono), no se recalcula.
    - **Alcance:** un parámetro `sucursal` ajeno responde **403**; un `vendedor` ajeno responde **404** (no confirma que
      exista). Con "Todas" hay un bloque por sucursal.
    - **Los tipos están duplicados** en `apps/portal/src/lib/flujo-diario.ts` y `reglas-flujo-diario.ts` del backend
      (el portal no importa del backend): si cambias uno, cambia el otro en el mismo commit.
    - **Portal** (`components/flujo-diario/`, `components/dashboard/`, `ui/selector-segmentado.tsx`, `Pestanas` con
      `deshabilitada`): el scroll horizontal de la tabla del Dashboard (13 columnas) se **aceptó** a propósito; no
      lo "arregles" quitando columnas.
    - **Nube**: `20261109120000_permiso_dashboard.sql`, `20261109130000_indices_flujo_diario.sql` (índices parciales de
      `venta_nota (vendedor_id, fecha)` y `cobro (vendedor_id, fecha_pago)` para las sumas por vendedor y día) y
      `20261109140000_nota_papel_entregado.sql` (columnas nulas, un check que todas las filas cumplen en null, el
      trigger nuevo de `venta_nota` y un permiso) se suben a `sinmex dev` después del merge, con el protocolo de push
      (pre-flight: nada que contar).
  - **`GET /reportes/ventas` (T-49) se queda** con su permiso `reporte_ventas.ver` y `lib/reporte-ventas.ts`: son la
    base del Excel de ventas de *Información → Reportes* (pieza 4). Su pantalla y `components/reporte-ventas/` se borraron.
    - Cuenta ventas vivas de **cualquier status**; la sucursal es **la de la venta** (`venta_nota.sucursal_id`), no la
      del cliente como en Cuentas por Cobrar (T-22). Piezas = líneas **vivas** de `venta_nota_detalle`.
    - Agrupa por día (subtotales) y trae `porRepartidor`. `repartidor=oficina` filtra ventas de mostrador.
  - **El portal se usa en computadora, no en celular.** Una tabla ancha tiene que caber desde **1366 px** de ventana
    (≈1012 px de caja, por la barra lateral `w-64` y el `p-8`). Medir el texto en el navegador antes de fijar anchos
    de columna: la primera versión de T-49 se desplazaba de lado incluso a 1440 px. Patrón: `table-fixed`, `colgroup`,
    `min-w`, scroll en su caja (ver `components/gastos/` o `components/flujo-diario/`).

- **Portal UI (piezas comunes, Etapa 1).** Spec: `docs/superpowers/specs/2026-10-20-portal-ui-etapa-1-design.md`.
  - **Toda pantalla nueva, o una vieja que se toque, usa `apps/portal/src/components/ui/`**: `EncabezadoPantalla`
    (título + UNA línea que dice para qué sirve), `EstadoPantalla` (Cargando / sin permiso / elige sucursal, mismo texto
    en todas), `Tabla`/`Th`/`Td`/`TdMonto`/`CajaTabla`, `FiltroFechas` (botón **Mostrar**, atajos Hoy · Ayer · Esta
    semana · Este mes) + `BotonExcel`, `Aviso`, `Etiqueta`/`EtiquetaStatusVenta`, `Monto`, `Fecha`, `Campo` y sus
    controles, `Pestanas` (con `onCambio` opcional para avisar la pestaña elegida), `SelectorSegmentado` (`ui/selector-segmentado.tsx`: 2–3 opciones excluyentes en tira, `radiogroup` con flechas; el "Por producto / Por cliente" del Dashboard), `Ventana` (`ui/ventana.tsx`, Dialog de base-ui: formularios cortos de crear/editar),
    `Ayuda` (ⓘ con globito, Tooltip de base-ui; las explicaciones de permisos viven en `lib/explicacion-permisos.ts`).
    Para confirmar, `useConfirmar()` (pinta `{ventana}` en la pantalla), **nunca `window.confirm`**.
  - **Movimiento:** `Pantalla` entra con un desvanecido al montarse y `app/(portal)/template.tsx` hace lo mismo al
    navegar; si una pantalla cambia de vista con el mismo `<Pantalla>` (lista ↔ formulario), cada vista lleva su `key`.
    El menú lateral es un solo `<aside>` que anima su ancho. La manita del mouse la pone `globals.css` (Tailwind 4 ya no
    la pone en botones); `prefers-reduced-motion` apaga todo.
  - **Formulario corto → `Ventana`; de varios bloques → pantalla completa con "← Volver a …"** (Clientes, Usuarios, como
    editar una venta). `PantallaCatalogo` ya lo resuelve con sus props `descripcion`, `tituloFormulario`,
    `formularioEn` (`"ventana"` por omisión o `"pantalla"`) y `baja` (botón que confirma con `useConfirmar`).
  - Formatos y rangos en un solo lugar: `lib/formato.ts` (`formatearPesos`, `formatearFecha`, `formatearFechaHora`,
    `plural`, `iniciales`) y `lib/fechas.ts` (`rangoSemana`, `rangoMes`, `diaAnterior`, `primerDiaDelMes`). Los archivos
    de antes (`lib/ventas.ts`, `lib/reportes.ts`, `lib/reporte-ventas.ts`, `lib/tesoreria.ts`) solo re-exportan.
  - **El color de la sucursal vive en `lib/sucursal-color.ts`** (TJ azul pacífico, MX morado jamaica, todas = tinta) y
    en las variables `--suc-…` de `globals.css`. Una sucursal nueva usa la tinta hasta que se agregue en los dos
    lugares. Es la única parte llamativa del portal: no se usa para otra cosa, salvo el renglón de grupo de cada sucursal (`FilaGrupo sucursal=…`) en Dashboard y Flujo diario con "Todas" (Roberto, 2026-11-11).
  - El marco es `components/layout/marco-portal.tsx`: sucursal arriba en su color, secciones plegables, usuario y
    "Cerrar sesión" abajo, ☰ lo esconde (se recuerda con `lib/almacen-local.ts`), y el `<title>` de la pestaña
    ("Ventas | JAWA Tijuana"). Una pantalla nueva se agrega en `nav-config.ts`; mientras su `page.tsx` sea un
    `Placeholder` lleva `pronto: true` (una prueba lo exige).
  - **En `app/(portal)/layout.tsx`, el `AuthProvider` va DENTRO del `<Suspense>`** (arreglo del error de hidratación,
    Tarea 8). Todo lo que lea `useAuth` tiene que seguir dentro de ese Suspense.
  - **Tesorería › Movimientos:** "Registrar operación" es un formulario fijo arriba; editar un movimiento abre una
    `Ventana` y no toca lo que el de arriba tenga escrito. Consulta al entrar y al picar **Mostrar**.
  - Todas las pantallas propias del portal **dentro del marco** ya usan las piezas comunes (el login y los
    placeholders "Pronto" conservan su aspecto; Gastos es de Mario) (Etapa 4: Registrar venta, Promociones, Ruta
    diaria). Registrar venta y Editar venta comparten los campos; Ruta diaria confirma con `useConfirmar` al descartar
    cambios. El modo `pantalla` de `PantallaCatalogo` pinta `EncabezadoPantalla` con `tituloFormulario` (el `h1`).
  - **Gastos es de Mario:** no se toca sin él. Ya no queda ningún `window.confirm` en el portal.

`npm run supabase -- migration up --local` aplica migraciones nuevas al Postgres local (ojo con el
`--`: sin él, npm se come los argumentos).

**Requisitos de entorno para lo anterior:**
- `JWT_SECRET` en `.env.development` (raíz del repo) — el backend no arranca sin ella. Genera una
  con `openssl rand -base64 32`.
- Variables de la app (todas en **horas**, todas con default): `ACCESS_TOKEN_TTL_APP_HORAS`,
  `REFRESH_TOKEN_TTL_APP_HORAS`, `VENTANA_OFFLINE_MAX_HORAS`, `VERIFICADOR_LOCAL_ITERACIONES`.
  Ver `.env.example` y `apps/backend/src/modules/auth/ttl-sesion.ts`.
- Para que la tablet alcance el backend: `EXPO_PUBLIC_API_URL` (default `http://localhost:3000`,
  que **solo sirve en emulador**; en una tablet real hay que apuntar a la IP del servidor).
- Para `test`, `test:e2e` y `db:types`: el stack local de Supabase arriba (un daemon de Docker
  corriendo + `npm run supabase start`). **El daemon de Docker cambia según la máquina**: una de
  las dos del equipo usa Colima (`colima start`) y la otra Docker Desktop — este archivo llegó a
  afirmar cada una de las dos como si fuera la única. Antes de asumir, `docker context ls`. Además, un
  `.env.test` en la raíz con `DATABASE_URL` (al Postgres local) y
  `JWT_SECRET`. `db:types` filtra con `--include-pattern='public.*'` para no traerse las tablas
  internas de Supabase (`auth.*`, `storage.*`, etc.), que contradicen el ADR-0002 (Supabase solo
  como Postgres gestionado).

CI (`.github/workflows/backend-ci.yml`) levanta su propio Postgres, aplica las migraciones de
`supabase/migrations/` y corre lint + build + test + test:e2e en cada push a `main` y en cada
Pull Request (un push a tu propia rama de feature, sin abrir/actualizar un PR, no lo dispara).
