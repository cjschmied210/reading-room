// Shared site-wide footer, injected into both the reader shell (compile.js)
// and the homepage (build-site.js) so the two never drift apart.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const markBase64 = readFileSync(path.join(__dirname, "assets/bridgeview-mark.png")).toString("base64");
const MARK_DATA_URI = `data:image/png;base64,${markBase64}`;

export const FOOTER_HTML = `<footer class="site-footer">
    <div class="site-footer-inner">
      <img class="site-footer-mark" src="${MARK_DATA_URI}" alt="" />
      <span>Built at Bridgeview</span>
    </div>
  </footer>`;

export const FOOTER_CSS = `
.site-footer {
  position: fixed; left: 0; right: 0; bottom: 0; z-index: 100;
  background: #ffffff; border-top: 3px solid #0f3d3e;
}
.site-footer-inner {
  display: flex; align-items: center; justify-content: center; gap: 8px;
  padding: 8px 16px; font-family: -apple-system, BlinkMacSystemFont, sans-serif;
  font-size: 12px; color: #1a1a1a;
}
.site-footer-mark { height: 28px; width: auto; flex-shrink: 0; }
`;
