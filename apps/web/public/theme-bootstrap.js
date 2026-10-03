// Apply a personal choice or the last-known workspace default before the app
// loads. Keeping this in a same-origin file allows a strict no-inline-script
// Content Security Policy. Mirrors resolveTheme in src/lib/theme-config.ts.
(function () {
  try {
    var legacy = {
      sunset: "dark",
      neubrutalism: "light",
      pressroom: "light",
      quiet: "light",
    };
    var normalize = function (value) {
      if (value === "light" || value === "dark" || value === "system")
        return value;
      return legacy[value] || null;
    };
    var theme =
      normalize(localStorage.getItem("dropvault-theme")) ||
      normalize(localStorage.getItem("dropvault-workspace-theme")) ||
      "system";
    var dark =
      theme === "dark" ||
      (theme === "system" &&
        window.matchMedia &&
        window.matchMedia("(prefers-color-scheme: dark)").matches);
    var root = document.documentElement;
    if (dark) root.classList.add("dark");
    root.dataset.theme = theme;
    root.style.colorScheme = dark ? "dark" : "light";
  } catch (_error) {}
})();
