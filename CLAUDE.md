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
│   ├── portal/    — Next.js (T-03, pendiente)
│   └── tablet/    — React Native/Expo (T-04, pendiente)
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
npm run lint --workspace=apps/backend
npm run build --workspace=apps/backend
npm test --workspace=apps/backend
npm run test:e2e --workspace=apps/backend      # pruebas end-to-end (requieren Postgres real)
npm run db:types --workspace=apps/backend      # regenera apps/backend/src/database/schema.d.ts desde la BD local
npm run crear-usuario --workspace=apps/backend # da de alta un usuario del portal (input interactivo)
```

Health check una vez levantado: `GET http://localhost:3000/health`.

**Requisitos de entorno para lo anterior:**
- `JWT_SECRET` en `.env.development` (raíz del repo) — el backend no arranca sin ella. Genera una
  con `openssl rand -base64 32`.
- Para `test`, `test:e2e` y `db:types`: el stack local de Supabase arriba (`colima start` +
  `npm run supabase start`) y un `.env.test` en la raíz con `DATABASE_URL` (al Postgres local) y
  `JWT_SECRET`. `db:types` filtra con `--include-pattern='public.*'` para no traerse las tablas
  internas de Supabase (`auth.*`, `storage.*`, etc.), que contradicen el ADR-0002 (Supabase solo
  como Postgres gestionado).

CI (`.github/workflows/backend-ci.yml`) levanta su propio Postgres, aplica las migraciones de
`supabase/migrations/` y corre lint + build + test + test:e2e en cada push a `main` y en cada
Pull Request (un push a tu propia rama de feature, sin abrir/actualizar un PR, no lo dispara).
