import assert from "node:assert";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test, { describe } from "node:test";
import { z } from "zod";
import { Journal, JournalError } from "../modules/index.ts";
import {
	asyncSchema,
	KETTLE,
	noteSchema,
	productJournal,
	productSchema,
	TOASTER,
	tempPath,
} from "./support.ts";

describe("Journal construction", () => {
	test("an empty path is rejected", () => {
		assert.throws(
			() =>
				new Journal({ path: "", schema: productSchema, idKey: (p) => p.id }),
			JournalError,
		);
	});

	test("version defaults to 0", () => {
		const journal = new Journal({
			path: "x.json",
			schema: productSchema,
			idKey: (p) => p.id,
		});
		assert.strictEqual(journal.version, 0);
	});

	test("a non-finite version is rejected", () => {
		assert.throws(
			() =>
				new Journal({
					path: "x.json",
					schema: productSchema,
					idKey: (p) => p.id,
					version: Number.NaN,
				}),
			JournalError,
		);
	});
});

describe("Journal.load", () => {
	test("every method except load throws before loading", () => {
		const journal = new Journal({
			path: "x.json",
			schema: productSchema,
			idKey: (p) => p.id,
		});
		assert.strictEqual(journal.loaded, false);
		assert.throws(() => journal.getEntries(), JournalError);
		assert.throws(() => journal.addEntry(KETTLE), JournalError);
		assert.throws(() => journal.revert(), JournalError);
		assert.throws(() => journal.dirty, JournalError);
		assert.rejects(journal.save(), JournalError);
	});

	test("a missing file loads as an empty journal", async () => {
		const journal = await productJournal();
		assert.strictEqual(journal.loaded, true);
		assert.deepStrictEqual(journal.getEntries(), []);
		assert.strictEqual(journal.dirty, false);
	});

	test("entries round-trip through save and load", async () => {
		const path = await tempPath();
		await (await productJournal(path))
			.addEntry(KETTLE)
			.addEntry(TOASTER)
			.save();

		const reloaded = await productJournal(path);
		assert.deepStrictEqual(reloaded.getEntries(), [KETTLE, TOASTER]);
		assert.deepStrictEqual(reloaded.getSavedEntry("p1"), KETTLE);
	});

	test("a file with a different version is rejected", async () => {
		const path = await tempPath();
		await writeFile(path, JSON.stringify({ version: 1, entries: [] }));
		await assert.rejects(productJournal(path), JournalError);
	});

	test("a file that is not JSON is rejected", async () => {
		const path = await tempPath();
		await writeFile(path, "{ not json");
		await assert.rejects(productJournal(path), JournalError);
	});

	test("a file without an entries array is rejected", async () => {
		const path = await tempPath();
		await writeFile(path, JSON.stringify({ version: 0, entries: {} }));
		await assert.rejects(productJournal(path), JournalError);
	});

	test("an invalid entry in the file names its index and carries the issues", async () => {
		const path = await tempPath();
		await writeFile(
			path,
			JSON.stringify({
				version: 0,
				entries: [KETTLE, { id: "p2", title: "Toaster", price: -1 }],
			}),
		);
		await assert.rejects(productJournal(path), (error: unknown) => {
			assert.ok(error instanceof JournalError);
			assert.match(error.message, /entries\[1\]/);
			assert.match(error.message, /price/);
			assert.strictEqual(error.issues.length, 1);
			return true;
		});
	});

	test("duplicate ids in the file are rejected", async () => {
		const path = await tempPath();
		await writeFile(
			path,
			JSON.stringify({ version: 0, entries: [KETTLE, KETTLE] }),
		);
		await assert.rejects(productJournal(path), JournalError);
	});

	test("async schemas are supported on load", async () => {
		const path = await tempPath();
		await writeFile(
			path,
			JSON.stringify({ version: 0, entries: [{ id: "a" }] }),
		);
		const journal = await new Journal({
			path,
			schema: asyncSchema,
			idKey: (e) => e.id,
		}).load();
		assert.deepStrictEqual(journal.getEntry("a"), { id: "a" });
	});

	test("reloading discards unsaved changes", async () => {
		const journal = await productJournal();
		journal.addEntry(KETTLE);
		await journal.load();
		assert.strictEqual(journal.hasEntry("p1"), false);
	});
});

