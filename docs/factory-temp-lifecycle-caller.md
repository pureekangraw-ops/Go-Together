# Finite temporary Factory lifecycle caller

`factory_visual_temp` uses the existing owner-authenticated MCP gate, Factory Hub connector and private AppTools → FACTORY_DIRECT signed rail. It does not expose a generic HTTP proxy, raw registry access or credentials.

Operations are `register`, `capabilities`, `inventory`, `quota`, `create` and `remove`. The exact manifest, expected Factory source SHA and operation input must match Factory's separately configured namespace/approval. Register/create/remove require explicit owner approval plus a stable UUID requestId. Read operations use fresh Hub relay identities. An uncertain response is never retried; the caller retains the real Hub receipt or exact receipt lookup identity.

The signed envelope is FACTORY_VISUAL_TEMP_OPERATION_V1 at `/station/go-visual-temp`. Requests are limited to8KiB and responses to64KiB, with a30second transport abort signal. Returned source, namespace and operation must match, and only known result fields are accepted. The existing Factory configuration remains default-off. No production config or deployment is performed by this change.

This lifecycle creates/deletes only empty, owned resource entities. It does not upload the three test Workers, bind their services, execute browser jobs or prove hosted acceptance. Factory's source-side interop script imports this actual GO adapter to verify signed caller/receiver and CAS lifecycle behavior with synthetic provider HTTP.
