# Deliver Kuwi as a PWA

Accepted: 2026-11-07

Deliver an installable PWA for iPhone Safari and Home Screen use first. Anthony
clarified that the goal is Tarsi's refined UI/UX, animations, and finance logic.
Native Apple integrations are outside this delivery; no later native app is
committed. This replaces the earlier unqualified native full-parity target and
avoids the proposed weekly free-development provisioning renewal.

Keep Kuwi branding, Convex cloud data, Clerk authentication for cloud use,
offline local use without sign-in, and the strict 3NF and ACID requirements.
Reopen the local storage implementation from ADR-0004 for the browser runtime;
browser SQLite and IndexedDB are candidates, not accepted replacements. Browser
durability, offline startup, and sync need validation before implementation.

Inspect Tarsi's delivered web code first for screen structure, animations, and
logic. Decompiled or formatted bundles do not establish an original buildable
project or permission to reuse its code or artwork. Native package inspection
is optional evidence when web code leaves a relevant behavior unresolved.
