import assert from "node:assert";
import test, { describe } from "node:test";
import { z } from "zod";
import { Journal, JournalError, versions } from "../modules/index.ts";
import {
	type Equal,
	type Expect,
	KETTLE,
	noteSchema,
	type Product,
	productSchema,
	tempPath,
} from "./support.ts";

describe("Journal types", () => {
	test("the entry type is inferred from the schema", async () => {
		const journal = await new Journal({
			path: await tempPath(),
			schema: productSchema,
			idKey: (p) => p.id,
		}).load();
		const entry = journal.addEntry(KETTLE).getEntry("p1");

		type _Entry = Expect<Equal<typeof entry, Product | undefined>>;
		type _Entries = Expect<
			Equal<ReturnType<typeof journal.getEntries>, Product[]>
		>;
		assert.deepStrictEqual(entry, KETTLE);
	});

	test("idKey is contextually typed and its return type becomes the id type", async () => {
		const journal = await new Journal({
			path: await tempPath(),
			schema: noteSchema,
			idKey: (note) => note.n,
		}).load();

		type Ids = ReturnType<typeof journal.getIds>;
		type _Ids = Expect<Equal<Ids, number[]>>;

		// @ts-expect-error ids are numbers, so a string id is not accepted.
		assert.strictEqual(journal.hasEntry("1"), false);
	});

	test("idKey must return a string or a number", () => {
		new Journal({
			path: "x.json",
			schema: productSchema,
			// @ts-expect-error an array is not a valid id.
			idKey: (p) => p.tags,
		});
	});

	test("addEntry accepts the schema's input, which may differ from its output", async () => {
		const schema = z.object({ id: z.string(), qty: z.number().default(1) });
		const journal = await new Journal({
			path: await tempPath(),
			schema,
			idKey: (e) => e.id,
		}).load();

		journal.addEntry({ id: "a" });
		const entry = journal.getEntry("a");
		type _Output = Expect<
			Equal<typeof entry, { id: string; qty: number } | undefined>
		>;
		assert.deepStrictEqual(entry, { id: "a", qty: 1 });
	});

	test("addEntry rejects the wrong shape at compile time and at runtime", async () => {
		const journal = await new Journal({
			path: await tempPath(),
			schema: productSchema,
			idKey: (p) => p.id,
		}).load();

		assert.throws(() => {
			// @ts-expect-error price must be a number.
			journal.addEntry({ id: "p1", title: "Kettle", price: "30" });
		}, JournalError);
	});

	test("updateEntry patches only take the entry's own fields", async () => {
		const journal = await new Journal({
			path: await tempPath(),
			schema: productSchema,
			idKey: (p) => p.id,
		}).load();
		journal.addEntry(KETTLE);

		// @ts-expect-error colour is not a product field.
		journal.updateEntry("p1", { colour: "red" });
		assert.throws(() => {
			// @ts-expect-error price must be a number.
			journal.updateEntry("p1", { price: "free" });
		}, JournalError);
	});

	test("each migration is typed by the schemas on either side of it", () => {
		const v0 = z.object({ id: z.string(), price: z.number() });
		const v1 = z.object({ id: z.string(), cents: z.number() });

		versions(v0).next(v1, (previous) => {
			type _Previous = Expect<Equal<typeof previous, z.output<typeof v0>>>;
			return { id: previous.id, cents: previous.price * 100 };
		});

		// @ts-expect-error the v1 schema needs cents, which this migration forgets.
		versions(v0).next(v1, (previous) => ({ id: previous.id }));

		// Async migrations are typed the same way.
		versions(v0).next(v1, async (previous) => ({ id: previous.id, cents: 0 }));
	});

	test("a versioned journal is typed by the last schema in the chain", async () => {
		const chain = versions(
			z.object({ id: z.string(), price: z.number() }),
		).next(z.object({ sku: z.number(), cents: z.number() }), (previous) => ({
			sku: Number(previous.id),
			cents: previous.price,
		}));
		const journal = await new Journal({
			path: await tempPath(),
			versions: chain,
			idKey: (entry) => entry.sku,
		}).load();

		const entry = journal.getEntry(1);
		type _Entry = Expect<
			Equal<typeof entry, { sku: number; cents: number } | undefined>
		>;
		assert.strictEqual(journal.version, 1);
	});

	test("schema and versions cannot both be passed", () => {
		const schema = z.object({ id: z.string() });
		// @ts-expect-error pick one: schema for a single version, versions for a chain.
		new Journal({
			path: "x.json",
			schema,
			versions: versions(schema),
			idKey: (e) => e.id,
		});
		// @ts-expect-error version is derived from the chain.
		new Journal({
			path: "x.json",
			versions: versions(schema),
			version: 2,
			idKey: (e) => e.id,
		});
	});

	test("a schema whose output is not an object is rejected", () => {
		new Journal({
			path: "x.json",
			// @ts-expect-error entries must be objects.
			schema: z.string(),
			idKey: () => "x",
		});
	});
});
