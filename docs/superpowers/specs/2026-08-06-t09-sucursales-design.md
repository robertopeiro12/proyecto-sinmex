# T-09 · Catálogo de Sucursales + filtro global "Por sucursal"

- **Issue:** [#9](https://github.com/robertopeiro12/proyecto-sinmex/issues/9) — Sprint 3
- **Depende de:** T-05 (esquema base) y T-03 (scaffold del portal), ambos hechos
- **Fecha:** 2026-08-06
- **Producto:** Portal Web + Backend

## Objetivo

Que el administrador pueda dar de alta y editar sucursales, y que el portal ofrezca un selector
"Por sucursal / todas" que un usuario **General** pueda mover libremente, mientras un usuario
atado a una sucursal queda restringido a la suya.

Sucursal es un **catálogo dinámico**, no una lista fija: hoy operan Tijuana (TJ) y Mexicali (MX),
pero el cliente confirmó que abrirán más. Ver `10-Dominio/Entidades/Sucursal.md` y
`10-Dominio/Reglas/Sucursales.md` en el vault.

## Alcance

### Dentro

1. Restricción de formato del `codigo` de sucursal en la base.
2. Módulo `sucursales` en el backend: listar, crear, editar.
3. Pantalla `/catalogo/sucursales` en el portal (tabla + alta/edición en diálogo).
4. Selector "Por sucursal" en la barra superior, con su estado en la URL.
5. Regla de alcance por usuario (`General` vs. atado a una sucursal), aplicada en el servidor.

### Fuera, a propósito

| Qué | Por qué |
|---|---|
| Permisos finos sobre quién administra sucursales | Es T-08. Hoy basta el guard global: los endpoints exigen sesión válida. Se agrega `sucursal.gestionar` a los criterios de T-08. |
| Cablear el filtro a Dashboard, Reportes, Rutas, etc. | Esas pantallas son placeholders sin datos. T-09 deja el mecanismo y el contrato; cada ticket lo consume cuando tenga qué filtrar. |
| Pruebas automatizadas del portal | El portal **no tiene** infraestructura de pruebas (sin archivos de prueba, sin config, sin script `test`; su CI corre solo lint + build). Montarla es un ticket propio, no se cuela aquí. |
| Componentes genéricos de catálogo reutilizables | Se escribe concreto. La abstracción se extrae en T-10, con dos casos reales a la vista en vez de uno inventado. |

## Decisiones

### D1 — El estado del filtro vive en la URL

`?sucursal=TJ` o `?sucursal=todas`. El selector escribe el query param; quien necesite filtrar lo
lee de `searchParams`; `sidebar-nav.tsx` lo preserva al navegar entre secciones.

**Alternativa descartada:** contexto de React + cookie. Deja la URL limpia y no requiere tocar los
links, pero rompe el caso "mándame el link de esta vista" — real en un portal lleno de reportes y
dashboards — y obliga a sincronizar cookie ↔ contexto para que los server components no rendericen
con un valor viejo.

### D2 — El servidor es la autoridad sobre el alcance, el cliente solo propone

El query param es una preferencia de UI. Toda consulta resuelve la sucursal efectiva en el backend
a partir del usuario autenticado. Un usuario atado a Tijuana que pida Mexicali **no** obtiene datos
de Mexicali, edite la URL a mano o no.

### D3 — Pedir una sucursal fuera de tu alcance responde 403

**Alternativa descartada:** devolver en silencio la sucursal propia. Dejaría al usuario viendo
datos de TJ mientras la pantalla dice MX — confuso de usar y difícil de depurar. El 403 es honesto
y directo de probar.

Pedir `todas` **no** es un caso de 403: no nombra una sucursal ajena, así que un usuario atado que
la pida simplemente recibe la suya. El 403 se reserva para pedir una sucursal concreta que no te
toca.

En la práctica el caso casi no ocurre: a un usuario atado, el selector le aparece fijo en su
sucursal y el portal no genera esas URLs. Un 403 aquí significa URL manipulada o marcador viejo.

### D3b — El query param lleva el **código**, no el `id`

`?sucursal=TJ`, no `?sucursal=6f3a…`. El código es legible, estable (D5) y es lo que la gente
reconoce; un uuid en la URL no le dice nada a nadie y hace los links imposibles de escribir a mano.
El backend traduce código → `id` al resolver el alcance. `todas` es un valor reservado y por eso
ningún código de sucursal puede colisionar con él (los códigos son 2 letras mayúsculas).

### D4 — Perfil y sucursal son ejes independientes

El alcance sale del campo `sucursal_id` del usuario (`null` = General), **no** del perfil. Un
"Administrador General" atado a Tijuana puede hacer todo, pero solo sobre Tijuana.

**Alternativa descartada:** cablear "el perfil Administrador General siempre ve todo". No hace
falta — se consigue lo mismo asignándole sucursal General — y cerraría la puerta a un
"administrador general de Mexicali" el día que abran una tercera sucursal. Además el cliente no ha
pedido esa regla, y el vault prohíbe inventar reglas de negocio sin confirmar.

### D5 — El código de sucursal es inmutable tras el alta

Las 2 letras del código abren el folio de cada operación (`TJ260322AP05`, ver
`ADR-0001 Formato de folios`). Cambiarlo dejaría los folios históricos apuntando a un código que ya
no existe, y esos folios no se pueden corregir hacia atrás. `PATCH` acepta `nombre` y `activa`; el
`codigo` no es editable.

### D6 — La baja se expresa solo con `activa`; `deleted_at` no se usa

La tabla tiene ambas columnas. Desde el portal solo se activa/desactiva.

Una sucursal inactiva deja de ofrecerse al asignar usuarios, clientes o vendedores nuevos, pero
sigue apareciendo en el filtro y en los históricos: borrarla rompería ventas y folios ya emitidos.
`deleted_at` se queda en la tabla por consistencia con el resto del esquema, pero ninguna ruta la
escribe.

### D7 — Módulo propio `sucursales/`, fuera de los 12 slugs del vault

Los módulos del backend replican los slugs de dominio del vault (`ventas-cobranza`, `tesoreria`, …).
Sucursal no encaja en ninguno porque los atraviesa todos. Va en
`apps/backend/src/modules/sucursales/` y se anota la excepción en `CLAUDE.md`, para que nadie tenga
que deducir después por qué hay una carpeta que no venía en la lista.

## Base de datos

Una migración nueva, corta:

```sql
alter table sucursal
  add constraint sucursal_codigo_formato check (codigo ~ '^[A-Z]{2}$');
```

Hoy `codigo` es `text not null unique`, sin restricción de forma. El dominio dice que son
exactamente 2 letras mayúsculas. Va como `check` en la base y no solo como validación del
formulario porque el script `crear-usuario`, las semillas y cualquier carga futura entran por
debajo del backend.

Las semillas existentes (`TJ`, `MX`) ya cumplen, así que la migración aplica sin limpieza previa.

**Pruebas pgTAP** (archivo nuevo, se suman a las 39 actuales):

- El check rechaza minúsculas (`tj`), longitud distinta de 2 (`T`, `TIJ`) y dígitos (`T1`).
- El check acepta un código válido nuevo (`GD`).
- `TJ` y `MX` siguen sembradas y activas.

## Backend

### Estructura

`apps/backend/src/modules/sucursales/`, con el molde que ya usa `auth`:

```
sucursales.module.ts
sucursales.controller.ts
sucursales.service.ts
sucursales.repository.ts      — Kysely, tipos de src/database/schema.d.ts
alcance-sucursal.ts           — regla de D2/D3, lógica pura
dto/crear-sucursal.dto.ts
dto/editar-sucursal.dto.ts
```

El módulo se registra en `app.module.ts`. Los DTOs usan `class-validator`, igual que `LoginDto`;
el `ValidationPipe` global de `configurar-app.ts` ya corre con `whitelist: true, transform: true`.

### Endpoints

Todos detrás del guard global (`JwtAuthGuard`): requieren sesión, sin permiso fino (ver T-08).

| Método | Ruta | Cuerpo | Respuesta |
|---|---|---|---|
| `GET` | `/sucursales` | — | Lista de `{ id, codigo, nombre, activa }` |
| `POST` | `/sucursales` | `{ codigo, nombre }` | La sucursal creada, 201 |
| `PATCH` | `/sucursales/:id` | `{ nombre?, activa? }` | La sucursal actualizada |

`GET /sucursales` sirve a dos consumidores: la tabla del catálogo y el selector. Devuelve activas e
inactivas — el catálogo necesita ver las inactivas para poder reactivarlas, y el selector las
filtra del lado del portal.

Un usuario atado a una sucursal recibe de `GET /sucursales` **solo la suya**. Es la aplicación
directa de D2 y lo que hace que el selector le aparezca fijo sin lógica especial en el portal.

`PATCH` sobre una sucursal fuera del alcance del usuario responde **403**, igual que la lectura.

`POST` es el caso raro: crear una sucursal no ocurre "dentro de" ninguna sucursal, así que no hay
alcance que aplicar. Hoy, por tanto, un usuario atado a Tijuana **puede crear** una sucursal nueva
—y acto seguido no verla en su listado—. Es una rareza conocida y aceptada: administrar el catálogo
de sucursales debería exigir permiso, y ese permiso es exactamente `sucursal.gestionar` en T-08.
Inventar aquí una regla provisional (p. ej. "solo los General crean") sería una restricción que
nadie pidió y que T-08 tendría que deshacer.

### Errores

| Situación | Respuesta |
|---|---|
| `codigo` duplicado | **409** con mensaje utilizable ("Ya existe una sucursal con el código TJ") |
| `codigo` mal formado, `nombre` vacío | **400**, del `ValidationPipe` |
| `id` inexistente en `PATCH` | **404** |
| Sucursal fuera del alcance del usuario | **403** (D3) |

El 409 merece nota: la base ya tiene el `unique`, pero sin capturar el error de Postgres
(`23505`) saldría como 500 genérico y el portal no podría decirle nada útil al usuario. El código
detecta el `23505` en vez de consultar antes si el código existe — consultar primero deja una
carrera entre la consulta y el insert.

### La regla de alcance

`alcance-sucursal.ts` expone una función pura. Trabaja con **códigos** en ambos extremos (D3b); la
traducción código → `id` la hace el repositorio después:

```
resolverAlcance(codigoDelUsuario: string | null, codigoPedido: string | null)
  -> { tipo: 'todas' } | { tipo: 'una', codigo: string }   // o lanza 403
```

Aislada y sin base de datos a propósito: es la regla que los 5 catálogos siguientes (T-10, T-11,
T-12, T-13, T-62) van a reutilizar tal cual, y es lógica de decisión pura, así que se prueba
exhaustivamente sin montar Postgres.

Casos:

| Usuario | Pide | Resultado |
|---|---|---|
| General (`null`) | nada | todas |
| General | `todas` | todas |
| General | `TJ` | solo TJ |
| Atado a TJ | nada | solo TJ |
| Atado a TJ | `TJ` | solo TJ |
| Atado a TJ | `todas` | solo TJ (no es escalada: pide más y recibe lo suyo) |
| Atado a TJ | `MX` | **403** |

> **Nota de implementación:** el JWT solo lleva `sub` y `tipo` (decisión de T-06), así que el
> backend no sabe la sucursal del usuario por el token. El service la consulta al resolver el
> alcance: `usuario` por PK con `leftJoin` a `sucursal` para obtener el código — una lectura
> indexada por petición, la misma forma que ya usa `AuthService.buscarUsuarioPorId`. Cachearla o
> meterla en el token es una decisión que corresponde a T-08, cuando el guard tenga que cargar
> también los permisos; no se adelanta aquí.

### Pruebas

- **Unitarias** (`alcance-sucursal.spec.ts`): los 7 casos de la tabla de arriba.
- **End-to-end** (`sucursales.e2e-spec.ts`), contra Postgres real, con **dos usuarios de prueba**:
  uno General y uno atado a Tijuana.
  - Crear una sucursal y verla en el listado.
  - Código duplicado → 409.
  - Código mal formado → 400.
  - `PATCH` de nombre y de `activa`.
  - `PATCH` intentando cambiar el `codigo` → el campo se ignora (`whitelist`), el código no cambia.
  - Sin sesión → 401.
  - Usuario de Tijuana: `GET /sucursales` devuelve solo TJ.
  - Usuario de Tijuana pidiendo `?sucursal=MX` → 403.
  - Usuario de Tijuana pidiendo `?sucursal=todas` → recibe TJ, no 403.
  - Usuario de Tijuana haciendo `PATCH` sobre la sucursal de Mexicali → 403.

El último par es el que justifica los dos usuarios: con uno solo, la regla de alcance queda sin
verificar end-to-end.

## Portal

### Pantalla `/catalogo/sucursales`

- Entrada nueva en `nav-config.ts`, sección **Catálogo**.
- Tabla: código, nombre, estado (activa/inactiva).
- Botón "Nueva sucursal" → diálogo con `codigo` (2 letras, se normaliza a mayúsculas) y `nombre`.
- Editar → mismo diálogo con el código en solo lectura (D5) y un control para `activa`.
- Errores de la API visibles en el formulario: el 409 aparece junto al campo de código, no como
  fallo genérico.

Componentes de shadcn que faltan y hay que agregar: `table`, `input`, `label`, `dialog`.
El portal hoy solo tiene `card` y `button`.

### Selector "Por sucursal"

Vive en la barra superior, junto a `BarraUsuario`.

- Usuario **General**: opciones "Todas", Tijuana, Mexicali (solo las activas). Al elegir, escribe
  `?sucursal=` y navega.
- Usuario **atado**: se muestra su sucursal, sin desplegable. No hay nada que elegir.

La distinción no necesita lógica especial en el portal: `GET /sucursales` ya devuelve una sola
sucursal a un usuario atado, así que el selector muestra desplegable cuando recibe más de una.

### Preservar el filtro al navegar

`sidebar-nav.tsx` arrastra el `?sucursal=` actual a los 24 destinos del menú. Sin esto, el filtro
se pierde al cambiar de sección y el mecanismo no sirve para lo que se construyó.

### Valor por defecto

Sin `?sucursal=` en la URL, la vista es "todas" para un usuario General y su sucursal para un
usuario atado — exactamente lo que devuelve `resolverAlcance` con `sucursalPedida = null`. El
portal no necesita adivinar ni redirigir para poner el param.

### Verificación

Manual, siguiendo los mismos casos que cubren los e2e, con los dos usuarios de prueba. El CI del
portal sigue siendo lint + build (ver "Fuera de alcance").

## Al cerrar

Según el contrato del vault (`CLAUDE.md` → `../jawa-obsidian-memory/AGENTS.md`):

- `10-Dominio/Reglas/Sucursales.md` — el mecanismo del filtro, ya implementado.
- `20-Arquitectura/Portal Web.md` — la sección Catálogo tiene su primera pantalla real.
- `00-Inicio/Estado del proyecto.md` — T-09 hecho, y qué desbloquea (T-62, T-12).
- `CLAUDE.md` del repo — la excepción de la carpeta `sucursales/` (D7).

Y en GitHub: agregar `sucursal.gestionar` a los criterios de aceptación de T-08.

## Criterios de aceptación del issue

| Criterio original | Cómo queda |
|---|---|
| Catálogo dinámico con código de 2 letras; sembrar TJ y MX | Cubierto: CRUD + `check` en la base; semillas ya existen desde T-05 |
| Selector "Por sucursal / todas" transversal | Mecanismo construido y cableado al catálogo. Las demás secciones lo consumen en sus tickets, cuando tengan datos |
| Usuario con sucursal General ve/opera todas | Cubierto (D4), verificado en e2e con dos usuarios |
| Toda consulta operativa respeta el filtro | Parcial por construcción: hoy no existe ninguna consulta operativa. La regla queda en `resolverAlcance`, lista para reutilizarse |
