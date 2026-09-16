import { compileBundle, composeHtml } from "./compile.js";
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const { js, css } = await compileBundle();
const html = composeHtml({ js, css, title: "Reading Room", data: null });

mkdirSync(path.join(root, "template"), { recursive: true });
writeFileSync(path.join(root, "template/index.html"), html);

console.log("Built template/index.html (" + Math.round(html.length / 1024) + " KB)");
