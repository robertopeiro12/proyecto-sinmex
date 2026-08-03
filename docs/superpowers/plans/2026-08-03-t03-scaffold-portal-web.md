# T-03 · Scaffold del Portal Web — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Crear el esqueleto del Portal Web (Next.js) en `apps/portal` con layout, navegación de las 4 secciones y páginas placeholder, integrado al monorepo.

**Architecture:** App Router de Next.js 15 con un route group `(portal)` que aplica el layout de sidebar a todas las secciones. La navegación vive como datos en `nav-config.ts` (fuente única) y la pinta `sidebar-nav.tsx`. Cada sub-ítem es una página placeholder que reusa un componente `<Placeholder>`.

**Tech Stack:** Next.js 15 (App Router), TypeScript, Tailwind CSS v4, shadcn/ui, Node 22.

## Global Constraints

- **Ubicación:** todo bajo `apps/portal/` (workspace ya declarado en el `package.json` raíz como `apps/*`).
- **Node 22**, **npm** (mismo que el backend). Sin ORM/datos/auth (fuera de alcance).
- **Nombre del paquete:** `"portal"` (el backend usa `"backend"`).
- **Puerto de dev:** `3001` (el backend usa 3000; evitar colisión).
- **Sin tests unitarios** (scaffold): la verificación es `next build` + `next lint` + render de rutas.
- **No tocar servicios externos** (Vercel diferido). No modificar `apps/backend`.
- **Convención de rutas** (slugs exactos, kebab-case), fuente única en `nav-config.ts`:
  - Operación: `/operacion` (Dashboard), `/operacion/reporte-de-ventas`, `/operacion/procesos`, `/operacion/peticiones`, `/operacion/notificaciones`, `/operacion/ruta-diaria`, `/operacion/ruta-semanal`
  - Catálogo: `/catalogo/clientes`, `/catalogo/vendedores`, `/catalogo/vehiculos`, `/catalogo/productos`, `/catalogo/usuarios`, `/catalogo/perfiles-y-permisos`
  - Producción: `/produccion/peticiones`, `/produccion/recarga`, `/produccion/corte`, `/produccion/almacenes`
  - Información: `/informacion/reportes`, `/informacion/analisis-cliente`, `/informacion/nomina`

---

### Task 1: Proyecto Next.js scaffold + integración al monorepo

**Files:**
- Create: `apps/portal/**` (generado por create-next-app)
- Modify: `apps/portal/package.json` (name, puerto dev)

**Interfaces:**
- Produces: proyecto Next.js buildeable en `apps/portal`, enlazado al workspace.

- [ ] **Step 1: Scaffold con create-next-app (no interactivo)**

Run desde la raíz del repo:
```bash
npx --yes create-next-app@15 apps/portal \
  --ts --tailwind --eslint --app --src-dir \
  --import-alias "@/*" --use-npm --turbopack --disable-git
```
Expected: crea `apps/portal/` con Next.js 15, TypeScript, Tailwind v4, ESLint, `src/`.

- [ ] **Step 2: Ajustar package.json del portal**

En `apps/portal/package.json`: cambiar `"name"` a `"portal"` y el script `dev` para fijar el puerto:
```json
{
  "name": "portal",
  "scripts": {
    "dev": "next dev --turbopack -p 3001",
    "build": "next build",
    "start": "next start -p 3001",
    "lint": "next lint"
  }
}
```
(Conservar el resto de campos y dependencias que generó create-next-app.)

- [ ] **Step 3: Reconciliar el workspace**

Run desde la raíz:
```bash
npm install
```
Expected: instala sin error; `apps/portal` queda enlazado en el workspace.

- [ ] **Step 4: Verificar build**

Run: `npm run build --workspace=apps/portal`
Expected: `next build` termina sin errores.

- [ ] **Step 5: Verificar que el dev server sirve la home**

```bash
npm run dev --workspace=apps/portal &
sleep 8
curl -s -o /dev/null -w "%{http_code}" http://localhost:3001/
kill %1
```
Expected: imprime `200`.

- [ ] **Step 6: Commit**

