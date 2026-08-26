# T-08b · Matriz de perfiles y permisos

- **Issue:** [#8](https://github.com/robertopeiro12/proyecto-sinmex/issues/8) — Sprint 3 (mitad
  pendiente; T-08a ya cerró el guard)
- **Depende de:** T-08a (guard de permisos granulares, hecho), T-05 (esquema `perfil`/`permiso`,
  hecho)
- **Fecha:** 2026-08-26
- **Producto:** Backend + Portal Web

## Objetivo

Que un administrador pueda, desde el portal, **crear perfiles nuevos** y **configurar qué
permisos tiene cada uno**, mediante una matriz que muestra el catálogo completo de permisos. Es lo
que T-08a dejó pendiente a propósito (el guard ya exige `@RequierePermiso`, pero los 6 perfiles
semilla siguen sin ninguna fila en `perfil_permiso`) y lo que T-13 (Gestión de Usuarios) necesita
para poder asignar un perfil real a un usuario nuevo.

Ver `10-Dominio/Entidades/Perfil.md` en el vault.

## Alcance

### Dentro

1. Backend: `GET /perfiles` (perfiles + su matriz + catálogo de permisos, todo en una respuesta),
   `POST /perfiles` (alta), `PATCH /perfiles/:id` (renombrar), `DELETE /perfiles/:id` (baja
   lógica), `PATCH /perfiles/:id/permisos` (togglear una celda perfil↔permiso).
2. Permiso nuevo `perfil.gestionar` (grupo `General`), sembrado por migración. Exigido en **los
   cuatro** endpoints (a diferencia de precios/productos/vehículos, aquí ni siquiera la lectura es
   pública — ver D3).
3. Pantalla `/catalogo/perfiles-y-permisos` en el portal, reemplazando el placeholder actual.
4. Pruebas: pgTAP de las protecciones que vive la base, unitarias de las reglas del maestro y del
   bloqueo de baja, e2e de los cuatro endpoints.

### Fuera, a propósito

| Qué | Por qué |
|---|---|
| **Overrides por usuario (`usuario_permiso`)** | Confirmado con Roberto: T-08b es perfiles y su matriz; asignar una excepción a un usuario puntual se hace desde la pantalla de ese usuario, que es **T-13** y todavía no existe. |
| **Alta/edición/baja de la tabla `permiso`** | El catálogo de permisos no es libre: cada clave está ligada a un `@RequierePermiso(...)` real en el código (`sucursal.gestionar`, `precio.gestionar`, etc.). Agregar una fila sin su punto de aplicación en el backend sería un permiso que no hace nada. Sigue sembrándose por migración, un ticket a la vez, como hasta ahora. |
| **La pantalla de Usuarios** | Es T-13. T-08b solo deja el catálogo de perfiles listo para que el desplegable de esa pantalla lo consuma. |
| **Reasignación masiva de usuarios al dar de baja un perfil** | D4 bloquea la baja mientras haya usuarios activos en vez de ofrecer un flujo de reasignación — ese flujo no tiene dónde vivir hasta T-13. |

## Decisiones

### D1 — El código vive en `modules/auth/`, junto al resto del mecanismo de permisos

`Perfil.md` en el vault declara `modulo: nomina-comisiones` en su frontmatter — es la clasificación
de negocio más cercana entre los 12 módulos del cliente, porque "identidad y permisos" no es uno de
esos 12 (ni lo es `Usuario.md` ni `Vendedor.md`, clasificados igual). Pero el **código** de
permisos —`permisos.ts`, `permisos.repository.ts`, `permisos.guard.ts`,
`requiere-permiso.decorator.ts`— ya vive en `apps/backend/src/modules/auth/` desde T-06/T-08a, y
`AuthModule` ya exporta `PermisosRepository`. Crear el CRUD de perfiles ahí, en vez de en un
`modules/nomina-comisiones/` que hoy es un stub vacío sin relación con esto, evita separar el
recurso de la maquinaria que lo consume. Mismo criterio de "el código sigue al mecanismo, no al
frontmatter del vault" que ya aplicó T-09 con `modules/sucursales/`.

> [!info] Nota para el vault, después del merge
> No hace falta tocar el `modulo:` de `Perfil.md` (sigue siendo la mejor clasificación de negocio
> disponible) pero sí vale la pena anotar ahí, como ya hace con el permiso `sucursal.gestionar`
> sembrado en T-08a, que el código de la matriz vive en `apps/backend/src/modules/auth/`.

