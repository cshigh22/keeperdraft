# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Development
npm run dev          # Next.js dev server (port 3000)
npm run dev:all      # Next.js + Socket.IO server concurrently (use this for full local dev)

# Build & Lint
npm run build
npm run lint

# Database
npm run db:generate  # Regenerate Prisma client after schema changes
npm run db:push      # Push schema changes without creating a migration
npm run db:migrate   # Create a migration and apply it
npm run db:studio    # Open Prisma Studio (GUI for inspecting data)
npm run db:seed      # Seed NFL players from Sleeper API + demo data
```

## Architecture

KeeperDraft is a fantasy football keeper-league draft management app. It has two server processes:

1. **Next.js** (port 3000) — App Router, Server Actions, NextAuth v5 (Google OAuth)
2. **Socket.IO server** (port 3001) — standalone Node.js process for real-time draft coordination

### Key architectural boundaries

- **Server Actions** (`src/app/actions/`) handle all DB mutations (keepers, trades, teams, rosters, marketplace, champions).
- **Socket.IO** (`src/server/socket-server.ts`) handles real-time events: draft picks, timers, trade proposals/responses. The `DraftStateManager` (`src/server/draft-state-manager.ts`) keeps an in-memory draft state cache on the Socket.IO server and syncs to the DB.
- **Hooks** (`src/hooks/useDraftSocket.ts`, `useGlobalSocket.ts`) connect React components to the Socket.IO server.

### Data flow

```
User Action → Server Action (DB write) + Socket.IO emit
           → All clients receive event → Optimistic UI update
```

Trades can happen globally (outside of draft) via `GlobalTradeNotifier` and `useGlobalSocket`. During a draft they also flow through the Socket.IO server.

### Core domain models

| Model | Purpose |
|---|---|
| `League` | Container for a season; has commissioner, teams, settings |
| `Team` | A manager's team within a league; has roster, draft queue, picks |
| `Player` | NFL player seeded from Sleeper API |
| `DraftPick` | A specific pick slot (round/number); can be traded |
| `DraftState` | Single row per league tracking live draft status, current pick, timer |
| `DraftSettings` | Snake/linear/auction type, timer, roster slots, max keepers |
| `PlayerRoster` | Join table: player↔team with keeper/acquisition metadata |
| `Trade` | Negotiation with status machine (PENDING→ACCEPTED→PROCESSING→COMPLETED) |
| `TradeAsset` | Players or picks in a trade |
| `TradeBlockEntry` | Public trade availability signal per phase (PRE_DRAFT/DRAFT) |
| `PastWinner` | Hall of Champions records per season |
| `LeagueRumor` | Rumor mill entries for the Marketplace tab |

### Pages & components

- `/leagues/[leagueId]` — League dashboard: Hall of Champions, Marketplace (trade block + rumors), settings
- `/leagues/[leagueId]/keepers` — Keeper selection UI
- `/draft` — Main draft room: `DraftBoard`, `PlayerPool`, `PlayerQueue`, `DraftTimer`, `SidebarRoster`, `TeamRosters`, `TradeModal`

### Auth

NextAuth v5 with Google OAuth. `middleware.ts` redirects unauthenticated users to `/login`. Commissioner-only actions are verified server-side.

### Environment variables

```
DATABASE_URL
AUTH_SECRET
AUTH_GOOGLE_ID
AUTH_GOOGLE_SECRET
NEXT_PUBLIC_APP_URL
NEXT_PUBLIC_SOCKET_URL   # e.g. http://localhost:3001
SOCKET_PORT              # default 3001
NODE_ENV
```
