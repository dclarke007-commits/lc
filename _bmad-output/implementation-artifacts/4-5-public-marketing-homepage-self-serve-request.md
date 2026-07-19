---
baseline_commit: 8fb1948
retrofit: true
retrofit_note: "Shipped ad-hoc post-MVP; retrofitted into planning artifacts 2026-07-19 via Correct Course (sprint-change-proposal-2026-07-19.md)."
ships_in:
  - "PR #12 (8fb1948) — public homepage + self-serve request"
  - "commit 3a4256c — route homepage inquiries to source='web'"
  - "PR #11 (5f0c372) — fresh & trustworthy design system (NFR8, cross-cutting)"
spec: "docs/superpowers/specs/2026-07-18-public-homepage-self-serve-request-design.md"
---

# Story 4.5: Public marketing homepage + self-serve request

Status: done (retrofitted)

## Story

As a **prospective client**,
I want **a public homepage that explains the service and lets me request a booking**,
so that **I can reach the business without a per-client link or a phone call**.

## Acceptance Criteria

1. **(FR42, FR33) Anonymous marketing homepage; operator app stays gated.**
   **Given** an anonymous visitor at `/`
   **When** the page loads
   **Then** they see the marketing homepage with no auth gate, while every operator surface stays behind sign-in.

2. **(FR42, FR6, AR5) Self-serve request → provisional record + pending request.**
   **Given** a visitor submits the self-serve request (name, phone, address)
   **When** processed
   **Then** a provisional `Client` + `PendingRequest` are created (reusing the FR6/AR5 machinery) and neither reserves nor consumes capacity.

3. **(FR42, FR37, AR12) Homepage inquiry logged as `web`.**
   **Given** a homepage self-serve submission
   **When** recorded
   **Then** exactly one `Inquiry` is logged with source `web`, deduped via partial unique index; the conversion denominator dedupes to distinct inquiries.

### Definition of Done (invariants)

- **AR9 (AD-8):** homepage writes carry `owner_id` (routed to the single operator via `getOwnerId()`); no tenant UI.
- **AR12:** `web` is a first-class Inquiry source alongside `link` (server-set on homepage submit); a hand-crafted `source=link` POST is still rejected.
- **NFR8:** homepage + all surfaces render on the shared fresh-and-trustworthy design system (PR #11).
- **Public-write rate-limit gap (LOCKED):** homepage submit is unauthenticated and input-capped/validated; per-IP throttle deferred per sprint-status Epic-4 action item.

## Traceability

- **FRs:** FR42 (new), FR37 (+`web`), FR6/FR33 (reused).
- **NFR:** NFR8 (new).
- **AR:** AR5, AR9, AR12 (+`web`).
- **Migrations:** 0014/0015 (`web` enum value + partial dedup index).
- **Planning:** epics.md Epic 4 (Story 4.5); PRD §5.1 FR42, §6 NFR8, §7 In-scope.
