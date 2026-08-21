(() => {
  // Copy buttons on each terminal window.
  document.querySelectorAll("[data-copy]").forEach((button) => {
    button.addEventListener("click", async () => {
      const source = document.getElementById(button.dataset.copy);
      const text = source?.textContent?.trim();
      if (!text) return;
      const label = button.querySelector("span");
      const original = label.textContent;

      try {
        await navigator.clipboard.writeText(text);
        label.textContent = "Copied";
      } catch {
        const scratch = document.createElement("textarea");
        scratch.value = text;
        scratch.setAttribute("readonly", "");
        scratch.style.position = "fixed";
        scratch.style.opacity = "0";
        document.body.appendChild(scratch);
        scratch.select();
        const copied = document.execCommand("copy");
        scratch.remove();
        label.textContent = copied ? "Copied" : "Select it";
      }

      window.setTimeout(() => {
        label.textContent = original;
      }, 1800);
    });
  });

  // Setup checkpoints. Each person tracks their own progress on their own
  // laptop while we walk through it together.
  const list = document.querySelector("[data-checklist]");
  if (list) {
    const inputs = Array.from(list.querySelectorAll('input[type="checkbox"]'));
    const count = document.querySelector(".check-count b");
    const storageKey = `insurwreck:${list.dataset.checklist}`;

    function paint() {
      inputs.forEach((input) => {
        input.closest(".gate")?.classList.toggle("is-done", input.checked);
      });
      if (count) count.textContent = String(inputs.filter((i) => i.checked).length);
    }

    function save() {
      const checked = inputs.filter((i) => i.checked).map((i) => i.value);
      try {
        window.localStorage.setItem(storageKey, JSON.stringify(checked));
      } catch {
        // Ticks still work for this session without persistence.
      }
      paint();
    }

    let saved = new Set();
    try {
      saved = new Set(JSON.parse(window.localStorage.getItem(storageKey) || "[]"));
    } catch {
      saved = new Set();
    }

    inputs.forEach((input) => {
      input.checked = saved.has(input.value);
      input.addEventListener("change", save);
    });
    paint();
  }

  // Step 1's OS / install-path picker: show only the matching variant.
  const osTabs = Array.from(document.querySelectorAll("[data-os-tabs] .idea-tab"));
  const pathTabs = Array.from(document.querySelectorAll("[data-path-tabs] .idea-tab"));
  const setupVariants = Array.from(document.querySelectorAll(".setup-variant"));
  if (osTabs.length && pathTabs.length) {
    let os = "mac";
    let path = "terminal";

    function paintSetup() {
      osTabs.forEach((tab) => {
        const isActive = tab.dataset.os === os;
        tab.classList.toggle("active", isActive);
        tab.setAttribute("aria-pressed", String(isActive));
      });
      pathTabs.forEach((tab) => {
        const isActive = tab.dataset.path === path;
        tab.classList.toggle("active", isActive);
        tab.setAttribute("aria-pressed", String(isActive));
      });
      setupVariants.forEach((variant) => {
        variant.classList.toggle(
          "is-active",
          variant.dataset.os === os && variant.dataset.path === path
        );
      });
    }

    osTabs.forEach((tab) => tab.addEventListener("click", () => { os = tab.dataset.os; paintSetup(); }));
    pathTabs.forEach((tab) => tab.addEventListener("click", () => { path = tab.dataset.path; paintSetup(); }));
    paintSetup();
  }

  // Reading progress, so a long walkthrough shows how much is left.
  const progress = document.querySelector("[data-progress]");
  if (progress) {
    let queued = false;
    const update = () => {
      queued = false;
      const max = document.documentElement.scrollHeight - window.innerHeight;
      const ratio = max > 0 ? window.scrollY / max : 0;
      progress.style.width = `${Math.min(100, Math.max(0, ratio * 100))}%`;
    };
    window.addEventListener(
      "scroll",
      () => {
        if (queued) return;
        queued = true;
        window.requestAnimationFrame(update);
      },
      { passive: true }
    );
    update();
  }

  // Highlight the section currently in view in the sticky nav.
  const links = Array.from(document.querySelectorAll(".nav-links a[href^='#']"));
  const sections = links
    .map((link) => document.querySelector(link.getAttribute("href")))
    .filter(Boolean);

  if (sections.length && "IntersectionObserver" in window) {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          links.forEach((link) => {
            link.classList.toggle(
              "is-current",
              link.getAttribute("href") === `#${entry.target.id}`
            );
          });
        });
      },
      { rootMargin: "-45% 0px -50% 0px" }
    );
    sections.forEach((section) => observer.observe(section));
  }
})();
