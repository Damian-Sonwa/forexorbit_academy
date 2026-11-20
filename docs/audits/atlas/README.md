# forexorbitAppRole: generated role JSON

These files are **generated** from `rolePrivileges()` in `lib/app-database-role.js`. Do not edit them by hand.

```
node scripts/atlas-role.js --database Forex_elearning --write   # regenerate
node scripts/atlas-role.js --database Forex_elearning --check   # exit 1 if they have drifted
```

`tests/app-database-role.test.js` fails if either file differs from the generator. It also fails if the Atlas JSON grants anything other than `rolePrivileges()`.

| File | Format | Used by |
| --- | --- | --- |
| `forexorbitAppRole.atlas-admin-api.json` | Atlas Admin API custom role: one entry per action, with resources `{cluster:false, db, collection}` | Atlas UI (Database Access, Custom Roles) or the Admin API custom-DB-roles endpoint. When updating an existing role, the role name goes in the path; check the current Atlas API reference for whether `roleName` is accepted in the body. |
| `forexorbitAppRole.createRole.json` | MongoDB `createRole` / `updateRole` privileges | mongosh on a self-managed server; a reference for review |

## What the role grants on `Forex_elearning`

- **find, insert, update, remove** on 62 named collections (`READ_WRITE_COLLECTIONS`).
- **find, insert only** on 3 append-only collections: `adminAuditLog`, `tradingLedger`, `marketIncidents`. There is no update, remove, drop, rename or collMod on these collections.
- **createCollection, createIndex** on `consultationMessages`, `consultationRequests` and `consultationSessions`. These are used by the admin "seed experts" route.
- **listCollections** on the database.
- No database-wide write, no other database, no cluster action, no inherited roles.

## Change from the Oct-28 file (`review/sprint-1-3-integration`, commit ce445d1)

The earlier file was generated before Phases 4.5 to 10. It lacks 18 collections:

| Phase | Collections | Actions |
| --- | --- | --- |
| 10 trading and market (11) | `tradingAccountSlots`, `tradingAccounts`, `tradingOperations`, `tradingOrders`, `tradingPositions`, `marketCheckpoints`, `marketDataSets`, `marketHealth`, `marketQuotes` | find, insert, update, remove |
| | `tradingLedger`, `marketIncidents` | find, insert (append-only) |
| 9 assessments | `quizAttempts`, `quizAttemptCounters` | find, insert, update, remove |
| 8 learning activity | `learningDays`, `learningMinutes` | find, insert, update, remove |
| 4.5 / 5 / email reset | `sessions`, `paystackRefunds`, `passwordResetTokens` | find, insert, update, remove |

Production sessions have worked since Phase 4.5 went live. That suggests the live role already holds at least `sessions`, so it is not the Oct-28 file. The live role has not been read. Run `scripts/check-db-role.js` against production first. It sends only `connectionStatus` and names every missing or excessive action exactly.

Applying the role is an owner action. Nothing in this repository connects to Atlas.
