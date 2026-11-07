# Kuwi app

For app changes, run `pnpm check` from the repository root. Commands, iOS
Simulator testing, and physical-device checks are in [README.md](README.md).

Before closing an issue, follow the acceptance-evidence checklist in
[issue-tracker.md](../../docs/agents/issue-tracker.md#completion-and-review).
Before deploying, follow [Vercel hosting](README.md#vercel-hosting), including
account, project, and preview/production verification.

Before changing an Expo, Expo Router, or React Native API, read the installed
version in `package.json` and consult its matching official documentation.
Use `pnpm --filter @kuwi/app exec expo install <package>` for Expo packages.

Routes live in `src/app/`; keep other modules outside that directory.
The current delivery is a static web app. Native build instructions apply only
when a task explicitly adds a native target.
