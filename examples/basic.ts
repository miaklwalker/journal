import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { Journal } from "../main.ts";

// A stand-in for a remote system the script is changing: a shop's product API.
const shop = new Map([
	["sku-1", { id: "sku-1", title: "Kettle", price: 30 }],
	["sku-2", { id: "sku-2", title: "Toaster", price: 45 }],
]);

const journal = new Journal({
	path: join(tmpdir(), "journal-example", "products.json"),
	schema: z.object({ id: z.string(), title: z.string(), price: z.number() }),
	idKey: (product) => product.id,
	version: 0,
});
await journal.load();

// Snapshot everything before touching it, and save immediately, so the old
// state survives even if this process dies halfway through the loop.
for (const product of shop.values()) journal.upsertEntry(product);
await journal.save();

// The risky part: a bulk price change that goes wrong on the second product.
try {
	for (const id of journal.getIds()) {
		const product = shop.get(id);
		if (!product) continue;
		if (id === "sku-2") throw new Error("Shop API timed out");
		product.price = Math.round(product.price * 0.8);
	}
} catch (error) {
	console.log(
		`Failed: ${(error as Error).message}. Rolling back from the journal.`,
	);
	for (const id of journal.getIds()) {
		const before = journal.getSavedEntry(id);
		if (before) shop.set(id, before);
	}
}

console.log("Shop after rollback:", [...shop.values()]);

// A later run (or a separate recovery script) sees the same snapshot on disk.
const recovered = await new Journal({
	path: journal.path,
	schema: journal.schema,
	idKey: (product) => product.id,
}).load();
console.log("Journal on disk:", recovered.getEntries());

await recovered.reset();
