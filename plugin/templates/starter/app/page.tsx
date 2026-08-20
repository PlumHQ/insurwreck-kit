import Link from "next/link";

export default function Home() {
  const name = process.env.NEXT_PUBLIC_PARTICIPANT_NAME;
  const brief = process.env.NEXT_PUBLIC_IDEA_BRIEF;

  return (
    <div className="space-y-12">
      <section className="space-y-3">
        <p className="text-sm font-medium text-indigo-600 dark:text-indigo-400">Insurwreck starter</p>
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
          {name ? `Welcome, ${name}.` : "Two working demos, one app."}
        </h1>
        {brief ? (
          <p className="max-w-2xl text-neutral-600 dark:text-neutral-400">Your idea: {brief}</p>
        ) : (
          <p className="max-w-2xl text-neutral-600 dark:text-neutral-400">
            Every idea we saw registered for the hackathon collapses into one of two shapes.
            This app ships both, already wired to Claude and Resend, so you can delete the half
            you don&apos;t need and build on the rest.
          </p>
        )}
      </section>

      <section className="grid gap-6 sm:grid-cols-2">
        <Link
          href="/dashboard"
          className="group rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md dark:border-neutral-800 dark:bg-neutral-900"
        >
          <h2 className="text-lg font-semibold">Claims Dashboard</h2>
          <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
            A filterable table of sample claims with an AI-generated risk column. Good starting
            point for: dashboards, classifiers, triage tools.
          </p>
          <span className="mt-4 inline-block text-sm font-medium text-indigo-600 group-hover:underline dark:text-indigo-400">
            Open dashboard &rarr;
          </span>
        </Link>

        <Link
          href="/generate"
          className="group rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md dark:border-neutral-800 dark:bg-neutral-900"
        >
          <h2 className="text-lg font-semibold">Document Generator</h2>
          <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
            A form that has Claude draft a letter or email, then download it or send it via
            Resend. Good starting point for: letters, replies, summaries.
          </p>
          <span className="mt-4 inline-block text-sm font-medium text-indigo-600 group-hover:underline dark:text-indigo-400">
            Open generator &rarr;
          </span>
        </Link>
      </section>
    </div>
  );
}
