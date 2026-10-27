---

title: "Snapshot and revert"
description: "The working set, the saved snapshot, and the methods that read, write and undo against them."
---

A journal holds two sets of entries. The **working set** is what reads and
writes act on. The **saved snapshot** is the working set as of the last
`load()` or `save()`. Every write changes only the working set; nothing reaches
the snapshot, or the disk, until `save()`.

## References

Wherever a method takes a `ref`, you can pass the id or a whole entry. An entry
is resolved through `idKey`, so `journal.getEntry(product)` works when you
already have the object in hand.

## Reading

| Method               | Returns                                                |
| -------------------- | ------------------------------------------------------ |
| `hasEntry(ref)`      | Whether the working set holds this id.                 |
| `getEntry(ref)`      | The working entry, or `undefined`.                     |
| `getSavedEntry(ref)` | The entry as of the last load or save, or `undefined`. |
| `getEntries()`       | Every working entry, in insertion order.               |
| `getIds()`           | Every working id, in insertion order.                  |

## Writing

All writes are synchronous and chainable.

| Method                    | Behaviour                                                                                                                                 |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `addEntry(entry)`         | Validates and adds. Throws if the id already exists.                                                                                      |
| `updateEntry(ref, patch)` | Shallow-merges `patch` over the existing entry and validates the result. Throws if the entry is missing or the patch would change its id. |
| `upsertEntry(entry)`      | Adds the entry if it's new; otherwise merges it over the existing one, so optional fields it leaves out are kept.                         |
| `deleteEntry(ref)`        | Removes the entry. Does nothing if the id isn't there.                                                                                    |

```ts
journal
	.addEntry({ id: "sku-1", title: "Kettle", price: 30 })
	.updateEntry("sku-1", { price: 25 })
	.deleteEntry("sku-2");
```

## Undo

| Method               | Behaviour                                                                                                              |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `revert()`           | Throws away every unsaved change.                                                                                      |
| `revertEntry(ref)`   | Throws away unsaved changes to one entry. An entry added since the last save is removed, and a deleted one comes back. |
| `getSavedEntry(ref)` | Reads the snapshot without changing the working set, for restoring an external system.                                 |

`journal.dirty` is `true` whenever the working set differs from the snapshot.

## Why entries are cloned

Entries are cloned (with `structuredClone`) when they go in and when they come
out. If you change an object after adding it, or change one you got back, the
journal is unaffected:

```ts
const product = { id: "sku-1", title: "Kettle", price: 30 };
journal.addEntry(product);
product.price = 0;

journal.getEntry("sku-1")?.price; // 30
```

Without this, a script that snapshots an object and then edits the same object
would silently edit its own backup.
