'use client';

import { useEffect } from 'react';

import { initRum } from './rum-client';

/**
 * Starts RUM once, on the client.
 *
 * Mount it anywhere inside `<body>` in the root layout. It renders nothing and
 * takes no children, so it does not become a wrapper every tree has to thread
 * through — the original version wrapped the whole app purely to read a user id
 * it then attached to every event, which is exactly the personal data this no
 * longer sends.
 */
export function RumProvider() {
  useEffect(() => {
    initRum();
  }, []);

  return null;
}
