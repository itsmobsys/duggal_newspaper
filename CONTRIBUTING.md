# Contributing

Thanks for helping the paper. A few rules keep it free, honest and maintainable.

## Ground rules

1. **Free or it does not ship.** No paid service, no paid dependency, no paid
   API. If a feature only works on a paid plan, it does not belong here.
2. **The model is fixed.** The desk runs
   `nvidia/nemotron-3.5-super-vl-120b-a12b`. Do not add a silent fallback to a
   different model. If a model change is genuinely needed, it is a configuration
   change plus a documented decision.
3. **Never invent facts.** Prompts, fixtures and copy must not invent quotes,
   sources, people, statistics or photos. Reader submissions are the only source
   material.
4. **Never commit secrets.** `.env` files are gitignored. Use the provided
   `.env.example` files. If you think a key leaked, rotate it and say so.
5. **No fake success.** UI must reflect real API responses. A 202/queued state
   is not "published".
6. **Small dependencies.** Prefer the standard library and the platform. A new
   package needs a reason in the pull request.

## Development

```bash
npm run setup
cp .env.example .env
cp apps/web/.env.example apps/web/.env.local
npm run db:migrate
npm run db:seed
npm run admin:create -- you@example.com 'a-long-password'
npm run dev:api
npm run dev:web
```

Before opening a pull request:

```bash
npm run verify
```

That runs typecheck, lint, the API tests and both production builds. Formatting
is enforced with Prettier (`npm run format`).

## Tests

- API tests live in `apps/api/test/` and run with Vitest.
- Add a test for queue behaviour, moderation rules, edition scheduling or any
  security boundary you change.
- Tests must not require a network or a real NVIDIA key.

## Code conventions

- TypeScript strict; `noUncheckedIndexedAccess` is on.
- API: Fastify routes validate with Zod; errors use the shared envelope
  `{ error: { code, message } }`.
- Web: server components read the database; client components only handle
  interaction. Do not add a client-side data library.
- CSS: hand-written, tokens in `apps/web/src/app/globals.css`. Page-specific
  styling goes in a CSS module.
- Article bodies are plain text with blank-line paragraphs. Never store HTML.
- Timestamps are ISO strings in UTC; dates in the edition are `YYYY-MM-DD` in
  the site timezone (`Asia/Kolkata` by default).
- Use the existing components (`ArticleCard`, `Pagination`, `EmptyState`, …)
  instead of duplicating markup.

## Commit messages

Conventional Commits, imperative mood:

```
feat(web): add edition archive pagination
fix(api): requeue submissions when the AI key appears
docs: explain the 11 PM edition build
```

## Security

- Do not open a public issue containing an exploit or a secret.
- Report privately via the Discord configured in `site.contact_discord`.
- Changes touching auth, uploads, the BFF, HMAC signing or rate limits need a
  short threat-model note in the pull request.

## Licence

By contributing you agree that your work is released under the MIT licence in
[LICENSE](LICENSE).
