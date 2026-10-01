export class SseParser {
  private buffer = "";
  private data: string[] = [];
  constructor(private readonly onEvent: (data: string) => void) {}

  feed(chunk: string, final = false): void {
    this.buffer += chunk;
    for (;;) {
      const index = this.buffer.search(/[\r\n]/);
      if (index < 0) break;
      const character = this.buffer[index];
      if (character === "\r" && index === this.buffer.length - 1 && !final) break;
      const line = this.buffer.slice(0, index);
      const length = character === "\r" && this.buffer[index + 1] === "\n" ? 2 : 1;
      this.buffer = this.buffer.slice(index + length);
      this.line(line);
    }
    if (final) {
      if (this.buffer.length || this.data.length) throw new Error("incomplete_sse_event");
    }
  }

  private line(line: string): void {
    if (line === "") {
      if (this.data.length) this.onEvent(this.data.join("\n"));
      this.data = [];
      return;
    }
    if (line.startsWith(":")) return;
    const colon = line.indexOf(":");
    const field = colon < 0 ? line : line.slice(0, colon);
    let value = colon < 0 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "data") this.data.push(value);
  }
}
