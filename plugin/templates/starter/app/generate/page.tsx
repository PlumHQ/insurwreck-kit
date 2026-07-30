import { GenerateForm } from "@/components/GenerateForm";

export default function GeneratePage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Document Generator</h1>
        <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
          Describe what you need, let Claude draft it, then download or send it.
        </p>
      </div>
      <GenerateForm />
    </div>
  );
}
