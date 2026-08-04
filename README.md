# Team Capacity Planner

A dependency-free browser application for planning weekly employee capacity across projects and project subtasks.

## Management capabilities

The weekly planner remains the primary scheduling surface. The integrated Management Workspace adds:

1. A department roster with the reporting hierarchy DM → ADM → Estimator. A Lead is an estimator who owns a project, not a roster role.
2. Role-scoped action-item permissions:
   - DM: all action-item data.
   - ADM: action items owned by their reporting group.
   - Project lead: action items for projects they own, assignable to estimators under the same ADM.
   - Estimator: read-only list access, plus self-assignment and updates to their active work.
3. Separate Projects and Unutilized sections in the action-item list.
4. Required estimated-hour budgets, plus WBS and IO charging references.
5. Self-assignment and manager-to-direct-report delegation using buttons or drag-and-drop targets.
6. Persistent completion percentages across releases and employee handoffs.
7. Additive employee work logs and automatic task gain/loss calculations against the estimated budget.
8. Timestamped task notes that preserve the author and completion percentage at the time of the note.
9. Project-level rollups of completed action-item gains and losses.
10. E&I as the cross-discipline group; project assignment templates still default to each employee's primary group.

Additional workflow defaults:

- Every employee starts with 40 weekly hours of capacity. Over-allocation is allowed and highlighted.
- New action items default to WBS `110803`.
- Electrical project work defaults to IO `1507`.
- Instrumentation project work defaults to IO `1509`.
- Unutilized work defaults to IO `1511`.
- Every project receives 28 procedure activities extracted from `2025 Estimating schedule activities and claiming.xlsx`, plus seven Electrical and three Instrumentation takeoffs.
- Estimator and project-lead views focus on actionable work and planning hours. Manager views include the full portfolio, people, roster, and activity surfaces.
- Estimators are warned when their rolling three-week action plan is below 120 remaining hours.

The existing operational dashboard, project portfolio, employee profiles, leave approvals, weekly check-ins, goals, one-on-ones, assignment responses, alerts, and activity history remain available.

Roster members can be removed directly from the Roster page. Removal hides them from active planning, releases unfinished work, preserves history, and provides a Restore action.

## Run locally

ES modules must be served over HTTP. From this folder, use any static server, for example:

```powershell
python -m http.server 8000
```

Then open `http://localhost:8000/main.html`.

## Verify changes

Node.js 20 or newer is recommended.

```powershell
npm test
npm run check
```

The application itself has no runtime package dependencies.

## Data and sharing

- Planner data always autosaves in the current browser.
- When deployed with the included Azure Function, changes also save to one shared team workspace and every open browser checks for newer data every 30 seconds.
- The header shows **Team current**, **Saving to team**, **Team sync offline**, or **Sync conflict**. **Data → Refresh team data** performs an on-demand check.
- Concurrent saves use ETags. A newer team save is never silently overwritten; the browser preserves the conflicting local copy so it can be exported before refresh.
- The **Working as** selector applies the selected roster member's permissions throughout the Management Workspace.
- If no saved roster exists, `data/roster.csv` is loaded automatically. Required columns are Name, Role, and Group; Reports To and Email are optional but recommended.
- `data/roster-template.csv` demonstrates DM, ADM, and Estimator rows and their reporting relationships.
- PTO and leave requests open `https://rp.kiewit.com/#/`.
- Task notes can be removed by the note author or a manager/project lead with access to the task.
- JSON export is the durable backup and transfer format.
- A snapshot link contains a point-in-time copy of the planner. It does **not** remain synchronized after it is opened.
- CSV export is intended for reporting and downstream analysis.

## Collaboration and authentication

The frontend checks Azure Static Web Apps `/.auth/me` and a portable `/api/me` fallback. When a verified email matches the roster, the local identity selector is locked. On GitHub Pages and local development, **Working as** provides workflow-level behavior only; it is not authentication.

The included `/api/workspace` Function is the production shared-data boundary. It reads the Microsoft principal supplied by Azure Static Web Apps, matches the email to the active roster, validates role/reporting scope on every update, stores the normalized workspace in Azure Blob Storage, and uses optimistic concurrency.

GitHub Pages cannot run this Function and therefore remains local-only. See [DEPLOYMENT.md](./DEPLOYMENT.md) for the Azure resource request, settings, deployment fields, pilot procedure, and production hardening path.
