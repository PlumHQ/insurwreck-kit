const captureMode = new URLSearchParams(window.location.search).has("capture");
const reducedMotion =
  captureMode || window.matchMedia("(prefers-reduced-motion: reduce)").matches;

if (captureMode) {
  document.documentElement.classList.add("capture-mode");
}

const revealItems = document.querySelectorAll(".reveal");

if (reducedMotion || !("IntersectionObserver" in window)) {
  revealItems.forEach((item) => item.classList.add("is-visible"));
} else {
  const revealObserver = new IntersectionObserver(
    (entries, observer) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      });
    },
    { rootMargin: "0px 0px -8% 0px", threshold: 0.12 },
  );

  revealItems.forEach((item) => revealObserver.observe(item));
}

const workflow = document.querySelector("[data-workflow]");

if (workflow) {
  const nodes = [...workflow.querySelectorAll("[data-step]")];
  const status = workflow.querySelector("[data-status]");
  const detail = workflow.querySelector("[data-detail]");
  const replay = workflow.querySelector("[data-replay]");
  const runId = workflow.querySelector("[data-run-id]");
  let timer;
  let currentRun = 47;

  const runCopy = [
    {
      status: "Request entered",
      detail: "A recurring trigger gives the system a clear job to do.",
    },
    {
      status: "Context assembled",
      detail: "Relevant history, records, and constraints are brought into the run.",
    },
    {
      status: "Agent and tools acting",
      detail: "The agent decides the next step and uses the approved tools.",
    },
    {
      status: "Human judgment applied",
      detail: "The important exception pauses for a person before work continues.",
    },
    {
      status: "Outcome checked",
      detail: "The action is complete, recorded, and measured against the goal.",
    },
  ];

  const setStep = (step) => {
    nodes.forEach((node, index) => {
      node.classList.toggle("is-complete", index < step);
      node.classList.toggle("is-active", index === step);
    });

    const progress = `${(step / Math.max(nodes.length - 1, 1)) * 80}%`;
    const mobileProgress = `${(step / Math.max(nodes.length - 1, 1)) * 100}%`;
    workflow.style.setProperty("--run-progress", progress);
    workflow.style.setProperty("--run-progress-mobile", mobileProgress);
    status.textContent = runCopy[step].status;
    detail.textContent = runCopy[step].detail;
  };

  const playWorkflow = () => {
    window.clearInterval(timer);
    currentRun += 1;
    runId.textContent = `RUN · ${String(currentRun).padStart(4, "0")}`;
    let step = 0;
    setStep(step);

    if (reducedMotion) {
      setStep(nodes.length - 1);
      return;
    }

    timer = window.setInterval(() => {
      step += 1;
      if (step >= nodes.length) {
        window.clearInterval(timer);
        return;
      }
      setStep(step);
    }, 1100);
  };

  replay.addEventListener("click", playWorkflow);

  if ("IntersectionObserver" in window && !reducedMotion) {
    const workflowObserver = new IntersectionObserver(
      (entries, observer) => {
        if (!entries[0].isIntersecting) return;
        playWorkflow();
        observer.disconnect();
      },
      { threshold: 0.42 },
    );
    workflowObserver.observe(workflow);
  } else {
    playWorkflow();
  }
}

document.querySelectorAll(".reference-image img").forEach((image) => {
  image.addEventListener("error", () => {
    image.closest(".reference-image")?.classList.add("is-missing");
    image.remove();
  });
});
