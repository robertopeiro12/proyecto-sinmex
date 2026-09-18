# Foto del prospecto: captura, subida y visualización

**Fecha:** 2026-09-18
**Cierra:** el criterio incumplido de T-40 (issue #40) — *"Foto opcional solo si no ralentiza la captura"*
**Decisiones previas que este diseño consume:** ADR-0010 (equipos personales), `Despliegue y topología` (archivos en el disco del backend), ADR-0006 (contrato del `push`)

## El problema

T-40 entregó el alta de prospectos sin foto porque no existía dónde guardarla. El cliente la pidió
condicionada: *"me gustaría que tomaran foto, repito, **si esto no se hace lento**"*.

Esa condición es la que manda todo el diseño. En ruta **no hay red**. Subir la foto al tomarla
dejaría al vendedor esperando frente al negocio, que es exactamente lo que el cliente quiere evitar.

## Las tres decisiones de fondo

### 1. La foto se sube en el `sync`, no al capturarla

Se toma, se comprime y se guarda **en el equipo**. Viaja cuando el equipo sincroniza, ya en el WiFi
del negocio. Costo en campo: **cero**.

### 2. Va por un canal aparte del lote del `push`

> [!danger] Esto no es una preferencia de diseño, es un requisito de corrección
> El contrato de ADR-0006 es JSON por lotes y **cada operación se acepta o se rechaza entera**. Si la
> foto viajara dentro de la operación del prospecto, una imagen pesada o una subida a medias
> **rechazaría el alta completa** — se perdería un cliente potencial por no poder subir algo que es
> **opcional**.

De ahí la forma que pidió Mario: **un botón, dos requests**. El botón guarda en local; la
sincronización manda el lote y, aparte, la foto.

### 3. El archivo vive en el disco del backend

Ni `bytea` ni Supabase Storage. Decisión de Mario del 2026-09-18, documentada en
`Despliegue y topología`, que además cierra el alcance de Supabase en **solo Postgres**.

## Arquitectura

```
Equipo del vendedor                      Servidor
───────────────────                      ────────
[Guardar prospecto]  ← un solo botón
   │
   ├─ prospecto  → cola de operaciones ──push──→  lote JSON → cliente (tipo='prospecto')
   │                                                   │
   └─ foto       → archivo local + foto_uri            │ el servidor acepta y devuelve la clave
                        │                              ▼
                        └────── request aparte ──→ POST /sync/foto/:clave
                           (solo si el prospecto            │
                            ya fue aceptado)                ├─→ <FOTOS_DIR>/<clave>.jpg
                                                            └─→ cliente.foto_archivo
```

### Idempotencia: sale gratis, no se inventa nada

La `clave` de la URL es **la misma llave de idempotencia** que ya identifica la operación del
prospecto (el uuid v4 que la tablet genera al capturarlo). El archivo en disco se llama
`<clave>.jpg`.

Consecuencia: **reenviar escribe el mismo nombre**. No hay duplicados posibles, no hace falta un
identificador nuevo, ni un contador, ni una tabla de control. La idempotencia es una propiedad de
cómo se nombra el archivo, no código que haya que mantener.

### Orden obligatorio: la foto va después de que el prospecto fue aceptado

Antes de que el servidor acepte la operación, **no existe la fila `cliente` a la que la foto
pertenece**. Así que la foto solo es elegible para subir cuando su prospecto ya está sincronizado —
estado que la tablet **ya registra**, sin banderas nuevas.

Si llega una foto con una `clave` que el servidor no conoce, o cuya operación fue rechazada,
responde `404`/`409` y la tablet la deja pendiente.

### Aislamiento del fallo

| Qué falla | Qué pasa |
|---|---|
| El `push` del prospecto | La foto ni se intenta. Sigue en el equipo. |
| La subida de la foto | Se anota el error **en los campos de foto de esa fila**. El estado del prospecto **no se toca**. Reintenta en la siguiente sincronización. |
| El archivo local desapareció | Se marca como no recuperable y se deja de reintentar. Un prospecto sin foto es válido. |

**Un prospecto sin foto es un prospecto completo.** La foto puede llegar tarde, o no llegar nunca.

## Componentes

### Backend

**Migración** — dos columnas nulables en `cliente`, **sin tabla nueva**: con el archivo en disco no
hay bytes que aislar.

```sql
alter table cliente add column foto_archivo text;
alter table cliente add column foto_subida_en timestamptz;
```

**`POST /sync/foto/:clave`** — auth de vendedor (`Bearer`, el mismo guard que `push`).
- Resuelve `clave` → `sync_operacion` → el `cliente.id` que creó.
- Rechaza si la operación no existe, no es de tipo `prospecto`, o no fue aceptada.
- Rechaza si el vendedor del token **no es** quien subió esa operación.
- Límite de tamaño: **2 MB** (holgura sobre los ~300 KB esperados). Rechaza con `413`.
- Valida que el contenido **sea** JPEG, no solo que lo diga el `Content-Type`.
- Escribe `<FOTOS_DIR>/<clave>.jpg` y actualiza las dos columnas.

**`GET /clientes/:id/foto`** — auth de portal (cookie). Sirve el archivo. `404` si no tiene.

**Sin códigos de rechazo nuevos en `CODIGOS_RECHAZO`.** El canal de la foto no es el lote, así que le
bastan los códigos HTTP. Esto además **evita un conflicto con T-20**, que está modificando esa lista.

**`FOTOS_DIR`** es configuración (variable de entorno), con default para desarrollo. El directorio se
crea si no existe.

### Tablet

- **Captura opcional** en el alta de prospecto. Si el vendedor no toma foto, nada cambia.
- **Compresión en el equipo** antes de guardar. Objetivo: **≤300 KB**. Redimensionar el lado mayor a
  ~1600 px y bajar calidad. *La combinación exacta se mide en implementación; el objetivo es el
  número, no la receta.*
- **Estado de subida en la fila del prospecto** (`foto_uri` ya existe): cuándo se subió y el último
  error. **Sin tabla nueva.**
- **Paso nuevo en el motor de sincronización**, después del `push`: sube las fotos de prospectos ya
  sincronizados que aún no la tienen arriba.

### Portal

La foto se muestra donde el administrador ya ve al prospecto, en `components/clientes/`. Miniatura en
la lista o en el detalle; ampliable. Si el prospecto no tiene foto, no se dibuja un hueco.

## Pruebas

- **Tablet:** que la foto no se ofrezca antes de que el prospecto esté sincronizado; que un fallo de
  subida **no** cambie el estado del prospecto; que un reenvío use la misma clave; que un prospecto
  sin foto siga siendo válido.
- **Backend (e2e):** clave inexistente, operación rechazada, vendedor ajeno, archivo >2 MB, contenido
  que no es JPEG, y que **subir dos veces la misma clave deje un solo archivo**.
- **pgTAP:** las dos columnas nulables.
- **Portal:** prospecto con foto y sin foto.

> [!warning] La prueba que de verdad importa
> Que **una foto que falla no se lleve el prospecto**. Es el fallo que este diseño existe para
> prevenir, y el único cuyo síntoma en producción sería un cliente potencial perdido en silencio.

## Fuera de alcance

- Varias fotos por prospecto. El cliente dijo *"foto del lugar"*, singular.
- Foto para clientes ya convertidos.
- **Respaldo del directorio de fotos.** Es real y está anotado en `Despliegue y topología`: el
  respaldo de la base ya no cubre los archivos. Va con la decisión de hosting, que está en hold.

## Qué invalidaría este diseño

Si algún día se muestran fotos **en lote** (una galería de cientos) o se agregan archivos en más
módulos, servirlos desde el disco del backend deja de ser lo simple y toca reconsiderar Storage o un
CDN. Al volumen de hoy —~500 fotos al año— no pasa.
