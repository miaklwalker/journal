---

title: "Migrations"
description: "Chain every version of an entry's schema with typed migrations, so old journal files load into the current shape."
---

When the shape of your entries changes, old journal files still hold the old
shape. A version chain lists every schema in order, with a migration between
each pair, and the journal brings old files up to date when it loads them.

## Building a chain

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

Pass `versions` instead of `schema`. New entries are validated against the last
schema in the chain.

Version numbers come from position: `v0` is 0 and each `.next()` adds one. You
can't skip a version, reorder them, or add one without its migration.

Each migration's parameter is typed as the previous schema's output, and its
return value must match the next schema's input, so a migration that forgets a
field fails to compile. Migrations may be async.

Chains are immutable. `.next()` returns a new chain, so a shared base can be
extended in two places without either seeing the other's versions.

## Keep old schemas frozen

Write each schema out in full, and never build `v0` from your current schema
(for example with `.omit()` or `.extend()`). If you do, `v0` changes whenever
the current schema does, and it stops describing what old files actually
contain.

## What happens on load

When `load()` finds an older file, it brings each entry up the chain one step
at a time. It validates the entry against its own version's schema first, then
against each later schema after each migration. A broken migration therefore
fails on the entry and the step it broke, with a message such as
`entries[3] after migration v1→v2`.

After migrating, ids are recomputed with `idKey`. Two entries ending up with
the same id is an error.

`journal.migratedFrom` holds the version the file was at, and `journal.dirty`
is `true` until the first save.

## Backups

Migration happens in memory; the file isn't touched until you call `save()`.
The first `save()` (or `reset()`) after a migration copies the old file to
`journal.backupPath(version)` before overwriting it. For the example above,
that's `products.v0.json`.

If a backup of that version already exists, it's left alone. The earliest copy
is the most original one.

## Dropping old versions

Once no old files remain, you can delete the oldest schemas. Start the chain at
the first version you keep, so the remaining numbers don't move:

```ts
const productVersions = versions(v3, { from: 3 }).next(v4, migrateV3toV4);
```

A file older than `from` fails with a "too old" error. Plain
`schema` + `version: 3` is shorthand for `versions(schema, { from: 3 })`.

## Testing a migration

`chain.migrate(value, fromVersion)` runs a chain on one value without touching
a file:

```ts
const migrated = await productVersions.migrate(
	{ id: "sku-1", title: "Kettle", price: 30 },
	0,
);
// { id: "sku-1", title: "Kettle", price: { amount: 30, currency: "USD" }, archived: false }
```

`examples/migration.ts` in the repository runs a complete migration from a v0
file.