### D2 — El perfil maestro se protege por nombre en el servicio, no con una columna nueva

`esMaestro()` en `permisos.ts:20-22` ya compara `perfil.nombre === 'Administrador General'` por
igualdad exacta. Agregar una columna `perfil.es_maestro` sería más correcto a largo plazo, pero es
una migración y un cambio a un módulo (T-08a) que ya está cerrado y probado, para resolver un
riesgo que se puede cerrar sin tocarlo: `PerfilesService` reimporta `esMaestro` de `permisos.ts` (no
lo duplica) y lo usa para rechazar, con `409`, cualquier intento de:

- Renombrar el perfil maestro (`PATCH /perfiles/:id` con `nombre` cuando `esMaestro(actual.nombre)`).
- Darlo de baja (`DELETE /perfiles/:id` en las mismas condiciones).
- Togglear una celda suya (`PATCH /perfiles/:id/permisos`) — sería una escritura muerta: el maestro
  nunca consulta `perfil_permiso` (`permisos.repository.ts:43-44` corta antes), así que una fila ahí
  no haría nada. Rechazarlo evita el dato fantasma en vez de dejarlo pasar en silencio.

Los demás 5 perfiles semilla son perfiles normales: se pueden renombrar, togglear y dar de baja sin
ninguna protección especial.

### D3 — `perfil.gestionar` protege lectura Y escritura, a diferencia de precios/productos/vehículos

En T-10/T-11/T-18 el `GET` es público (cualquier sesión) porque el dato (catálogo de productos,
precios) lo necesita más de una pantalla. Aquí no: la matriz completa —qué perfil tiene qué
permiso— es información de seguridad, no un catálogo operativo, y no hay ninguna otra pantalla que
la vaya a consumir todavía. Los cuatro endpoints exigen `@RequierePermiso('perfil.gestionar')`.

Consecuencia en el portal: a diferencia de `PantallaPrecios` (que siempre carga la matriz y solo
oculta el editor), `PantallaPerfiles` comprueba `puede('perfil.gestionar')` **antes** de llamar a la
API y, si es falso, muestra un mensaje ("No tienes permiso para ver esta sección") en vez de
disparar un `GET` que sabe de antemano que va a volver `403`.

### D4 — Dar de baja un perfil se bloquea si tiene usuarios activos asignados

`usuario.perfil_id` no tiene `on delete` especial y la baja de un perfil es lógica (`deleted_at`;
`perfil` no tiene columna `activo` como `vehiculo`/`producto`/`sucursal` — ver Modelo de datos), así
que Postgres no impide nada por sí solo — y `permisosDe()` filtra `perfil.deleted_at is null` en su
join (`permisos.repository.ts:29`), así que un usuario con un perfil dado de baja pasaría a tener
**cero permisos** sin ningún aviso. `PerfilesService.darDeBaja()` (`DELETE /perfiles/:id`) cuenta
primero `usuario` activos (`deleted_at is null`) con ese `perfil_id`; si hay al menos uno, `409`
antes de tocar la fila. Hay que reasignarlos primero — ese flujo de reasignación no tiene pantalla
propia hasta T-13, así que por ahora significa hacerlo a mano en la base si hiciera falta.

### D5 — Orientación de la matriz: permisos en filas, perfiles en columnas

Los permisos crecen con cada ticket que agrega un `@RequierePermiso` nuevo (van 22 desde T-05, más
2 agregados después); los perfiles son ~6 y crecen poco. Filas = permisos (agrupadas con un
subtítulo por `grupo`, en el orden fijo `General → Operacion Comercial → Produccion/Almacen →
Informacion`, el mismo de la semilla) y columnas = perfiles + una columna final de alta. Agregar un
permiso nuevo en un ticket futuro es una fila más sin tocar el layout; agregar un perfil es una
columna más, con scroll horizontal si hace falta, que es el caso menos frecuente.

### D6 — Sin `PantallaCatalogo`, mismo criterio que T-18

No es alta/edición de una entidad por fila con formulario modal — es una grilla de checkboxes. Se
construye como pantalla propia en `components/perfiles/`, reusando `useEnvioFormulario` para el
estado de guardado de cada celda, igual que `CeldaPrecio`.

### D7 — Un perfil nuevo nace sin ningún permiso

`POST /perfiles` solo recibe `{ nombre }` y no inserta ninguna fila en `perfil_permiso`: el
administrador los marca después en la matriz, celda por celda. Evita inventar un "perfil base" o
copiar permisos de otro perfil sin que el negocio lo haya pedido.

