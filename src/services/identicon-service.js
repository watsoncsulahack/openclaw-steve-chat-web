export class IdenticonService {
  constructor() {
    this.cache = new Map();
  }

  async sha256Bytes(text) {
    if (crypto?.subtle) {
      const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
      return Array.from(new Uint8Array(buf));
    }

    let h = 2166136261;
    const out = new Array(32).fill(0);
    for (let i = 0; i < text.length; i += 1) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 16777619);
      out[i % 32] = (out[i % 32] + (h >>> ((i % 4) * 8))) & 255;
    }
    return out;
  }

  async identiconSvg(seed, size = 42, radius = 10) {
    const bytes = await this.sha256Bytes(seed);
    const hue = Math.round((bytes[0] / 255) * 360);
    const hue2 = (hue + 170 + (bytes[1] % 60)) % 360;
    const fg = `hsl(${hue} ${62 + (bytes[2] % 18)}% ${56 + (bytes[3] % 10)}%)`;
    const bg = `hsl(${hue2} ${34 + (bytes[4] % 14)}% ${14 + (bytes[5] % 7)}%)`;

    const n = 5;
    const pad = Math.max(2, Math.floor(size * 0.12));
    const usable = size - pad * 2;
    const cell = usable / n;
    const offsetX = (size - cell * n) / 2;
    const offsetY = offsetX;

    let rects = "";
    let bit = 0;
    for (let y = 0; y < n; y += 1) {
      for (let x = 0; x < Math.ceil(n / 2); x += 1) {
        const on = ((bytes[6 + (bit % 24)] >> (bit % 8)) & 1) === 1;
        bit += 1;
        if (!on) continue;

        const x1 = offsetX + x * cell;
        const xm = offsetX + (n - 1 - x) * cell;
        const y1 = offsetY + y * cell;
        rects += `<rect x="${x1.toFixed(2)}" y="${y1.toFixed(2)}" width="${cell.toFixed(2)}" height="${cell.toFixed(2)}" fill="${fg}" rx="1.2"/>`;
        if (xm !== x1) {
          rects += `<rect x="${xm.toFixed(2)}" y="${y1.toFixed(2)}" width="${cell.toFixed(2)}" height="${cell.toFixed(2)}" fill="${fg}" rx="1.2"/>`;
        }
      }
    }

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><rect width="${size}" height="${size}" rx="${radius}" fill="${bg}"/>${rects}</svg>`;
  }

  paint(el, seed, size = 42, radius = 10) {
    const key = `${seed}:${size}:${radius}`;
    const cached = this.cache.get(key);
    if (cached) {
      el.style.backgroundImage = `url("${cached}")`;
      return;
    }

    this.identiconSvg(seed, size, radius)
      .then((svg) => {
        const data = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
        this.cache.set(key, data);
        el.style.backgroundImage = `url("${data}")`;
      })
      .catch(() => {
        el.style.backgroundImage = "none";
      });
  }
}