describe("Journal reads", () => {
	test("entries can be looked up by id or by the entry itself", async () => {
		const journal = (await productJournal()).addEntry(KETTLE);
		assert.strictEqual(journal.hasEntry("p1"), true);
		assert.strictEqual(journal.hasEntry(KETTLE), true);
		assert.strictEqual(journal.hasEntry("nope"), false);
		assert.deepStrictEqual(journal.getEntry(KETTLE), KETTLE);
		assert.strictEqual(journal.getEntry("nope"), undefined);
	});

	test("getIds lists ids in insertion order", async () => {
		const journal = (await productJournal()).addEntry(TOASTER).addEntry(KETTLE);
		assert.deepStrictEqual(journal.getIds(), ["p2", "p1"]);
	});

	test("numeric ids work", async () => {
		const journal = await new Journal({
			path: await tempPath(),
			schema: noteSchema,
			idKey: (note) => note.n,
		}).load();
		journal.addEntry({ n: 0, text: "zero is a valid id" });
		assert.deepStrictEqual(journal.getEntry(0), {
			n: 0,
			text: "zero is a valid id",
		});
	});
});

describe("Journal isolation", () => {
	test("mutating an added object does not change the journal", async () => {
		const product = { ...KETTLE };
		const journal = (await productJournal()).addEntry(product);
		product.price = 0;
		assert.strictEqual(journal.getEntry("p1")?.price, 30);
	});

	test("mutating a returned entry does not change the journal", async () => {
		const journal = (await productJournal()).addEntry({
			...KETTLE,
			tags: ["kitchen"],
		});
		const entry = journal.getEntry("p1");
		entry?.tags?.push("sale");
		const all = journal.getEntries();
		if (all[0]) all[0].price = 0;
		assert.deepStrictEqual(journal.getEntry("p1"), {
			...KETTLE,
			tags: ["kitchen"],
		});
	});
});

describe("Journal writes", () => {
	test("addEntry validates", async () => {
		const journal = await productJournal();
		assert.throws(
			() => journal.addEntry({ ...KETTLE, price: -5 }),
			JournalError,
		);
		assert.strictEqual(journal.hasEntry("p1"), false);
	});

	test("addEntry refuses an existing id", async () => {
		const journal = (await productJournal()).addEntry(KETTLE);
		assert.throws(() => journal.addEntry(KETTLE), JournalError);
	});

	test("addEntry rejects an empty or non-finite id", async () => {
		const journal = await new Journal({
			path: await tempPath(),
			schema: noteSchema,
			idKey: (note) => note.text,
		}).load();
		assert.throws(() => journal.addEntry({ n: 1, text: "  " }), JournalError);
		const numeric = await new Journal({
			path: await tempPath(),
			schema: noteSchema,
			idKey: (note) => note.n,
		}).load();
		assert.throws(
			() => numeric.addEntry({ n: Number.POSITIVE_INFINITY, text: "x" }),
			JournalError,
		);
	});

	test("addEntry refuses an async schema rather than skipping validation", async () => {
		const journal = await new Journal({
			path: await tempPath(),
			schema: asyncSchema,
			idKey: (e) => e.id,
		}).load();
		assert.throws(() => journal.addEntry({ id: "a" }), JournalError);
	});

	test("schema output is stored, not the raw input", async () => {
		const schema = z.object({ id: z.string(), name: z.string().trim() });
		const journal = await new Journal({
			path: await tempPath(),
			schema,
			idKey: (e) => e.id,
		}).load();
		journal.addEntry({ id: "a", name: "  padded  " });
		assert.strictEqual(journal.getEntry("a")?.name, "padded");
	});

	test("updateEntry merges a patch and re-validates", async () => {
		const journal = (await productJournal()).addEntry(KETTLE);
		journal.updateEntry("p1", { price: 25 });
		assert.deepStrictEqual(journal.getEntry("p1"), { ...KETTLE, price: 25 });
		assert.throws(() => journal.updateEntry("p1", { price: -1 }), JournalError);
		assert.strictEqual(journal.getEntry("p1")?.price, 25);
	});

	test("updateEntry throws for a missing entry", async () => {
		const journal = await productJournal();
		assert.throws(() => journal.updateEntry("p1", { price: 1 }), JournalError);
	});

	test("updateEntry refuses to change the id", async () => {
		const journal = (await productJournal()).addEntry(KETTLE);
		assert.throws(() => journal.updateEntry("p1", { id: "p9" }), JournalError);
		assert.deepStrictEqual(journal.getIds(), ["p1"]);
	});

	test("upsertEntry adds when absent and merges when present", async () => {
		const journal = (await productJournal()).upsertEntry({
			...KETTLE,
			tags: ["kitchen"],
		});
		journal.upsertEntry({ ...KETTLE, price: 20 });
		assert.deepStrictEqual(journal.getEntry("p1"), {
			...KETTLE,
			price: 20,
			tags: ["kitchen"],
		});
	});

	test("deleteEntry removes an entry, and is a no-op for an absent one", async () => {
		const journal = (await productJournal()).addEntry(KETTLE);
		journal.deleteEntry(KETTLE).deleteEntry("nope");
		assert.deepStrictEqual(journal.getEntries(), []);
	});
});

