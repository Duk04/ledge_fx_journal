export const THEME_STORAGE_KEY = "ledger.theme";

/**
 * Applies the stored theme before first paint so the app never flashes the
 * wrong palette. Kept deliberately tiny and inline; a stored value of "system"
 * (or nothing at all) leaves the document unstamped so prefers-color-scheme
 * decides, which is what the token layer in globals.css expects.
 */
export function ThemeScript() {
  const js = `(function(){try{var t=localStorage.getItem("${THEME_STORAGE_KEY}");if(t==="dark"||t==="light"){document.documentElement.setAttribute("data-theme",t)}}catch(e){}})();`;
  return <script dangerouslySetInnerHTML={{ __html: js }} />;
}
