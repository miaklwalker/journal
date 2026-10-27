---

title: "Overview"
description: "Why Journal exists: a typed, file-backed snapshot of entries that a script can save before a risky change and restore from afterwards."
---

Journal is a typed, file-backed record of entries keyed by id. Before a script
changes something, it snapshots the thing into the journal and saves. If the
change goes wrong, the journal still has the old version, and the script (or
a later one) can put it back.

## A journal is not a cache

A cache is meant to go stale and be thrown away. A journal is meant to stick
around. The difference shows up in what each one promises:

- **The snapshot is trustworthy.** Entries are cloned on the way in and on the
  way out, so nothing the script does to its own objects afterwards can change
  what was recorded.
- **The file survives a crash.** Saves write to a temporary file and rename it
  into place. A process killed mid-write leaves the previous journal intact.
- **Wrong data fails loudly.** Every entry is validated against a schema, on
  write and on load. A file written by older or newer code is caught by its
  version number instead of loading into the wrong shape.

## The shape of a script

```ts
import { Journal } from "@michaelrwalker/journal";
import { z } from "zod";

const journal = await new Journal({
	path: "./journal/products.json",
	schema: z.object({ id: z.string(), title: z.string(), price: z.number() }),
	idKey: (product) => product.id,
}).load();

journal.upsertEntry(product); // snapshot before touching the real thing
await journal.save();

await shop.updateProduct(product.id, { price: 0 }); // ...something goes wrong

const before = journal.getSavedEntry(product.id); // the product as it was
await shop.updateProduct(product.id, before);
```

## Any validator

Schemas are [Standard Schema](https://standardschema.dev) validators, so Zod,
Valibot, ArkType, Effect Schema or a hand-written schema all work, and the
package depends on none of them. The entry type, the id type and the `idKey`
parameter are all inferred from the schema. You never write a type annotation.

## Data that changes shape

When the shape of an entry changes, list every version's schema in a chain
with a migration between each pair. Old files are brought up to date on load,
and the original file is backed up on the first save. See
[Migrations](guides/migrations).

## Where to go next

- [Installation](installation) to add the package.
- [Quick Start](quick-start) for a complete worked example.
- [Snapshot and revert](guides/snapshot-and-revert) for the working set, the
  saved snapshot, and how undo works.
