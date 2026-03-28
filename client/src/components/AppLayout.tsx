/**
 * AppLayout — Global UI wrapper.
 * Provides the animated light background and orb decorations.
 */
export function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="app-layout">
      {/* Ambient orb decorations — purely visual */}
      <div className="orb orb-1" aria-hidden />
      <div className="orb orb-2" aria-hidden />
      <div className="orb orb-3" aria-hidden />

      <div className="app-layout-inner">
        {children}
      </div>
    </div>
  );
}
