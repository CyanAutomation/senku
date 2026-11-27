import { chmod, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createProfileContractArtifact } from "../src/contracts/profile-artifact";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = resolve(root, "contracts/senku-profiles.v1.json");
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(createProfileContractArtifact(), null, 2)}\n`);
await chmod(outputPath, 0o644);
