/** @jest-environment node */
import { config } from "../../src/services/configService";
import { getMockStore } from "../../src/repositories/mockStore";
import { getRenewalRecoveryRepository } from "../../src/repositories/renewalRecoveryRepository";
import { renewalRecoverySchema } from "../../src/types/renewalRecovery";
import { getSubscriptionRepository } from "../../src/repositories/subscriptionRepository";

beforeEach(() => {
  config.mock.enabled = true;
  getMockStore().renewalRecoveryRecords.clear();
  getMockStore().renewalRecoveryPointers.clear();
});
const watch = () =>
  renewalRecoverySchema.parse({
    guildId: "999999999999999990",
    subscriptionId: "sub_owned",
    customerId: "cus_owned",
    payerId: "211750261922725888",
    mode: "test",
    revision: "r1",
    paid: {
      invoiceId: "in_paid",
      priceId: "price_pro",
      tier: "pro",
      interval: "year",
      periodStart: 1,
      periodEnd: 1000000,
    },
    scheduledOperationId: null,
    enforcementAccepted: false,
    state: "watching",
    nextCheckAt: 1000000,
  });
async function seed() {
  const record = watch();
  const pointer = {
    guildId: record.guildId,
    status: "active",
    tier: "pro",
    startDate: "2026-01-01",
    subscriptionType: "stripe",
    stripeSubscriptionId: record.subscriptionId,
    stripeSyncRevision: "s1",
  };
  await getSubscriptionRepository().write(pointer);
  return { record, pointer };
}
test("registers once and does not reset the current cycle", async () => {
  const { record, pointer } = await seed();
  const repo = getRenewalRecoveryRepository();
  expect(await repo.register({ record, expectedSubscription: pointer })).toBe(
    true,
  );
  expect(
    await repo.register({
      record: { ...record, revision: "r2" },
      expectedSubscription: pointer,
    }),
  ).toBe(false);
  expect((await repo.getCurrent(record.guildId))?.revision).toBe("r1");
});
test("rejects a replaced subscription and stale recovery revision", async () => {
  const { record, pointer } = await seed();
  const repo = getRenewalRecoveryRepository();
  expect(
    await repo.register({
      record,
      expectedSubscription: { ...pointer, stripeSyncRevision: "stale" },
    }),
  ).toBe(false);
  await repo.register({ record, expectedSubscription: pointer });
  expect(
    await repo.compareAndWrite({
      next: { ...record, revision: "r2" },
      expectedRevision: "stale",
      expectedSubscription: pointer,
      blocking: false,
    }),
  ).toBe(false);
});
test("discovers only due work in its provider mode", async () => {
  const { record, pointer } = await seed();
  const repo = getRenewalRecoveryRepository();
  await repo.register({ record, expectedSubscription: pointer });
  expect(
    (await repo.listDue({ mode: "test", now: 999999, limit: 1 })).keys,
  ).toEqual([]);
  expect(
    (await repo.listDue({ mode: "live", now: 1000000, limit: 1 })).keys,
  ).toEqual([]);
  expect(
    (await repo.listDue({ mode: "test", now: 1000000, limit: 1 })).keys,
  ).toHaveLength(1);
});
