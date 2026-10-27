# Deploy CareerBridge with GitHub, Render and cloud MySQL

This deployment keeps XianFire/Express and MySQL. It does not convert the app to a static site. `render.yaml` is a proposed free demo web service, not an already-created service. Actual provider accounts, database credentials and deployment approval are required.

## Review workflow

1. Review the deployment feature branch and pull request.
2. Merge into `main` only when approved.
3. Connect Render to `lucivandenver/bstm`, branch `main`.
4. Future work stays on feature branches. Render auto-deploys after an approved merge updates `main`; unpublished/local edits do not affect the live site.

Repository source changes live in GitHub. Database data and credentials stay in their services; GitHub pushes do not back up or copy your database.

## Create the cloud database

Create an Aiven for MySQL service on its free plan if available in your account/region. Record the service host, port, database name, username and password privately. Use the database name actually shown by Aiven (often `defaultdb`), not `BSTM` unless you created it. Download the project's CA certificate from the service overview.

Allow the Render service's outbound IP ranges if the database uses an IP allowlist. Choose a nearby region when available. Your local Laragon/MySQL server and phpMyAdmin are not automatically exposed or migrated to the cloud. To retain existing records, separately export the backed-up local database and import it into the chosen cloud database using a compatible MySQL client before switching environments.

## Create the Render service

After the PR is merged, use Render **New > Blueprint** and select the repository containing `render.yaml`. Inspect the plan and confirm the service is Free before creating it. The service must be a Node Web Service, not a Static Site.

The Blueprint uses:

- Node 24, production environment, linked branch `main`.
- Build: `npm ci --omit=dev --ignore-scripts`. The generated Tailwind stylesheet is already in Git.
- Start: `npm run migrate && npm start`. Missing tables are created before startup; the migration never force-syncs. Existing data should be backed up before deploying schema changes.
- Health check: `/healthz`, which returns 200 only when the database is reachable.
- A generated persistent session secret and database-backed sessions.

Enter these environment values through the Render dashboard/Blueprint prompts, not GitHub:

| Variable | Value |
| --- | --- |
| `DB_HOST` | Cloud MySQL service hostname |
| `DB_PORT` | Port shown by the database provider |
| `DB_NAME` | Existing cloud database name |
| `DB_USER` | Cloud database username |
| `DB_PASSWORD` | Cloud database password |
| `DB_SSL` | `true` |
| `DB_SSL_CA` | Full PEM CA certificate, including BEGIN/END lines |
| `GOOGLE_CLIENT_ID` | OAuth Web client ID |
| `GOOGLE_CLIENT_SECRET` | OAuth Web client secret |

Alternatively, store the CA as a Render secret file `aiven-ca.pem`, set `DB_SSL_CA_FILE=/etc/secrets/aiven-ca.pem`, and remove/leave empty `DB_SSL_CA`. If both CA settings exist, the inline value takes precedence. Certificate verification stays enabled. Do not fix certificate errors by disabling verification.

Render supplies its public `RENDER_EXTERNAL_URL`; the app uses it when `APP_URL` is absent. Do not copy `APP_URL=http://localhost:3000`, local DB variables or the local callback URL into the online service. Render controls `PORT`.

Starter courses are not seeded automatically. To add the existing practice content to an empty demo database, temporarily use this start command for one deploy:

```sh
npm run migrate && npm run seed:student && npm start
```

Then restore the normal start command. Seeding does not replace courses, and the material still needs faculty validation.

## Configure Google for the online URL

After Render assigns the actual HTTPS URL, add the following authorised redirect URI to the same Google OAuth Web client in Google Cloud:

```text
https://YOUR-ACTUAL-SERVICE.onrender.com/auth/google/callback
```

Use the real assigned hostname. Keep `http://localhost:3000/auth/google/callback` as an additional URI for local development. If `GOOGLE_REDIRECT_URI` is omitted on Render, the app derives it from the public site URL. If you set it explicitly, it must match the online URI exactly.

The same Google project can support local and online callbacks. Changing hosting alone does not prove the previous sign-in issue is fixed. Retry after deployment and use the fixed diagnostic code/reference if it fails. Add the intended Google accounts as test users while the consent screen is in testing, or complete the provider's publishing requirements.

## Custom domain

You can start with Render's assigned `onrender.com` HTTPS subdomain. A separately owned domain can be added through Render's Custom Domains settings and the DNS records it specifies. Once configured, set `APP_URL=https://your-real-domain.example`, add that domain's Google callback, and update an explicitly configured `GOOGLE_REDIRECT_URI`. Certificate verification links use the configured public URL.

## Smoke checks before sharing the demo

- Deployment logs show the actual HTTPS service URL.
- `/healthz` returns status `ok`; the homepage and local CSS load.
- Google signup, profile saving, course progress and credential downloads work with the cloud database.
- A second deployment retains students, sessions, progress and credentials.
- A proposed feature branch does not affect the deployed `main` branch until approved and merged.
- Logs do not contain passwords, tokens, OAuth JSON, SQL or private profiles.

## Free-plan limits

Render's free web service sleeps after 15 minutes without inbound traffic and may take about a minute to wake. Its local filesystem is ephemeral. Current student records/sessions are in cloud MySQL and generated downloads are streamed; future uploaded course documents will need persistent object storage. Free services and databases have usage/storage limits and are intended for demos/development, not guaranteed production availability. A custom purchased domain has its own registration cost.

Official references:

- https://render.com/docs/free
- https://render.com/docs/web-services
- https://render.com/docs/deploys
- https://render.com/docs/blueprint-spec
- https://render.com/docs/environment-variables
- https://aiven.io/docs/products/mysql/concepts/mysql-free-tier
- https://aiven.io/docs/platform/concepts/tls-ssl-certificates
