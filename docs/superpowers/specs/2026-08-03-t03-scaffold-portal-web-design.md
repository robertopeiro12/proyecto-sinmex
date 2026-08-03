# T-03 · Scaffolding del Portal Web (Next.js) — Diseño

- **Fecha:** 2026-08-03
- **Issue:** T-03 (proyecto-sinmex)
- **Depende de:** — (nada; solo la convención de monorepo de T-02)
- **Fuente de dominio:** vault `jawa-obsidian-memory` — nota `Portal Web`, `Sucursales`; `ADR-0002` (stack: Next.js + Tailwind/shadcn).

## Objetivo

Crear el **esqueleto del Portal Web**: un proyecto Next.js dentro del monorepo (`apps/portal`) con layout, navegación por las 4 secciones (Operación, Catálogo, Producción, Información) y sus sub-ítems como páginas placeholder. Es el marco donde vivirán las pantallas reales (T-09, T-10, T-12, …). **No** incluye lógica de negocio, datos, ni autenticación.

## Alcance

**Incluye:** proyecto Next.js configurado (TypeScript, Tailwind v4, shadcn/ui), layout con sidebar, árbol de navegación completo con páginas placeholder, un CI de lint+build para el portal, e integración al workspace del monorepo.

**No incluye** (cada uno en su ticket): login/auth (T-06/T-13), conexión a datos/API, cualquier pantalla funcional, y el despliegue en Vercel (diferido — el hosting aún es "propuesto" en ADR-0002).

## Decisiones tomadas (en brainstorming)

- **Sin login** en este scaffold: el portal abre directo en el layout. El login real es T-06 (construirlo ahora sería trabajo desechable).
- **Sub-ítems stubbed**: el sidebar muestra las 4 secciones y sus sub-ítems, cada uno como página placeholder.
- **Vercel diferido**: no se conecta ningún servicio externo; el criterio de "preview en Vercel" queda pendiente hasta que el equipo confirme hosting.
- **CI ahora**: `portal-ci.yml` con lint + build (sin tests; no hay lógica que probar en un scaffold).

## Stack técnico

- **Next.js 15** con **App Router**.
- **TypeScript** (mismo estilo que `apps/backend`: ESLint plano `eslint.config.mjs`).
- **Tailwind CSS v4** + **shadcn/ui** con tema base neutro.
- **Node 22** (igual que el backend).
- Sin gestor de estado ni capa de fetching (no hay datos todavía).

## Árbol de navegación

Derivado de la nota `Portal Web` del vault, con dos ajustes por cambios recientes: **SIG eliminado** (el cliente lo quitó; T-42 cerrado) y **Vendedores** (T-62) + **Almacenes** (T-63) agregados.

```
Operación:   Dashboard · Reporte de Ventas · Procesos · Peticiones · Notificaciones · Ruta Diaria · Ruta Semanal
Catálogo:    Clientes · Vendedores · Vehículos · Productos · Usuarios · Perfiles y Permisos
Producción:  Peticiones · Recarga · Corte · Almacenes
Información:  Reportes · Análisis Cliente · Nómina
```

El índice de cada sección (`/operacion`, `/catalogo`, …) muestra la primera pantalla o una vista de bienvenida de la sección. "Clientes" vive solo en Catálogo (en el vault también aparece como consulta en Operación, pero es la misma entidad; se evita duplicar rutas).

## Estructura de archivos

```
apps/portal/
├── package.json                       # name: "portal" (igual que el backend usa "backend"); scripts dev/build/lint/start
├── next.config.ts
├── tsconfig.json
├── eslint.config.mjs
├── postcss.config.mjs                 # Tailwind v4
├── components.json                    # config shadcn/ui
├── README.md
└── src/
    ├── app/
    │   ├── layout.tsx                 # layout raíz (html, body, fuente)
    │   ├── globals.css                # Tailwind + tokens del tema
    │   ├── page.tsx                   # redirect() a /operacion
    │   └── (portal)/
    │       ├── layout.tsx             # sidebar + navegación; envuelve las 4 secciones
    │       ├── operacion/{page.tsx, reporte-de-ventas/, procesos/, peticiones/, notificaciones/, ruta-diaria/, ruta-semanal/}
    │       ├── catalogo/{page.tsx, clientes/, vendedores/, vehiculos/, productos/, usuarios/, perfiles-y-permisos/}
    │       ├── produccion/{page.tsx, peticiones/, recarga/, corte/, almacenes/}
    │       └── informacion/{page.tsx, reportes/, analisis-cliente/, nomina/}
    ├── components/
    │   ├── ui/                        # componentes shadcn (button, card, …)
    │   └── layout/
    │       ├── nav-config.ts          # árbol de navegación como datos (única fuente de verdad)
    │       └── sidebar-nav.tsx        # lee nav-config.ts y pinta el sidebar
    └── lib/
        └── utils.ts                   # helper cn()
```

Cada página placeholder (sub-ítem) renderiza el mismo componente simple: título de la pantalla + texto "Próximamente", dentro de un `Card` de shadcn para verse consistente.

## Otros archivos

- `.github/workflows/portal-ci.yml` — lint + build del portal (Node 22, `npm ci`, `npm run lint/build --workspace=apps/portal`). Mismo patrón que `backend-ci.yml`.
- `package.json` (raíz) — agregar script `"portal": "npm run dev --workspace=apps/portal"` (junto a `"backend"`).

## Componentes clave

- **`nav-config.ts`**: exporta el árbol como estructura tipada (`{ label, href, children? }[]`), agrupado por las 4 secciones. Única fuente de verdad de la navegación.
- **`sidebar-nav.tsx`**: componente cliente que lee `nav-config.ts`, resalta la ruta activa (usando `usePathname`), y permite expandir/colapsar secciones.
- **`(portal)/layout.tsx`**: estructura de dos columnas (sidebar fijo + área de contenido); server component que renderiza `<SidebarNav />`.

## Verificación

- `npm install` en la raíz enlaza `apps/portal` al workspace sin romper el backend.
- `npm run dev --workspace=apps/portal` levanta el portal; la home redirige a `/operacion`.
- Navegar por el sidebar carga cada página placeholder; la ruta activa se resalta.
- `npm run lint --workspace=apps/portal` y `npm run build --workspace=apps/portal` pasan sin error.
- El CI del portal corre en verde en el PR.

## Pendientes / futuros tickets

- Login y protección de rutas (T-06/T-13).
- Filtro global "Por sucursal" transversal (parte de T-09 en adelante).
- Conexión a la API/datos en cada pantalla (T-09, T-10, T-12, …).
- Despliegue (Vercel u otro) — cuando el equipo confirme hosting (ADR-0002).
