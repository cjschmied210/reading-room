import esbuild from "esbuild";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

export async function compileBundle() {
  const result = await esbuild.build({
    entryPoints: [path.join(root, "src/app.jsx")],
    bundle: true,
    minify: true,
    format: "iife",
    target: "es2019",
    write: false,
    logLevel: "silent"
  });
  const js = result.outputFiles[0].text;
  const css = readFileSync(path.join(root, "src/style.css"), "utf8");
  return { js, css };
}

export function composeHtml({ js, css, title, data, teacher = "" }) {
  const shell = readFileSync(path.join(__dirname, "shell.html"), "utf8");
  return shell
    .replace("__TITLE__", escapeHtml(title))
    .replace("__TEACHER__", escapeHtml(teacher))
    .replace("/*__CSS__*/", css)
    .replace("/*__DATA__*/null", JSON.stringify(data))
    .replace("/*__JS__*/", js);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
}
