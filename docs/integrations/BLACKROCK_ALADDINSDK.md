# BlackRock AladdinSDK — institutional data integration candidate

**Status: `CONDITIONAL — ACCESS AND ENTITLEMENTS NOT CONFIRMED`.** This document registers the SDK and describes how it would be integrated. Nothing has been cloned, installed, configured or connected. There are no credentials, and none were requested, created or tested.

| | |
|---|---|
| Category | Institutional Data and API Integration SDK |
| Product area | Research and Institutional Intelligence |
| Not | An LLM, chatbot, skill repository, broker gateway or standalone Breakout application |
| Approval | Owner approved registration as a candidate on 2026-11-01. Implementation is **not** approved |

## 1. Provenance (verified 2026-11-01 via the GitHub and PyPI APIs, read-only)

| Item | Value | Evidence |
|---|---|---|
| Repository | https://github.com/blackrock/aladdinsdk | GitHub API: `blackrock/aladdinsdk`, not archived |
| Default branch | `main` | GitHub API |
| **Pinned commit** | **`c1c9f3c2a0a37f8bafce8b27a851f32223bbf305`** | Exists. Committed 2026-09-20T16:45:45Z, "remove unused packages (#58)" |
| Pin vs `main` at verification | identical (0 ahead, 0 behind) | `compare/<pin>...main` |
| Pin vs latest tag | 2 commits **ahead** of tag `2.0.0-beta10` (`fdb6612b323b`) | `compare/2.0.0-beta10...<pin>` |
| Release maturity | **Beta.** The latest PyPI release is `aladdinsdk 2.0.0b10`; the version is derived from Git tags (`setuptools-git-versioning`). The pinned commit is untagged | PyPI JSON; `pyproject.toml` |
| Package | `aladdinsdk` | `pyproject.toml` `name` |
| Python | `>= 3.9` | `pyproject.toml` `requires-python` (also PyPI) |
| Licence | **Apache License 2.0** | GitHub licence detection `Apache-2.0`; root `LICENSE` is the standard Apache 2.0 text |
| Copyright | Source headers read `Copyright 2024 BlackRock, Inc.`, licensed under Apache 2.0 | `aladdinsdk/__init__.py` header |
| NOTICE file | **None present** at the pin. A search of all 363 tree entries finds only `LICENSE` | Recursive Git tree |
| Repository size at pin | 363 tree entries | Recursive Git tree |

**Pin policy:** do not follow `main` and do not upgrade the pin silently. Any change of pin, or a switch to a tagged release, needs a manifest update and owner approval. Before any future distribution, recheck the licence, any NOTICE file, and the licences of every transitive Python dependency.

**Transitive dependencies** (`requirements.txt` at the pin; recorded, not installed): `aenum`, `cryptography`, `dynaconf`, `jsonpath-ng`, `openpyxl`, `pandas`, `pick`, `pydantic`, `python_dateutil`, `pyopenssl`, `PyYAML`, `snowflake-connector-python[pandas]` (`<3.17.4`), `snowflake-snowpark-python[pandas]`, `snowflake-sqlalchemy`, `requests`, `requests-oauthlib`, `tenacity`, `urllib3` (`<2.0.0`), `boto3`, `numpy`, `lazy-imports`. The `urllib3 < 2` pin and the Snowflake and Snowpark stack are why the SDK must live in its own isolated Python environment.

## 2. Documented capabilities (upstream README at the pin)

| Capability | README basis |
|---|---|
| Aladdin API client (`AladdinAPI`) | Wraps OpenAPI-generated clients for the Aladdin Graph API swagger specs |
| Authentication: Basic Auth and OAuth | `API.AUTH_TYPE` = `Basic Auth` or `OAuth`. `API.AUTH_FLOW_TYPE` = `refresh_token` or `client_credentials`. OAuth uses `client_id`, `client_secret` and (for that flow) `refresh_token`; a pre-issued access token is also accepted. Scopes must be a subset of those set for the app in **Aladdin Studio** |
| API plugins | Bundles installed as separate Python packages and **auto-discovered** (§5) |
| Input validation and response deserialisation | pydantic validation; deserialisation can be turned off per call |
| Retry and rate limiting | A retry mechanism, plus rate limiting per API endpoint |
| Long-running operations | LRO utilities to trigger and poll long-running endpoints |
| Aladdin Data Cloud (ADC) | `ADCClient` wraps the Snowflake connector or **Snowpark**. Authenticates with `oauth` or `snowflake_jwt` (RSA keys). Session management covers role, database, schema and warehouse. **Supports both reading and writing** |
| S3 storage | S3 client (boto3) |
| Data utilities | Batch processing, data transformations, data exports, pagination, URL rewriting, extra HTTP headers |
| Other | Logging, error-handler registration, Studio notifications, **email notifications**, CLI for OAuth refresh-token generation, DomainSDK development |

