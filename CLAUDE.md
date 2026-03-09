# Proyecto-1 — Web Facturador

Invoice management web app for an accounting studio, with planned ARCA (AFIP) integration for electronic invoice emission in Argentina.

## Tech Stack

**Client:** React 19, TypeScript, Vite, React Router v7, Axios, Supabase JS
**Server:** Node.js, Express, TypeScript, ts-node/nodemon, PDFKit, Supabase JS
**Database/Auth:** Supabase (Postgres + Auth + Row Level Security)

## Project Structure

```
Proyecto-1/
  package.json          # Root: dev/build scripts using concurrently
  client/               # Vite React SPA
    src/
      config/           # supabase.ts client init
      context/          # AuthContext.tsx — global auth state
      services/         # api.ts — axios instance with auth interceptors
      components/       # Layout.tsx, ProtectedRoute.tsx
      pages/            # Dashboard, Clients, Invoices, Login, Register
  server/               # Express API
    src/
      config/           # supabase.ts — anon + user-scoped clients
      middleware/        # auth.ts — JWT verification via Supabase
      routes/           # auth, client, invoice, company routes
      controllers/      # Business logic per resource
      services/         # pdf.service.ts — PDFKit invoice generation
```

## Commands

```bash
# From root
npm run dev          # Start client + server concurrently
npm run dev:client   # Client only (port 5173)
npm run dev:server   # Server only (port 3001, nodemon)
npm run build        # Build both
npm run install:all  # Install root + client + server deps

# From client/
npm run dev
npm run build

# From server/
npm run dev
npm run build
```

## Environment Variables

- `client/.env`: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`
- `server/.env`: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `PORT`

## API Routes

All routes prefixed with `/api`. Auth routes: `/api/auth/{signup,login,me}`. Protected routes (require Bearer token): `/api/clients`, `/api/invoices`, `/api/company`.

## Additional Documentation

- `.claude/docs/architectural_patterns.md` — Auth flow, RLS pattern, controller structure, client API layer
