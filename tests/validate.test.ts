import assert from "node:assert";
import test, { describe } from "node:test";
import {
	formatIssues,
	JournalError,
	validateAsync,
	validateSync,
} from "../modules/index.ts";
import { asyncSchema, noteSchema } from "./support.ts";

describe("formatIssues", () => {
	test("joins path segments and path-segment objects with dots", () => {
		assert.strictEqual(
			formatIssues([
				{ message: "Required", path: ["entries", 2, { key: "name" }] },
			]),
			"  - entries.2.name: Required",
		);
	});

	test("an issue without a path is labelled as the root", () => {
		assert.strictEqual(
			formatIssues([{ message: "Bad" }, { message: "Worse", path: [] }]),
			"  - (root): Bad\n  - (root): Worse",
		);
	});
});

describe("validateSync and validateAsync", () => {
	test("return the schema's output on success", async () => {
		assert.deepStrictEqual(
			validateSync(noteSchema, { n: 1, text: "a", extra: true }, "here"),
			{ n: 1, text: "a" },
		);
		assert.deepStrictEqual(
			await validateAsync(asyncSchema, { id: "a" }, "here"),
			{ id: "a" },
		);
	});

	test("throw JournalError with the issues on failure", () => {
		assert.throws(
			() => validateSync(noteSchema, {}, "in a test"),
			(error: unknown) =>
				error instanceof JournalError &&
				error.message.startsWith("Invalid entry in a test") &&
				error.issues.length === 1,
		);
	});

	test("validateSync refuses an async schema", () => {
		assert.throws(
			() => validateSync(asyncSchema, { id: "a" }, "here"),
			JournalError,
		);
	});
});
