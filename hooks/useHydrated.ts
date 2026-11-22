/**
 * True after the first client render. For state that the server cannot know: a value used during
 * hydration must match the server's HTML. Firefox restores form controls (including a button's
 * disabled state) when a page is reloaded or revisited, so a button disabled "until fields are
 * filled" can differ between the server HTML and the restored page; applying that rule only after
 * hydration keeps the first render identical on both sides.
 */

import { useEffect, useState } from 'react';

export function useHydrated() {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => { setHydrated(true); }, []);
  return hydrated;
}
