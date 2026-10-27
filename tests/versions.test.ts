import assert from "node:assert";
import { readFile, writeFile } from "node:fs/promises";
import test, { describe } from "node:test";
import { z } from "zod";
import { Journal, JournalError, versions } from "../modules/index.ts";
import { tempPath } from "./support.ts";

const v0 = z.object({ id: z.string(), price: z.number() });
const v1 = z.object({
	id: z.string(),
	price: z.object({ amount: z.number(), currency: z.string() }),
});
const v2 = v1.extend({ archived: z.boolean() });

/** Records every migration call so tests can see which steps ran. */
function chain(calls: string[] = []) {
	return versions(v0)
		.next(v1, (product) => {
			calls.push(`v0→v1 ${product.id}`);
			return { ...product, price: { amount: product.price, currency: "USD" } };
		})
		.next(v2, async (product) => {
			calls.push(`v1→v2 ${product.id}`);
			return { ...product, archived: false };
		});
}

const MIGRATED = {
	id: "p1",
	price: { amount: 30, currency: "USD" },
	archived: false,
};

async function fileAt(version: number, entries: unknown[]) {
	const path = await tempPath("products.json");
	await writeFile(path, JSON.stringify({ version, entries }));
	return path;
}

function journalAt(path: string, calls?: string[]) {
	return new Journal({
		path,
		versions: chain(calls),
		idKey: (product) => product.id,
	});
}

describe("versions()", () => {
	test("numbers versions by position, starting at from", () => {
		assert.strictEqual(versions(v0).version, 0);
		assert.strictEqual(chain().version, 2);
		const late = versions(v1, { from: 3 }).next(v2, (p) => ({
			...p,
			archived: false,
		}));
		assert.strictEqual(late.from, 3);
		assert.strictEqual(late.version, 4);
		assert.strictEqual(late.schema, v2);
	});

	test("rejects a negative or fractional start", () => {
		assert.throws(() => versions(v0, { from: -1 }), JournalError);
		assert.throws(() => versions(v0, { from: 1.5 }), JournalError);
	});

	test("next returns a new chain and leaves the original alone", () => {
		const base = versions(v0);
		base.next(v1, (p) => ({ ...p, price: { amount: p.price, currency: "X" } }));
		assert.strictEqual(base.version, 0);
	});
});

describe("Versions.migrate", () => {
	test("runs every step from the given version up", async () => {
		const calls: string[] = [];
		assert.deepStrictEqual(
			await chain(calls).migrate({ id: "p1", price: 30 }, 0),
			MIGRATED,
		);
		assert.deepStrictEqual(calls, ["v0→v1 p1", "v1→v2 p1"]);
	});

	test("starts part-way up the chain", async () => {
		const calls: string[] = [];
		const value = { id: "p1", price: { amount: 30, currency: "USD" } };
		assert.deepStrictEqual(await chain(calls).migrate(value, 1), MIGRATED);
		assert.deepStrictEqual(calls, ["v1→v2 p1"]);
	});

	test("at the current version it only validates", async () => {
		const calls: string[] = [];
		assert.deepStrictEqual(await chain(calls).migrate(MIGRATED, 2), MIGRATED);
		assert.deepStrictEqual(calls, []);
	});

	test("validates the input against its own version first", async () => {
		const calls: string[] = [];
		await assert.rejects(
			chain(calls).migrate({ id: "p1", price: "30" }, 0),
			(error: unknown) =>
				error instanceof JournalError && /as version 0/.test(error.message),
		);
		assert.deepStrictEqual(calls, []);
	});

	test("a migration that returns the wrong shape fails at that step", async () => {
		const broken = versions(v0)
			// @ts-expect-error price must become an object.
			.next(v1, (p) => p)
			.next(v2, (p) => ({ ...p, archived: false }));
		await assert.rejects(
			broken.migrate({ id: "p1", price: 30 }, 0),
			(error: unknown) =>
				error instanceof JournalError &&
				/after migration v0→v1/.test(error.message) &&
				error.issues.length > 0,
		);
	});

	test("a migration that throws is wrapped with the step and the cause", async () => {
		const cause = new Error("currency service down");
		const throwing = versions(v0).next(v1, () => {
			throw cause;
		});
		await assert.rejects(
			throwing.migrate({ id: "p1", price: 30 }, 0),
			(error: unknown) => {
				assert.ok(error instanceof JournalError);
				assert.match(error.message, /Migration v0→v1 failed/);
				assert.match(error.message, /currency service down/);
				assert.strictEqual(error.cause, cause);
				return true;
			},
		);
	});

	test("rejects versions newer than the chain or older than from", async () => {
		await assert.rejects(chain().migrate(MIGRATED, 3), /newer code/);
		const late = versions(v1, { from: 1 });
		await assert.rejects(late.migrate({ id: "p1", price: 30 }, 0), /too old/);
		await assert.rejects(late.migrate({}, 0.5), JournalError);
	});
});

