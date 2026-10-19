/**
 * Module resolution for `node --test` on TypeScript sources.
 *
 * The app is built by Next/Turbopack, which resolves extensionless imports and
 * the `@/` alias. Node's type stripping runs the same files directly, but its
 * ESM resolver wants a file extension, so this hook fills that one gap. No new
 * dependency: `registerHooks` is built into Node 22.15+.
 */
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = pathToFileURL(`${process.cwd()}/`);
const typed = /\.(?:ts|mts|js|mjs|json)$/;

registerHooks({
  resolve(specifier, context, nextResolve) {
    let target;
    if (specifier.startsWith("@/")) {
      target = new URL(specifier.slice(2), root).href;
    } else if (specifier.startsWith(".") && context.parentURL) {
      target = new URL(specifier, context.parentURL).href;
    } else {
      return nextResolve(specifier, context);
    }

    if (typed.test(target)) return nextResolve(target, context);

    const candidate = new URL(`${target}.ts`);
    if (existsSync(fileURLToPath(candidate))) {
      return nextResolve(candidate.href, context);
    }

    return nextResolve(target, context);
  },
});
