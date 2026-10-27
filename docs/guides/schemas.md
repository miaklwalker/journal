---

title: "Schemas"
description: "Using any Standard Schema validator with Journal, the rules a schema must follow, and writing one by hand."
---

Journal validates entries with any [Standard Schema](https://standardschema.dev)
validator: Zod, Valibot, ArkType, Effect Schema, or one you write yourself. The
schema's output must be an object, because entries are merged, cloned and
written to JSON.

## Input and output types

`addEntry` and `upsertEntry` take the schema's **input** type and store its
**output**. Defaults and transforms are therefore applied once, on the way in:

```ts
const schema = z.object({
	id: z.string(),
	title: z.string(),
	tags: z.array(z.string()).default([]),
});

journal.addEntry({ id: "sku-1", title: "Kettle" });
journal.getEntry("sku-1")?.tags; // []
```

`updateEntry` takes a partial of the output type, merges it, and validates the
result.

## Writes validate synchronously

Write methods don't return promises, so they validate synchronously. A schema
with async refinements still works in `load()`, which awaits it, but any write
method throws on it rather than silently skipping validation.

## Stored entries must survive JSON

Entries are validated again on load and on update, so the schema's output has
to be valid input after a round trip through JSON. A schema whose output
contains a `Date` breaks this: JSON stores the `Date` as a string, and
`z.date()` rejects the string when the file is loaded back.

Use a coercing schema such as `z.coerce.date()`, or store the ISO string and
convert it where you use it.

## Writing a schema by hand

A Standard Schema is an object with a `~standard` property:

```ts
import type { StandardSchemaV1 } from "@michaelrwalker/journal";

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

`examples/custom-schema.ts` in the repository has a complete version.

## Validating outside a journal

`validateSync`, `validateAsync` and `formatIssues` are exported, so you can
validate something exactly the way the journal does and get the same error
messages.
