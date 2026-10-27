/**
 * The Standard Schema interface, copied verbatim (minus comments) from
 * https://standardschema.dev. The spec explicitly invites libraries to copy it
 * rather than depend on `@standard-schema/spec`, which is how this package
 * accepts a schema from Zod, Valibot, ArkType, Effect Schema or anything else
 * that implements it — without depending on any of them.
 */
export interface StandardSchemaV1<Input = unknown, Output = Input> {
	readonly "~standard": StandardSchemaV1.Props<Input, Output>;
}

export declare namespace StandardSchemaV1 {
	export interface Props<Input = unknown, Output = Input> {
		readonly version: 1;
		readonly vendor: string;
		readonly validate: (
			value: unknown,
		) => Result<Output> | Promise<Result<Output>>;
		readonly types?: Types<Input, Output> | undefined;
	}

	export type Result<Output> = SuccessResult<Output> | FailureResult;

	export interface SuccessResult<Output> {
		readonly value: Output;
		readonly issues?: undefined;
	}

	export interface FailureResult {
		readonly issues: ReadonlyArray<Issue>;
	}

	export interface Issue {
		readonly message: string;
		readonly path?: ReadonlyArray<PropertyKey | PathSegment> | undefined;
	}

	export interface PathSegment {
		readonly key: PropertyKey;
	}

	export interface Types<Input = unknown, Output = Input> {
		readonly input: Input;
		readonly output: Output;
	}

	export type InferInput<Schema extends StandardSchemaV1> = NonNullable<
		Schema["~standard"]["types"]
	>["input"];

	export type InferOutput<Schema extends StandardSchemaV1> = NonNullable<
		Schema["~standard"]["types"]
	>["output"];
}
