export interface AudioSnippet {
    chunks: Buffer[],
    timestamp: number,
    userId: string,
}

export interface AudioFileData {
    userId: string;
    timestamp: number;
    fileName?: string;
    transcript?: string;
    processing: boolean;
    processingPromise?: Promise<void>;
}

export interface AudioData {
    currentSnippet: AudioSnippet | null;
    // TODO: Not really worried about storing snippets that are being processed... garbage collector should clear them up, I think?
    // processing: AudioSnippet[]
    audioFiles: AudioFileData[]
}
