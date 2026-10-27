# @michaelrwalker/journal

A typed, file-backed record of entries keyed by id. A cache is meant to go
stale and be thrown away. A journal is meant to stick around. Before a script
changes something, snapshot it into the journal and save. If the change goes
wrong, the journal still has the old version, and you can put it back.

Entries are validated with any [Standard Schema](https://standardschema.dev)
validator, such as Zod, Valibot, ArkType or Effect Schema, so the package
depends on none of them.

```ts
import { Journal } from "@michaelrwalker/journal";
import { z } from "zod";

const journal = new Journal({
	path: "./journal/products.json",
	schema: z.object({ id: z.string(), title: z.string(), price: z.number() }),
	idKey: (product) => product.id,
	version: 0,
});
await journal.load();

journal.upsertEntry(product); // snapshot before touching the real thing
await journal.save();

await shop.updateProduct(product.id, { price: 0 }); // ...something goes wrong

const before = journal.getSavedEntry(product.id); // the product as it was
await shop.updateProduct(product.id, before);
```

The entry type, the id type and the `idKey` parameter all come from the
schema, so you never write a type annotation. A misspelled field, the wrong
kind of id, or a patch with the wrong type for a field won't compile.

## Install

```bash
npm install @michaelrwalker/journal
```

There are no runtime dependencies. The Standard Schema interface is copied in,
as the spec allows. The package ships as TypeScript source, so your own build
compiles it. It uses `node:fs/promises`, which also works under Bun and Deno.

## new Journal(options)

| Option     | Type                          | Default    | Description                                                                                                                                                        |
| ---------- | ----------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `path`     | `string`                      | (required) | The JSON file to read and write. Parent directories are created on save.                                                                                           |
| `schema`   | `StandardSchemaV1`            | (required) | Validates each entry. Its output must be an object.                                                                                                                |
| `idKey`    | `(entry) => string \| number` | (required) | Gives an entry's identity. It's a function, so a composite key like `` (o) => `${o.shop}:${o.number}` `` works. Must return a non-empty string or a finite number. |
| `version`  | `number`                      | `0`        | Written into the file and checked on load. A file at any other version fails loudly instead of loading into the wrong shape.                                       |
| `versions` | `Versions`                    |            | Use this instead of `schema` and `version` when old files need migrating. See [Migrations](#migrations).                                                           |

## Loading and saving

**`await journal.load()`** reads and validates the file. If the file doesn't
exist, you get an empty journal, so a script's first run needs no setup. Every
other method throws until `load` has finished. Calling `load` again throws
away unsaved changes.

**`await journal.save()`** writes the working set to disk and makes it the
new saved snapshot. It writes to a temporary file and then renames it into
place. If the process crashes mid-write, the previous journal is left intact.

**`await journal.reset()`** empties the journal and saves the empty file.

**`journal.dirty`** is `true` when the working set differs from what's on
disk. That includes right after a migrated load, before the first save.

**`journal.migratedFrom`** is the version the file was at, if `load()` had to
migrate it. Otherwise it's `undefined`.

## Reading

Wherever a method takes `ref`, you can pass the id or a whole entry. An entry
is resolved through `idKey`, so `journal.getEntry(product)` works when you
already have the object.

| Method               | Returns                                                                              |
| -------------------- | ------------------------------------------------------------------------------------ |
| `hasEntry(ref)`      | Whether the working set holds this id.                                               |
| `getEntry(ref)`      | The working entry, or `undefined`.                                                   |
| `getSavedEntry(ref)` | The entry as of the last load or save, whatever has changed since. Use this to undo. |
| `getEntries()`       | Every working entry, in insertion order.                                             |
| `getIds()`           | Every working id, in insertion order.                                                |

Entries are cloned when they go in and when they come out. If you change an
object after adding it, or change one you got back, the journal is
unaffected. This is what makes the snapshot trustworthy.

## Writing

All writes are synchronous and chainable. They change the working set only.
Nothing reaches disk until `save()`.

| Method                    | Behaviour                                                                                                                                       |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `addEntry(entry)`         | Validates and adds. Throws if the id already exists.                                                                                            |
| `updateEntry(ref, patch)` | Merges `patch` over the existing entry (shallow) and validates the result. Throws if the entry is missing, or if the patch would change its id. |
| `upsertEntry(entry)`      | Adds the entry if it's new. Otherwise merges it over the existing one, so optional fields it leaves out are kept.                               |
| `deleteEntry(ref)`        | Removes the entry. Does nothing if the id isn't there.                                                                                          |
| `revert()`                | Throws away every unsaved change.                                                                                                               |
| `revertEntry(ref)`        | Throws away unsaved changes to one entry. An entry added since the last save is removed, and a deleted one comes back.                          |

`addEntry` and `upsertEntry` take the schema's _input_ type and store its
_output_. Defaults and transforms are applied once, on the way in.

## Schemas

Any validator that implements Standard Schema works. There are two rules
about which schemas fit.

**Mutations validate synchronously.** That's what lets a script call
`addEntry` without awaiting. A schema with async refinements will work in
`load()`, which awaits it, but any write method throws on it rather than
silently skipping validation.

**Stored entries are validated again on load and on update.** The schema's
output therefore has to be valid input after a trip through JSON. A schema
that turns a string into a `Date` won't load its own file back. Use a
coercing schema (`z.coerce.date()`) or store the ISO string.

You can also write a schema by hand. See
[`examples/custom-schema.ts`](examples/custom-schema.ts):

```ts
const orderSchema: StandardSchemaV1<Order> = {
	"~standard": {
		version: 1,
		vendor: "my-app",
		validate(value) {
			return isOrder(value)
				? { value }
				: { issues: [{ message: "Expected an order", path: ["status"] }] };
		},
	},
};
```

`validateSync`, `validateAsync` and `formatIssues` are exported too, if you
want to validate something the same way the journal does.

## Migrations

When the shape of your data changes, list every version's schema in a chain,
each with a function that turns the previous version into the next one. Then
pass the chain as `versions` instead of `schema`:

```ts
import { Journal, versions } from "@michaelrwalker/journal";

const productVersions = versions(v0)
	.next(v1, (product) => ({
		...product,
		price: { amount: product.price, currency: "USD" },
	}))
	.next(v2, async (product) => ({ ...product, archived: false }));

const journal = await new Journal({
	path: "./journal/products.json",
	versions: productVersions,
	idKey: (product) => product.id,
}).load();
```

Version numbers come from each schema's position in the chain: `v0` is 0 and
each `.next()` adds one. You can't skip a version, reorder them, or add one
without its migration. Each migration's parameter is typed as the previous
schema's output, and its return value has to match the next schema's input,
so a migration that forgets a field won't compile. Migrations may be async.

When `load()` finds an older file, it brings each entry up the chain one step
at a time. It checks the entry against its own version's schema first, then
against each later schema after each migration. A broken migration therefore
fails on the entry and the step it broke, such as `after migration v1→v2`.
After migrating, ids are recomputed with `idKey`, and two entries ending up
with the same id is an error.

Migration happens in memory. The file isn't touched until you call `save()`.
The first `save()` (or `reset()`) after a migration copies the old file to
`journal.backupPath(version)`, which is `products.v0.json` for the example
above, before overwriting it. If a backup of that version already exists, it's
left alone, because the earliest copy is the most original one.

**Keep old schemas frozen.** Write each one out in full, and never build `v0`
from your current schema. If you do, `v0` changes whenever the current schema
does, and it stops describing what old files actually contain.

**Dropping old versions.** Once no old files remain, you can delete the
oldest schemas. Start the chain at the first version you keep, so the
remaining numbers don't move: `versions(v3, { from: 3 })`. A file older than
that fails with a "too old" error. Plain `schema` + `version: 3` is shorthand
for `versions(schema, { from: 3 })`.

`chain.migrate(value, fromVersion)` runs a chain on a single value without a
file, which makes migrations easy to unit-test. See
[`examples/migration.ts`](examples/migration.ts) for a complete run.

## Errors

Everything throws `JournalError`. When the failure came from the schema,
`error.issues` holds the validator's issues as it returned them, and the
message lists them one per line with their paths.

| When                                                             | Message names                                     |
| ---------------------------------------------------------------- | ------------------------------------------------- |
| Any method is called before `load()`                             | The method, and that you need to call `load()`    |
| The file isn't JSON or isn't a journal                           | The path                                          |
| The file is newer than the code, or older than the chain's start | The file's version and the supported range        |
| A migration throws (the original error is kept as `cause`)       | `entries[i]` and the step, e.g. `v0→v1`           |
| A migrated entry fails a later version's schema                  | `entries[i]`, the step and each issue             |
| An entry in the file fails validation                            | `entries[i]` and each issue                       |
| Two entries in the file share an id, before or after migration   | The id and both indexes                           |
| A write fails validation                                         | The method and each issue                         |
| A write uses an async schema                                     | That only `load()` supports async schemas         |
| `idKey` returns something unusable                               | The value it returned                             |
| `addEntry` finds the id already there                            | The id, and to use `updateEntry` or `upsertEntry` |
| `updateEntry` can't find the entry, or the patch changes the id  | The id                                            |

## Development

```bash
npm test             # node:test
npm run typecheck    # tsc --noEmit, which also runs the type-level tests
npm run format       # biome format
npm run fix          # biome lint --write
npm run release      # release-it
```
