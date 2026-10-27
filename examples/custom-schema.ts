import { tmpdir } from "node:os";
import { join } from "node:path";
import { Journal, JournalError, type StandardSchemaV1 } from "../main.ts";

// The journal doesn't know about Zod. It accepts anything implementing
// Standard Schema, which is every mainstream validator — or, as here, a few
// lines of your own when pulling in a library isn't worth it.
interface Order {
	shop: string;
	number: number;
	status: "open" | "shipped";
}

const orderSchema: StandardSchemaV1<Order> = {
	"~standard": {
		version: 1,
		vendor: "example",
		validate(value) {
			const v = value as Partial<Order>;
			const issues: StandardSchemaV1.Issue[] = [];
			if (typeof v.shop !== "string")
				issues.push({ message: "Expected a string", path: ["shop"] });
			if (!Number.isInteger(v.number))
				issues.push({ message: "Expected an integer", path: ["number"] });
			if (v.status !== "open" && v.status !== "shipped") {
				issues.push({
					message: 'Expected "open" or "shipped"',
					path: ["status"],
				});
			}
			return issues.length > 0 ? { issues } : { value: value as Order };
		},
	},
};

// idKey is a function rather than a property name, so a composite key across
// two fields is no harder than a single one.
const journal = await new Journal({
	path: join(tmpdir(), "journal-example", "orders.json"),
	schema: orderSchema,
	idKey: (order) => `${order.shop}:${order.number}`,
}).load();

journal.addEntry({ shop: "eu", number: 1001, status: "open" });
journal.addEntry({ shop: "us", number: 1001, status: "open" });
journal.updateEntry("eu:1001", { status: "shipped" });
console.log(journal.getEntries());

try {
	// A JavaScript caller, or data from an API, can still get this wrong.
	journal.addEntry(
		JSON.parse('{ "shop": "eu", "number": 1002, "status": "lost" }'),
	);
} catch (error) {
	if (error instanceof JournalError) console.log(error.message);
}

await journal.reset();
