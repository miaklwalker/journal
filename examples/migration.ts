import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { Journal, versions } from "../main.ts";

const path = join(tmpdir(), "journal-example", "migration", "products.json");
await rm(join(path, ".."), { recursive: true, force: true });

// Each schema is written out in full and never derived from a later one.
// v0 must keep describing what old files actually contain, whatever v2 becomes.
const v0 = z.object({ id: z.string(), title: z.string(), price: z.number() });
const v1 = z.object({
	id: z.string(),
	title: z.string(),
	price: z.object({ amount: z.number(), currency: z.string() }),
});
const v2 = z.object({
	id: z.string(),
	title: z.string(),
	price: z.object({ amount: z.number(), currency: z.string() }),
	archived: z.boolean(),
});

// Last month's script only knew v0, and left a journal behind.
const old = await new Journal({ path, schema: v0, idKey: (p) => p.id }).load();
old.addEntry({ id: "sku-1", title: "Kettle", price: 30 });
old.addEntry({ id: "sku-2", title: "Toaster", price: 45 });
await old.save();

// Today's script knows the whole chain. Each migration is typed by the
// schema before it, so `product.price` is a number in the first and an
// object in the second, without writing a type.
const productVersions = versions(v0)
	.next(v1, (product) => ({
		...product,
		price: { amount: product.price, currency: "USD" },
	}))
	.next(v2, (product) => ({ ...product, archived: false }));

const journal = await new Journal({
	path,
	versions: productVersions,
	idKey: (product) => product.id,
}).load();

console.log(`Loaded a v${journal.migratedFrom} file as v${journal.version}.`);
console.log("Entries:", journal.getEntries());
console.log("Dirty before save:", journal.dirty);

// Saving writes v2 and keeps the untouched v0 file beside it.
await journal.save();
console.log("Dirty after save:", journal.dirty);
console.log(
	`Backup at ${journal.backupPath(0)}:`,
	JSON.parse(await readFile(journal.backupPath(0), "utf8")),
);