### Configuration (README at the pin)

- **Required:** `defaultWebServer`, the BlackRock client environment's default web server. There is no public default.
- **Sources, lowest to highest priority:** default config file (`DEFAULT_ASDK_CONFIG_FILE`), user config file (`ASDK_USER_CONFIG_FILE`, which must be set before `aladdinsdk` is imported), `ASDK_`-prefixed environment variables (Dynaconf, double underscore for nesting, e.g. `ASDK_API__AUTH_TYPE`), then inline parameters on SDK calls and constructors.
- **Run mode:** `RUN_MODE` = `local` (default), `compute` (Aladdin Studio Compute) or `test`.
- **Credential-handling paths the README documents** (and their status for Breakout):
  - In `local` mode, if no password is configured, the SDK **prompts on the command line** and stores the password in the OS keyring. *Not acceptable for an unattended service.*
  - `USER_CREDENTIALS.PASSWORD` in plain config, or `PASSWORD_FILEPATH` (a plaintext file the README itself marks "NOT RECOMMENDED"). *Not allowed.*
  - `ENCRYPTED_PASSWORD_FILEPATH` with an optional key file, OAuth client details and token files, ADC RSA key pair. *Candidates only, subject to security review.*
- **Email:** `NOTIFICATIONS.EMAIL.*` (SMTP host, username, password, recipients) and `ERROR_HANDLING.EMAIL_NOTIFICATIONS.*` (send email on SDK errors). Studio notifications can use SMTP or push.
- **No read-only mode is documented.** The README describes no SDK-wide read-only switch, and `ADCClient.write_frame(...)` writes DataFrames to ADC tables. Read-only behaviour must be enforced by Breakout's adapter and by upstream permissions; it can't be assumed from the SDK.

### Official plugins listed in the README

`asdk_plugin_accounting`, `asdk_plugin_analytics`, `asdk_plugin_clients`, `asdk_plugin_compliance`, `asdk_plugin_data`, `asdk_plugin_investment_operations`, `asdk_plugin_investment_research`, `asdk_plugin_platform`, `asdk_plugin_portfolio`, `asdk_plugin_portfolio_management`, `asdk_plugin_trading`.

The README lists three plugins beyond the eight named in the owner's brief: `clients`, `platform` and `portfolio_management`. Which APIs each plugin contains is published on PyPI per plugin and hasn't been reviewed. **None of these plugins is assumed to be available to Adorbis or Breakout.** Each one depends on the client's entitlements.

## 3. Access prerequisites (all UNRESOLVED)

| # | Prerequisite | Why | State |
|---|---|---|---|
| A1 | A BlackRock **Aladdin client environment** (the `defaultWebServer` is required configuration) | The SDK connects to a client's own Aladdin deployment, not a public endpoint | Not confirmed |
| A2 | **Aladdin Studio** access | OAuth apps and scopes are defined in Studio; ADC OAuth can be brokered through Studio login | Not confirmed |
| A3 | API authentication method (Basic Auth or OAuth) | `API.AUTH_TYPE` | Not decided |
| A4 | OAuth application, client ID and secret, refresh token, and **scopes** | Scopes must be a subset of the Studio app's scopes | Not provided |
| A5 | Plugin and API bundle **entitlements** | Each plugin's APIs need entitlement | Unknown |
| A6 | Aladdin Data Cloud availability | Needed only if ADC data is used | Unknown |
| A7 | Snowflake account, role, warehouse, database and schema | ADC is Snowflake-based | Unknown |
| A8 | Data licence and usage terms for displaying Aladdin data to Breakout users | Institutional data usually comes with redistribution limits | Not reviewed |
| A9 | Relevance to Indian markets (NSE/BSE/MCX instruments in the entitled datasets) | Breakout's focus is Indian markets | Unknown |

