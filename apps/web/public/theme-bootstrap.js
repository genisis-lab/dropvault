// Apply a personal choice or the last-known workspace default before the app
// loads. Keeping this in a same-origin file allows a strict no-inline-script
// Content Security Policy.
(function () {
  try {
    var allowed = [
      "neubrutalism",
      "pressroom",
      "quiet",
      "light",
      "dark",
      "sunset",
    ];
    var theme =
      localStorage.getItem("dropvault-theme") ||
      localStorage.getItem("dropvault-workspace-theme") ||
      "neubrutalism";
    if (allowed.indexOf(theme) === -1) theme = "neubrutalism";
    if (theme !== "light") document.documentElement.classList.add(theme);
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme =
      theme === "dark" || theme === "sunset" ? "dark" : "light";
  } catch (_error) {}
})();
