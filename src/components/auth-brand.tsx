export function AuthBrand({ subtitle }: { subtitle: string }) {
  return (
    <div className="mb-8 text-center">
      <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl border border-gold/40 bg-gradient-to-br from-brand-soft to-surface shadow-gold">
        <span className="font-display text-3xl font-bold gold-text">L</span>
      </div>
      <h1 className="font-display text-4xl font-semibold tracking-tight">
        Luxe <span className="gold-text">CRM</span>
      </h1>
      <p className="mt-2 text-sm text-muted">{subtitle}</p>
    </div>
  );
}
