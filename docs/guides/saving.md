---

title: "Saving and the file"
description: "How load, save and reset work, the on-disk format, crash safety, and the version check."
---

## Loading

`await journal.load()` reads the file, checks its version, migrates it if
needed, and validates every entry. It resolves to the journal, so creating and
loading fit in one expression:

```ts
const journal = await new Journal({ path, schema, idKey }).load();
```

- A missing file loads as an empty journal.
- A file that isn't JSON, or isn't a journal, throws and names the path.
- Calling `load()` again throws away unsaved changes and re-reads the file.

Every other method throws until `load()` has finished, so a forgotten `await`
fails immediately rather than reading an empty journal.

## Saving

`await journal.save()` writes the working set to disk and makes it the new
saved snapshot. Parent directories are created if needed.

The write goes to a temporary file first, which is then renamed over the
journal. A rename is atomic on the same filesystem, so a process that crashes
mid-save leaves the previous journal intact rather than half a file.

## Resetting

`await journal.reset()` empties the journal and saves the empty file. Use it
once a change is finished and verified, so a later run doesn't mistake old
snapshots for current ones.

## The file format

```json
{
	"version": 0,
	"entries": [{ "id": "sku-1", "title": "Kettle", "price": 30 }]
}
```

Entries are stored as an array, in insertion order, and ids are recomputed
from `idKey` on load rather than stored separately. Two entries sharing an id
is an error.

## The version check

`version` is written into the file and checked on load. A file written by
newer code (a higher version) throws instead of loading into a shape this code
doesn't understand. A file at a lower version is migrated if you passed a
[version chain](migrations), and otherwise throws.

Bump `version` whenever the schema changes incompatibly. It defaults to `0`.
