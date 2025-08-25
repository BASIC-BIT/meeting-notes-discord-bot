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
