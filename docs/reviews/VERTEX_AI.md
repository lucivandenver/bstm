# Vertex AI course generation

Vertex AI is an optional Admin-selectable provider for faculty course drafting. Gemini and Groq remain available. Career guidance continues using its existing Gemini configuration.

## Render setup

Set `VERTEX_MODEL` to a model enabled for the Google Cloud project. Choose one authentication mode:

### Vertex AI Express Mode

```text
VERTEX_AUTH_MODE=api_key
VERTEX_API_KEY=<private Express Mode API key>
```

### Standard Vertex AI with service account

Use a Render Secret File named `google-credentials.json`, then set:

```text
VERTEX_AUTH_MODE=service_account
VERTEX_PROJECT_ID=<Google Cloud project id>
VERTEX_LOCATION=us-central1
GOOGLE_APPLICATION_CREDENTIALS=/etc/secrets/google-credentials.json
```

Alternatively, store the JSON contents as the private `VERTEX_SERVICE_ACCOUNT_JSON` environment secret. Grant the service account the least permissions needed to call Vertex AI. Never commit credentials or paste them into issues, chat, logs, or screenshots. Redeploy after changing Render environment values or secret files.

## Admin controls

Open Admin > System settings > Course AI providers. Enable Vertex AI, select it as the active course provider, and save. The selected provider applies to new course-generation requests. Existing jobs continue with the provider they started with. The Admin UI shows whether Vertex credentials appear configured, but never exposes their values.

## Verification limits

Automated tests mock the provider HTTP response and validate the Express Mode request. They do not verify a live Google Cloud token exchange, model permissions, quota, Render secret-file mount, or production course-generation request. Validate those on a staging service before production use.