## Modelo de datos

Sin migraciones de esquema — `perfil`, `permiso`, `perfil_permiso` ya existen desde T-05
(`20260803163003_identidad_y_permisos.sql`) y no cambian de forma:

```sql
create table perfil (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  nombre text not null unique
);

create table permiso (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  clave text not null unique,
  grupo text not null,
  descripcion text
);

create table perfil_permiso (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  perfil_id uuid not null references perfil(id),
  permiso_id uuid not null references permiso(id),
  unique (perfil_id, permiso_id)
);
```

Migración nueva de T-08b — solo la semilla del permiso:

```sql
insert into permiso (clave, grupo, descripcion) values
  ('perfil.gestionar', 'General', 'Crear perfiles y configurar su matriz de permisos')
on conflict (clave) do nothing;
```

El Administrador General lo hereda automático (`permisos.repository.ts:43-44`), sin fila en
`perfil_permiso`.

## Endpoints

Todos bajo `@RequierePermiso('perfil.gestionar')` (D3).

| Método | Ruta | Body | Notas |
|---|---|---|---|
| `GET` | `/perfiles` | — | `{ permisos: PermisoDto[], perfiles: PerfilDto[] }` — ver forma abajo. Una sola llamada, para que la matriz se pinte de una sin condiciones de carrera entre catálogo y asignaciones. |
| `POST` | `/perfiles` | `{ nombre }` | Alta sin permisos (D7). `409` si el nombre ya existe (unique de `perfil.nombre`, mismo criterio `esDuplicado()`/`23505` que T-09/T-10/T-11). |
| `PATCH` | `/perfiles/:id` | `{ nombre }` | Solo renombra. `409` si `id` es el maestro (D2). `409` si el nuevo `nombre` ya existe. |
| `DELETE` | `/perfiles/:id` | — | Baja lógica (`deleted_at`; `perfil` no tiene columna `activo`, ver Modelo de datos). `409` si `id` es el maestro (D2). `409` si hay usuarios activos con ese perfil (D4). Primer `@Delete` del backend — hasta ahora toda baja de otras entidades viajaba como `PATCH { activo: false }`, pero `perfil` no tiene esa columna que togglear. |
| `PATCH` | `/perfiles/:id/permisos` | `{ permisoId, habilitado }` | Upsert (si `habilitado: true`) o baja lógica (si `false`) de la fila en `perfil_permiso`, sobre el unique `(perfil_id, permiso_id)` — mismo criterio "la base decide" que T-09/T-10/T-11/T-14/T-18. `409` si `id` es el maestro (D2). `404` si `permisoId` no existe. |

### Forma de `GET /perfiles`

```json
{
  "permisos": [
    { "id": "uuid", "clave": "producto.gestionar", "grupo": "General", "descripcion": "..." }
  ],
  "perfiles": [
    { "id": "uuid", "nombre": "Administrador General", "esMaestro": true, "permisos": ["producto.gestionar", "sucursal.gestionar", "..."] },
    { "id": "uuid", "nombre": "Jefe de Ventas", "esMaestro": false, "permisos": ["venta.registrar", "..."] }
  ]
}
```

`esMaestro` sale de reusar `esMaestro()` de `permisos.ts` sobre `perfil.nombre` — no se duplica la
regla. Para el maestro, `permisos` no se calcula consultando `perfil_permiso` (siempre está vacío
para él): el backend manda el catálogo completo de claves, igual que `permisosDe()` ya hace para la
sesión. El portal usa esa lista para pintar su columna toda marcada y deshabilitada.

## Archivos

### Backend — `apps/backend/src/modules/auth/`

| Archivo | Qué hace |
|---|---|
| `perfiles.repository.ts` | `catalogoPermisos()`, `listarPerfiles()`, `listarAsignaciones()` (las tres piezas del `GET`), `crear(nombre)`, `buscarPorId(id)`, `renombrar(id, nombre)`, `contarUsuariosActivos(perfilId)`, `darDeBaja(id)`, `togglePermiso(perfilId, permisoId, habilitado)` (upsert/baja lógica sobre el unique). |
| `perfiles.service.ts` | Las reglas de D2/D4: reimporta `esMaestro` de `permisos.ts`, rechaza operaciones sobre el maestro, cuenta usuarios activos antes de dar de baja. Mapea `23505` a `409` (nombre duplicado) y `buscar()` vacío a `404` (perfil/permiso inexistente). |
| `perfiles.controller.ts` | Los cinco endpoints. |
| `dto/crear-perfil.dto.ts` | `nombre` (string, 1–80, recortado como `EditarVehiculoDto`). |
| `dto/editar-perfil.dto.ts` | `nombre` (string, 1–80, recortado; único campo — a diferencia de `EditarVehiculoDto`, aquí no hay un segundo campo opcional porque la baja es su propio `DELETE`). |
| `dto/actualizar-permiso-perfil.dto.ts` | `permisoId` (uuid), `habilitado` (boolean). |
| `auth.module.ts` | Registra `PerfilesController`, `PerfilesService`, `PerfilesRepository`. |

