# Mission Hero — Architecture Documentation

Read in order:

| #   | Document                                                    | What it answers                           |
| --- | ----------------------------------------------------------- | ----------------------------------------- |
| 01  | [Architecture Proposal](./01-architecture.md)               | How the system is shaped and why          |
| 02  | [Data Model & ERD](./02-data-model.md)                      | Every entity, every invariant             |
| 03  | [Security & Child-Safety Model](./03-security-model.md)     | Threat model and defences                 |
| 04  | [User Journeys](./04-user-journeys.md)                      | What actually happens, screen by screen   |
| 05  | [Folder Structure](./05-folder-structure.md)                | Where code lives and what may import what |
| 06  | [Core Business Rules](./06-business-rules.md)               | BR-1 … BR-61, cited from code and tests   |
| 07  | [MVP Sprint Plan](./07-mvp-sprint-plan.md)                  | Vertical slices and exit criteria         |
| 08  | [Test Strategy](./08-test-strategy.md)                      | The pyramid and the §46 critical list     |
| 09  | [UI Wireframes](./09-wireframes.md)                         | Mobile-first frames for both surfaces     |
| 10  | [Internal Architecture Review](./10-architecture-review.md) | Self-review across five lenses            |

The one-sentence version: **the client never creates value** — every XP point, Reward
Point, Character Star and wheel outcome is decided by the server, inside a transaction,
exactly once.
