import { ReactionsEditor } from "@/components/ReactionsEditor";

export default function SettingsPage() {
  return (
    <div className="px-8 py-7">
      <div className="mb-8 flex items-center justify-between border-b border-[var(--color-border-subtle)] pb-6">
        <div className="flex items-center gap-6">
          <h1 className="text-[17px] font-semibold tracking-[-0.02em] text-[var(--color-text-primary)]">
            Settings
          </h1>
          <span className="text-[13px] text-[var(--color-text-muted)]">
            Reactions & Lifecycle
          </span>
        </div>
        <a
          href="/"
          className="text-[12px] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:no-underline transition-colors"
        >
          ← Dashboard
        </a>
      </div>
      <ReactionsEditor />
    </div>
  );
}
