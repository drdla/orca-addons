// The Files seam: reading a file on this machine, here an Agent Review's findings.json in a
// Review Workspace (#29). Real: src/files-process.ts. Fake: src/fakes/fake-files.ts.

export interface Files {
  /** The file's text, or null if there is no such file. Other failures reject. */
  readText(path: string): Promise<string | null>
}
