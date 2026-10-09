# Local service boundary

Run Content Desk only on the loopback interface. Do not proxy its API to a public address: it is a single-user local application, not an authenticated multi-tenant service.

The service checks Host and checks Origin plus a session token for POST requests. Store article data, backups and credentials outside the source repository. The default data directory is `~/.content-desk`.

Agent tasks receive only the submitted brief and selected content template. Codex runs with its read-only sandbox; Claude's generation adapter has tools and MCP disabled. The CLI provider still processes submitted prompts under its own terms. Review all generated facts and links before publishing.

Do not put credentials into issue reports. For a suspected vulnerability, provide a minimal reproduction without personal content; avoid publicly posting exploitable credential details.
