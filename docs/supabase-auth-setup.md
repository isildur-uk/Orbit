# Orbit Supabase authentication

The project is linked locally to Supabase project `vjhahnnulqiouthqovdi`.
The client uses only the public project URL and publishable key from
`src/personal-network/supabase-config.js`. Database passwords and service-role
keys must not be added to the repository or shipped to a device.

## Provider setup

In Supabase Dashboard → Authentication → Providers:

1. Enable Google and add the Google OAuth client ID and client secret.
2. In Google Cloud, enable the People API for that OAuth project. Orbit requests
   the read-only `contacts.readonly` scope only when the user chooses Connect
   Google from Connected accounts.
3. Enable Apple after the Apple App ID/Services ID is configured.
4. Enable Facebook only if Facebook is wanted as an Orbit identity provider.

In Authentication → URL Configuration, add the exact Orbit preview URL and the
production URL. The browser build returns to the current Orbit page after the
provider callback. Mobile deep-link redirects will be added when the iOS
identifier and release domain are fixed.

The app buttons are wired to Supabase OAuth. The Google Contacts connection uses
the same Google provider with an additional read-only contacts scope, reads the
Google People API response in memory, and sends normalized candidates through
Orbit's existing review-before-merge queue. Orbit does not write the provider
token into the vault. Until a provider is enabled in the dashboard, it returns
an honest configuration error rather than creating a fake local connection.

## Local checks

```powershell
npx supabase link --project-ref vjhahnnulqiouthqovdi
npx supabase projects api-keys --project-ref vjhahnnulqiouthqovdi
```

The second command can be used to confirm that a public publishable key exists.
Never copy the service-role or database credentials into the client.
