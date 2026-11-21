// The Files seam: files on this machine, here an Agent Review's findings.json in a Review
// Workspace (#29) and its review cover page (#55). Real: src/files-process.ts. Fake:
// src/fakes/fake-files.ts.

export interface Files {
  /** The file's text, or null if there is no such file. Other failures reject. */
  readText(path: string): Promise<string | null>
  /** Writes the file, replacing it, creating its folder first if needed. */
  writeText(path: string, text: string): Promise<void>
}
