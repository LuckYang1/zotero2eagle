const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

require.extensions[".ts"] = (module, filename) => {
  const source = fs.readFileSync(filename, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText;
  module._compile(output, filename);
};

const testDir = path.join(require("node:process").cwd(), "unit");
for (const file of fs
  .readdirSync(testDir)
  .filter((name) => name.endsWith(".test.ts"))) {
  require(path.join(testDir, file));
}
