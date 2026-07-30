(() => {
  const tabs = Array.from(document.querySelectorAll(".idea-tab"));
  const panels = Array.from(document.querySelectorAll(".idea-panel"));

  function activateTab(tab) {
    const panelName = tab.dataset.panel;

    tabs.forEach((candidate) => {
      const isActive = candidate === tab;
      candidate.classList.toggle("active", isActive);
      candidate.setAttribute("aria-selected", String(isActive));
      candidate.tabIndex = isActive ? 0 : -1;
    });

    panels.forEach((panel) => {
      panel.hidden = panel.id !== `panel-${panelName}`;
    });
  }

  tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => activateTab(tab));
    tab.addEventListener("keydown", (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();

      let nextIndex = index;
      if (event.key === "ArrowLeft") nextIndex = (index - 1 + tabs.length) % tabs.length;
      if (event.key === "ArrowRight") nextIndex = (index + 1) % tabs.length;
      if (event.key === "Home") nextIndex = 0;
      if (event.key === "End") nextIndex = tabs.length - 1;

      tabs[nextIndex].focus();
      activateTab(tabs[nextIndex]);
    });
  });

  document.querySelectorAll("[data-idea-deck]").forEach((deck) => {
    const carousel = deck.querySelector(".idea-carousel");
    const cards = Array.from(carousel.querySelectorAll(".example-card"));
    const previous = deck.querySelector("[data-deck-prev]");
    const next = deck.querySelector("[data-deck-next]");
    const count = deck.querySelector("[data-deck-count]");
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let scrollFrame;

    function cardPosition(card) {
      return card.getBoundingClientRect().left - carousel.getBoundingClientRect().left + carousel.scrollLeft;
    }

    function activeIndex() {
      return cards.reduce((nearest, card, index) => {
        const distance = Math.abs(carousel.scrollLeft - cardPosition(card));
        return distance < nearest.distance ? { index, distance } : nearest;
      }, { index: 0, distance: Number.POSITIVE_INFINITY }).index;
    }

    function updateCount() {
      count.textContent = `${activeIndex() + 1} / ${cards.length}`;
    }

    function move(direction) {
      const current = activeIndex();
      const target = (current + direction + cards.length) % cards.length;
      carousel.scrollTo({ left: cardPosition(cards[target]), behavior: reduceMotion ? "auto" : "smooth" });
    }

    previous.addEventListener("click", () => move(-1));
    next.addEventListener("click", () => move(1));
    carousel.addEventListener("keydown", (event) => {
      if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
      event.preventDefault();
      move(event.key === "ArrowLeft" ? -1 : 1);
    });
    carousel.addEventListener("scroll", () => {
      window.cancelAnimationFrame(scrollFrame);
      scrollFrame = window.requestAnimationFrame(updateCount);
    }, { passive: true });

    updateCount();
  });

  const copyButton = document.querySelector(".copy-button");
  if (copyButton) {
    copyButton.addEventListener("click", async () => {
      const target = document.getElementById(copyButton.dataset.copyTarget);
      const formula = target?.querySelector("p:nth-of-type(2)")?.textContent?.trim();
      if (!formula) return;

      const label = copyButton.querySelector("span");
      const originalLabel = label.textContent;
      const cleanFormula = formula.replace(/\s+/g, " ");

      try {
        await navigator.clipboard.writeText(cleanFormula);
        label.textContent = "Copied";
      } catch {
        const textarea = document.createElement("textarea");
        textarea.value = cleanFormula;
        textarea.setAttribute("readonly", "");
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.select();
        const copied = document.execCommand("copy");
        textarea.remove();
        label.textContent = copied ? "Copied" : "Select and copy";
      }

      window.setTimeout(() => {
        label.textContent = originalLabel;
      }, 1800);
    });
  }

  const checklist = document.querySelector("[data-checklist]");
  if (checklist) {
    const inputs = Array.from(checklist.querySelectorAll('input[type="checkbox"]'));
    const count = document.querySelector(".check-count b");
    const storageKey = `insurwreck:${checklist.dataset.checklist}`;

    function readSaved() {
      try {
        return JSON.parse(window.localStorage.getItem(storageKey) || "[]");
      } catch {
        return [];
      }
    }

    function save() {
      const checked = inputs.filter((input) => input.checked).map((input) => input.value);
      count.textContent = String(checked.length);
      try {
        window.localStorage.setItem(storageKey, JSON.stringify(checked));
      } catch {
        // The checklist still works for the current session when storage is unavailable.
      }
    }

    const saved = new Set(readSaved());
    inputs.forEach((input) => {
      input.checked = saved.has(input.value);
      input.addEventListener("change", save);
    });
    save();
  }
})();
