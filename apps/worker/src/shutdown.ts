export type DrainStep = (msLeft: number) => Promise<unknown>;

export async function drainWithin(budgetMs: number, steps: readonly DrainStep[]): Promise<void> {
  const deadline = Date.now() + budgetMs;
  for (const step of steps) {
    const left = Math.max(0, deadline - Date.now());
    let timer: NodeJS.Timeout | undefined;
    const outOfTime = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, left);
    });
    try {
      await Promise.race([step(left).catch(() => undefined), outOfTime]);
    } finally {
      clearTimeout(timer);
    }
  }
}
