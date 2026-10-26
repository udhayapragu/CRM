import Link from "next/link";

export default function NotFound() {
  return (
    <div className="card mx-auto mt-10 max-w-lg p-8 text-center">
      <div className="font-display text-6xl gold-text">404</div>
      <p className="mt-2 text-sm text-muted">This record doesn&apos;t exist or was removed.</p>
      <Link href="/dashboard" className="mt-4 inline-block text-sm text-brand-strong hover:underline">Back to dashboard</Link>
    </div>
  );
}
