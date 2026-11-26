/**
 * Styles for both surfaces.
 *
 * Every colour comes from a `--dsw-*` token, expressed through a private
 * `--wk-*` layer so an upstream rename is a two-line change. The popover pairs
 * `--dsw-menu-surface-fill` with `--dsw-menu-backdrop-filter`: taking the fill
 * without the blur yields a 58%-opaque板 with text bleeding through it on
 * Windows and Linux.
 */

const CSS = `
.weknora-root,
.weknora-panel {
  --wk-fg: var(--dsw-alias-label-primary, #0f1115);
  --wk-fg-2: var(--dsw-alias-label-secondary, #61666b);
  --wk-fg-3: var(--dsw-alias-label-tertiary, #8b8f94);
  --wk-fg-4: var(--dsw-alias-label-quaternary, #b3b7bb);
  /* Small type needs its own step: the tertiary/quaternary tokens are designed
     for larger text and land at 3.4-3.7:1 at 11.5px, under the 4.5:1 floor. Blending
     toward the primary label keeps the hierarchy and moves the right way in both themes. */
  --wk-fg-3-small: color-mix(in srgb, var(--wk-fg-3) 78%, var(--wk-fg) 22%);
  --wk-fg-4-small: color-mix(in srgb, var(--wk-fg-4) 55%, var(--wk-fg) 45%);
  --wk-border: var(--dsw-alias-border-l1, #0000000a);
  --wk-border-2: var(--dsw-alias-border-l2, #0000000f);
  --wk-hover: var(--dsw-alias-interactive-bg-hover, #2631480f);
  --wk-accent: var(--dsw-alias-state-business-primary, #4176e6);
  --wk-accent-soft: color-mix(in srgb, var(--wk-accent) 12%, transparent);
  --wk-danger: var(--dsw-alias-state-error-primary, #ec1313);
  --wk-danger-soft: color-mix(in srgb, var(--wk-danger) 10%, transparent);
  --wk-ok: var(--dsw-alias-state-success-primary, #17a34a);
  --wk-module: var(--dsw-alias-bg-module-platform, #f2f3f4);
  --wk-layer: var(--dsw-alias-bg-layer-2, #ffffff);
  --wk-field: color-mix(in srgb, var(--dsw-alias-label-primary, #0f1115) 6%, transparent);
  --wk-panel-fill: var(--dsw-menu-surface-fill, var(--dsw-alias-bg-layer-2, #ffffff));
  --wk-panel-blur: var(--dsw-menu-backdrop-filter, blur(40px) saturate(150%));
  --wk-chrome: var(--dsw-alias-menu-group-header-fill, var(--dsw-alias-bg-layer-2, #ffffff));
  --wk-elevation: var(--dsw-elevation-prominent, 0 0 0 .5px #00000029, 0 8px 24px #00000014);
  --wk-radius-sm: 6px;
  --wk-radius: 8px;
  --wk-radius-lg: var(--dsw-radius-lg, 16px);
}

/* ── trigger ─────────────────────────────────────────────────────────────── */
.weknora-chip {
  display: inline-flex; align-items: center; gap: 6px;
  height: 30px; padding: 0 9px; border: 0; border-radius: var(--wk-radius);
  background: transparent; cursor: pointer; font: inherit; font-size: 13px;
  color: var(--wk-fg-2); white-space: nowrap;
}
.weknora-chip:hover { background: var(--wk-hover); }
.weknora-chip:focus-visible { outline: 2px solid var(--wk-accent); outline-offset: 1px; }
.weknora-chip[data-state="on"] { color: var(--wk-fg); }
.weknora-chip[data-state="on"] .weknora-chip-icon { color: var(--wk-accent); }
.weknora-chip[data-state="warn"] { color: var(--wk-danger); }
.weknora-chip[data-state="warn"] .weknora-chip-icon { color: var(--wk-danger); }
.weknora-chip svg { width: 15px; height: 15px; flex: none; }
.weknora-chip-caret { width: 12px; height: 12px; opacity: .7; }
.weknora-count {
  font-size: 11px; line-height: 17px; font-weight: 500; padding: 1px 8px;
  border-radius: 999px; border: 0; background: var(--wk-accent); color: #fff;
}

/* ── popover ─────────────────────────────────────────────────────────────── */
.weknora-panel {
  position: fixed; z-index: 60; display: flex; flex-direction: column;
  width: 392px; max-height: min(420px, 60vh);
  border: 0; border-radius: var(--wk-radius-lg); overflow: hidden;
  background: var(--wk-panel-fill);
  -webkit-backdrop-filter: var(--wk-panel-blur);
  backdrop-filter: var(--wk-panel-blur);
  box-shadow: var(--wk-elevation);
  isolation: isolate;
  color: var(--wk-fg);
}
@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
  .weknora-panel { background: var(--wk-layer); }
}
.weknora-head {
  position: sticky; top: 0; z-index: 1; display: flex; gap: 8px; align-items: flex-start;
  padding: 13px 12px 11px 15px;
  background: var(--wk-chrome);
  -webkit-backdrop-filter: var(--wk-panel-blur);
  backdrop-filter: var(--wk-panel-blur);
  border-bottom: .5px solid var(--wk-border);
}
.weknora-title { font-size: 13.5px; font-weight: 600; line-height: 20px; }
.weknora-sub { font-size: 11.5px; line-height: 17px; color: var(--wk-fg-3-small); margin-top: 2px; }
.weknora-x {
  margin-left: auto; width: 24px; height: 24px; flex: none; border: 0;
  border-radius: var(--wk-radius-sm); background: transparent; color: var(--wk-fg-3);
  cursor: pointer; display: grid; place-items: center; font-size: 14px;
}
.weknora-x:hover { background: var(--wk-hover); color: var(--wk-fg); }
.weknora-search { padding: 10px 12px 4px; }
.weknora-field {
  display: flex; align-items: center; gap: 7px; height: 32px; padding: 0 9px;
  border-radius: var(--wk-radius); background: var(--wk-field);
  border: 1px solid var(--wk-border);
}
.weknora-field:focus-within { border-color: var(--wk-accent); }
.weknora-field svg { width: 14px; height: 14px; color: var(--wk-fg-3); flex: none; }
.weknora-field input {
  border: 0; background: transparent; outline: 0; font: inherit; font-size: 13px;
  width: 100%; color: var(--wk-fg);
}
.weknora-field input::placeholder { color: var(--wk-fg-3-small); }

.weknora-list { overflow: auto; padding: 6px 6px 8px; flex: 1; }
.weknora-row {
  display: flex; align-items: flex-start; gap: 10px; width: 100%; text-align: left;
  padding: 9px; border: 0; border-radius: 10px; background: transparent;
  cursor: pointer; color: inherit; font: inherit; min-height: 44px;
}
.weknora-row:hover { background: var(--wk-hover); }
.weknora-row:focus-visible { outline: 2px solid var(--wk-accent); outline-offset: -2px; }
.weknora-row[aria-selected="true"] { background: var(--wk-accent-soft); }
.weknora-box {
  width: 16px; height: 16px; flex: none; margin-top: 2px; border-radius: 4px;
  border: 1.5px solid var(--wk-fg-4); display: grid; place-items: center;
}
.weknora-row[aria-selected="true"] .weknora-box { background: var(--wk-accent); border-color: transparent; }
.weknora-row[aria-selected="true"] .weknora-box::after {
  content: ""; width: 9px; height: 5px; transform: rotate(-45deg) translateY(-1px);
  border-left: 1.8px solid #fff; border-bottom: 1.8px solid #fff;
}
.weknora-row-main { min-width: 0; flex: 1; display: block; }
.weknora-row-name {
  display: flex; align-items: center; gap: 6px;
  font-size: 13px; font-weight: 500; line-height: 19px;
}
.weknora-row-desc {
  display: block; font-size: 11.5px; line-height: 17px; color: var(--wk-fg-3-small);
  margin-top: 1px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.weknora-row-meta { display: block; font-size: 11px; line-height: 17px; color: var(--wk-fg-4-small); margin-top: 3px; }
.weknora-tag {
  font-size: 11px; line-height: 17px; font-weight: 500; padding: 1px 8px;
  border-radius: 999px; border: 0; white-space: nowrap;
  background: var(--wk-module); color: var(--wk-fg-2);
}
.weknora-tag.is-err { background: var(--wk-danger-soft); color: var(--wk-danger); }
.weknora-divider { height: .5px; background: var(--wk-border); margin: 5px 9px; }
.weknora-foot {
  position: sticky; bottom: 0; z-index: 1; display: flex; align-items: center; gap: 8px;
  padding: 9px 12px; border-top: .5px solid var(--wk-border);
  background: var(--wk-chrome);
  -webkit-backdrop-filter: var(--wk-panel-blur);
  backdrop-filter: var(--wk-panel-blur);
}
.weknora-foot .weknora-sel { font-size: 11.5px; color: var(--wk-fg-3-small); min-width: 0; }
.weknora-spacer { flex: 1; }

.weknora-btn {
  border: 0; border-radius: var(--wk-radius); cursor: pointer; font: inherit;
  font-size: 12.5px; padding: 5px 11px; background: transparent; color: var(--wk-fg-2);
}
.weknora-btn:hover { background: var(--wk-hover); color: var(--wk-fg); }
.weknora-btn:focus-visible { outline: 2px solid var(--wk-accent); outline-offset: 1px; }
.weknora-btn[disabled] { opacity: .55; cursor: default; }
.weknora-btn.is-primary { background: var(--dsw-alias-brand-primary, #0f1115); color: var(--dsw-alias-bg-base, #fff); }
.weknora-btn.is-quiet { padding: 5px 6px; }
.weknora-btn.is-danger { color: var(--wk-danger); }

.weknora-alert {
  margin: 10px 12px 0; padding: 8px 10px; border-radius: var(--wk-radius);
  background: var(--wk-danger-soft); font-size: 12px; line-height: 18px;
  display: flex; gap: 7px; align-items: flex-start;
}
.weknora-alert svg { width: 14px; height: 14px; flex: none; margin-top: 2px; color: var(--wk-danger); }
.weknora-alert-sub { color: var(--wk-fg-3-small); }
.weknora-empty { padding: 22px 18px 26px; text-align: center; }
.weknora-empty .t { font-size: 13px; font-weight: 500; margin-bottom: 4px; }
.weknora-empty .d { font-size: 12px; color: var(--wk-fg-3-small); line-height: 19px; margin-bottom: 12px; }
.weknora-skeleton {
  height: 44px; margin: 6px 9px; border-radius: 10px;
  background: linear-gradient(90deg, var(--wk-hover), transparent, var(--wk-hover));
  background-size: 200% 100%;
  animation: weknora-shimmer 1.1s ease-in-out infinite;
}
@keyframes weknora-shimmer {
  from { background-position: 200% 0; }
  to { background-position: -200% 0; }
}
@media (prefers-reduced-motion: reduce) {
  .weknora-skeleton { animation: none; }
}
.weknora-sel { display: inline-flex; align-items: center; gap: 6px; }
.weknora-dot { width: 6px; height: 6px; border-radius: 999px; background: var(--wk-ok); flex: none; }
.weknora-dot.is-err { background: var(--wk-danger); }
.weknora-spin {
  width: 12px; height: 12px; flex: none; border-radius: 999px;
  border: 1.5px solid var(--wk-fg-4); border-top-color: var(--wk-accent);
  animation: weknora-spin .8s linear infinite;
}
@keyframes weknora-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) {
  .weknora-spin { animation: none; }
  .weknora-panel { transition: none; }
}

/* ── settings page ───────────────────────────────────────────────────────── */
.weknora-settings { max-width: 760px; color: var(--wk-fg); }
.weknora-settings h2 { margin: 0; font-size: 17px; font-weight: 600; line-height: 24px; }
.weknora-settings .lede { margin: 3px 0 0; font-size: 12px; line-height: 18px; color: var(--wk-fg-3-small); }
.weknora-group { border-top: .5px solid var(--wk-border); margin-top: 18px; padding-top: 14px; }
.weknora-group > .gh {
  font-size: 12px; font-weight: 600; color: var(--wk-fg-2); letter-spacing: .02em; margin-bottom: 10px;
}
.weknora-frow { display: flex; gap: 16px; align-items: flex-start; margin-bottom: 12px; }
.weknora-frow > .lbl {
  width: 116px; flex: none; font-size: 12.5px; line-height: 32px; color: var(--wk-fg-2);
}
.weknora-frow > .ctl { flex: 1; min-width: 0; max-width: 420px; }
.weknora-hint { font-size: 11.5px; line-height: 17px; color: var(--wk-fg-3-small); margin-top: 4px; }
.weknora-input {
  height: 32px; width: 100%; padding: 0 10px; border-radius: var(--wk-radius);
  background: var(--wk-field); border: 1px solid var(--wk-border);
  font: inherit; font-size: 13px; color: var(--wk-fg); outline: 0;
}
.weknora-input:focus { border-color: var(--wk-accent); }
.weknora-input[aria-invalid="true"] { border-color: var(--wk-danger); }
.weknora-input.is-mono { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 12px; }
.weknora-inline { display: flex; gap: 8px; align-items: center; }
.weknora-inline .weknora-input { flex: 1; }
.weknora-inline .weknora-hint { margin: 0; white-space: nowrap; }
.weknora-status { display: flex; align-items: center; gap: 8px; height: 32px; font-size: 12.5px; color: var(--wk-fg-2); }
.weknora-status .ok { width: 7px; height: 7px; border-radius: 999px; background: var(--wk-ok); flex: none; }
.weknora-secret { display: flex; align-items: center; gap: 8px; }
.weknora-secret .val {
  flex: 1; height: 32px; display: flex; align-items: center; padding: 0 10px;
  border-radius: var(--wk-radius); background: var(--wk-field);
  border: 1px solid var(--wk-border); font-size: 13px; color: var(--wk-fg-2);
}
.weknora-radios { display: flex; gap: 14px; align-items: center; min-height: 32px; font-size: 12.5px; color: var(--wk-fg-2); }
.weknora-radios label { display: inline-flex; align-items: center; gap: 6px; cursor: pointer; }
.weknora-radio { width: 14px; height: 14px; border-radius: 999px; border: 1.5px solid var(--wk-fg-4); display: inline-grid; place-items: center; }
.weknora-radio[data-on="true"] { border-color: var(--wk-accent); }
.weknora-radio[data-on="true"]::after { content: ""; width: 7px; height: 7px; border-radius: 999px; background: var(--wk-accent); }
.weknora-checks { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 14px; font-size: 12.5px; color: var(--wk-fg-2); }
.weknora-checks label { display: flex; align-items: center; gap: 7px; cursor: pointer; }
.weknora-cb {
  width: 15px; height: 15px; border-radius: 4px; border: 1.5px solid var(--wk-fg-4);
  display: inline-grid; place-items: center; flex: none;
}
.weknora-cb[data-on="true"] { background: var(--wk-accent); border-color: transparent; }
.weknora-cb[data-on="true"]::after {
  content: ""; width: 8px; height: 4.5px; transform: rotate(-45deg) translateY(-1px);
  border-left: 1.8px solid #fff; border-bottom: 1.8px solid #fff;
}
.weknora-footnote { margin-top: 10px; font-size: 11.5px; line-height: 17px; color: var(--wk-fg-4-small); }
.weknora-message {
  margin-top: 12px; padding: 8px 10px; border-radius: var(--wk-radius);
  font-size: 12px; line-height: 18px; display: flex; gap: 8px;
  background: var(--wk-module); color: var(--wk-fg-2);
}
.weknora-message.is-ok { background: color-mix(in srgb, var(--wk-ok) 12%, transparent); color: var(--wk-fg); }
.weknora-message.is-err { background: var(--wk-danger-soft); color: var(--wk-fg); }
.weknora-message a, .weknora-message button {
  border: 0; background: transparent; color: var(--wk-accent); cursor: pointer;
  font: inherit; font-size: 12px; padding: 0; text-decoration: underline;
}
.weknora-errsummary { margin-top: 12px; }
.weknora-field-error {
  font-size: 11.5px; line-height: 17px; color: var(--wk-danger); margin-top: 4px;
}
.weknora-errsummary ul { margin: 4px 0 0; padding-left: 18px; }
.weknora-link {
  border: 0; background: transparent; padding: 0; font: inherit; font-size: 12px;
  color: var(--wk-danger); text-decoration: underline; cursor: pointer; text-align: left;
}
.weknora-link:focus-visible { outline: 2px solid var(--wk-accent); outline-offset: 2px; }
.weknora-actions { display: flex; gap: 8px; align-items: center; margin-top: 14px; }
`

const ATTRIBUTE = 'data-plugin-css'
const NAME = 'dsh-weknora/client.css'

/** Inject once per document; a second injection would duplicate every rule. */
export function installStyles(): void {
  try {
    const existing = document.querySelector(`style[${ATTRIBUTE}="${NAME}"]`)
    if (existing !== null) return
    const style = document.createElement('style')
    style.setAttribute('data-plugin', 'dsh-weknora')
    style.setAttribute(ATTRIBUTE, NAME)
    style.textContent = CSS
    document.head.appendChild(style)
  } catch {
    // A missing stylesheet costs pixels, not behaviour.
  }
}
