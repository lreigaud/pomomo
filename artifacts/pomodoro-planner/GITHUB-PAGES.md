# Use pomomo as a GitHub Pages website

The Android app and website use the same source code. No Android Studio, Java,
Expo Go, backend server, or API keys are needed to use the published website.

## One-time setup

1. Upload the **whole repository**, not just `artifacts/pomodoro-planner`.
   Include `.github/workflows/github-pages.yml`, `pnpm-lock.yaml`,
   `pnpm-workspace.yaml`, the root `package.json`, and workspace libraries.
   Do not upload `node_modules`, credentials, signing keys, or local `.env` files.
2. In GitHub, open your repository's **Settings → Pages**.
3. Under **Build and deployment → Source**, select **GitHub Actions**.
4. Push to `main` or `master`. If the upload happened before enabling Pages,
   open **Actions → Publish pomomo website → Run workflow**.
5. Once the workflow succeeds, open the website link under **Settings → Pages**.

For a normal project repository, the link is typically
`https://USERNAME.github.io/REPOSITORY/`. The workflow detects the correct base
path, including account sites and custom domains. Do not manually edit paths.
Future pushes to `main` or `master` rebuild the website automatically.
For another default branch, change `branches` in the workflow.

GitHub Pages must be available for your repository under your GitHub plan.
Enabling a public repository also makes its source code public.

## Website limitations

- Tasks, plans, settings, and history are saved in **this browser on this device**.
  They do not sync with the Android app or other devices. Clearing site data
  removes them. Use a separate browser profile if sharing a device.
- The timer, task management, calendar, and history work in the browser.
- Native Android notifications and lock-screen timer status are **not available**
  on the website. Planned events are saved, but the website does not schedule
  their Android reminders. Keep using Android for reliable background alerts.
- This is a website, not an APK or a guaranteed offline app.

## Build locally (optional)

From the repository root:

```bash
pnpm install --frozen-lockfile
PAGES_BASE_PATH=/YOUR-REPOSITORY pnpm --filter @workspace/pomodoro-planner run build:web
```

For a domain-root site, omit `PAGES_BASE_PATH`. The output is in
`artifacts/pomodoro-planner/dist`. The script temporarily sets Expo's static web
export and URL prefix, then restores `app.json` even if export fails. Do not run
it while editing `app.json` or while a native build is reading that file.

All application routes are exported as HTML so direct links and reloads can
work without a Node server. GitHub Pages serves these through its clean URLs.
The existing Replit/native build commands are unchanged.
