---

title: "Type safety"
description: "Everything Journal infers from the schema, and the mistakes that become compile errors as a result."
---

You never write a type annotation for a journal. The schema decides the entry
type, and `idKey` decides the id type:

```ts
const journal = new Journal({
	path: "./journal/products.json",
	schema: z.object({ id: z.string(), title: z.string(), price: z.number() }),
	idKey: (product) => product.id, // product is inferred
});
// Journal<typeof schema, string>
```

## What fails to compile

| Mistake                                                         | Why it fails                                         |
| --------------------------------------------------------------- | ---------------------------------------------------- |
| `idKey: (product) => product.sku`                               | The schema has no `sku` field.                       |
| `journal.getEntry(42)`                                          | Ids are strings.                                     |
| `updateEntry("sku-1", { price: "free" })`                       | `price` is a number.                                 |
| `addEntry({ id: "sku-1", title: "Kettle" })`                    | `price` is required.                                 |
| Passing both `schema` and `versions`                            | They're mutually exclusive.                          |
| A migration that leaves out a field                             | Its return value must match the next schema's input. |
| A migration that reads a field the previous version didn't have | Its parameter is the previous schema's output.       |

## Input vs output

Write methods accept the schema's input type and reads return its output type,
so defaults and transforms are reflected in both directions. A field with a
`.default()` is optional in `addEntry` and always present in `getEntry`.

## Runtime checks too

The schema validates every write and every entry on load, and the journal
checks its own rules (ids, versions, missing entries) at runtime as well. A
JavaScript caller or a corrupted file gets a `JournalError` naming the problem,
not bad data. See [Errors](../reference/errors).