describe("Journal with versions", () => {
	test("schema + version is shorthand for a one-version chain", () => {
		const journal = new Journal({
			path: "x.json",
			schema: v0,
			version: 4,
			idKey: (p) => p.id,
		});
		assert.strictEqual(journal.version, 4);
		assert.strictEqual(journal.versions.from, 4);
		assert.strictEqual(journal.schema, v0);
	});

	test("an old file is migrated on load, and migratedFrom says from where", async () => {
		const calls: string[] = [];
		const journal = await journalAt(
			await fileAt(0, [{ id: "p1", price: 30 }]),
			calls,
		).load();
		assert.deepStrictEqual(journal.getEntries(), [MIGRATED]);
		assert.deepStrictEqual(journal.getSavedEntry("p1"), MIGRATED);
		assert.strictEqual(journal.migratedFrom, 0);
		assert.deepStrictEqual(calls, ["v0→v1 p1", "v1→v2 p1"]);
	});

	test("a current file and a missing file are not migrations", async () => {
		const current = await journalAt(await fileAt(2, [MIGRATED])).load();
		assert.strictEqual(current.migratedFrom, undefined);
		assert.strictEqual(current.dirty, false);
		const missing = await journalAt(await tempPath()).load();
		assert.strictEqual(missing.migratedFrom, undefined);
	});

	test("loading migrates in memory only; the file is untouched until save", async () => {
		const path = await fileAt(0, [{ id: "p1", price: 30 }]);
		const before = await readFile(path, "utf8");
		const journal = await journalAt(path).load();
		assert.strictEqual(journal.dirty, true);
		assert.strictEqual(await readFile(path, "utf8"), before);

		await journal.save();
		assert.strictEqual(journal.dirty, false);
		assert.strictEqual(journal.migratedFrom, 0);
		assert.deepStrictEqual(JSON.parse(await readFile(path, "utf8")), {
			version: 2,
			entries: [MIGRATED],
		});
	});

	test("the first save backs up the old file beside the journal", async () => {
		const path = await fileAt(0, [{ id: "p1", price: 30 }]);
		const original = await readFile(path, "utf8");
		const journal = await journalAt(path).load();
		await journal.save();

		const backup = journal.backupPath(0);
		assert.match(backup, /products\.v0\.json$/);
		assert.strictEqual(await readFile(backup, "utf8"), original);
	});

	test("an existing backup is never overwritten", async () => {
		const path = await fileAt(0, [{ id: "p1", price: 30 }]);
		const journal = journalAt(path);
		await writeFile(journal.backupPath(0), "the first backup");

		await (await journal.load()).save();
		assert.strictEqual(
			await readFile(journal.backupPath(0), "utf8"),
			"the first backup",
		);
	});

	test("only the first save after a migration makes a backup", async () => {
		const path = await fileAt(0, [{ id: "p1", price: 30 }]);
		const journal = await journalAt(path).load();
		await journal.save();
		const backup = await readFile(journal.backupPath(0), "utf8");

		await journal.updateEntry("p1", { archived: true }).save();
		assert.strictEqual(await readFile(journal.backupPath(0), "utf8"), backup);
		await assert.rejects(readFile(journal.backupPath(2), "utf8"));
	});

	test("reset also backs up a migrated file", async () => {
		const path = await fileAt(1, [MIGRATED]);
		const journal = await journalAt(path).load();
		await journal.reset();
		assert.match(await readFile(journal.backupPath(1), "utf8"), /"version":1/);
	});

	test("a migration that produces duplicate ids names both entries", async () => {
		const collapsing = versions(v0).next(v1, (p) => ({
			id: "same",
			price: { amount: p.price, currency: "USD" },
		}));
		const path = await fileAt(0, [
			{ id: "a", price: 1 },
			{ id: "b", price: 2 },
		]);
		await assert.rejects(
			new Journal({ path, versions: collapsing, idKey: (p) => p.id }).load(),
			(error: unknown) =>
				error instanceof JournalError &&
				/entries\[0\] and entries\[1\]/.test(error.message) &&
				/after migrating from version 0/.test(error.message),
		);
	});

	test("a file from newer code is rejected", async () => {
		await assert.rejects(journalAt(await fileAt(3, [])).load(), /newer code/);
	});

	test("a file older than the chain's start is rejected", async () => {
		const path = await fileAt(0, [{ id: "p1", price: 30 }]);
		const journal = new Journal({
			path,
			versions: versions(v1, { from: 1 }),
			idKey: (p) => p.id,
		});
		await assert.rejects(journal.load(), /too old/);
	});

	test("a non-integer version in the file is rejected", async () => {
		await assert.rejects(
			journalAt(await fileAt(Number.NaN, [])).load(),
			JournalError,
		);
	});

	test("reloading clears the migration state", async () => {
		const path = await fileAt(0, [{ id: "p1", price: 30 }]);
		const journal = await journalAt(path).load();
		await journal.save();
		await journal.load();
		assert.strictEqual(journal.migratedFrom, undefined);
		assert.strictEqual(journal.dirty, false);
	});
});
