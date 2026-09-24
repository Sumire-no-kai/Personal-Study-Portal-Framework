(() => {
  try {
    const savedTheme = localStorage.getItem("study-portal-reading-theme");
    if (["light", "warm", "dark"].includes(savedTheme)) {
      document.documentElement.dataset.readingTheme = savedTheme;
    }
  } catch (error) {
    // A private browser may not expose local storage; the default light theme still works.
  }
})();
