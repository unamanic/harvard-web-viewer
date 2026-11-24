import { useMemo } from "react";
import { hexdump } from "../formats/hexdump";

/** Shows the first `limit` bytes as a hex dump, to aid format discovery. */
export function HexInspector({ bytes, limit = 4096 }: { bytes: Uint8Array; limit?: number }) {
  const text = useMemo(() => hexdump(bytes.subarray(0, limit)).join("\n"), [bytes, limit]);
  return (
    <section>
      <h3>Hex inspector ({bytes.length} bytes{bytes.length > limit ? `, showing first ${limit}` : ""})</h3>
      <pre className="hex">{text}</pre>
    </section>
  );
}
