// Subscription Type
export interface Subscription {
  userID: string;
  status: string;
  tier: string;
  startDate: string;
  endDate?: string;
  nextBillingDate?: string;
  paymentMethod?: string;
  subscriptionType: string;
  serverID: string;
}

// Payment Transaction Type
export interface PaymentTransaction {
  transactionID: string;
  userID: string;
  amount: number;
  currency: string;
  status: string;
  paymentDate: string;
  paymentMethod: string;
  discountCode?: string;
  subscriptionID: string;
}

// Access Logs Type
export interface AccessLog {
  accessLogID: string;
  userID: string;
  meetingID: string;
  accessTime: string;
  fileType: string;
  ipAddress?: string;
}

// Recording/Transcript Type
export interface RecordingTranscript {
  meetingID: string;
  fileType: string;
  fileLocation: string;
  fileSize: number;
  expirationDate?: string;
}

// Auto Record Settings Type
export interface AutoRecordSettings {
  guildId: string; // Partition key
  channelId: string; // Sort key - use "ALL" for record all channels
  textChannelId: string; // Where to send meeting notifications
  enabled: boolean; // Whether auto-recording is active
  recordAll: boolean; // True if this is a guild-wide setting
  createdBy: string; // User ID who created this setting
  createdAt: string; // ISO timestamp
}

// Server Context Type
export interface ServerContext {
  guildId: string; // Partition key
  context: string; // The context/instructions for the server
  updatedAt: string; // ISO timestamp
  updatedBy: string; // User ID who last updated
}

// Channel Context Type
export interface ChannelContext {
  guildId: string; // Partition key
  channelId: string; // Sort key
  context: string; // The context/instructions for the channel
  updatedAt: string; // ISO timestamp
  updatedBy: string; // User ID who last updated
}

// Meeting History Type
export interface MeetingHistory {
  guildId: string; // Partition key
  channelId_timestamp: string; // Sort key (channelId#ISO-timestamp)
  meetingId: string; // Unique meeting identifier
  channelId: string; // Denormalized for easier queries
  timestamp: string; // ISO timestamp (denormalized)
  notes?: string; // AI-generated notes (comprehensive, includes everything)
  context?: string; // Meeting-specific context if provided
  attendees: string[]; // List of attendee user tags
  duration: number; // Meeting duration in seconds
  transcribeMeeting: boolean; // Whether transcription was enabled
  generateNotes: boolean; // Whether notes were generated
}
