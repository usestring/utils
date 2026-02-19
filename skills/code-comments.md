# Commenting Skill: Write WHY, not WHAT

## Goal

Comments exist to preserve **intent and context that is not obvious from the code**.
If the code already says it, the comment should not.
If you can delete the comment and the code is still equally understandable, delete it.

---

## The Rule

Every comment must answer at least one of:

* Why is this here? Business context can be a valid reason
* Why is it done this way (tradeoff)?
* What constraint forces this design (rate limit, API quirk, SLA, backwards compatibility)?
* What invariant must hold true?
* What risk is being mitigated (performance, security, correctness)?
* What assumption would be easy to break later?
* Why now / why here (why this layer, why this module, why this ordering)?

---

## What Comments Are Banned

Do not restate mechanics that are obvious from the code.

Bad (WHAT-style comments):

* Loop through items
* Set flag to true
* Call the API
* Check if null

If you are narrating the code’s behavior, stop and rewrite as intent plus constraint.

## Examples

### Rate limits / external constraints

Good:
WHY: Batch at 50 BECAUSE: upstream 429s above ~60 items and retries amplify load.

Bad:
Batch items in groups of 50.

---

### Non-obvious ordering

Good:
WHY: Validate before enqueue BECAUSE: jobs are non-idempotent and would double-charge on retry.

Bad:
Validate input then enqueue job.

---

### Performance

Good:
WHY: Precompute lookup map BECAUSE: this runs inside a hot loop (avoids O(n^2)).

Bad:
Create a map for faster lookup.

---

### “Looks weird” code

Good:
WHY: Keep sleep jittered BECAUSE: synchronized retries cause a thundering herd.

Bad:
Sleep for a bit.

---

### Business Reason

Good:
WHY: Add a listener status changes from failed to succeeded. BECAUSE: Customers need to be alerted when a previously failed job succeeds.

Bad:
Send email when status changes.

## Decision Process (Use Every Time)

Before writing a comment:

1. Is this obvious from naming and structure? If yes → no comment.
2. If removed, would a future reader miss intent or constraint? If yes → comment.
3. Can intent be expressed in code instead (rename, extract function)? If yes → do that first.
4. If still needed, write using WHY plus BECAUSE (or INVARIANT, RISK, TRADEOFF, etc.).

---

## Output Requirements for Agents

When adding or modifying comments in a diff:

* Prefer fewer, high-signal comments over many.
* Each comment must include at least one of: WHY, BECAUSE, TRADEOFF, INVARIANT, RISK, ASSUMPTION, CONTEXT.
* If a comment cannot be justified with one of those, remove it.
