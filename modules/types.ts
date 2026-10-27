import type { StandardSchemaV1 } from "./standardSchema.ts";
import type { Versions } from "./versions.ts";

/**
 * Any Standard Schema whose output is an object. Entries are merged, cloned
 * and written to JSON, so a schema that produces a bare string or number has
 * nowhere sensible to live in a journal.
 */
export type EntrySchema = StandardSchemaV1<unknown, object>;

/** What the journal stores and hands back: the schema's parsed output. */
export type EntryOf<TSchema extends EntrySchema> =
	StandardSchemaV1.InferOutput<TSchema>;

/**
 * What the journal accepts on the way in. Identical to {@link EntryOf} unless
 * the schema transforms or applies defaults.
 */
export type EntryInput<TSchema extends EntrySchema> =
	StandardSchemaV1.InferInput<TSchema>;

/** The kinds of value an entry can be keyed by. Both survive a JSON round trip. */
export type EntryId = string | number;

/**
 * Anything the journal can resolve to an id: the id itself, or a whole entry,
 * which is passed through `idKey`. Lets you write `journal.getEntry(product)`
 * when you already have the object in hand.
 */
export type EntryRef<TSchema extends EntrySchema, TId extends EntryId> =
	| TId
	| EntryOf<TSchema>;

/**
 * Options for {@link Journal}. Pass either `schema` (with an optional
 * `version`) for a journal that never migrates, or `versions` for one that
 * does. The first is shorthand for `versions: versions(schema, { from: version })`.
 */
export type JournalOptions<TSchema extends EntrySchema, TId extends EntryId> = {
	/** The JSON file the journal reads and writes. Parent directories are created on save. */
	path: string;
	/**
	 * Derives an entry's identity. A function rather than a property name so
	 * that composite or nested ids (`(e) => \`${e.shop}:${e.sku}\``) work too.
	 * Must return a non-empty string or a finite number.
	 */
	idKey: (entry: EntryOf<TSchema>) => TId;
} & (
	| {
			/** Validates every entry on the way in, and the whole file on load. */
			schema: TSchema;
			/**
			 * Stamped into the file and checked on load. Bump it when the schema
			 * changes incompatibly so a stale journal fails loudly instead of
			 * parsing into the wrong shape. Defaults to `0`.
			 */
			version?: number;
			versions?: never;
	  }
	| {
			/**
			 * A chain of schemas built with {@link versions}. Older files are
			 * migrated up to the last schema on load.
			 */
			versions: Versions<TSchema>;
			schema?: never;
			version?: never;
	  }
);

/** The on-disk shape of a journal file. */
export interface JournalFile<TEntry> {
	version: number;
	entries: TEntry[];
}

/**
 * The single error type this package throws: invalid entries, a file that
 * doesn't match the schema or version, duplicate or missing ids, and calls
 * made before {@link Journal.load}. When the failure came from the schema,
 * `issues` holds the validator's issues untouched.
 */
export class JournalError extends Error {
	override name = "JournalError";

	constructor(
		message: string,
		readonly issues: ReadonlyArray<StandardSchemaV1.Issue> = [],
		options?: ErrorOptions,
	) {
		super(message, options);
	}
}