No credentials have been provided. **No sample or placeholder credentials** will be created, and connectivity won't be claimed until a real, entitled call succeeds.

## 4. Architecture (if implementation is ever approved)

```
Breakout Research workspace (panels, Copilot citations)
  → Breakout backend orchestration (Node; envelopes, permissions, provenance)
    → Breakout Institutional Data Adapter   ← separate Python service, own container and venv
        → aladdinsdk (pinned) + approved read-only plugins only
            → authorised Aladdin APIs (client environment)
            → authorised Aladdin Data Cloud (Snowflake), read-only role
```

- **A separate service:** a Python 3.9 or later service in the `breakout` Compose project, with its own image, its own locked virtual environment and its own secrets file. Its network path is reviewed separately, like the OpenAlgo adapter.
- **Nothing in the Node backend:** no Python, `aladdinsdk` or plugin dependency enters `package.json`, the Copilot backend, the frontend, or the OpenAlgo, TradeOS or Collector environments.
- **A fixed adapter interface:** the adapter exposes a small, versioned, allowlisted set of read operations, for example `GET /v1/research/<dataset>?instrument=…`. There is no generic API passthrough, no arbitrary query, and no SQL from callers.
- **Breakout envelopes:** results come back in the orchestration envelope (`source: "aladdin"`, `endpoint`, `instrument`, `as_of`, `fetched_at`, `freshness`, `status`, `data`), filtered to reviewed fields.
- **Presentation:** Aladdin data appears in Research as **institutional evidence** with a provenance line. The Copilot can cite it, and it is never presented as a decision.

## 5. Safety constraints

1. **`asdk_plugin_trading` is never installed or activated in Release 1.** The README states that the SDK *"will scan installed python packages to find compatible plugins. All APIs in these plugins will be available via AladdinSDK without any additional setup steps."* So exclusion has to be enforced at the **environment** level:
   - the adapter's lockfile must not contain the package;
   - a startup check must refuse to run if it is importable;
   - the adapter's outbound API allowlist must exclude order and trading APIs. The README's example is `OrderAPI`, which lives in the trading plugin.
2. **No Aladdin order, trading, compliance-override or accounting-mutation API is exposed** to the Copilot, the browser or any Breakout tool. Breakout's tool registry can only express read operations.
3. **ADC is used read-only.** The `ADCClient` can write. The adapter uses a read-only Snowflake role and exposes only fixed, parameterised read queries.
4. **Credentials are service-grade only:**
   - **No interactive auth:** the SDK's interactive password prompt and OS keyring storage are not used.
   - **No plaintext passwords:** `PASSWORD_FILEPATH` (a plaintext password file) is not allowed.
   - **Secret storage:** secrets live in the adapter's own environment or secret file (mode 600), and never in Breakout's `.env` or in TradeOS or OpenAlgo configuration.
5. **SDK email notifications are disabled.** They are an uncontrolled outbound channel.
6. **Aladdin data is supporting evidence only.** It is never an independent decision, never mapped to TradeOS vocabulary, and never overrides TradeOS. **TradeOS retains final decision authority.**
7. **Rate limits and retries stay bounded** to the adapter's own budget, on top of the SDK's own retry and rate-limit utilities.

### Security, permission and operational requirements for any future adapter

These are acceptance conditions for a future implementation phase, not features that exist today.

