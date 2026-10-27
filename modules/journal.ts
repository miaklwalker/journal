import {
	constants,
	copyFile,
	mkdir,
	readFile,
	rename,
	writeFile,
} from "node:fs/promises";
import { dirname, format, parse } from "node:path";
import {
	type EntryId,
	type EntryInput,
	type EntryOf,
	type EntryRef,
	type EntrySchema,
	type JournalFile,
	JournalError,
	type JournalOptions,
} from "./types.ts";
import { validateSync } from "./validate.ts";
import { type Versions, versions } from "./versions.ts";

function isObject(value: unknown): value is object {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * A typed, file-backed record of entries keyed by id — the persistent
 * counterpart to a cache. It keeps two copies of everything: the working set
 * you mutate, and the snapshot last written to disk. That second copy is the
 * point. Snapshot something before you change it elsewhere, and if the change
 * goes wrong the journal still knows what it used to be.
 *
 * Entries are cloned on the way in and on the way out, so mutating an object
 * you added, or one you got back, never reaches into the journal behind its
 * back.
 *
 * ```ts
 * const journal = new Journal({
 * 	path: "./journal/products.json",
 * 	schema: z.object({ id: z.string(), title: z.string(), price: z.number() }),
 * 	idKey: (product) => product.id,
 * 	version: 0,
 * });
 * await journal.load();
 *
 * journal.upsertEntry(product); // snapshot it before touching the real thing
 * await journal.save();
 *
 * await shop.updateProduct(product.id, { price: 0 }); // something goes wrong
 * const before = journal.getSavedEntry(product.id);   // still the old product
 * ```
 */
export class Journal<
	TSchema extends EntrySchema,
	TId extends EntryId = EntryId,
> {
	readonly path: string;
	readonly versions: Versions<TSchema>;
	private readonly idKey: (entry: EntryOf<TSchema>) => TId;
	private entries = new Map<TId, EntryOf<TSchema>>();
	private saved = new Map<TId, EntryOf<TSchema>>();
	private _loaded = false;
	private _migratedFrom: number | undefined;
	/** Set until the first save after a migrated load, which backs the old file up. */
	private pendingBackup: number | undefined;

	constructor(options: JournalOptions<TSchema, TId>) {
		if (!options.path) {
			throw new JournalError(
				"Journal path is empty. Pass a file path as `path`.",
			);
		}
		this.path = options.path;
		this.versions =
			options.versions ?? versions(options.schema, { from: options.version });
		this.idKey = options.idKey;
	}

	/** The current schema: the last one in the version chain. */
	get schema(): TSchema {
		return this.versions.schema;
	}

	/** The current version, written into the file on save. */
	get version(): number {
		return this.versions.version;
	}

	/**
	 * The version the file was at when it was loaded, if it was older than
	 * {@link version} and had to be migrated. `undefined` when no migration
	 * ran, including when there was no file.
	 */
	get migratedFrom(): number | undefined {
		this.assertLoaded("migratedFrom");
		return this._migratedFrom;
	}

	/** Whether {@link load} has completed. Every other method requires it. */
	get loaded(): boolean {
		return this._loaded;
	}

	/**
	 * Whether the working set differs from what is on disk. After a migrated
	 * load this is `true` until the next save, since the file still holds the
	 * old version.
	 */
	get dirty(): boolean {
		this.assertLoaded("dirty");
		if (this.pendingBackup !== undefined) return true;
		if (this.entries.size !== this.saved.size) return true;
		for (const [id, entry] of this.entries) {
			const saved = this.saved.get(id);
			if (
				saved === undefined ||
				JSON.stringify(saved) !== JSON.stringify(entry)
			) {
				return true;
			}
		}
		return false;
	}

	/**
	 * Reads and validates the file at `path`. A missing file is an empty
	 * journal, not an error, so the first run of a script needs no setup.
	 * This is the only async validation point: schemas with async refinements
	 * work here, but not in the synchronous mutators.
	 *
	 * A file at an older version is migrated up the version chain in memory,
	 * one entry at a time and validated at every step. Nothing is written
	 * until {@link save}, which backs the old file up first.
	 */
	async load(): Promise<this> {
		const entries = new Map<TId, EntryOf<TSchema>>();
		const indexes = new Map<TId, number>();
		const raw = await this.readFile();
		let migratedFrom: number | undefined;

		if (raw !== undefined) {
			const file = this.parseFile(raw);
			if (file.version < this.version) migratedFrom = file.version;
			for (const [index, value] of file.entries.entries()) {
				const entry = await this.versions.migrate(
					value,
					file.version,
					`at entries[${index}] of ${this.path}`,
				);
				const id = this.idOf(entry);
				const first = indexes.get(id);
				if (first !== undefined) {
					throw new JournalError(
						`Duplicate id ${String(id)} at entries[${first}] and entries[${index}] of ${this.path}${migratedFrom === undefined ? "" : ` after migrating from version ${migratedFrom}`}.`,
					);
				}
				indexes.set(id, index);
				entries.set(id, entry);
			}
		}

		this.entries = entries;
		this.saved = structuredClone(entries);
		this._migratedFrom = migratedFrom;
		this.pendingBackup = migratedFrom;
		this._loaded = true;
		return this;
	}

	/** Whether an entry with this id is in the working set. */
	hasEntry(ref: EntryRef<TSchema, TId>): boolean {
		this.assertLoaded("hasEntry");
		return this.entries.has(this.resolveId(ref));
	}

	/** A copy of the working entry, or `undefined` if there isn't one. */
	getEntry(ref: EntryRef<TSchema, TId>): EntryOf<TSchema> | undefined {
		this.assertLoaded("getEntry");
		return cloneOrUndefined(this.entries.get(this.resolveId(ref)));
	}

	/**
	 * A copy of the entry as it was at the last {@link load} or {@link save},
	 * regardless of any changes since. This is what you reach for to undo a
	 * change made outside the journal.
	 */
	getSavedEntry(ref: EntryRef<TSchema, TId>): EntryOf<TSchema> | undefined {
		this.assertLoaded("getSavedEntry");
		return cloneOrUndefined(this.saved.get(this.resolveId(ref)));
	}

	/** Copies of every working entry, in insertion order. */
	getEntries(): EntryOf<TSchema>[] {
		this.assertLoaded("getEntries");
		return Array.from(this.entries.values(), (entry) => structuredClone(entry));
	}

	/** Every id in the working set, in insertion order. */
	getIds(): TId[] {
		this.assertLoaded("getIds");
		return Array.from(this.entries.keys());
	}

	/** Validates and adds a new entry. Throws if its id is already present. */
	addEntry(input: EntryInput<TSchema>): this {
		this.assertLoaded("addEntry");
		const entry = validateSync(
			this.schema,
			structuredClone(input),
			"passed to addEntry",
		);
		const id = this.idOf(entry);
		if (this.entries.has(id)) {
			throw new JournalError(
				`Entry ${String(id)} already exists. Use updateEntry or upsertEntry to change it.`,
			);
		}
		this.entries.set(id, entry);
		return this;
	}

	/**
	 * Shallow-merges `patch` over an existing entry and re-validates the
	 * result. The patch may not change the entry's id, since the journal
	 * would then hold it under a key it no longer has.
	 */
	updateEntry(
		ref: EntryRef<TSchema, TId>,
		patch: Partial<EntryOf<TSchema>>,
	): this {
		this.assertLoaded("updateEntry");
		const id = this.resolveId(ref);
		const existing = this.entries.get(id);
		if (existing === undefined) {
			throw new JournalError(
				`Entry ${String(id)} does not exist. Use addEntry or upsertEntry to create it.`,
			);
		}
		this.replace(id, { ...existing, ...structuredClone(patch) }, "updateEntry");
		return this;
	}

	/**
	 * Adds the entry, or replaces the existing one with the same id. Fields
	 * missing from `input` are carried over from the existing entry, matching
	 * {@link updateEntry}.
	 */
	upsertEntry(input: EntryInput<TSchema>): this {
		this.assertLoaded("upsertEntry");
		const entry = validateSync(
			this.schema,
			structuredClone(input),
			"passed to upsertEntry",
		);
		const id = this.idOf(entry);
		const existing = this.entries.get(id);
		if (existing === undefined) {
			this.entries.set(id, entry);
		} else {
			this.replace(id, { ...existing, ...entry }, "upsertEntry");
		}
		return this;
	}

	/** Removes an entry from the working set. Removing an absent id is a no-op. */
	deleteEntry(ref: EntryRef<TSchema, TId>): this {
		this.assertLoaded("deleteEntry");
		this.entries.delete(this.resolveId(ref));
		return this;
	}

	/**
	 * Writes the working set to disk and makes it the new saved snapshot. The
	 * file is written beside the target and renamed into place, so a crash
	 * mid-write leaves the previous journal intact rather than half a file.
	 *
	 * The first save after a migrated load copies the old file to
	 * {@link backupPath} before overwriting it, unless a backup of that
	 * version already exists — the earliest copy is the one worth keeping.
	 */
	async save(): Promise<this> {
		this.assertLoaded("save");
		if (this.pendingBackup !== undefined) {
			await this.backup(this.pendingBackup);
		}
		const payload: JournalFile<EntryOf<TSchema>> = {
			version: this.version,
			entries: Array.from(this.entries.values()),
		};
		const temporary = `${this.path}.${process.pid}.tmp`;
		await mkdir(dirname(this.path), { recursive: true });
		await writeFile(temporary, `${JSON.stringify(payload, null, "\t")}\n`);
		await rename(temporary, this.path);
		this.saved = structuredClone(this.entries);
		this.pendingBackup = undefined;
		return this;
	}

	/**
	 * Where the copy of a file at `version` goes before a migrated save
	 * overwrites it: beside the journal, with the version before the
	 * extension (`products.json` → `products.v0.json`).
	 */
	backupPath(version: number): string {
		const { dir, name, ext } = parse(this.path);
		return format({ dir, name: `${name}.v${version}`, ext });
	}

	/** Discards every unsaved change, restoring the last saved snapshot. */
	revert(): this {
		this.assertLoaded("revert");
		this.entries = structuredClone(this.saved);
		return this;
	}

	/**
	 * Discards unsaved changes to one entry. An entry that was added since the
	 * last save is removed; one that was deleted comes back.
	 */
	revertEntry(ref: EntryRef<TSchema, TId>): this {
		this.assertLoaded("revertEntry");
		const id = this.resolveId(ref);
		const saved = this.saved.get(id);
		if (saved === undefined) {
			this.entries.delete(id);
		} else {
			this.entries.set(id, structuredClone(saved));
		}
		return this;
	}

	/** Empties the journal and writes the empty file to disk. */
	async reset(): Promise<this> {
		this.assertLoaded("reset");
		this.entries.clear();
		return this.save();
	}

	private replace(id: TId, merged: unknown, where: string): void {
		const entry = validateSync(this.schema, merged, `after ${where}`);
		const nextId = this.idOf(entry);
		if (nextId !== id) {
			throw new JournalError(
				`${where} would change the id of entry ${String(id)} to ${String(nextId)}. Delete it and add a new entry instead.`,
			);
		}
		this.entries.set(id, entry);
	}

	private idOf(entry: EntryOf<TSchema>): TId {
		const id: unknown = this.idKey(entry);
		if (
			(typeof id === "number" && Number.isFinite(id)) ||
			(typeof id === "string" && id.trim() !== "")
		) {
			return id as TId;
		}
		throw new JournalError(
			`idKey returned ${JSON.stringify(id) ?? String(id)}. It must return a non-empty string or a finite number.`,
		);
	}

	private resolveId(ref: EntryRef<TSchema, TId>): TId {
		return isObject(ref) ? this.idOf(ref) : (ref as TId);
	}

	private assertLoaded(name: string): void {
		if (!this._loaded) {
			throw new JournalError(
				`Cannot use ${name} before the journal is loaded. Call await journal.load() first.`,
			);
		}
	}

	private async backup(version: number): Promise<void> {
		try {
			await copyFile(
				this.path,
				this.backupPath(version),
				constants.COPYFILE_EXCL,
			);
		} catch (error) {
			// EEXIST: an earlier backup of this version wins. ENOENT: the old
			// file was removed since load, so there is nothing left to keep.
			if (
				isObject(error) &&
				"code" in error &&
				(error.code === "EEXIST" || error.code === "ENOENT")
			) {
				return;
			}
			throw error;
		}
	}

	private async readFile(): Promise<string | undefined> {
		try {
			return await readFile(this.path, "utf8");
		} catch (error) {
			if (isObject(error) && "code" in error && error.code === "ENOENT") {
				return undefined;
			}
			throw error;
		}
	}

	private parseFile(raw: string): { version: number; entries: unknown[] } {
		let parsed: unknown;
		try {
			parsed = JSON.parse(raw);
		} catch (error) {
			throw new JournalError(
				`${this.path} is not valid JSON: ${(error as Error).message}`,
			);
		}
		if (
			!isObject(parsed) ||
			!("version" in parsed) ||
			!("entries" in parsed) ||
			!Array.isArray(parsed.entries)
		) {
			throw new JournalError(
				`${this.path} is not a journal file. Expected { "version": number, "entries": [...] }.`,
			);
		}
		this.versions.assertSupported(parsed.version, `of ${this.path}`);
		return { version: parsed.version, entries: parsed.entries };
	}
}

function cloneOrUndefined<T>(value: T | undefined): T | undefined {
	return value === undefined ? undefined : structuredClone(value);
}
