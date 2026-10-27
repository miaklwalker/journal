---

title: "Journal API"
description: "Every export of @michaelrwalker/journal: the Journal class, versions, and the validation helpers."
---

## `new Journal(options)`

| Option     | Type                          | Default                     | Notes                                                                                                                              |
| ---------- | ----------------------------- | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `path`     | `string`                      | required                    | The JSON file to read and write. Parent directories are created on save.                                                           |
| `schema`   | `StandardSchemaV1`            | required, unless `versions` | Validates each entry. Its output must be an object.                                                                                |
| `idKey`    | `(entry) => string \| number` | required                    | An entry's identity. Composite keys work: `` (o) => `${o.shop}:${o.number}` ``. Must return a non-empty string or a finite number. |
| `version`  | `number`                      | `0`                         | Written into the file and checked on load.                                                                                         |
| `versions` | `Versions`                    | —                           | A version chain, in place of `schema` and `version`. See [Migrations](../guides/migrations).                                       |

## Lifecycle

| Member                | Notes                                                                                       |
| --------------------- | ------------------------------------------------------------------------------------------- |
| `load()`              | Reads, migrates and validates the file. Resolves to the journal.                            |
| `save()`              | Writes the working set atomically and makes it the saved snapshot. Resolves to the journal. |
| `reset()`             | Empties the journal and saves. Resolves to the journal.                                     |
| `loaded`              | Whether `load()` has finished.                                                              |
| `dirty`               | Whether the working set differs from the saved snapshot.                                    |
| `migratedFrom`        | The file's version if `load()` migrated it, otherwise `undefined`.                          |
| `backupPath(version)` | Where a pre-migration backup of that version is written.                                    |
| `path`                | The journal file's path.                                                                    |
| `schema`              | The current schema.                                                                         |
| `version`             | The current version.                                                                        |

## Reading

| Method               | Returns                                                |
| -------------------- | ------------------------------------------------------ |
| `hasEntry(ref)`      | `boolean`                                              |
| `getEntry(ref)`      | The working entry, or `undefined`.                     |
| `getSavedEntry(ref)` | The entry as of the last load or save, or `undefined`. |
| `getEntries()`       | Every working entry, in insertion order.               |
| `getIds()`           | Every working id, in insertion order.                  |

A `ref` is an id or a whole entry.

## Writing

Synchronous, and each returns the journal for chaining.

| Method                    | Notes                                                                      |
| ------------------------- | -------------------------------------------------------------------------- |
| `addEntry(input)`         | Throws if the id exists.                                                   |
| `updateEntry(ref, patch)` | Shallow merge, then validate. Throws if missing or if the id would change. |
| `upsertEntry(input)`      | Adds, or merges over the existing entry.                                   |
| `deleteEntry(ref)`        | No-op if absent.                                                           |
| `revert()`                | Drops every unsaved change.                                                |
| `revertEntry(ref)`        | Drops unsaved changes to one entry.                                        |

## `versions(schema, options?)`

Starts a version chain. `options.from` sets the first schema's version number
(default `0`).

| Member                         | Notes                                                                                                                     |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| `.next(schema, migrate)`       | Returns a new chain with one more version. `migrate` takes the previous output and returns the next input, sync or async. |
| `.migrate(value, fromVersion)` | Brings one value up to the current version, validating at each step.                                                      |
| `.version`                     | The current version number.                                                                                               |
| `.schema`                      | The current schema.                                                                                                       |
| `.from`                        | The first version number in the chain.                                                                                    |

## Validation helpers

| Function                              | Notes                                                                              |
| ------------------------------------- | ---------------------------------------------------------------------------------- |
| `validateSync(schema, value, where)`  | Validates synchronously, throwing `JournalError` on failure or on an async schema. |
| `validateAsync(schema, value, where)` | Validates, awaiting async schemas.                                                 |
| `formatIssues(issues)`                | Formats Standard Schema issues one per line, with paths.                           |

## Types

`EntrySchema`, `EntryOf`, `EntryInput`, `EntryId`, `EntryRef`,
`JournalOptions`, `JournalFile`, `Migration`, `VersionsOptions` and
`StandardSchemaV1` are exported for code that wraps a journal.
