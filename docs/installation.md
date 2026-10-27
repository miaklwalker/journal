---

title: "Installation"
description: "Add Journal to a project: no runtime dependencies, bring your own Standard Schema validator, shipped as TypeScript source."
---

```bash
npm install @michaelrwalker/journal
```

You'll also want a validator that implements
[Standard Schema](https://standardschema.dev), unless you write schemas by
hand:

```bash
npm install zod
```

## What you get

Journal has no runtime dependencies. The Standard Schema interface is copied
into the package, as the spec allows, so it works with any compliant
validator without depending on one.

It reads and writes files with `node:fs/promises`, which is also available
under Bun and Deno.

The package ships as TypeScript source rather than compiled JavaScript with a
`.d.ts` shadow. `package.json` points `main` and `types` both at `main.ts`:

```json
{
	"main": "main.ts",
	"types": "main.ts",
	"exports": { ".": "./main.ts" }
}
```

If your project compiles TypeScript through a bundler or runs it directly
(Node with type stripping, Bun, Deno), there's nothing to configure.
Otherwise your toolchain needs to transform `.ts` files from `node_modules`.

## Importing

```ts
import { Journal, versions } from "@michaelrwalker/journal";
```

Everything comes from that one entry point: `Journal`, `versions`,
`JournalError`, the `validateSync`, `validateAsync` and `formatIssues`
helpers, and the supporting types. See [Journal API](reference/api).

## Running the examples locally

From a clone of the repository:

```bash
node --experimental-transform-types --disable-warning=ExperimentalWarning examples/basic.ts
```
