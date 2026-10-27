# pomomo

A local-first Pomodoro planner with task session goals, weekday recurrence, and browsable focus history.

## Run & Operate

- `pnpm --filter @workspace/pomodoro-planner run typecheck` — check the mobile app
- `node --test artifacts/pomodoro-planner/tests/*.test.cjs` — local startup, storage, and notification regression checks
- The managed `artifacts/pomodoro-planner: expo` workflow runs the mobile preview
- `pnpm --filter @workspace/api-server run dev` — run the shared API server (unused by the mobile app)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- The mobile app does not require a database or external API credentials

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Mobile: Expo Router, React Native, AsyncStorage, Inter, react-native-svg
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/pomodoro-planner/store/FocusContext.tsx` — tasks, completed sessions, and timestamp-based timer persistence
- `artifacts/pomodoro-planner/app/(tabs)/` — Focus, Tasks, and Progress screens
- `artifacts/pomodoro-planner/app/task.tsx` — task creation/editing and recurrence
- `artifacts/pomodoro-planner/constants/colors.ts` — light/dark mobile palette

## Architecture decisions

- Keep the first build local-first; no cloud accounts or server-side features were requested. Task and session history are stored on the device.
- A repeating goal is a new goal on each scheduled day. A one-time goal counts all sessions until its target is reached.
- Timer deadlines are persisted as timestamps so backgrounding the app does not pause elapsed time. A completed session is recorded when the app can process its deadline.
- Archiving preserves history rather than deleting completed sessions.

## Product

- 25-minute focus sessions linked to a task, followed by a 5-minute break
- Per-task session goals and daily, weekday, or individually selected weekly days
- Task creation, editing, archiving, and restoring
- Weekly bars, monthly activity calendar, task breakdowns, and previous-period navigation

## User preferences

See project memory for the requested delivery target.

## Gotchas

- Use managed workflows, not a bare Expo start command.
- Keep the Expo managed sign-in step and static `app.json` configuration intact.
- Startup shows a system-font loading screen. Font loading remains gated, with an eight-second fallback; late font completion must not remount navigation or the state provider.
- A failed or stalled initial storage read keeps navigation and writes blocked and offers retry. Never replace unread saved history with empty defaults.
- Phone alerts are opt-in. Local notifications handle completion sound/vibration when the screen is locked, while timestamps reconcile progress on resume.
- The Android running notification displays the session and finish time, not a native live seconds countdown. Phone notification, volume, and battery settings affect delivery.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
