---

title: "Quick Start"
description: "Snapshot products before a bulk price change, then roll back from the journal when the change fails partway."
---

This walks through the case Journal is built for: a script about to change
many records in a remote system, which needs a way back if it fails halfway.

## Create and load

```ts
import { Journal } from "@michaelrwalker/journal";
import { z } from "zod";

const journal = await new Journal({
	path: "./journal/products.json",
	schema: z.object({ id: z.string(), title: z.string(), price: z.number() }),
	idKey: (product) => product.id,
}).load();
```

`load()` resolves to the journal itself. If the file doesn't exist yet, you get
an empty journal, so a script's first run needs no setup. Every other method
throws until `load()` has finished.

## Snapshot, then save

```ts
for (const product of await shop.listProducts()) {
	journal.upsertEntry(product);
}
await journal.save();
```

Save before the risky part, not after. Once `save()` resolves, the old state
is on disk and survives even if the process dies in the next line.

## Make the change

```ts
try {
	for (const id of journal.getIds()) {
		const product = journal.getEntry(id);
		if (!product) continue;
		await shop.updateProduct(id, { price: Math.round(product.price * 0.8) });
	}
} catch (error) {
	console.error("Price change failed, rolling back:", error);
	for (const id of journal.getIds()) {
		const before = journal.getSavedEntry(id);
		if (before) await shop.updateProduct(id, before);
	}
}
```

`getSavedEntry()` returns the entry as of the last `load()` or `save()`,
whatever has happened to the working set since. That's the undo.

## Recover from another run

The snapshot is on disk, so a separate recovery script sees the same data:

```ts
const recovered = await new Journal({
	path: "./journal/products.json",
	schema: productSchema,
	idKey: (product) => product.id,
}).load();

for (const product of recovered.getEntries()) {
	await shop.updateProduct(product.id, product);
}
```

## Clean up

When the change is finished and verified, empty the journal:

```ts
await journal.reset();
```
