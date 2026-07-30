(() => {
  const slides = Array.from(document.querySelectorAll(".slide"));
  if (!slides.length) return;

  const dotsWrap = document.querySelector(".deck-dots");
  const progress = document.querySelector("[data-progress]");
  const nowEl = document.querySelector("[data-slide-now]");
  const totalEl = document.querySelector("[data-slide-total]");
  const prevBtn = document.querySelector("[data-prev]");
  const nextBtn = document.querySelector("[data-next]");
  const storageKey = "insurwreck:orientation";

  let index = 0;

  const dots = slides.map((slide, i) => {
    const dot = document.createElement("button");
    dot.type = "button";
    dot.setAttribute("aria-label", `Slide ${i + 1}: ${slide.dataset.title || ""}`.trim());
    dot.addEventListener("click", () => show(i));
    dotsWrap?.appendChild(dot);
    return dot;
  });

  if (totalEl) totalEl.textContent = `/ ${slides.length}`;

  function show(next, { push = true } = {}) {
    index = Math.max(0, Math.min(slides.length - 1, next));
    slides.forEach((slide, i) => slide.classList.toggle("is-active", i === index));
    dots.forEach((dot, i) => dot.setAttribute("aria-current", String(i === index)));
    if (nowEl) nowEl.textContent = String(index + 1);
    if (progress) progress.style.width = `${((index + 1) / slides.length) * 100}%`;
    if (prevBtn) prevBtn.disabled = index === 0;
    if (nextBtn) nextBtn.disabled = index === slides.length - 1;
    slides[index].scrollTop = 0;
    if (push) {
      const hash = `#${index + 1}`;
      if (window.location.hash !== hash) {
        window.history.replaceState(null, "", hash);
      }
    }
  }

  prevBtn?.addEventListener("click", () => show(index - 1));
  nextBtn?.addEventListener("click", () => show(index + 1));

  document.addEventListener("keydown", (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const tag = event.target?.tagName;
    if (tag === "INPUT" && event.key === " ") return;

    switch (event.key) {
      case "ArrowRight":
      case "PageDown":
      case " ":
        event.preventDefault();
        show(index + 1);
        break;
      case "ArrowLeft":
      case "PageUp":
        event.preventDefault();
        show(index - 1);
        break;
      case "Home":
        event.preventDefault();
        show(0);
        break;
      case "End":
        event.preventDefault();
        show(slides.length - 1);
        break;
      default:
        break;
    }
  });

  // Touch: horizontal swipe moves slides, but never fight a vertical scroll
  // inside an overflowing slide.
  let touchX = null;
  let touchY = null;
  document.addEventListener(
    "touchstart",
    (event) => {
      touchX = event.touches[0].clientX;
      touchY = event.touches[0].clientY;
    },
    { passive: true }
  );
  document.addEventListener(
    "touchend",
    (event) => {
      if (touchX === null) return;
      const dx = event.changedTouches[0].clientX - touchX;
      const dy = event.changedTouches[0].clientY - touchY;
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.6) {
        show(dx < 0 ? index + 1 : index - 1);
      }
      touchX = null;
      touchY = null;
    },
    { passive: true }
  );

  // Copy buttons — clipboard API with a textarea fallback for non-secure
  // contexts, same approach as the main site.
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

  // Checkpoints. Each participant tracks their own progress on their own
  // laptop; the presenter just asks the room.
  const gates = Array.from(document.querySelectorAll(".gate"));
  if (gates.length) {
    const inputs = gates.flatMap((gate) => Array.from(gate.querySelectorAll("input")));

    function read() {
      try {
        return new Set(JSON.parse(window.localStorage.getItem(storageKey) || "[]"));
      } catch {
        return new Set();
      }
    }

    function paint() {
      gates.forEach((gate) => {
        const done = Array.from(gate.querySelectorAll("input")).every((i) => i.checked);
        gate.classList.toggle("is-done", done);
      });
    }

    function save() {
      const checked = inputs.filter((i) => i.checked).map((i) => i.value);
      try {
        window.localStorage.setItem(storageKey, JSON.stringify(checked));
      } catch {
        // Progress still works for this session if storage is unavailable.
      }
      paint();
    }

    const saved = read();
    inputs.forEach((input) => {
      input.checked = saved.has(input.value);
      input.addEventListener("change", save);
    });
    paint();
  }

  function slideFromHash() {
    const n = Number.parseInt(window.location.hash.replace("#", ""), 10);
    return Number.isFinite(n) && n > 0 ? n - 1 : 0;
  }

  // Changing only the hash is a same-document navigation, so nothing reloads.
  // Without this, deep links pasted into the address bar and the browser's
  // back/forward buttons would silently leave the deck on the wrong slide.
  window.addEventListener("hashchange", () => {
    const target = slideFromHash();
    if (target !== index) show(target, { push: false });
  });

  show(slideFromHash(), { push: false });
})();
