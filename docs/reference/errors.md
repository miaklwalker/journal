---

title: "Errors"
description: "JournalError: every way Journal throws, and what each message names."
---

Everything Journal throws is a `JournalError`:

```ts
class JournalError extends Error {
	readonly issues: ReadonlyArray<StandardSchemaV1.Issue>;
}
```

When the failure came from the schema, `issues` holds the validator's issues
exactly as it returned them, and the message lists them one per line with
their paths. For other failures `issues` is empty. When a migration throws,
the original error is kept as `cause`.

## When it throws

| When                                                             | The message names                                 |
| ---------------------------------------------------------------- | ------------------------------------------------- |
| Any method is called before `load()`                             | The method, and that you need to call `load()`    |
| The file isn't JSON or isn't a journal                           | The path                                          |
| The file is newer than the code, or older than the chain's start | The file's version and the supported range        |
| A migration throws                                               | `entries[i]` and the step, e.g. `v0→v1`           |
| A migrated entry fails a later version's schema                  | `entries[i]`, the step and each issue             |
| An entry in the file fails validation                            | `entries[i]` and each issue                       |
| Two entries in the file share an id, before or after migration   | The id and both indexes                           |
| A write fails validation                                         | The method and each issue                         |
| A write uses an async schema                                     | That only `load()` supports async schemas         |
| `idKey` returns something unusable                               | The value it returned                             |
| `addEntry` finds the id already there                            | The id, and to use `updateEntry` or `upsertEntry` |
| `updateEntry` can't find the entry, or the patch changes the id  | The id                                            |
| `path` is empty                                                  | That a file path is required                      |
| A version chain starts below 0 or at a non-integer               | The value given                                   |

## Handling schema failures

```ts
try {
	journal.addEntry(input);
} catch (error) {
	if (!(error instanceof JournalError)) throw error;
	for (const issue of error.issues) {
		console.error(issue.path, issue.message);
	}
}
```
