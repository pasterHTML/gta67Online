import fs from "node:fs/promises";
import path from "node:path";

const assetId = "kloofendal_43d_clear_puresky";
const apiUrl = "https://api.polyhaven.com/files/" + assetId;
const destination = path.join(process.cwd(), "assets", "sky", assetId + "_1k.hdr");
const userAgent = "LEONIDAOnline-SkyAssetDownloader/1.0 (https://github.com/pasterHTML/gta67Online)";

const metadataResponse = await fetch(apiUrl, {
  headers: {
    "User-Agent": userAgent,
    "Accept": "application/json"
  }
});

if (!metadataResponse.ok) {
  throw new Error("Poly Haven API returned HTTP " + metadataResponse.status);
}

const metadata = await metadataResponse.json();
const download = metadata && metadata.hdri && metadata.hdri["1k"] && metadata.hdri["1k"].hdr;

if (!download || !download.url || !Number.isFinite(download.size)) {
  throw new Error("The Poly Haven API did not return a 1K HDR download.");
}

const maxBytes = 6 * 1024 * 1024;
if (download.size > maxBytes) {
  throw new Error("The 1K HDRI is unexpectedly large (" + download.size + " bytes).");
}

const fileResponse = await fetch(download.url, {
  headers: { "User-Agent": userAgent }
});

if (!fileResponse.ok) {
  throw new Error("HDR download returned HTTP " + fileResponse.status);
}

const bytes = Buffer.from(await fileResponse.arrayBuffer());
if (bytes.length < 1024 || bytes.length > maxBytes) {
  throw new Error("Unexpected HDR file size: " + bytes.length + " bytes");
}

await fs.mkdir(path.dirname(destination), { recursive: true });
await fs.writeFile(destination, bytes);

console.log("Downloaded " + path.relative(process.cwd(), destination) + " (" + bytes.length + " bytes).");
console.log("Source: Poly Haven — Kloofendal 43d Clear (Pure Sky), CC0.");