```bash
git add apps/portal package-lock.json
git commit -m "T-03: scaffold Next.js del portal (apps/portal)"
```

---

### Task 2: shadcn/ui inicializado + componentes base

**Files:**
- Create: `apps/portal/components.json`, `apps/portal/src/lib/utils.ts`, `apps/portal/src/components/ui/button.tsx`, `apps/portal/src/components/ui/card.tsx`

**Interfaces:**
- Consumes: proyecto de Task 1.
- Produces: helper `cn()` en `@/lib/utils`; componentes `Card`, `CardHeader`, `CardTitle`, `CardContent`, `Button` en `@/components/ui/*`.

- [ ] **Step 1: Inicializar shadcn/ui (no interactivo)**

Run desde `apps/portal`:
```bash
cd apps/portal && npx --yes shadcn@latest init -d && cd -
```
Expected: crea `components.json`, `src/lib/utils.ts` (con `cn`), y ajusta `globals.css` con los tokens del tema.

- [ ] **Step 2: Agregar componentes base**

Run desde `apps/portal`:
```bash
cd apps/portal && npx --yes shadcn@latest add button card && cd -
```
Expected: crea `src/components/ui/button.tsx` y `src/components/ui/card.tsx`.

- [ ] **Step 3: Verificar build**

Run: `npm run build --workspace=apps/portal`
Expected: build sin errores.

- [ ] **Step 4: Commit**

```bash
git add apps/portal
git commit -m "T-03: inicializar shadcn/ui + componentes base (button, card)"
```

---

### Task 3: Navegación (config, placeholder, sidebar, layout)

**Files:**
- Create: `apps/portal/src/components/layout/nav-config.ts`
- Create: `apps/portal/src/components/layout/placeholder.tsx`
- Create: `apps/portal/src/components/layout/sidebar-nav.tsx`
- Create: `apps/portal/src/app/(portal)/layout.tsx`

**Interfaces:**
- Consumes: `cn()` (Task 2), `Card*` (Task 2).
- Produces: `navSections` (datos de navegación), componente `<Placeholder title />`, `<SidebarNav />`, y el layout del route group `(portal)`.

- [ ] **Step 1: Crear `nav-config.ts`**

Create `apps/portal/src/components/layout/nav-config.ts`:
```ts
export type NavItem = { label: string; href: string };
export type NavSection = { label: string; items: NavItem[] };

export const navSections: NavSection[] = [
  {
    label: "Operación",
    items: [
      { label: "Dashboard", href: "/operacion" },
      { label: "Reporte de Ventas", href: "/operacion/reporte-de-ventas" },
      { label: "Procesos", href: "/operacion/procesos" },
      { label: "Peticiones", href: "/operacion/peticiones" },
      { label: "Notificaciones", href: "/operacion/notificaciones" },
      { label: "Ruta Diaria", href: "/operacion/ruta-diaria" },
      { label: "Ruta Semanal", href: "/operacion/ruta-semanal" },
    ],
  },
  {
    label: "Catálogo",
    items: [
      { label: "Clientes", href: "/catalogo/clientes" },
      { label: "Vendedores", href: "/catalogo/vendedores" },
      { label: "Vehículos", href: "/catalogo/vehiculos" },
      { label: "Productos", href: "/catalogo/productos" },
      { label: "Usuarios", href: "/catalogo/usuarios" },
      { label: "Perfiles y Permisos", href: "/catalogo/perfiles-y-permisos" },
    ],
  },
  {
    label: "Producción",
    items: [
      { label: "Peticiones", href: "/produccion/peticiones" },
      { label: "Recarga", href: "/produccion/recarga" },
      { label: "Corte", href: "/produccion/corte" },
      { label: "Almacenes", href: "/produccion/almacenes" },
    ],
  },
  {
    label: "Información",
    items: [
      { label: "Reportes", href: "/informacion/reportes" },
      { label: "Análisis Cliente", href: "/informacion/analisis-cliente" },
      { label: "Nómina", href: "/informacion/nomina" },
    ],
  },
];
```

- [ ] **Step 2: Crear el componente `Placeholder`**