describe("Journal snapshots", () => {
	test("getSavedEntry keeps the saved version while the working copy changes", async () => {
		const journal = await (await productJournal()).addEntry(KETTLE).save();
		journal.updateEntry("p1", { price: 0 });
		assert.strictEqual(journal.getEntry("p1")?.price, 0);
		assert.strictEqual(journal.getSavedEntry("p1")?.price, 30);
	});

	test("getSavedEntry is undefined for an entry added since the last save", async () => {
		const journal = (await productJournal()).addEntry(KETTLE);
		assert.strictEqual(journal.getSavedEntry("p1"), undefined);
	});

	test("dirty tracks unsaved changes", async () => {
		const journal = await productJournal();
		assert.strictEqual(journal.dirty, false);
		journal.addEntry(KETTLE);
		assert.strictEqual(journal.dirty, true);
		await journal.save();
		assert.strictEqual(journal.dirty, false);
		journal.updateEntry("p1", { price: 1 });
		assert.strictEqual(journal.dirty, true);
		journal.revert();
		assert.strictEqual(journal.dirty, false);
	});

	test("revert restores every entry to the saved snapshot", async () => {
		const journal = await (await productJournal()).addEntry(KETTLE).save();
		journal.updateEntry("p1", { price: 0 }).addEntry(TOASTER);
		journal.revert();
		assert.deepStrictEqual(journal.getEntries(), [KETTLE]);
	});

	test("revertEntry restores one entry, removing it if it was never saved", async () => {
		const journal = await (await productJournal()).addEntry(KETTLE).save();
		journal.updateEntry("p1", { price: 0 }).addEntry(TOASTER);
		journal.revertEntry("p1").revertEntry(TOASTER);
		assert.deepStrictEqual(journal.getEntries(), [KETTLE]);
	});

	test("revertEntry brings back a deleted entry", async () => {
		const journal = await (await productJournal()).addEntry(KETTLE).save();
		journal.deleteEntry("p1").revertEntry("p1");
		assert.deepStrictEqual(journal.getEntry("p1"), KETTLE);
	});
});

describe("Journal.save and reset", () => {
	test("save creates missing parent directories and writes the file format", async () => {
		const path = join(
			await tempPath("unused"),
			"..",
			"nested",
			"deeper",
			"journal.json",
		);
		const journal = await new Journal({
			path,
			schema: productSchema,
			idKey: (p) => p.id,
			version: 3,
		}).load();
		await journal.addEntry(KETTLE).save();
		assert.deepStrictEqual(JSON.parse(await readFile(path, "utf8")), {
			version: 3,
			entries: [KETTLE],
		});
	});

	test("reset empties the journal on disk", async () => {
		const path = await tempPath();
		const journal = await (await productJournal(path)).addEntry(KETTLE).save();
		await journal.reset();
		assert.deepStrictEqual(journal.getEntries(), []);
		assert.strictEqual(journal.getSavedEntry("p1"), undefined);
		assert.deepStrictEqual((await productJournal(path)).getEntries(), []);
	});
});
