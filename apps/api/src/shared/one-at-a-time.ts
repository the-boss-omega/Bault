/**
 * Run work for the same key one call at a time, in arrival order.
 *
 * For a check that reads a count and then acts on it — "fewer than ten failures,
 * so verify this password" — where two calls for the same key interleaving
 * would both read the old count. Callers for DIFFERENT keys never wait on each
 * other.
 *
 * In memory rather than a database lock, on purpose. A transaction-scoped
 * advisory lock would serialise across processes too, but it holds a pooled
 * connection for as long as the work runs — for sign-in, the whole argon2
 * verification — and a burst aimed at one key would park a connection per
 * waiting request until the pool was gone and every other route with it. Here a
 * waiting request costs a promise. The guarantee is per process: with several
 * API instances, a burst can overshoot by at most one in-flight call per extra
 * instance.
 */
export class OneAtATime {
  private readonly tails = new Map<string, Promise<void>>();

  async run<T>(key: string, work: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const done = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => done);
    this.tails.set(key, tail);
    try {
      await previous;
      return await work();
    } finally {
      release();
      // The last caller for a key removes it, so the map does not grow with
      // every identifier anybody has ever typed.
      if (this.tails.get(key) === tail) this.tails.delete(key);
    }
  }
}
