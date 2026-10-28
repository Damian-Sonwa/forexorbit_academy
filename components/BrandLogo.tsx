/**
 * BrandLogo Component
 * FX Orbit Academy wordmark. `auto` follows the light/dark theme; `light` is for dark surfaces.
 */

import Image from 'next/image';

const LOGO_WIDTH = 996;
const LOGO_HEIGHT = 218;

type Variant = 'auto' | 'dark' | 'light';

interface BrandLogoProps {
  variant?: Variant;
  /** Sizing classes; set the height and let the width follow (e.g. `h-9`). */
  className?: string;
  priority?: boolean;
}

export default function BrandLogo({ variant = 'auto', className = 'h-9', priority = false }: BrandLogoProps) {
  const base = `w-auto select-none ${className}`;
  const img = (src: string, extra = '') => (
    <Image
      src={src}
      alt="FX Orbit Academy"
      width={LOGO_WIDTH}
      height={LOGO_HEIGHT}
      priority={priority}
      draggable={false}
      className={`${base} ${extra}`.trim()}
    />
  );

  if (variant === 'dark') return img('/brand/fxorbit-logo.png');
  if (variant === 'light') return img('/brand/fxorbit-logo-light.png');
  return (
    <>
      {img('/brand/fxorbit-logo.png', 'dark:hidden')}
      {img('/brand/fxorbit-logo-light.png', 'hidden dark:block')}
    </>
  );
}
