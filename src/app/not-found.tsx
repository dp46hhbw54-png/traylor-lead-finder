import Link from "next/link";

export default function NotFound() {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white px-6 py-12 text-center">
      <h1 className="text-lg font-semibold text-slate-900">Page not found</h1>
      <p className="mt-1 text-sm text-slate-600">That screen doesn&apos;t exist.</p>
      <Link href="/" className="mt-4 inline-block font-semibold text-brand-700 hover:underline">
        Back to Today
      </Link>
    </div>
  );
}
