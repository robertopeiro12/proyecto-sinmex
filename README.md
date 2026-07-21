# proyecto-sinmex (JAWA)

Sistema para JAWA, una empresa de distribución de bebidas: **App de Tablet** para
vendedores/repartidores en ruta + **Portal Web** para administración.

> El conocimiento completo del negocio y la arquitectura vive en un vault de Obsidian
> separado, no en este repo. Ver [`CLAUDE.md`](./CLAUDE.md) y, dentro del vault,
> `AGENTS.md` — léelo antes de tocar cualquier tarea de dominio o arquitectura.

## Qué necesitas instalado

- [Node.js](https://nodejs.org/) (LTS) y npm
- [Git](https://git-scm.com/)
- Acceso a la organización de Supabase `IOCUSDEV-PRO` (pídeselo a Roberto si no lo tienes)

## Cómo arrancar

1. **Clona este repo** y, como carpeta **hermana** (mismo nivel, no adentro), el vault de memoria:
   ```
   git clone https://github.com/robertopeiro12/proyecto-sinmex.git
   git clone git@github.com:brg8607/jawa-obsidian-memory.git
   ```
   Deben quedar así, uno junto al otro:
   ```
   Dev/
   ├── proyecto-sinmex/
   └── jawa-obsidian-memory/
   ```

2. **Instala dependencias** (incluye el CLI de Supabase, ya como dependencia del proyecto):
   ```
   cd proyecto-sinmex
   npm install
   ```

3. **Configura tus variables de entorno:**
   ```
   cp .env.example .env.development
   ```
   Llena los valores desde el dashboard de Supabase (proyecto `sinmex dev`, dentro de
   `IOCUSDEV-PRO`):
   - `SUPABASE_URL` y `SUPABASE_ANON_KEY` → **Project Settings → API Keys**
   - `SUPABASE_SERVICE_ROLE_KEY` → misma sección, "secret keys"
   - `DATABASE_URL` → **Project Settings → Database** (o el botón **Connect**), con tu propio
     password (puedes generar uno nuevo si no tienes el original)

   `.env.development` nunca se sube a git — ya está en `.gitignore`.

4. **Conecta el CLI de Supabase a tu cuenta:**
   ```
   npx supabase login
   npx supabase link --project-ref psrxgmyhajbdsriusqvl
   ```

## Estado del proyecto

Stack técnico y decisiones de arquitectura: ver `ADR-0002 Stack tecnológico inicial` en el
vault. El trabajo de implementación se trackea como issues (`T-01`…`T-60`) en este repo,
agrupados en sprints con dependencias explícitas.
