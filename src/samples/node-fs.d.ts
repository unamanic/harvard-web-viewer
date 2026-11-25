// Minimal typings for the few node:fs calls the sample suite makes. The
// project has no @types/node (and adds no dependencies); this covers only
// what src/samples/loadSamples.ts uses, and only runs under Vitest (Node).
declare module "node:fs" {
  export function existsSync(path: string | URL): boolean;
  export function readdirSync(path: string | URL, options: { recursive: true }): string[];
  export function readFileSync(path: string | URL): Uint8Array;
  export function statSync(path: string | URL): { isFile(): boolean; isDirectory(): boolean };
}
