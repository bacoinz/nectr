/**
 * Random access to a file's bytes: a `File` in the browser, an R2 object
 * (Range reads) in the Worker, a plain array in tests. Returns fewer bytes at
 * the end of the file.
 */
export type ByteSource = (offset: number, length: number) => Promise<Uint8Array>;

export class ReadBudgetError extends Error {}

const WINDOW = 64 * 1024;

/**
 * Wraps a ByteSource with a single cached 64 KB window and a cap on the number
 * of underlying reads, so a hostile file cannot make the Worker loop over R2.
 */
export class Reader {
  private start = 0;
  private buf: Uint8Array = new Uint8Array(0);
  private reads = 0;

  constructor(
    private readonly source: ByteSource,
    readonly size: number,
    private readonly maxReads = 24,
  ) {}

  /** Returns exactly `length` bytes at `offset`, or fewer if the file ends first. */
  async bytes(offset: number, length: number): Promise<Uint8Array> {
    if (offset < 0 || offset >= this.size || length <= 0) return new Uint8Array(0);
    const end = Math.min(offset + length, this.size);
    if (offset < this.start || end > this.start + this.buf.length) {
      if (++this.reads > this.maxReads) throw new ReadBudgetError("too many reads");
      this.start = offset;
      this.buf = await this.source(offset, Math.max(WINDOW, end - offset));
    }
    return this.buf.subarray(offset - this.start, end - this.start);
  }
}

export const fromBytes = (data: Uint8Array): ByteSource => async (offset, length) =>
  data.subarray(offset, Math.min(offset + length, data.length));

export const ascii = (b: Uint8Array, from: number, len: number) =>
  String.fromCharCode(...b.subarray(from, from + len));
