# Security policy

The newspaper runs on free tiers with real reader submissions, photos and an
admin console. Security reports are taken seriously and handled privately.

## Reporting a vulnerability

**Do not open a public issue.** Use GitHub's private reporting:

<https://github.com/itsmobsys/duggal_newspaper/security/advisories/new>

Please include:

- what an attacker can do, and what they need to start;
- the affected route, file or component;
- reproduction steps or a proof of concept;
- whether the issue is already public anywhere.

Never include live secrets, session cookies, upload tickets or real personal data
in the report. If a key may have leaked, say so and rotate it — do not paste it.

## What is in scope

- Authentication and authorization: admin login, sessions, the BFF, HMAC service
  signing, worker tokens.
- Uploads: ticket issuing, `PUT /public/uploads/:id`, image validation, storage
  keys, original downloads.
- Input handling: Zod validation, SQL parameterization, URL and domain checks,
  rate limits, CSRF, security headers and CSP.
- Secret handling: environment variables, logs, error responses, the admin
  diagnostics panel.
- Infrastructure: Render, Vercel, Turso and Vercel Blob configuration documented
  in this repository.

## What is out of scope

- Spam or abusive stories that are published as intended (that is an editorial
  problem, not a vulnerability).
- The AI saying something rude. The paper is deliberately unhinged; see the
  editorial policy in the README.
- Reports that require a compromised maintainer account, a rooted device, or
  physical access.
- Missing hardening headers with no demonstrated impact.
- Denial of service through the free-tier quotas alone.

## Response

- Acknowledgement within 72 hours.
- A fix or a mitigation plan as soon as the report is confirmed.
- Credit in the advisory if you want it.

## Safe harbour

Good-faith research on a deployment you own, or on the public site without
accessing other people's data, will not be pursued. Stop as soon as you have
proof, and do not retain reader data.
