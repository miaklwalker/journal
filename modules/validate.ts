import type { StandardSchemaV1 } from "./standardSchema.ts";
import { JournalError } from "./types.ts";

/**
 * Renders validator issues as one `  - path: message` line each. Standard
 * Schema leaves formatting to the consumer, so this is the lowest common
 * denominator every vendor's issues fit into.
 */
export function formatIssues(
	issues: ReadonlyArray<StandardSchemaV1.Issue>,
): string {
	return issues
		.map((issue) => {
			const path = (issue.path ?? [])
				.map((segment) =>
					String(typeof segment === "object" ? segment.key : segment),
				)
				.join(".");
			return `  - ${path === "" ? "(root)" : path}: ${issue.message}`;
		})
		.join("\n");
}

/**
 * Validates synchronously. Mutations stay synchronous so a script can call
 * `addEntry` without awaiting, which means a schema with async refinements
 * can only be used by {@link Journal.load}; anywhere else it throws rather
 * than silently skipping validation.
 */
export function validateSync<TOutput>(
	schema: StandardSchemaV1<unknown, TOutput>,
	value: unknown,
	where: string,
): TOutput {
	const result = schema["~standard"].validate(value);
	if (result instanceof Promise) {
		throw new JournalError(
			`The schema validated asynchronously ${where}. Only load() supports async schemas; mutations must validate synchronously.`,
		);
	}
	return unwrap(result, where);
}

/** Validates, awaiting the schema if it is async. */
export async function validateAsync<TOutput>(
	schema: StandardSchemaV1<unknown, TOutput>,
	value: unknown,
	where: string,
): Promise<TOutput> {
	return unwrap(await schema["~standard"].validate(value), where);
}

function unwrap<TOutput>(
	result: StandardSchemaV1.Result<TOutput>,
	where: string,
): TOutput {
	if (result.issues) {
		throw new JournalError(
			`Invalid entry ${where}:\n${formatIssues(result.issues)}`,
			result.issues,
		);
	}
	return result.value;
}