### Portal — `apps/portal/src/`

| Archivo | Qué hace |
|---|---|
| `lib/perfiles.ts` | Tipos `Permiso`, `Perfil`, y `obtenerPerfiles()`, `crearPerfil(nombre)`, `editarPerfil(id, cambios)`, `togglePermiso(perfilId, permisoId, habilitado)`. |
| `components/perfiles/pantalla-perfiles.tsx` | Comprueba `puede('perfil.gestionar')` (D3); si no, mensaje. Si sí, carga `GET /perfiles` y arma la matriz. |
| `components/perfiles/celda-permiso.tsx` | Checkbox por celda; `onChange` dispara `togglePermiso` vía `useEnvioFormulario`; deshabilitado y siempre marcado en la columna del maestro. |
| `components/perfiles/columna-perfil.tsx` | Encabezado de columna: nombre editable inline (excepto el maestro) + control de baja (deshabilitado con tooltip si `contarUsuariosActivos` — el backend igual valida, ver D4). |
| `app/(portal)/catalogo/perfiles-y-permisos/page.tsx` | Deja de ser placeholder. |

## Pruebas

| Capa | Qué se prueba |
|---|---|
| **pgTAP** | El permiso `perfil.gestionar` queda sembrado · el unique `(perfil_id, permiso_id)` rechaza una fila duplicada. |
| **Unitarias** | `PerfilesService`: rechaza renombrar/dar de baja/togglear sobre el perfil cuyo nombre es `'Administrador General'` · rechaza la baja cuando `contarUsuariosActivos` devuelve > 0 · la permite cuando devuelve 0. |
| **e2e** (`perfiles.e2e-spec.ts`) | `GET /perfiles` sin `perfil.gestionar` → `403` · con el permiso, devuelve catálogo + perfiles con sus claves · `POST` crea un perfil sin permisos · `POST` con nombre repetido → `409` · `PATCH .../permisos` togglea una celda y una segunda llamada la revierte · `PATCH` (renombrar) y `DELETE` sobre el maestro → `409` en los dos casos, y `PATCH .../permisos` sobre el maestro → `409` también · `DELETE` con un usuario activo asignado → `409`; sin usuarios → `200`/`204` y el perfil deja de aparecer en `GET`. |
| **Portal** | Sin pruebas de pantalla propias, mismo gap conocido del resto del portal. |

### Verificación manual (Playwright, Postgres **local**)

Nunca contra `sinmex dev`. Checklist:

1. Sin `perfil.gestionar`: entrar a `/catalogo/perfiles-y-permisos` muestra el mensaje de permiso,
   sin llamar a la API (confirmar en la pestaña de red).
2. Con el permiso: ver la matriz con los 6 perfiles semilla como columnas, la del maestro toda
   marcada y deshabilitada, las demás vacías (sin datos sembrados por T-08b).
3. Marcar una celda de un perfil normal → refrescar → sigue marcada.
4. Desmarcarla → refrescar → sigue vacía.
5. Intentar renombrar "Administrador General" → error, y confirmar en la base que el nombre no
   cambió.
6. Crear un perfil nuevo → aparece como columna nueva, sin ninguna celda marcada.
7. Asignar (a mano, en la base local) ese perfil nuevo a un usuario de prueba, marcarlo activo, e
   intentar darlo de baja desde el portal → error. Dar de baja al usuario de prueba primero →
   ahora sí se puede dar de baja el perfil.

## Después del merge

- **Actualizar el vault:**
  - `10-Dominio/Entidades/Perfil.md` — cerrar el `[!info]` que dice "la configurará él en T-08b" y
    anotar dónde vive el código (D1).
  - `00-Inicio/Estado del proyecto.md` — fila de T-08 (se cierra del todo) y la tabla de "próximos
    pasos", que hoy marca T-13 como bloqueado por "falta T-08b".
