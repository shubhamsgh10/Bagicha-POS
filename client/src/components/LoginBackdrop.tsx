import pizzaBgImage from "@assets/Wood-Fire-Pizza.png";

/**
 * The chef-at-the-oven picture behind the phone login screens. `contain` + bottom-right so the
 * picture's own BAGICHA lockup (drawn into its bottom-right corner) stays fully visible — it is
 * the only logo on the login screens. The asset is near-white, so the letterbox is invisible.
 */
export function LoginBackdrop({ className = "" }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={`fixed inset-0 z-0 bg-white pointer-events-none ${className}`}
      style={{
        backgroundImage: `url(${pizzaBgImage})`,
        backgroundSize: "contain",
        backgroundPosition: "right bottom",
        backgroundRepeat: "no-repeat",
      }}
    />
  );
}
