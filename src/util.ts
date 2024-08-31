import {existsSync, statSync} from "node:fs";

export function doesFileHaveContent(path: string): boolean {
    return existsSync(path) && statSync(path).size > 0;
}