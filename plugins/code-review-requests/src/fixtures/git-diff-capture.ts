// Real `git diff` output (git 2.45.2), captured from a throwaway repo for #58: between
// two commits, del.ts lost lines 5–6 (a pure deletion hunk), link-me.txt became a symlink (a type
// change: one `T` entry, two patch sections), "naïve "q".ts" changed line 2 (a quoted, non-ASCII
// path), rename-me.ts became renamed.ts with line 4 edited, and z.ts changed line 2 (a file after
// the type change, so a pairing that drifts shows). Args as diffArgs builds them.

/** `git diff … --name-status -z <from> <to> --` */
export const diffNameStatusCapture = "M\u0000del.ts\u0000T\u0000link-me.txt\u0000M\u0000naïve \"q\".ts\u0000R095\u0000rename-me.ts\u0000renamed.ts\u0000M\u0000z.ts\u0000"

/** `git diff … -U0 <from> <to> --` */
export const diffPatchCapture = [
  "diff --git a/del.ts b/del.ts",
  "index 0ff3bbb..940dde3 100644",
  "--- a/del.ts",
  "+++ b/del.ts",
  "@@ -5,2 +4,0 @@",
  "-5",
  "-6",
  "diff --git a/link-me.txt b/link-me.txt",
  "deleted file mode 100644",
  "index 01e79c3..0000000",
  "--- a/link-me.txt",
  "+++ /dev/null",
  "@@ -1,3 +0,0 @@",
  "-1",
  "-2",
  "-3",
  "diff --git a/link-me.txt b/link-me.txt",
  "new file mode 120000",
  "index 0000000..417ce6b",
  "--- /dev/null",
  "+++ b/link-me.txt",
  "@@ -0,0 +1 @@",
  "+a.ts",
  "\\ No newline at end of file",
  "diff --git \"a/na\\303\\257ve \\\"q\\\".ts\" \"b/na\\303\\257ve \\\"q\\\".ts\"",
  "index 4cb29ea..ddc897f 100644",
  "--- \"a/na\\303\\257ve \\\"q\\\".ts\"\t",
  "+++ \"b/na\\303\\257ve \\\"q\\\".ts\"\t",
  "@@ -2 +2 @@ one",
  "-two",
  "+TWO",
  "diff --git a/rename-me.ts b/renamed.ts",
  "similarity index 95%",
  "rename from rename-me.ts",
  "rename to renamed.ts",
  "index ac9837c..fee2a5b 100644",
  "--- a/rename-me.ts",
  "+++ b/renamed.ts",
  "@@ -4 +4 @@ line 3",
  "-line 4",
  "+line four",
  "diff --git a/z.ts b/z.ts",
  "index 8a1218a..f1deecf 100644",
  "--- a/z.ts",
  "+++ b/z.ts",
  "@@ -2 +2 @@",
  "-2",
  "+zwei",
  ""
].join('\n')
