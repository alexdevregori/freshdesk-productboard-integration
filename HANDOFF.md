# Handoff Notes

Original author: Alex Degregori (leaving Productboard). This document covers how to **access** everything the integration depends on, how to **maintain** it, and what state it's in.

> Items marked **TODO (Alex)** need to be filled in before handoff.

---

## 1. Access: where everything lives

This is a **public Freshworks Marketplace app** owned and maintained by Productboard. Customers install it themselves from the Marketplace and enter their **own** Freshdesk API key and Productboard API token at install time. Productboard doesn't hold or manage any shared credentials for it.

| What | Where | How to get access |
|---|---|---|
| Source code | <https://github.com/alexdevregori/freshdesk-productboard-integration> | Currently on Alex's **personal** GitHub account. **TODO (Alex):** transfer it to the Productboard GitHub org (Settings → Danger Zone → Transfer) before leaving. |
| Marketplace listing (public) | <https://www.freshworks.com/apps/productboard_2/> | The customer-facing page where people install the app. |
| Freshworks Developer Portal (publisher account) | <https://developers.freshworks.com/> | Where new versions are uploaded and submitted for Marketplace review, and where the listing (description, screenshots, support contact) is edited. Alex is currently adding the new owner here (in progress as of Oct 2026). **TODO (Alex):** put the new owner's name here once that's done. |
| Support contact on the listing | Developer Portal → listing details | If the listing's support email or contact points at Alex, change it to a team address. |
| Freshdesk + Productboard test accounts | — | Needed for local testing with `fdk run`. There's no permanent sandbox. Alex tested with a personal Freshdesk trial, which will expire and goes away when Alex leaves. New maintainers should create their own [Freshdesk free trial](https://www.freshworks.com/freshdesk/signup/) and use any Productboard workspace where they're an admin to generate an API token. |

## 2. Maintenance

### Day-to-day

The app has no backend, cron jobs, or database to run. It's a static sidebar app hosted by Freshworks inside each customer's Freshdesk. All HTTP calls go through Freshworks request templates using that customer's own tokens. Maintenance mostly means **reacting to platform/API changes**, **shipping fixes**, and **answering customer support questions**.

### Shipping a new version to the Marketplace

1. Set up locally (see [README → Local development](README.md#local-development)).
2. Edit code, then test against a real ticket with `fdk run` + `?dev=true`.
3. `fdk validate` must pass with no errors. Marketplace review rejects apps that have validation errors.
4. `fdk pack` → `dist/freshdesk-productboard-integration.zip`.
5. In the Freshworks Developer Portal, open the app → **new version** → upload the zip → add release notes → **submit for review**. Freshworks reviews public app versions before they go live, which can take several days.
6. Once approved, the new version is rolled out to installed customers. **Be careful changing `config/iparams.json`:** renaming, removing, or retyping a field can affect existing installs. Test an upgrade from the currently published version before submitting.

### Things that will need attention over time

| Trigger | What to do |
|---|---|
| **Freshworks platform / FDK upgrades** | Freshworks periodically deprecates platform versions and Node versions. The app is on platform **3.0**, Node **24.11.0**, FDK **10.1.9** (`manifest.json` → `engines`). When notified, bump these, run `fdk validate`, and fix any reported issues. |
| **Productboard API changes** | The app uses Productboard **API v2** (`/v2/notes`, `/v2/entities`, `/v2/entities/fields/tags/values`). Templates are in `config/requests.json` and payload shapes are in `buildNoteBody()`, `createProductboardUser()`, and `createProductboardTag()` in `app/scripts/app.js`. The auto-create-on-missing logic depends on error codes `resource.notFound` and `selectOption.notFound` (`getMissingResources()`), so watch for changes there. |
| **Freshdesk API changes** | Only one endpoint is used: `GET /api/v2/tickets/:id/conversations`. Paging assumes 30 items per page. |
| **Customer reports "Error sending ticket… make sure your API tokens are valid"** | A 400 or 401 from an API. Almost always the customer's own token is expired, rotated, or not created by a Productboard admin. They should update it under Freshdesk Admin → Apps → this app → Settings. |
| **"Summary is required because the ticket content is too large"** | Working as designed. The note exceeded Productboard's 100 KB limit, so the agent must add a summary. |
| **CDN dependencies** | `index.html` loads Crayons v4 from jsDelivr. A major Crayons release could change component behavior. |

### Debugging

- Open the browser devtools console on a ticket page. The app logs errors with prefixes such as `Error initializing:`, `Error rendering notes:`, `Productboard API error (attempt N):`, and `Error in send flow:`.
- Locally, `fdk run` writes verbose logs to `log/fdk.log`.

## 3. Current state

### Recent work

- **Migrated to Productboard API v2** (commit `8430f00`). This includes auto-creating missing customers and tags with retry.
- **Migrated to Freshworks platform 3.0** (**not yet published to the Marketplace**; verify upgrading existing installs, since the iparam types changed): `manifest.json` restructured into `modules`, Node 24 / FDK 10, iparams simplified to plain `text` types, and app state consolidated into a `state` object in `app.js`.
- **Vitest test scaffolding** added (`package.json`, `vitest.config.js`, `tests/`).

### Known issues / suggested follow-ups

1. **Tests are a placeholder.** `tests/app.test.js` is the FDK template test and doesn't exercise the real logic. Good candidates for real unit tests are `buildNoteBody`, `handleSizeLimit`, `getMissingResources`, `extractAndFormatBody`, `formatTimestamp`, and the retry loop.
2. **`app.activated` handler bug.** In `init()`, `state.client.events.on('app.activated', renderNotes())` *calls* `renderNotes` immediately and passes its promise, not a callback. History renders once on load but won't refresh on re-activation. Fix: `state.client.events.on('app.activated', renderNotes)`.
3. **`handleConversationErrors` check is ineffective.** `allConversations.includes("Error 404")` is checked against an array of conversation objects, so it never matches. A 404 actually surfaces as a thrown error and is shown to the agent.
4. **Missing `package.json` metadata.** There's no `name` or `scripts`. Consider adding `"test": "vitest run"`.
5. **Leftover template bits.** The `index.html` `<title>` is "A Template App", there's an unused `axios` script include, and there's an unused `#apptext` div.
6. **Agent summary isn't escaped.** The summary text is wrapped in `<p>` and inserted into note HTML as-is.
