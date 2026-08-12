import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const app = await readFile(new URL("../js/app.js", import.meta.url), "utf8");
const domainImport = app.match(/import\s*\{([\s\S]*?)\}\s*from\s*['"]\.\/domain\.js['"]/);
assert.ok(domainImport, "Importação de domain.js não encontrada em app.js");
assert.match(domainImport[1], /\bRESULT\b/, "RESULT precisa ser importado de domain.js porque docsView usa Object.values(RESULT)");
assert.match(app, /function\s+docsView\s*\(/, "docsView precisa existir");
assert.match(app, /Object\.values\(RESULT\)/, "Filtro de resultados da aba Documentos precisa continuar baseado em RESULT");
console.log("navigation.test.mjs: OK");
