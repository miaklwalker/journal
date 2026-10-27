import type { EntryInput, EntryOf, EntrySchema } from "./types.ts";
import { JournalError } from "./types.ts";
import { validateAsync } from "./validate.ts";

/**
 * Turns an entry of one version into the input of the next. Receives the
 * previous schema's output and must return something the next schema accepts.
 * May be async, since migrations only ever run inside {@link Journal.load}.
 */
export type Migration<TFrom extends EntrySchema, TTo extends EntrySchema> = (
	previous: EntryOf<TFrom>,
) => EntryInput<TTo> | Promise<EntryInput<TTo>>;

/** Options for {@link versions}. */
export interface VersionsOptions {
	/**
	 * The version number of the first schema in the chain. Defaults to `0`.
	 * Raise it when you delete the oldest schemas, so the ones that remain keep
	 * their numbers and existing files still line up.
	 */
	from?: number;
}

/**
 * One link in the chain, with its generics erased. `migrate` uses method
 * syntax on purpose: method parameters are checked bivariantly, so a
 * migration written against a specific entry type can be stored here without
 * an `any`. The {@link Versions.next} signature is what keeps it type-safe.
 */
interface Step {
	readonly schema: EntrySchema;
	migrate?(previous: unknown): unknown;
}

/**
 * An ordered chain of schemas, each with a migration from the one before it.
 * Version numbers come from position in the chain, so a version can't be
 * skipped, reordered, or added without its migration. Build one with
 * {@link versions}.
 *
 * Chains are immutable: `.next()` returns a new chain, so a shared base can
 * be extended in two places without either seeing the other's versions.
 */
export class Versions<TSchema extends EntrySchema> {
	/** The version number of the first schema in the chain. */
	readonly from: number;
	private readonly steps: readonly Step[];

	/** @internal Use {@link versions} to start a chain. */
	constructor(steps: readonly Step[], from: number) {
		this.steps = steps;
		this.from = from;
	}

	/** The current version: the number of the last schema in the chain. */
	get version(): number {
		return this.from + this.steps.length - 1;
	}

	/** The current schema, which the journal validates new entries with. */
	get schema(): TSchema {
		return (this.steps[this.steps.length - 1] as Step).schema as TSchema;
	}

	/**
	 * Adds the next version. `migrate` receives an entry already validated
	 * against the current last schema, and its return value is validated
	 * against `schema` before the next step runs.
	 */
	next<TNext extends EntrySchema>(
		schema: TNext,
		migrate: Migration<TSchema, TNext>,
	): Versions<TNext> {
		return new Versions<TNext>([...this.steps, { schema, migrate }], this.from);
	}

	/**
	 * Brings one stored value from `fromVersion` up to the current version,
	 * validating it at every step. The journal calls this on load; it is
	 * public so a chain can be tested on its own, without writing files.
	 */
	async migrate(
		value: unknown,
		fromVersion: number,
		where = "passed to migrate",
	): Promise<EntryOf<TSchema>> {
		this.assertSupported(fromVersion, where);
		const start = fromVersion - this.from;
		let current = await validateAsync(
			(this.steps[start] as Step).schema,
			value,
			`${where} (as version ${fromVersion})`,
		);
		for (let index = start + 1; index < this.steps.length; index += 1) {
			const step = this.steps[index] as Step;
			const version = this.from + index;
			let migrated: unknown;
			try {
				migrated = await step.migrate?.(current);
			} catch (error) {
				throw new JournalError(
					`Migration v${version - 1}→v${version} failed ${where}: ${error instanceof Error ? error.message : String(error)}`,
					[],
					{ cause: error },
				);
			}
			current = await validateAsync(
				step.schema,
				migrated,
				`${where} after migration v${version - 1}→v${version}`,
			);
		}
		return current as EntryOf<TSchema>;
	}

	/**
	 * Throws unless a file written at `version` can be read by this chain.
	 * Separate from {@link migrate} so the journal can reject a whole file
	 * before looking at any of its entries.
	 */
	assertSupported(version: unknown, where: string): asserts version is number {
		if (typeof version !== "number" || !Number.isInteger(version)) {
			throw new JournalError(
				`Version ${JSON.stringify(version)} ${where} is not an integer.`,
			);
		}
		if (version > this.version) {
			throw new JournalError(
				`Version ${version} ${where} was written by newer code. This journal only knows versions up to ${this.version}.`,
			);
		}
		if (version < this.from) {
			throw new JournalError(
				`Version ${version} ${where} is too old. The oldest version this journal can migrate from is ${this.from}.`,
			);
		}
	}
}

/**
 * Starts a version chain at `schema`. Add later versions with `.next()`,
 * then pass the chain to {@link Journal} as `versions` in place of `schema`.
 *
 * ```ts
 * const productVersions = versions(z.object({ id: z.string(), price: z.number() }))
 * 	.next(
 * 		z.object({ id: z.string(), price: z.object({ amount: z.number(), currency: z.string() }) }),
 * 		(v0) => ({ ...v0, price: { amount: v0.price, currency: "USD" } }),
 * 	);
 * ```
 *
 * Keep old schemas frozen. Never derive one from the current schema, or the
 * old version changes whenever the current one does.
 */
export function versions<TSchema extends EntrySchema>(
	schema: TSchema,
	options: VersionsOptions = {},
): Versions<TSchema> {
	const from = options.from ?? 0;
	if (!Number.isInteger(from) || from < 0) {
		throw new JournalError(
			`A version chain must start at a non-negative integer, got ${String(from)}.`,
		);
	}
	return new Versions<TSchema>([{ schema }], from);
}
