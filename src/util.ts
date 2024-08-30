import {readFileSync} from "node:fs";


export function doesFileHaveContent(path: string): boolean {
    return readFileSync(path).length > 0;
}