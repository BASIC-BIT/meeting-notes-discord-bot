import { existsSync, statSync, unlinkSync } from "node:fs";

export function doesFileHaveContent(path: string): boolean {
    return existsSync(path) && statSync(path).size > 0;
}

export function deleteIfExists(path: string) {
    if(existsSync(path)){
        unlinkSync(path);
    }
}