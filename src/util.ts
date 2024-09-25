import {
  existsSync,
  statSync,
  unlinkSync,
  readdirSync,
  rmSync,
  rmdirSync,
} from "node:fs";
import { join } from "node:path";

export function doesFileHaveContent(path: string): boolean {
  return existsSync(path) && statSync(path).size > 0;
}

export function deleteIfExists(path: string) {
  if (existsSync(path)) {
    unlinkSync(path);
  }
}
export function deleteDirectoryRecursively(directoryPath: string): void {
  try {
    // Read all contents of the directory
    const files = readdirSync(directoryPath);

    // Iterate over each file/subdirectory
    for (const file of files) {
      const fullPath = join(directoryPath, file);

      // Check if it's a directory or file
      const stat = statSync(fullPath);

      if (stat.isDirectory()) {
        // Recursively delete subdirectories
        deleteDirectoryRecursively(fullPath);
      } else {
        // Delete the file
        rmSync(fullPath);
      }
    }

    // Delete the empty directory
    rmdirSync(directoryPath);
    console.log(`Deleted directory: ${directoryPath}`);
  } catch (err) {
    console.error(`Error while deleting directory ${directoryPath}:`, err);
  }
}
