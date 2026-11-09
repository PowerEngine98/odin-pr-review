function rotate(value: number, by: number): number {
  return (value << by) | (value >>> (32 - by));
}

export function sha1Hex(input: string): string {
  const bytes = new TextEncoder().encode(input);
  const length = bytes.length;
  const blocks = ((length + 8) >>> 6) + 1;
  const words = new Uint32Array(blocks * 16);
  for (let i = 0; i < length; i++) words[i >>> 2]! |= bytes[i]! << (24 - (i % 4) * 8);
  words[length >>> 2]! |= 0x80 << (24 - (length % 4) * 8);
  words[blocks * 16 - 1] = length * 8;
  words[blocks * 16 - 2] = Math.floor((length * 8) / 0x100000000);

  let h0 = 0x67452301;
  let h1 = 0xefcdab89;
  let h2 = 0x98badcfe;
  let h3 = 0x10325476;
  let h4 = 0xc3d2e1f0;
  const w = new Uint32Array(80);
  for (let block = 0; block < blocks; block++) {
    for (let t = 0; t < 16; t++) w[t] = words[block * 16 + t]!;
    for (let t = 16; t < 80; t++) w[t] = rotate(w[t - 3]! ^ w[t - 8]! ^ w[t - 14]! ^ w[t - 16]!, 1);
    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    for (let t = 0; t < 80; t++) {
      let f: number;
      let k: number;
      if (t < 20) {
        f = (b & c) | (~b & d);
        k = 0x5a827999;
      } else if (t < 40) {
        f = b ^ c ^ d;
        k = 0x6ed9eba1;
      } else if (t < 60) {
        f = (b & c) | (b & d) | (c & d);
        k = 0x8f1bbcdc;
      } else {
        f = b ^ c ^ d;
        k = 0xca62c1d6;
      }
      const next = (rotate(a, 5) + f + e + k + w[t]!) | 0;
      e = d;
      d = c;
      c = rotate(b, 30);
      b = a;
      a = next;
    }
    h0 = (h0 + a) | 0;
    h1 = (h1 + b) | 0;
    h2 = (h2 + c) | 0;
    h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0;
  }
  return [h0, h1, h2, h3, h4].map((h) => (h >>> 0).toString(16).padStart(8, "0")).join("");
}
