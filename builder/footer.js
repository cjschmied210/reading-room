// Shared site-wide footer, injected into both the reader shell (compile.js)
// and the homepage (build-site.js) so the two never drift apart.
export const FOOTER_HTML = `<footer class="site-footer">
    <div class="site-footer-inner">
      <svg class="site-footer-mark" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <path d="M9 5v22M9 5h9.5a5 5 0 0 1 0 10H9m0 0h10a5 5 0 0 1 0 10H9" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M23.5 5H27v3.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
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
  padding: 10px 16px; font-family: -apple-system, BlinkMacSystemFont, sans-serif;
  font-size: 13px; color: #44403c;
}
.site-footer-mark { width: 20px; height: 20px; color: #44403c; flex-shrink: 0; }
`;
