# Claude Code Instructions

## Architecture source of truth

`arch_reviewed.md` is the only architecture document that matters.
`arch.md` is a superseded draft — never read it, never update it.
All architectural decisions and updates go in `arch_reviewed.md` only.

## Workflow

- Show each file before writing it and wait for approval (like `git add -p`).
- Commit after each approved chunk with a descriptive message.
- Never push without asking.

## Code style

- Prefer less code over more, as long as it stays concise and readable.
- Every line must be explainable — if it needs a long comment to justify it, reconsider the approach.
- Don't overbuild. Implement exactly what the chunk requires, nothing speculative.

## Testing

- TDD-first: write the failing test before the implementation, every time.
- Tests must have real, meaningful assertions that exercise actual security logic.
- No assertion-light or "it loaded" tests — these are a no-hire signal in this project.
