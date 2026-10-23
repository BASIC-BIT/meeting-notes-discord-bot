/** @jest-environment node */
import { test, expect } from "@jest/globals";
import {
  collectPages,
  collectNativeInventory,
} from "../../scripts/deployment/collector-inventory.cjs";
import { manifestFixture } from "../fixtures/deployment/productionIntroduction.js";
test("native inventories retain every page and reject repeated continuation tokens", async () => {
  const m = manifestFixture();
  let calls = 0;
  const result = await collectPages(
    async () => {
      calls++;
      return {
        taskArns: [String(calls)],
        ...(calls === 1 ? { nextToken: "next" } : {}),
      };
    },
    m,
    "ecs",
    "list-tasks",
    {},
    "taskArns",
    "nextToken",
    "nextToken",
  );
  expect(result.rows).toEqual(["1", "2"]);
  expect(result.pages).toHaveLength(2);
  await expect(
    collectPages(
      async () => ({ taskArns: [], nextToken: "same" }),
      m,
      "ecs",
      "list-tasks",
      {},
      "taskArns",
      "nextToken",
      "nextToken",
    ),
  ).rejects.toThrow(/cursor/);
});
test("native operation denial is a concrete collection prerequisite, not evidence of absence", async () => {
  const m = manifestFixture();
  await expect(
    collectNativeInventory({
      m,
      request: { taskArn: m.legacyTaskArn },
      aws: async () => {
        throw new Error("secret");
      },
    }),
  ).rejects.toThrow(/UNKNOWN: native ecs.list-tasks/);
});
