# T-19 · Asignar factura a notas de ventas (Portal) — Diseño

**Issue:** [#19](https://github.com/robertopeiro12/proyecto-sinmex/issues/19)
**Fecha:** 2026-10-07 · **Estado:** propuesto, pendiente de revisión de Roberto
**Base:** `Status de venta.md`, `Venta-Nota.md` y `Ventas y Cobranza.md` del vault; spec de T-17 parte 2.

## 1. Para qué

Fuente (`Sistema Jawa (fuente).md`, Registrar Operaciones):

> **Factura** (por default debe venir seleccionado "N/A" pero la otra opción a elegir es "pendiente" que
> significa que está pendiente por asignarle número de factura que posteriormente se le asignará en la
> opción 5. Asignar factura a notas de ventas).

Y (`Nuevo Sistema Jawa Sinmex Julio 2027 (fuente).md`):

> **Nota de venta ≠ factura.** La nota de venta no tiene valor fiscal […]; la factura sí (programa avalado
> por SAT; **una factura puede agrupar varias notas**). Algunos clientes piden factura mensual de lo consumido.

La factura se emite **fuera** de JAWA, en el programa del SAT. JAWA solo **registra su número** en las
ventas que ampara, para saber qué falta de facturar y para los reportes (columna "Factura" de Estadísticas).

### Lo que T-19 ya no tiene que hacer

El issue pide además "los 5 status y su efecto" y "Promoción → venta y comisión en $0":

- **Los 5 status ya existen** y se asignan solos: alta en tablet (T-16) y portal (T-17): contado → `pagada`,
  crédito → `pendiente`, $0 → `promocion`; cobro parcial → `abonado` (T-20); `cuenta_perdida` desde el
  portal (T-17 parte 2). Se dejan comprobados por las pruebas existentes y se anota en el issue.
- **El efecto en flujo de efectivo y en cuentas por cobrar** es de los módulos que aún no existen (T-22
  CxC, T-32 Flujo de Efectivo). **La comisión $0 de Promoción** es de T-45 (cálculo de comisión). Se deja
  una nota en cada uno de esos issues y T-19 se cierra con esta entrega.

## 2. Decisiones de producto (Roberto, 2026-10-07)

| Tema | Decisión |
|---|---|
| Cómo se asigna | **Varias ventas de un jalón**: cliente → marcar ventas → teclear el número |
| Corregir | Se puede **cambiar el número** y **quitar ventas** de una factura (regresan a "pendiente"). Se guarda quién y cuándo |
| Qué ventas | Primero las `pendiente`; con "Mostrar también las N/A" se incluyen las `N/A`. **Promoción nunca** |
| Número repetido | Un número es de **un solo cliente**: usar `A780` en otro cliente **se rechaza**. Al mismo cliente sí se le pueden sumar ventas después |
| Modelo | **Tabla `factura`** a la que apuntan las ventas (opción B) |
| Editar una facturada | **No se edita**: hay que quitarla primero de la factura (como con los abonos). Así el monto de algo ya facturado nunca cambia sin que alguien lo decida a propósito |

## 3. Base de datos (una migración)

`supabase/migrations/20261007140000_factura.sql`:

```sql
create table factura (
  id                          uuid primary key default gen_random_uuid(),
  numero                      text not null
                                check (char_length(btrim(numero)) between 1 and 30),
  cliente_id                  uuid not null references cliente(id),
  creado_por_usuario_id       uuid not null references usuario(id),
  creado_en                   timestamptz not null default now(),
  actualizado_por_usuario_id  uuid references usuario(id),
  actualizado_en              timestamptz,
  -- Para la llave compuesta de venta_nota: la venta y su factura son del mismo cliente.
  unique (id, cliente_id)
);

-- Un número es de un solo cliente: A780, a780 y " A780 " son la misma factura.
create unique index uq_factura_numero on factura (lower(btrim(numero)));

alter table venta_nota
  add column factura_id                      uuid,
  add column factura_asignada_por_usuario_id uuid references usuario(id),
  add column factura_asignada_en             timestamptz,
  add constraint fk_venta_nota_factura
    foreign key (factura_id, cliente_id) references factura (id, cliente_id);

-- `factura` era texto libre y nullable desde T-05. Hoy solo hay N/A y pendiente (y null en
-- filas viejas, que el lector ya trataba como N/A).
update venta_nota set factura = 'N/A' where factura is null;
alter table venta_nota
  alter column factura set default 'N/A',
  alter column factura set not null,
  add constraint ck_venta_nota_factura
    check (factura in ('N/A', 'pendiente', 'facturada')),
  -- "facturada" si y solo si apunta a una factura.
  add constraint ck_venta_nota_factura_id
    check ((factura = 'facturada') = (factura_id is not null));

create index idx_venta_nota_factura on venta_nota (factura_id) where factura_id is not null;
create index idx_venta_nota_por_facturar on venta_nota (cliente_id)
  where factura = 'pendiente' and deleted_at is null;

insert into permiso (clave, grupo, descripcion) values
  ('venta.asignar_factura', 'Operacion Comercial', 'Asignar factura a notas de ventas')
on conflict (clave) do nothing;
```

- **La llave compuesta `(factura_id, cliente_id)`** hace que la base, y no el servicio, impida que una
  venta apunte a la factura de otro cliente. Con `factura_id` null no se comprueba (MATCH SIMPLE).
- **Ventas viejas:** nada que migrar más allá del `null → 'N/A'`.
- **La tablet no cambia:** sigue mandando `N/A`/`pendiente` (contrato §6) y nunca recibe la factura en el
  `pull`. `facturada` solo lo escribe el portal.
- **Pre-flight para `sinmex dev`** (por los dos checks y el `not null`): contar filas con
  `factura not in ('N/A', 'pendiente')` **sin contar null** → debe dar 0.
- **Una factura sin ventas se borra** en la misma transacción que la deja vacía (servicio, no trigger:
  es una sola ruta de código y se prueba en e2e).

## 4. Backend

Archivos nuevos en `modules/ventas-cobranza/`: `facturas.controller.ts`, `facturas.service.ts`,
`facturas.repository.ts`, `facturas.ts` (reglas puras), `dto/*-factura.dto.ts`. Todos los endpoints llevan
`@RequierePermiso('venta.asignar_factura')`, lectura incluida (como `usuario.gestionar`): es una pantalla
de una sola tarea. El alcance por sucursal se resuelve como en ventas (`exigirAlcanceSobre` contra la
sucursal del cliente ya leída).

| Endpoint | Qué hace |
|---|---|
| `GET /facturas/por-facturar?clienteId=&incluirNA=` | Ventas vivas del cliente que se pueden facturar: `factura = 'pendiente'` (y `'N/A'` con `incluirNA=true`), `status <> 'promocion'`, `deleted_at is null`. Fecha, folio, # de nota, monto, status. Orden por fecha y folio |
| `POST /facturas/asignar` `{ clienteId, numero, ventaIds[] }` | Asigna. 1–200 ventas |
| `GET /facturas?numero=&clienteId=` | Busca facturas (número exacto sin mayúsculas/espacios, o todas las del cliente), cada una con sus ventas y su total |
| `PATCH /facturas/:id` `{ numero }` | Cambia el número |
| `POST /facturas/:id/quitar` `{ ventaIds[] }` | Quita ventas; regresan a `pendiente`. Si la factura queda vacía, se borra |

### 4.1 Asignar — una transacción

1. Lee el cliente y exige alcance. Normaliza `numero` (`trim`, 1–30 caracteres).
2. **Bloquea las ventas** `for update`, filtrando por `id in ventaIds`.
3. Cada venta debe estar viva, ser de `clienteId`, no ser `promocion` y tener `factura in ('N/A', 'pendiente')`.
   Si alguna no cumple → **409 y no se asigna ninguna**:
   - otra factura: *"La venta TJ… ya está en la factura A780."*
   - otro cliente, eliminada o inexistente: *"La venta TJ… no se puede facturar."*
   - promoción: *"La venta TJ… es de promoción ($0): no se factura."*
4. Busca la factura por `lower(btrim(numero))`:
   - **existe y es del cliente** → se suman las ventas;
   - **existe y es de otro** → 409 *"La factura A780 ya está asignada a Cobach XXI."*;
   - **no existe** → `insert`. Si choca con `uq_factura_numero` (otro usuario la creó en ese instante),
     el `23505` se traduce **después del rollback** releyendo la factura (mismo patrón que la colisión de
     folio): si es de otro cliente, el 409 de arriba; si es del mismo, 409 *"Otro usuario acaba de crear
     esa factura; vuelve a intentar."*.
5. `update venta_nota set factura = 'facturada', factura_id, factura_asignada_por_usuario_id, factura_asignada_en = now()`.

### 4.2 Cambiar número

Bloquea la factura `for update`. Si el número nuevo es de **otra** factura → 409 (si es de otro cliente, el
mismo mensaje de 4.1; si es del mismo cliente, *"El cliente ya tiene la factura A780: quita estas ventas y
asígnalas a esa."*, para no fusionar facturas a escondidas). Guarda `actualizado_por_usuario_id`/`_en`.
Choque con `uq_factura_numero` → mismo tratamiento.

### 4.3 Quitar ventas

Bloquea la factura y las ventas. Cada venta debe pertenecer a esa factura (si no, 409 y nada cambia). Las
pasa a `factura = 'pendiente'`, `factura_id = null` y limpia `factura_asignada_*`. Si la factura queda sin
ventas, la borra.

### 4.4 Cambios en lo que ya existe

- **Detalle de venta** (`GET /ventas/:id`): `factura` sigue siendo `N/A`/`pendiente`/`facturada` y se
  agrega `facturaNumero: string | null` (join a `factura`).
- **Editar** (`PATCH /ventas/:id`): una venta `facturada` **no se edita**. `bloqueoDeEdicion` la rechaza
  con 409 *"Está en la factura A780: quítala primero de la factura para editarla."*, igual que con los
  abonos, y el detalle la marca `editable: false` con ese motivo. El DTO sigue aceptando solo
  `N/A`/`pendiente`, así que la edición nunca puede borrar un número. Esto resuelve el pendiente que T-17
  dejó en el issue #19.
- **Cuenta perdida** sí se permite en una venta facturada: no cambia montos ni productos.
- **Eliminar** (`DELETE /ventas/:id`): una venta `facturada` → 409 *"Está en la factura A780: quítala
  primero de la factura."* Así ninguna factura apunta a una venta borrada.
- **Push de la tablet:** sin cambios. Un reenvío nunca toca una venta ya proyectada.

## 5. Portal

Ruta nueva **`/operacion/facturas`**, entrada **"Facturas"** en Operación de `nav-config.ts`, después de
"Ventas". Sin el permiso, la pantalla dice "No tienes permiso para asignar facturas".

### 5.1 Asignar

- Buscador de cliente (el mismo `BuscadorCliente`).
- Tabla de ventas por facturar: casilla, fecha, folio, # de nota ("—" si no tiene), monto y status. Casilla
  "Seleccionar todas" y casilla **"Mostrar también las N/A"**.
- Campo **Número de factura** (≤ 30) y el **total de lo marcado** a la vista. Botón **Asignar**, deshabilitado
  sin ventas marcadas o sin número.
- Al asignar: mensaje *"Factura A780 asignada a 4 ventas ($1,234.00)"* y la tabla se recarga.

### 5.2 Buscar y corregir

- Búsqueda por **número** o por **cliente**. Cada factura muestra número, cliente, quién la registró, sus
  ventas (fecha, folio, monto) y el total.
- **Cambiar número:** campo en línea + Guardar.
- **Quitar:** casillas en sus ventas + botón "Quitar de la factura" (confirmación). Si se quitan todas, se
  avisa que la factura desaparece.

### 5.3 Cambios en pantallas existentes

- **Detalle de venta:** "Factura: A780" cuando está facturada.
- **Editar venta:** una venta facturada no muestra el botón Editar; en su lugar, el motivo que manda el
  servidor (mismo mecanismo que `motivoNoEditable` de T-17). `condicionesDeVenta` deja de convertir
  valores desconocidos a `N/A`.
- **Eliminar** recibe el 409 del servidor y lo muestra como cualquier otro.

## 6. Lo que NO entra

- Emitir la factura ni conectarse al SAT: la factura se hace en el programa externo.
- Datos fiscales (RFC, monto facturado, IVA, fecha de la factura). Solo el número.
- Llenar "pendiente" solo a partir del campo `cliente.factura` (¿requiere factura?). Hoy no se usa al
  capturar; si se quiere, es otro ticket.
- Efectos en CxC, flujo y comisión (T-22, T-32, T-45).
- Reportes por factura (T-49).

## 7. Pruebas

- **pgTAP** (`99_factura_test.sql`): número único sin mayúsculas/espacios; check `facturada ⇔ factura_id`;
  valores de `factura` fuera de los tres → error; la llave compuesta rechaza apuntar a la factura de otro
  cliente; `factura` ya no acepta null; existe el permiso `venta.asignar_factura`.
- **Unitarias** (`facturas.spec.ts`): normalizar número; qué ventas se pueden facturar y con qué mensaje.
- **e2e** (`facturas.e2e-spec.ts`): asignar varias; sumar a una existente del mismo cliente; rechazar
  número de otro cliente; rechazar si una de las ventas ya tiene factura / es promoción / es de otro
  cliente / está eliminada (y que **ninguna** quede asignada); `incluirNA`; cambiar número (y sus dos
  rechazos); quitar algunas y quitar todas (la factura se borra); sin permiso → 403; alcance por sucursal.
  En `ventas-editar.e2e-spec.ts`: editar una facturada → 409 y no cambia nada; eliminar una facturada →
  409; marcar cuenta perdida en una facturada sí entra; el detalle trae `facturaNumero` y `editable: false`.
- **Portal** (vitest): pantalla de asignar (payload, seleccionar todas, N/A, total, mensaje), buscar y
  corregir, y detalle/edición de una venta facturada.
- **Manual:** en el navegador contra el Postgres **local** (no `sinmex dev`).

## 8. Riesgos y notas

- **Editar una venta facturada está bloqueado** (decisión de Roberto al revisar, 2026-10-07). Si en la
  práctica estorba, se relaja en `bloqueoDeEdicion` sin tocar la base.
- El permiso nace sin perfil, como todos: solo lo tiene el Administrador General hasta que se configure la
  matriz (T-08b).
- La migración agrega checks y un `not null`: el protocolo de `CLAUDE.md` pide pre-flight en la nube (§3).