| Area | Requirement |
|---|---|
| Runtime isolation | Separate Python runtime (own image, locked venv, own secrets). No shared interpreter with TradeOS, OpenAlgo, Collector or the Node backend |
| Operation allowlist | Explicit allowlist of permitted plugins, API classes, endpoints and HTTP methods, and of fixed parameterised ADC queries. Everything else is rejected before the SDK is called |
| Read-only default | The adapter's contract is read-only. `write_frame` and any mutating API method are not reachable through it; the ADC Snowflake role has no write grants |
| Permission enforcement | Breakout backend checks per-user, per-source permission server-side before calling the adapter. The adapter checks a service credential from the backend only. The browser can't reach it |
| Authentication | Non-interactive service authentication only (OAuth `client_credentials` is the likely candidate, to be confirmed with BlackRock). `RUN_MODE` is not `local`, so no keyring prompt can occur. No plaintext passwords |
| Email | `ERROR_HANDLING.EMAIL_NOTIFICATIONS.ENABLED` set explicitly to false, no `NOTIFICATIONS.EMAIL.*` values configured, and outbound SMTP blocked at the network level, unless the owner approves otherwise in writing |
| Audit logging | Every adapter call logs requester, operation, parameters (without secrets), upstream status, row or record count and timing. SDK log export goes to the adapter's own volume, never the working directory |
| Tests | Tests prove that a non-allowlisted endpoint, any write or mutating method, `write_frame`, and the presence of `asdk_plugin_trading` are each rejected, and that no email is sent on an SDK error |
| Secrets | Never printed, logged or committed. Rotation owner and procedure documented before first use |

## 6. Integration limitations

- The integration is entirely conditional on A1–A9. Without an Aladdin client environment, the SDK has no use.
- The SDK is beta (`2.0.0b10`), and the pin is untagged.
- Plugin API coverage, data schemas and freshness characteristics are unknown until entitled documentation or access is available. This document doesn't invent them.
- The Snowflake and Snowpark stack and the `urllib3 < 2` constraint make the dependency footprint heavy, which is another reason for an isolated service.
- Dataset relevance to Indian-market intraday trading is unverified.

## 7. Release 1 recommendation and phase classification

- **Release 1: excluded.** Release 1 does not depend on BlackRock credentials, Aladdin client access, Aladdin Data Cloud, Snowflake access, or any plugin (the Trading plugin least of all). The core Breakout product works without Aladdin data.
- **Classification:** future, conditional integration candidate (`R2-ALADDIN` in [RELEASE_1_SCOPE.md](../design/RELEASE_1_SCOPE.md) §2a, blocker B10 in [INTEGRATION_EXPERIENCE_MAP.md](../design/INTEGRATION_EXPERIENCE_MAP.md) §4).
- **Gate to move forward:** prerequisites A1–A9 confirmed in writing, a named use case, owner approval to implement, and a security and network review of the adapter design above.

## 8. Unverified items and questions for BlackRock or the client

| # | Question | Why it matters |
|---|---|---|
| Q1 | Does Adorbis (or the trader's firm) have an Aladdin client environment, and what is its `defaultWebServer`? | Without it, the SDK has nothing to connect to (A1) |
| Q2 | Which API bundles and plugins is the account entitled to, and with which OAuth scopes? | Determines what data exists at all (A4, A5) |
| Q3 | Is OAuth `client_credentials` permitted for an unattended service account, and who issues and rotates the credentials? | Interactive and plaintext-password paths are ruled out |
| Q4 | Can a read-only API scope set and a read-only ADC Snowflake role be issued? | Breakout requires least privilege, not just adapter-side enforcement |
| Q5 | Is ADC needed for the intended use case, and if so which account, role, warehouse, database and schema? | Avoids provisioning Snowflake access that isn't needed (A6, A7) |
| Q6 | Do the data licence and terms permit showing Aladdin data to Breakout users, storing it, and passing excerpts to an LLM via Adorbis AI? | Redistribution and AI-processing limits (A8) |
| Q7 | Do the entitled datasets cover NSE/BSE/MCX instruments at a useful freshness? | Breakout's market is Indian intraday trading (A9) |
| Q8 | Network path: which egress, IP allowlisting or proxy (`API.OAUTH.AUTH_SERVER_PROXY`) does the client environment require? | Network review for the VPS |
| Q9 | Plugin API contents (per-plugin PyPI packages) and data schemas | Not reviewed; nothing is assumed here |
| Q10 | Will a tagged release succeed `2.0.0-beta10`, and should the pin move to it? | Current pin is an untagged beta snapshot |

## 9. Not done in this task (by instruction)

No clone, no submodule, no `pip install`, no virtual environment, no plugins, no adapter, no connection to BlackRock APIs or ADC, no credentials, no Copilot code change, no Docker change, no deployment, no commit or push. The README was re-read at the pinned commit (raw GitHub, read-only) on 2026-11-01 to confirm the configuration, authentication, email and ADC write facts in §2.
