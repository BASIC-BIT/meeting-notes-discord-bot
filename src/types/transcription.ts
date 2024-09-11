
export interface TranscriptionSegment {
    id: number;
    seek: number;
    start: number;
    end: number;
    text: string;
    tokens: string[];
    temperature: number;
    avg_logprob: number;
    compression_ratio: number;
    no_speech_prob: number;
    words?: string[];
}

export interface TranscriptionResponse {
    task: 'transcribe';
    language: 'english';
    duration: number;
    text: string;
    segments: TranscriptionSegment[];

}