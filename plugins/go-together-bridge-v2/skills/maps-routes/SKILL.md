---
name: maps-routes
description: Find real places, coordinates and routes, or help build map web apps with connected map services and cited source evidence.
---

Discover a real authorized place/geocoding/routing provider first. A mind map plugin is not a geographic maps provider. Resolve ambiguous place names using location context. Return provider place ID/name, latitude/longitude, source and retrieval time only when actually returned. Validate coordinate range and latitude/longitude order. Request travel mode and departure time only when needed. Distinguish route geometry, distance, ETA and straight-line distance; never invent travel time, traffic or route results. Read provider documentation and quotas before implementing APIs. Keep server secrets off clients. In map apps include attribution, loading/error states and manual place entry if location permission is denied. GPS is optional and must be requested through browser consent. If no provider is connected, give clearly labeled external search links or an implementation plan; do not promote them to verified geocoding or directions. Never send private Brain content to a map provider.

Read [shared rules](../../references/shared-rules.md) before acting. Check the current host's actual tools, connections and authorization; a skill cannot grant tool access. Distinguish instructions from implemented tools and runtime evidence.
