import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after } from "node:test";
import { z } from "zod";
import { Journal, type StandardSchemaV1 } from "../modules/index.ts";

export const productSchema = z.object({
	id: z.string().min(1),
	title: z.string(),
	price: z.number().nonnegative(),
	tags: z.array(z.string()).optional(),
});

export type Product = z.output<typeof productSchema>;

export const KETTLE: Product = { id: "p1", title: "Kettle", price: 30 };
export const TOASTER: Product = { id: "p2", title: "Toaster", price: 45 };

const directories: string[] = [];

after(async () => {
	await Promise.all(
		directories.map((directory) =>
			rm(directory, { recursive: true, force: true }),
		),
	);
});

/** A path inside a fresh temp directory, removed when the test file finishes. */
export async function tempPath(name = "journal.json"): Promise<string> {
	const directory = await mkdtemp(join(tmpdir(), "journal-test-"));
	directories.push(directory);
	return join(directory, name);
}

/** A loaded product journal at a fresh path. */
export async function productJournal(path?: string) {
	return new Journal({
		path: path ?? (await tempPath()),
		schema: productSchema,
		idKey: (product) => product.id,
	}).load();
}

/**
 * A hand-written Standard Schema with no library behind it, proving the
 * journal depends on the spec and nothing else.
 */
export const noteSchema: StandardSchemaV1<{ n: number; text: string }> = {
	"~standard": {
		version: 1,
		vendor: "test",
		validate(value) {
			if (
				typeof value === "object" &&
				value !== null &&
				"n" in value &&
				typeof value.n === "number" &&
				"text" in value &&
				typeof value.text === "string"
			) {
				return { value: { n: value.n, text: value.text } };
			}
			return {
				issues: [{ message: "Expected a note", path: [{ key: "text" }] }],
			};
		},
	},
};

/** A schema that always validates asynchronously, like a Zod schema with an async refine. */
export const asyncSchema: StandardSchemaV1<{ id: string }> = {
	"~standard": {
		version: 1,
		vendor: "test",
		validate: async (value) => ({ value: value as { id: string } }),
	},
};

export type Equal<A, B> =
	(<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
		? true
		: false;

export type Expect<T extends true> = T;
