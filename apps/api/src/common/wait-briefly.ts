/**
 * Waits for `ready` but never longer than `ms`, and never fails. Used at startup for
 * connections the app can run without (Redis), so a deploy doesn't begin with a burst of
 * avoidable cache misses and dropped clicks, while an outage still can't block boot.
 */
export async function waitBriefly(ready: Promise<unknown>, ms: number): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  await Promise.race([
    ready.catch(() => undefined),
    new Promise((resolve) => {
      timer = setTimeout(resolve, ms);
    }),
  ]);
  clearTimeout(timer);
}
