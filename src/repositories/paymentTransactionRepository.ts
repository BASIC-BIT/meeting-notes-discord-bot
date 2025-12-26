import { writePaymentTransaction } from "../db";
import { config } from "../services/configService";
import type { PaymentTransaction } from "../types/db";
import { getMockStore } from "./mockStore";

export type PaymentTransactionRepository = {
  write: (transaction: PaymentTransaction) => Promise<void>;
};

const realRepository: PaymentTransactionRepository = {
  write: writePaymentTransaction,
};

const mockRepository: PaymentTransactionRepository = {
  async write(transaction) {
    getMockStore().paymentTransactions.set(
      transaction.transactionID,
      transaction,
    );
  },
};

export function getPaymentTransactionRepository(): PaymentTransactionRepository {
  return config.mock.enabled ? mockRepository : realRepository;
}
