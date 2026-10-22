import type { Harness } from "./meetingUpdateDeliveryContract";
import type { authority, write } from "./meetingUpdateDeliveryContract";
import { deliveryRow } from "./meetingUpdateDeliveryFixtures";
import {
  attempt,
  observedAttemptInput,
  key,
  now,
  pending,
  pointers,
  planDelivery,
  registerOperation,
  deleteOperation,
  verifiedState,
} from "../types/meetingUpdateDelivery.fixture";
import {
  preparedMeetingUpdateAttemptSchema,
  meetingUpdateDeliverySchema,
} from "../../src/types/meetingUpdateDelivery";

export function planningContract(
  current: () => Harness,
  config: { authority: typeof authority; write: typeof write },
) {
  const { authority, write } = config;
  it("claims observation-only work and persists only captured acknowledgments behind a newer save", async () => {
    const h = current();
    await h.seed(deliveryRow(pending()));
    const observed = preparedMeetingUpdateAttemptSchema.parse(
      observedAttemptInput(),
    );
    expect(
      await h.repository.claim({
        key,
        expectedContentRevision: 1,
        expectedDeliveryRevision: "delivery-1",
        attempt: observed,
        authority,
      }),
    ).toBe("claimed");
    const claimed = await h.read();
    if (
      !claimed?.updateDelivery ||
      !("attempt" in claimed.updateDelivery.progress)
    )
      throw new Error("Expected persisted claim");
    expect(claimed.updateDelivery.progress.operations).toEqual([]);
    expect(claimed.updateDelivery.progress.attempt.observations).toEqual(
      observed.observations,
    );
    const save = write(claimed, "newer-noop-save");
    expect((await h.repository.updateContentAndDelivery(save)).kind).toBe(
      "committed",
    );
    expect(
      await h.repository.transition({
        key,
        expectedDeliveryRevision: save.nextDelivery.revision,
        attemptId: observed.attemptId,
        ownerInstanceId: "old",
        change: {
          kind: "complete",
          revision: "noop-complete",
          attemptId: observed.attemptId,
          completedAt: now + 1,
        },
      }),
    ).toBe("applied");
    expect((await h.read())?.updateDelivery).toMatchObject({
      parts: { notesBody: { desired: 2, acknowledged: 1 } },
      progress: { kind: "pending" },
      lastSuccess: { at: now + 1, contentRevision: 1 },
    });
  });
  it.each(["prepared", "rejected"])(
    "atomically carries a %s obsolete target through retirement and a later save",
    async (kind) => {
      const h = current();
      const obsolete = { ...deleteOperation, messageId: "999999999999999994" };
      const expectedPointers = {
        ...pointers,
        notesMessageIds: [...pointers.notesMessageIds, obsolete.messageId],
      };
      const register = { ...registerOperation(), expectedPointers };
      const rejected = {
        kind: "rejected",
        submissionId: "delete",
        submittedAt: now,
        rejectedAt: now + 1,
        retryAt: now + 5,
        reason: "provider_rejected",
      };
      const before = planDelivery(
        [register, obsolete],
        [verifiedState(), kind === "prepared" ? { kind } : rejected],
      );
      await h.seed(deliveryRow(before));
      expect(
        await h.repository.transition({
          key,
          expectedDeliveryRevision: before.revision,
          attemptId: "attempt-1",
          ownerInstanceId: "synthetic-owner",
          change: {
            kind: "progress",
            revision: "retired-cleanup",
            progress: { kind: "pending", nextCheckAt: now + 2 },
          },
        }),
      ).toBe("applied");
      const row = await h.read();
      expect(row?.updateDelivery?.cleanupCandidates).toEqual([
        {
          sourceAttemptId: "attempt-1",
          operationId: obsolete.operationId,
          registrationOperationId: register.operationId,
          channelId: obsolete.channelId,
          messageId: obsolete.messageId,
          beforeFingerprint: obsolete.beforeFingerprint,
        },
      ]);
      if (!row) throw new Error("Expected row");
      expect(
        (
          await h.repository.updateContentAndDelivery(
            write(row, "later-cleanup-save"),
          )
        ).kind,
      ).toBe("committed");
      expect((await h.read())?.updateDelivery?.cleanupCandidates).toEqual(
        row.updateDelivery?.cleanupCandidates,
      );
      expect((await h.read())?.updateDelivery?.parts.notesBody).toEqual({
        desired: 2,
        acknowledged: 0,
      });
      expect((await h.read())?.updateDelivery?.lastSuccess).toBeNull();
    },
  );

  it("does not derive cleanup authority or mutate pointers from an unverified register", async () => {
    const h = current();
    const obsolete = { ...deleteOperation, messageId: "999999999999999994" };
    const oldPointers = {
      ...pointers,
      notesMessageIds: [...pointers.notesMessageIds, obsolete.messageId],
    };
    const before = planDelivery(
      [{ ...registerOperation(), expectedPointers: oldPointers }, obsolete],
      [{ kind: "prepared" }, { kind: "prepared" }],
    );
    await h.seed({ ...deliveryRow(before), ...oldPointers });
    expect(
      await h.repository.transition({
        key,
        expectedDeliveryRevision: before.revision,
        attemptId: "attempt-1",
        ownerInstanceId: "synthetic-owner",
        change: {
          kind: "progress",
          revision: "unverified-retired",
          progress: { kind: "pending", nextCheckAt: now },
        },
      }),
    ).toBe("applied");
    const row = await h.read();
    expect(row?.notesMessageIds).toEqual(oldPointers.notesMessageIds);
    expect(row?.updateDelivery?.cleanupCandidates).toEqual([]);
    expect(row?.updateDelivery?.parts.notesBody.acknowledged).toBe(0);
  });
  it("reserves cleanup metadata capacity before claiming a pointer-changing plan", async () => {
    const h = current();
    const oldPointers = {
      ...pointers,
      notesMessageIds: [...pointers.notesMessageIds, "999999999999999994"],
    };
    const full = Array.from({ length: 300 }, (_, index) => ({
      sourceAttemptId: "prior",
      operationId: "delete-" + index,
      registrationOperationId: "register-prior",
      channelId: pointers.notesChannelId,
      messageId: "retained-" + index,
      beforeFingerprint: "b".repeat(64),
    }));
    const before = meetingUpdateDeliverySchema.parse({
      ...pending(),
      cleanupCandidates: full,
    });
    const row = { ...deliveryRow(before), ...oldPointers };
    await h.seed(row);
    const plan = preparedMeetingUpdateAttemptSchema.parse({
      ...attempt(),
      expectedPointers: oldPointers,
      operations: [
        { ...registerOperation(), expectedPointers: oldPointers },
        { ...deleteOperation, messageId: oldPointers.notesMessageIds[1] },
      ],
    });
    await expect(
      h.repository.claim({
        key,
        expectedContentRevision: 1,
        expectedDeliveryRevision: before.revision,
        attempt: plan,
        authority,
      }),
    ).rejects.toThrow(/capacity/);
    expect(await h.read()).toEqual(row);
  });
  it("removes retained metadata only after exact verified cleanup and captured completion", async () => {
    const h = current();
    const obsolete = { ...deleteOperation, messageId: "999999999999999994" };
    const candidate = {
      sourceAttemptId: "prior",
      operationId: "old-delete",
      registrationOperationId: "old-register",
      channelId: obsolete.channelId,
      messageId: obsolete.messageId,
      beforeFingerprint: obsolete.beforeFingerprint,
    };
    const active = meetingUpdateDeliverySchema.parse({
      ...planDelivery(
        [registerOperation(), obsolete],
        [verifiedState(), verifiedState()],
      ),
      cleanupCandidates: [candidate],
    });
    await h.seed(deliveryRow(active));
    expect(
      await h.repository.transition({
        key,
        expectedDeliveryRevision: active.revision,
        attemptId: "attempt-1",
        ownerInstanceId: "synthetic-owner",
        change: {
          kind: "complete",
          revision: "cleaned",
          attemptId: "attempt-1",
          completedAt: now + 2,
        },
      }),
    ).toBe("applied");
    expect((await h.read())?.updateDelivery).toMatchObject({
      cleanupCandidates: [],
      parts: { notesBody: { desired: 1, acknowledged: 1 } },
      progress: { kind: "synced" },
    });
    expect((await h.read())?.updateDeliveryQueue).toBeUndefined();
  });
}
