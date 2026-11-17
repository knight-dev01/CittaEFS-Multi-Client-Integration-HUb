// Bundles server.ts into dist/server.cjs. Dependencies stay external
// (installed node_modules) except those in BUNDLED, which are compiled into
// the output so the server never depends on the host installing them at
// runtime (Render's install did not provide nodemailer).
const esbuild = require("esbuild");
const pkg = require("../package.json");

const BUNDLED = new Set(["nodemailer"]);

// If the host's installer skipped a bundled package, install it now so the
// bundle is complete (fails the build loudly if that is impossible).
for (const name of BUNDLED) {
  try {
    require.resolve(name);
  } catch {
    const version = pkg.dependencies[name];
    console.warn(`[build] ${name} missing from node_modules - installing ${name}@${version}`);
    require("child_process").execSync(`npm install --no-save --no-audit --no-fund ${name}@${version}`, { stdio: "inherit" });
  }
}
const external = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies, ...(pkg.optionalDependencies || {}) })
  .filter((name) => !BUNDLED.has(name))
  .flatMap((name) => [name, `${name}/*`]);

esbuild
  .build({
    entryPoints: ["server.ts"],
    bundle: true,
    platform: "node",
    format: "cjs",
    sourcemap: true,
    outfile: "dist/server.cjs",
    external: [...external, ".prisma/*", "@prisma/*"],
    logLevel: "warning",
  })
  .catch(() => process.exit(1));