Create `apps/portal/src/components/layout/placeholder.tsx`:
```tsx
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function Placeholder({ title }: { title: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-muted-foreground">Próximamente</p>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 3: Crear `sidebar-nav.tsx`**

Create `apps/portal/src/components/layout/sidebar-nav.tsx`:
```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { navSections } from "./nav-config";
import { cn } from "@/lib/utils";

export function SidebarNav() {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-4">
      {navSections.map((section) => (
        <div key={section.label}>
          <p className="px-3 text-xs font-semibold uppercase text-muted-foreground">
            {section.label}
          </p>
          <ul className="mt-1 flex flex-col">
            {section.items.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={cn(
                    "block rounded-md px-3 py-1.5 text-sm hover:bg-accent",
                    pathname === item.href && "bg-accent font-medium",
                  )}
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}
```

- [ ] **Step 4: Crear el layout del route group `(portal)`**

Create `apps/portal/src/app/(portal)/layout.tsx`:
```tsx
import type { ReactNode } from "react";
import { SidebarNav } from "@/components/layout/sidebar-nav";

export default function PortalLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <aside className="w-64 shrink-0 border-r bg-background p-4">
        <div className="mb-6 px-3 text-lg font-bold">JAWA</div>
        <SidebarNav />
      </aside>
      <main className="flex-1 p-8">{children}</main>
    </div>
  );
}
```

- [ ] **Step 5: Verificar build**

Run: `npm run build --workspace=apps/portal`
Expected: build sin errores (aún sin páginas dentro de `(portal)`; el layout compila).

- [ ] **Step 6: Commit**

```bash
git add apps/portal/src
git commit -m "T-03: navegación (nav-config, sidebar, layout del portal, placeholder)"
```

---

### Task 4: Árbol de rutas — home redirect + páginas placeholder

**Files:**
- Modify/Create: `apps/portal/src/app/page.tsx` (redirect)
- Create: las 24 páginas placeholder bajo `apps/portal/src/app/(portal)/...`

**Interfaces:**
- Consumes: `<Placeholder>` (Task 3), layout `(portal)` (Task 3).
- Produces: todas las rutas navegables renderizando su placeholder.

- [ ] **Step 1: Home redirige a /operacion**

Reemplazar el contenido de `apps/portal/src/app/page.tsx` por:
```tsx
import { redirect } from "next/navigation";

export default function Home() {
  redirect("/operacion");
}
```

- [ ] **Step 2: Generar todas las páginas placeholder**

Run desde la raíz del repo (crea cada `page.tsx` con su título):
```bash
cd apps/portal/src/app/'(portal)'

# formato: "ruta|Título"
routes='
operacion|Dashboard
operacion/reporte-de-ventas|Reporte de Ventas
operacion/procesos|Procesos
operacion/peticiones|Peticiones
operacion/notificaciones|Notificaciones
operacion/ruta-diaria|Ruta Diaria
operacion/ruta-semanal|Ruta Semanal
catalogo|Catálogo
catalogo/clientes|Clientes
catalogo/vendedores|Vendedores
catalogo/vehiculos|Vehículos
catalogo/productos|Productos
catalogo/usuarios|Usuarios
catalogo/perfiles-y-permisos|Perfiles y Permisos
produccion|Producción
produccion/peticiones|Peticiones
produccion/recarga|Recarga
produccion/corte|Corte
produccion/almacenes|Almacenes
informacion|Información
informacion/reportes|Reportes
informacion/analisis-cliente|Análisis Cliente
informacion/nomina|Nómina
'

echo "$routes" | while IFS='|' read -r path title; do
  [ -z "$path" ] && continue
  mkdir -p "$path"
  cat > "$path/page.tsx" <<EOF
import { Placeholder } from "@/components/layout/placeholder";

export default function Page() {
  return <Placeholder title="$title" />;
}
EOF
done

cd - >/dev/null
```
Expected: crea 23 archivos `page.tsx` (las secciones índice `operacion/catalogo/produccion/informacion` + sus sub-ítems).

- [ ] **Step 3: Verificar build (todo el árbol compila)**

Run: `npm run build --workspace=apps/portal`
Expected: build lista las rutas generadas, sin errores.

- [ ] **Step 4: Verificar render de rutas clave**

```bash
npm run dev --workspace=apps/portal &
sleep 8
echo "home:"; curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3001/
echo "clientes:"; curl -s http://localhost:3001/catalogo/clientes | grep -o "Clientes" | head -1
echo "nomina:"; curl -s http://localhost:3001/informacion/nomina | grep -o "Nómina" | head -1
kill %1
```
Expected: home `200`; imprime `Clientes` y `Nómina` (el placeholder renderiza el título).

- [ ] **Step 5: Commit**

```bash
git add apps/portal/src/app
git commit -m "T-03: árbol de rutas con páginas placeholder + home redirect"
```

---

### Task 5: CI del portal + script raíz + README

**Files:**
- Create: `.github/workflows/portal-ci.yml`
- Modify: `package.json` (raíz, script `portal`)
- Create: `apps/portal/README.md`

**Interfaces:**
- Consumes: portal buildeable (Tasks 1-4).
- Produces: workflow de CI (lint+build), script `npm run portal`.

- [ ] **Step 1: Crear el workflow de CI**

Create `.github/workflows/portal-ci.yml`:
```yaml
name: Portal CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  lint-and-build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm

      - run: npm ci

      - name: Lint
        run: npm run lint --workspace=apps/portal

      - name: Build
        run: npm run build --workspace=apps/portal
```

- [ ] **Step 2: Agregar script al package.json raíz**

En `package.json` (raíz), en `scripts`, agregar junto a `"backend"`:
```json
"portal": "npm run dev --workspace=apps/portal"
```

- [ ] **Step 3: README del portal**

Create `apps/portal/README.md`:
```markdown
# Portal Web (JAWA)

Portal de administración (Next.js). Scaffold de T-03: layout, navegación y páginas placeholder.

## Desarrollo

Desde la raíz del repo:

```
npm run portal        # levanta el portal en http://localhost:3001
```

Estructura: App Router en `src/app/`, navegación en `src/components/layout/nav-config.ts`.
Las pantallas reales se agregan en sus tickets (T-09, T-10, T-12, …).
```

- [ ] **Step 4: Verificar lint + build (como el CI)**

Run:
```bash
npm run lint --workspace=apps/portal
npm run build --workspace=apps/portal
```
Expected: ambos sin errores.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/portal-ci.yml package.json apps/portal/README.md
git commit -m "T-03: CI del portal (lint+build) + script raíz + README"
```

---

### Task 6: Cierre — verificación completa y PR

**Files:** (ninguno nuevo)

- [ ] **Step 1: Verificación limpia**

```bash
npm ci
npm run lint --workspace=apps/portal
npm run build --workspace=apps/portal
```
Expected: instala y ambos pasan sin errores.

- [ ] **Step 2: Smoke manual de navegación (opcional pero recomendado)**

```bash
npm run dev --workspace=apps/portal &
sleep 8
for r in / /operacion /catalogo/clientes /produccion/almacenes /informacion/nomina; do
  echo "$r -> $(curl -s -o /dev/null -w "%{http_code}" http://localhost:3001$r)"
done
kill %1
```
Expected: `/` responde 200/307 (redirect) y las demás 200.

- [ ] **Step 3: Push + PR**

```bash
git push -u origin feature/t-03-portal
gh pr create --title "T-03 · Scaffold del Portal Web" \
  --body "Scaffold del Portal Web (Next.js + Tailwind + shadcn/ui): layout, navegación de las 4 secciones y páginas placeholder + CI. Closes #3."
```
Expected: el PR dispara CI (backend + portal). Revisar verde antes de mergear.

---

## Notas de ejecución

- **`Closes #3`** en inglés para que GitHub cierre el issue al mergear (lección de T-05).
- **create-next-app / shadcn** descargan paquetes (necesitan red), pero **no** necesitan Docker.
- Si `create-next-app` cambia el formato de `eslint`/`next.config` respecto a lo esperado, seguir su salida — lo importante es que `lint` y `build` pasen.
- El portal corre en **:3001** para no chocar con el backend (:3000).
