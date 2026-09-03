# T-13 · Gestión de Usuarios (CRUD + asignación de permisos)

- **Issue:** [#13](https://github.com/robertopeiro12/proyecto-sinmex/issues/13) — Sprint 4
- **Depende de:** T-08 (permisos granulares, hecho del todo: T-08a + T-08b)
- **Fecha:** 2026-09-03
- **Producto:** Backend + Portal Web

## Objetivo

Que un administrador pueda crear/editar usuarios del **portal web** (no vendedores — T-62 es
aparte): login + contraseña, nombre, perfil, sucursal (o "General"), y personalizar sus permisos
por excepción sobre los del perfil.

Ver `10-Dominio/Entidades/Usuario.md` en el vault. T-08b dejó explícitamente los overrides por
usuario (`usuario_permiso`) para este ticket — el esquema y `PermisosRepository.permisosDe()` ya
existen desde T-05/T-08a, sin tocar.

## Alcance

### Dentro

1. Migración: nuevo permiso `usuario.gestionar` (grupo `General`) + arreglo del `unique` plano de
   `usuario.login` (ver D1 — el mismo bug que T-08b encontró y corrigió en `perfil.nombre`).
2. Módulo de backend en `modules/auth/` (junto a `perfiles.*`/`permisos.*`, mismo criterio que D1
   de T-08b): `GET/POST/PATCH/DELETE /usuarios` + `GET /usuarios/catalogo-perfiles`.
3. Pantalla `/catalogo/usuarios` en el portal (hoy placeholder): alta/edición con contraseña,
   perfil, sucursal y una matriz de permisos con tooltip descriptivo por permiso.
4. Pruebas: pgTAP del índice nuevo, unitarias del cálculo de excepciones, e2e de los cinco
   endpoints + alcance + protecciones, pantalla con Testing Library (patrón T-65).

### Fuera, a propósito

| Qué | Por qué |
|---|---|
| **Pantalla de "cambiar mi propia contraseña"** | Confirmado con Roberto: el admin escribe la contraseña directo en el formulario de alta/edición (igual que `crear-usuario.ts`), sin flujo de "temporal + forzar cambio". Ese flujo es una pieza nueva que no existe hoy en ningún lado del portal. |
| **Vendedores** | Es T-62, entidad separada (`Vendedor` ≠ `Usuario`), con su propia decisión pendiente (desambiguación de folio, `ADR-0007`). |
| **Alta/edición de la tabla `permiso`** | Sigue igual que T-08b la describió: cada clave está ligada a un `@RequierePermiso` real en el código. |
| **Reasignación masiva al dar de baja un perfil** | Sigue siendo D4 de T-08b — esta pantalla no la resuelve; sí deja de estar "sin dónde vivir" para una reasignación manual, uno por uno, si hiciera falta. |

## Decisiones

### D1 — `usuario.login` pasa de `unique` plano a índice parcial, mismo bug que T-08b ya corrigió en `perfil.nombre`

`usuario` (`20260803163003_identidad_y_permisos.sql`) se creó con `login text not null unique`. Es
el mismo problema que documenta `20260826130000_perfil_nombre_baja_libera_nombre.sql`: un `unique`
plano sigue contando filas dadas de baja lógica. T-13 es el **primer** ticket que le da baja lógica
a un `usuario` (`DELETE /usuarios/:id`) — hasta hoy nadie lo había disparado, así que el bug
existía sin síntoma. Sin arreglarlo, dar de baja a alguien con login `jgarcia` reservaría ese login
para siempre, sin ningún camino en la UI para deshacerlo.

```sql
alter table usuario drop constraint usuario_login_key;

create unique index uq_usuario_login
  on usuario (lower(login))
  where deleted_at is null;
```

`lower()` por el mismo motivo que `uq_perfil_nombre`: `JGarcia` y `jgarcia` son el mismo login.

### D2 — Contraseña: obligatoria en alta, opcional en edición, mismo hash que ya usa `crear-usuario.ts`

`POST /usuarios` exige `contrasena` (mínimo 8 caracteres, sin tope superior — argon2id la hashea a
tamaño fijo). `PATCH /usuarios/:id` la vuelve opcional: campo vacío o ausente = "no cambiar";
si viene, se rehashea con el mismo `PasswordService.hashear()` de T-06, sin duplicar lógica. Esto
cierra el hueco que `crear-usuario.ts` dejó anotado en su propio comentario ("Existe porque el CRUD
de usuarios es T-13") — el script sigue existiendo para altas de emergencia sin portal, pero deja
de ser el único camino.

### D3 — Los permisos del formulario son "estado final marcado", no una lista de excepciones

Roberto: mostrar un tercer estado ("Hereda") confundiría al administrador. En vez de eso, cada
checkbox del formulario se **precarga con lo que da el perfil elegido** (marcado si el perfil lo
otorga, vacío si no) y el admin lo cambia como cualquier checkbox normal — nunca ve la palabra
"excepción".

El cliente manda el **estado final completo**: `permisosMarcados: string[]` (ids de `permiso`
marcados en el momento de guardar). El backend calcula la diferencia contra lo que da el perfil
elegido (`PerfilesRepository`, ver D5) y solo persiste en `usuario_permiso` lo que **no coincide**:

- Marcado y el perfil NO lo da → upsert `{ habilitado: true }`.
- Desmarcado y el perfil SÍ lo da → upsert `{ habilitado: false }`.
- Coincide con el perfil (marcado+lo da, o vacío+no lo da) → se borra la excepción si existía (baja
  lógica), o no-op si nunca existió.

Función pura `calcularExcepciones(marcados: Set<string>, delPerfil: string[]): Excepcion[]` en
`modules/auth/calcular-excepciones.ts`, hermana de `combinarPermisos` en `permisos.ts` (de hecho es
su inversa) — se prueba sin base de datos, mismo criterio que ese archivo ya documenta.

### D4 — Perfil maestro (Administrador General): la matriz no aplica, ni se guarda nada

`esMaestro()` (T-08a) ya hace que `permisosDe()` le dé el catálogo completo a quien tenga ese
perfil, sin mirar `usuario_permiso` (`permisos.repository.ts:43`). Si el formulario de alta/edición
tiene el perfil maestro seleccionado, el portal **deshabilita la matriz completa** (todo marcado,
sin poder destocarlo) y el backend, si de todos modos llegara un `permisosMarcados` para un usuario
con perfil maestro, lo **ignora** en vez de escribir excepciones muertas — mismo criterio que D2 de
T-08b usó para `perfil_permiso` del perfil maestro.

### D5 — El desplegable de perfil y la matriz consumen un endpoint propio, no `GET /perfiles`

`GET /perfiles` (T-08b, D3) exige `perfil.gestionar` **a propósito**, porque en ese momento
ninguna otra pantalla lo necesitaba. Ahora sí: el formulario de Usuarios necesita la lista de
perfiles + el catálogo de permisos + qué le da cada perfil, para poder precargar los checkboxes
(D3). Reutilizar `GET /perfiles` obligaría a que quien administra usuarios tenga *también*
`perfil.gestionar` — dos permisos separados a propósito (uno gestiona perfiles, otro usuarios) que
dejarían de poder configurarse por separado.

En vez de eso: `GET /usuarios/catalogo-perfiles`, gateado con `usuario.gestionar` (el mismo permiso
de todo este controlador), que arma la misma forma de datos reutilizando `PerfilesRepository`
(`catalogoPermisos()`, `listarPerfiles()`, `listarAsignaciones()`) sin duplicarla — `PerfilesRepository`
ya vive en `AuthModule` y no necesita exportarse fuera de él, `UsuariosService` está en el mismo
módulo.

### D6 — `usuario.gestionar` gatea los cinco endpoints por igual, lectura incluida

Igual que `perfil.gestionar` en T-08b (D3) y no como Productos/Vehículos/Clientes: el login y las
excepciones de permisos de otros usuarios son información sensible, y ninguna otra pantalla del
portal consume este catálogo. `PantallaUsuarios` comprueba `puede('usuario.gestionar')` **antes**
de llamar a la API (mismo patrón que `PantallaPerfiles`) — si no, muestra el mensaje de "no tienes
permiso" en vez de disparar un `GET` que ya sabe que va a volver `403`.

### D7 — Protecciones: sin auto-baja y sin quedarse sin ningún Administrador General activo

`DELETE /usuarios/:id` responde `409` si:
- `id` es el usuario de la sesión actual (`UsuarioActual`).
- Sería el último usuario activo con perfil `Administrador General` (`esMaestro`).

`PATCH /usuarios/:id` responde `409` con el mismo segundo motivo si el cambio le quita el perfil
maestro al último que lo tenía. La cuenta ("¿queda alguien más con ese perfil, activo?") se hace
sobre `usuario` filtrando `perfil_id` + `deleted_at is null`, análoga a
`PerfilesRepository.contarUsuariosActivos()` de T-08b pero acotada al perfil maestro.

### D8 — Alcance por sucursal, mismo `resolverAlcance()` de T-09, sin variación

Un usuario atado a una sucursal solo lista/gestiona usuarios de su propia sucursal (incluye
"General" como sucursal ajena — no la ve). Un usuario General puede listar todas, filtrar por una,
y elegir libremente la sucursal (o `null` = General) al dar de alta o editar.

A diferencia de Cliente/Vehículo (T-11/T-12, sucursal inmutable tras el alta), aquí **sí** se puede
reasignar: alguien puede cambiar de sucursal físicamente sin dejar de ser el mismo usuario del
portal. `sucursalId` viaja también en el `PATCH`. La regla de acceso es la misma en los dos
extremos: la sucursal actual del usuario editado y la sucursal destino deben estar dentro del
alcance de quien edita — si cualquiera de las dos queda fuera, `403` (mismo criterio que
`ClientesService.editar` para la sucursal actual; el destino es la variación propia de T-13, porque
aquí sí se permite moverlo). Un usuario General puede mover a cualquiera a cualquier sucursal o a
General; un usuario atado a una sucursal ni ve ni puede mover usuarios de/hacia otra.

### D9 — Ícono de información por permiso usa `permiso.descripcion`, ya sembrado

Sin dato nuevo: `permiso.descripcion` existe desde T-05 con textos como "Registrar/editar/eliminar
productos". `GET /usuarios/catalogo-perfiles` ya lo trae (viene incluido en
`PerfilesRepository.catalogoPermisos()`). El ícono ⓘ junto a cada fila de la matriz muestra ese
texto en un tooltip al hacer hover — sin pantalla ni endpoint aparte.

### D10 — Alta y edición son un solo `POST`/`PATCH`, misma reconciliación de permisos en la transacción

Igual que T-10/T-12: el payload trae los campos base + `permisosMarcados` en una sola llamada. El
`POST`/`PATCH` de usuario, la escritura de `usuario_permiso` (D3) y — en el alta — el hasheo de
contraseña ocurren dentro de una única `Kysely.transaction()`.

## Modelo de datos

`usuario`, `usuario_permiso`, `perfil`, `perfil_permiso` y `permiso` ya existen desde T-05/T-08 y
**no cambian de forma** (solo el índice de D1):

```sql
create table usuario (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  login text not null unique,        -- D1: pasa a indice parcial
  password_hash text not null,
  nombre text not null,
  perfil_id uuid not null references perfil(id),
  sucursal_id uuid references sucursal(id)  -- null = General
);

create table usuario_permiso (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  usuario_id uuid not null references usuario(id),
  permiso_id uuid not null references permiso(id),
  habilitado boolean not null
);
```

Migraciones nuevas de T-13:

```sql
-- 1) usuario.login: unique -> indice parcial (D1)
alter table usuario drop constraint usuario_login_key;
create unique index uq_usuario_login
  on usuario (lower(login))
  where deleted_at is null;

-- 2) nuevo permiso (grupo General, mismo patron que sucursal.gestionar/perfil.gestionar)
insert into permiso (clave, grupo, descripcion) values
  ('usuario.gestionar', 'General', 'Crear/editar/dar de baja usuarios del portal')
on conflict (clave) do nothing;
```

## Endpoints

Todos bajo `@RequierePermiso('usuario.gestionar')` a nivel de clase (D6), como `PerfilesController`.

| Método | Ruta | Notas |
|---|---|---|
| `GET` | `/usuarios?sucursal=` | Lista acotada por `resolverAlcance()` (D8). Campos de lista: login, nombre, perfil, sucursal, activo. |
| `GET` | `/usuarios/:id` | Detalle + permisos **efectivos actuales** (`permisosDe()` de T-08a, reutilizado) para precargar la matriz del formulario de edición (D3). |
| `GET` | `/usuarios/catalogo-perfiles` | `{ perfiles: PerfilResumen[]; permisos: Permiso[]; asignaciones: Asignacion[] }` — misma forma que ya arma `PerfilesRepository`, sin exponer el endpoint gateado por `perfil.gestionar` (D5). |
| `POST` | `/usuarios` | `{ login, nombre, contrasena, perfilId, sucursalId: string \| null, permisosMarcados: string[] }`. `409` si el login ya existe (activo). |
| `PATCH` | `/usuarios/:id` | Mismo payload, `contrasena` opcional (D2). `409` en los casos de D7. `403` si la sucursal destino queda fuera del alcance de quien edita (D8). |
| `DELETE` | `/usuarios/:id` | Baja lógica. `409` en los casos de D7. |

## Archivos

### Backend — `apps/backend/src/modules/auth/`

| Archivo | Qué hace |
|---|---|
| `usuarios.repository.ts` | `listar(alcance)`, `obtener(id)`, `crear(...)`, `actualizar(id, ...)`, `darDeBaja(id)`, `contarActivosConPerfil(perfilId)`, `reemplazarExcepciones(usuarioId, excepciones)` (upsert/baja lógica sobre `usuario_permiso`, análogo a `togglePermiso` de `perfiles.repository.ts`). |
| `usuarios.service.ts` | Alcance (`resolverAlcance`), las protecciones de D7, la transacción de D10, mapeo `23505`→409 (login duplicado, vía `esViolacionUnicidad`). |
| `usuarios.controller.ts` | Los cinco endpoints + `GET /usuarios/catalogo-perfiles`. |
| `calcular-excepciones.ts` (+ `.spec.ts`) | Función pura de D3, inversa de `combinarPermisos` (`permisos.ts`). |
| `dto/crear-usuario.dto.ts`, `dto/editar-usuario.dto.ts` | Validación de payloads (`class-validator`, mismo estilo que `dto/crear-cliente.dto.ts`). |
| `auth.module.ts` | Agrega `UsuariosController` a `controllers`, `UsuariosRepository`/`UsuariosService` a `providers` (sin exportarlos — nadie fuera del módulo los necesita). |

### Portal — `apps/portal/src/`

| Archivo | Qué hace |
|---|---|
| `lib/usuarios.ts` | Tipos + `listarUsuarios`, `obtenerUsuario`, `crearUsuario`, `actualizarUsuario`, `eliminarUsuario`, `obtenerCatalogoPerfiles`. |
| `components/usuarios/pantalla-usuarios.tsx` | Chequea `puede('usuario.gestionar')` antes del `GET` (D6, patrón `PantallaPerfiles`); carga lista + `TablaCatalogo`; abre el formulario. |
| `components/usuarios/formulario-usuario.tsx` | Secciones: datos básicos (login, nombre) → contraseña (obligatoria en alta / opcional en edición, D2) → perfil + sucursal → matriz de permisos (checkboxes agrupados por `grupo`, precargados según D3, con ícono ⓘ y tooltip de D9; deshabilitada por completo si el perfil elegido es maestro, D4). |
| `components/usuarios/matriz-permisos-usuario.tsx` | La grilla de checkboxes + tooltip, separada del formulario para no inflarlo (mismo criterio D6 de T-08b sobre `CeldaPermiso`/`ColumnaPerfil`). |
| `app/(portal)/catalogo/usuarios/page.tsx` | Deja de ser placeholder. Lee `searchParams.sucursal`. |

`nav-config.ts` no cambia — la entrada "Usuarios" → `/catalogo/usuarios` ya existe desde T-03.

## Pruebas

| Capa | Qué se prueba |
|---|---|
| **pgTAP** | `uq_usuario_login` rechaza un login duplicado activo · permite reusar el login de un usuario dado de baja · `usuario.gestionar` sembrado. |
| **e2e backend** (`usuarios.e2e-spec.ts`) | Alta/edición/baja completas · contraseña se rehashea solo si viene en `PATCH` · login duplicado → 409 · auto-baja → 409 · baja/edición del último Administrador General activo → 409 (ambos caminos, D7) · un permiso marcado que difiere del perfil crea excepción, uno que coincide no crea/la borra (D3) · perfil maestro ignora `permisosMarcados` (D4) · alcance por sucursal (403 fuera de alcance, patrón T-09/T-10/T-11/T-12) · sin `usuario.gestionar` → 403 incluso en `GET` (D6) · `GET /usuarios/catalogo-perfiles` no exige `perfil.gestionar` (D5). |
| **Unitarias** | `calcular-excepciones.spec.ts`, sin base de datos (patrón T-09 `alcance-sucursal.spec.ts` / `permisos.spec.ts`). |
| **Portal** | `pantalla-usuarios.test.tsx`, Testing Library de integración (patrón T-65): carga con/sin permiso, alta, edición, matriz deshabilitada con perfil maestro, error de servidor. |

### Verificación manual (Playwright, Postgres **local**)

Nunca contra `sinmex dev`. Checklist:

1. Alta de un usuario con perfil "Jefe de Ventas", desmarcando un permiso que el perfil sí da y
   marcando uno que no da → el usuario recién creado tiene exactamente esos permisos efectivos
   (comprobar con `GET /auth/me` iniciando sesión como él, o `GET /usuarios/:id`).
2. Editar ese mismo usuario sin tocar el campo de contraseña → sigue pudiendo iniciar sesión con la
   contraseña original.
3. Editar el campo de contraseña → la anterior deja de funcionar, la nueva sí.
4. Dar de baja ese usuario, crear uno nuevo con el mismo login → funciona (D1).
5. Intentar dar de baja el propio usuario de la sesión → 409, mensaje claro.
6. Con un solo Administrador General en la base, intentar darlo de baja o cambiarle el perfil → 409
   en los dos casos.
7. Elegir perfil "Administrador General" en el formulario → la matriz se deshabilita y muestra todo
   marcado.
8. Un usuario atado a TJ no ve usuarios de MX ni de "General", ni puede asignar esa sucursal al dar
   de alta.
9. Un usuario sin `usuario.gestionar` no ve la pantalla (mensaje de permiso, sin llamar a la API).

## Después del merge

- **Actualizar el vault:**
  - `10-Dominio/Entidades/Usuario.md` — anotar D1 (bug de login duplicado corregido), D3
    (representación del override como checkbox de estado final, no un tercer estado visible), y
    que el permiso `usuario.gestionar` gatea también la lectura (D6).
  - `00-Inicio/Estado del proyecto.md` — fila de T-13. Revisar si desbloquea algo más; T-16 (venta)
    sigue siendo el camino crítico.
