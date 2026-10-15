#!/usr/bin/env node
"use strict";
const { unmarshall } = require("@aws-sdk/util-dynamodb");
const {
  parseManifest,
  awsCaller,
  readArguments,
} = require("./sandbox-manifest.cjs");
const HISTORY_FIELDS = [
  "guildId",
  "meetingId",
  "timestamp",
  "updatedAt",
  "status",
  "duration",
  "ownerInstanceId",
  "executionVersion",
  "transcribeMeeting",
  "generateNotes",
  "capture.kind",
  "captureCoverage.kind",
  "captureCoverage.savedDurationMs",
  "checkpoint.revision",
  "processing.transcription",
  "processing.notes",
  "processing.summary",
  "delivery.notes.outcome",
  "delivery.notes.sent",
  "delivery.notes.intended",
  "delivery.summary.outcome",
  "recovery.disposition",
  "recovery.stage",
  "recovery.attempt",
];
function projection(fields) {
  const names = {};
  const text = fields
    .map((path) =>
      path
        .split(".")
        .map((part) => {
          const alias = "#" + part;
          names[alias] = part;
          return alias;
        })
        .join("."),
    )
    .join(",");
  return { ProjectionExpression: text, ExpressionAttributeNames: names };
}
async function inspectRunningTasks(aws, m, service) {
  const arns = new Set();
  let nextToken;
  do {
    const page = await aws("ecs", "list-tasks", {
      cluster: m.cluster,
      serviceName: m.service,
      desiredStatus: "RUNNING",
      ...(nextToken ? { nextToken } : {}),
    });
    for (const arn of page.taskArns) arns.add(arn);
    if (arns.size > 1000)
      throw new Error("Task inventory exceeds observation bound");
    nextToken = page.nextToken;
  } while (nextToken);
  const tasks = [];
  const all = [...arns];
  for (let i = 0; i < all.length; i += 100) {
    const response = await aws("ecs", "describe-tasks", {
      cluster: m.cluster,
      tasks: all.slice(i, i + 100),
    });
    if (
      response.failures?.length ||
      response.tasks.length !== all.slice(i, i + 100).length
    )
      throw new Error("Task inventory incomplete");
    tasks.push(...response.tasks);
  }
  const running = tasks.filter((t) => t.lastStatus === "RUNNING");
  const expectedDigestTasks = running.filter(
    (t) =>
      t.containers?.find((c) => c.name === m.containerName)?.imageDigest ===
      m.imageDigest,
  ).length;
  let nativeProtectedTasks = 0;
  for (let i = 0; i < all.length; i += 10) {
    const response = await aws("ecs", "get-task-protection", {
      cluster: m.cluster,
      tasks: all.slice(i, i + 10),
    });
    if (
      response.failures?.length ||
      response.protectedTasks.length !== all.slice(i, i + 10).length
    )
      throw new Error("Native protection inventory incomplete");
    nativeProtectedTasks += response.protectedTasks.filter(
      (p) => p.protectionEnabled && Date.parse(p.expirationDate) > Date.now(),
    ).length;
  }
  return {
    expectedDigestTasks,
    nativeProtectedTasks,
    taskInventoryComplete:
      running.length === service.runningCount &&
      tasks.length === running.length,
  };
}

async function collectSandboxObservation(options) {
  const m = parseManifest(options.manifest, options.expectedSha256);
  const now = (options.now ?? Date.now)(),
    start = Date.parse(options.since),
    end = Date.parse(options.until);
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    end <= start ||
    end - start > 86400000 ||
    end > now ||
    new Date(start).toISOString() !== options.since ||
    new Date(end).toISOString() !== options.until ||
    now - end > 86400000
  )
    throw new Error(
      "An explicit current observation window of at most 24 hours is required",
    );
  const aws = options.aws ?? awsCaller(m.region);
  const actor = await aws("sts", "get-caller-identity", {});
  if (actor.Account !== m.accountId || actor.Arn !== m.principalArn)
    throw new Error("Observation identity mismatch");
  const svc = await aws("ecs", "describe-services", {
    cluster: m.cluster,
    services: [m.service],
  });
  if (
    svc.failures?.length ||
    svc.services?.length !== 1 ||
    svc.services[0].serviceName !== m.service
  )
    throw new Error("Service unavailable");
  async function scan(suffix, fields, filter) {
    const rows = [];
    let ExclusiveStartKey;
    for (let page = 0; page < 100; page++) {
      const r = await aws("dynamodb", "scan", {
        TableName: m.tablePrefix + suffix,
        ConsistentRead: true,
        Limit: 100,
        ...projection(fields),
        ...filter,
        ...(ExclusiveStartKey ? { ExclusiveStartKey } : {}),
      });
      rows.push(...(r.Items ?? []).map(unmarshall));
      ExclusiveStartKey = r.LastEvaluatedKey;
      if (!ExclusiveStartKey) return rows;
    }
    throw new Error("Observation scan incomplete; no complete result claimed");
  }
  const history = await scan("MeetingHistoryTable", HISTORY_FIELDS, {
    FilterExpression: "#timestamp >= :since AND #timestamp <= :until",
    ExpressionAttributeValues: {
      ":since": { S: options.since },
      ":until": { S: options.until },
    },
  });
  const leases = await scan("ActiveMeetingTable", [
    "guildId",
    "meetingId",
    "ownerInstanceId",
    "executionVersion",
    "leaseExpiresAt",
    "status",
  ]);
  const runtimes = await scan("DeploymentControlTable", [
    "pk",
    "sk",
    "recordType",
    "servingGeneration",
    "coordinatorExpiresAt",
    "role",
    "identity.imageDigest",
    "readiness.expiresAt",
    "protection.expiresAt",
    "workCounts.recording",
    "workCounts.finalization",
    "workCounts.recovery_processing",
    "workCounts.voice_operation",
    "workCounts.ancillary_delivery",
    "deployment.phase",
  ]);
  const controls = await scan("MeetingControlCommandTable", [
    "queueStatus",
    "expiresAt",
    "claimExpiresAt",
  ]);
  const cohort = history.filter(
    (r) => Date.parse(r.timestamp) >= start && Date.parse(r.timestamp) <= end,
  );
  const result = {
    records: cohort.length,
    staleCandidates: 0,
    partialTranscriptions: 0,
    failedTranscriptions: 0,
    requestedTranscription: 0,
    requestedNotes: 0,
    deliveredNotes: 0,
    uncertainDelivery: 0,
    recoveryRecords: 0,
  };
  for (const row of cohort) {
    const progress = Date.parse(row.updatedAt ?? row.timestamp);
    const active = leases.some(
      (l) =>
        l.guildId === row.guildId &&
        l.meetingId === row.meetingId &&
        l.ownerInstanceId === row.ownerInstanceId &&
        l.executionVersion === row.executionVersion &&
        l.leaseExpiresAt >= end / 1000,
    );
    if (
      ["starting", "in_progress", "processing"].includes(row.status) &&
      !active &&
      progress <= end - 900000
    )
      result.staleCandidates++;
    if (row.processing?.transcription === "partial")
      result.partialTranscriptions++;
    if (row.processing?.transcription === "failed")
      result.failedTranscriptions++;
    if (row.transcribeMeeting === true) result.requestedTranscription++;
    if (row.generateNotes === true) result.requestedNotes++;
    if (row.delivery?.notes?.outcome === "complete") result.deliveredNotes++;
    if (row.recovery?.disposition === "needs_reconciliation")
      result.uncertainDelivery++;
    if (row.recovery) result.recoveryRecords++;
  }
  const service = svc.services[0];
  const inventory = await inspectRunningTasks(aws, m, service);
  const health = {};
  for (const TargetGroupArn of [m.targetGroupA, m.targetGroupB]) {
    const response = await aws("elbv2", "describe-target-health", {
      TargetGroupArn,
    });
    for (const row of response.TargetHealthDescriptions) {
      const state = row.TargetHealth?.State;
      if (
        [
          "initial",
          "healthy",
          "unhealthy",
          "unhealthy.draining",
          "unused",
          "draining",
          "unavailable",
        ].includes(state)
      )
        health[state] = (health[state] ?? 0) + 1;
    }
  }
  const listener = await aws("elbv2", "describe-listeners", {
    ListenerArns: [m.listenerArn],
  });
  const action = listener.Listeners?.find(
    (l) => l.ListenerArn === m.listenerArn,
  )?.DefaultActions;
  const weights =
    action?.length === 1 && action[0].Type === "forward"
      ? action[0].ForwardConfig?.TargetGroups
      : undefined;
  const routing =
    weights?.length === 2 &&
    weights.every((g) =>
      [m.targetGroupA, m.targetGroupB].includes(g.TargetGroupArn),
    )
      ? {
          a: weights.find((g) => g.TargetGroupArn === m.targetGroupA)?.Weight,
          b: weights.find((g) => g.TargetGroupArn === m.targetGroupB)?.Weight,
        }
      : "UNKNOWN";
  return {
    schemaVersion: 1,
    environment: "sandbox",
    manifestSha256: options.expectedSha256,
    since: options.since,
    until: options.until,
    identityMatched: true,
    history: result,
    health,
    routing,
    runtime: {
      ...inventory,
      desired: service.desiredCount,
      running: service.runningCount,
      pending: service.pendingCount,
      preparedDefinitionSelected: service.taskDefinition === m.taskDefinition,
      runtimeRecords: runtimes.filter((r) => r.recordType === "runtime").length,
      staleReadiness: runtimes.filter(
        (r) =>
          r.recordType === "runtime" &&
          r.role === "serving" &&
          r.readiness?.expiresAt <= end / 1000,
      ).length,
      deploymentIncomplete: runtimes.some(
        (r) => r.deployment && r.deployment.phase !== "complete",
      ),
      unexpiredQueuedControls: controls.filter(
        (r) => r.queueStatus === "pending" && r.expiresAt >= end / 1000,
      ).length,
    },
    evidence: {
      crashRecovery: "NOT_OBSERVED",
      simultaneousMultiServerAdmission: "NOT_OBSERVED",
      scope:
        "Counts are signals for private follow-up, not proof of successful recovery or absence of failure.",
    },
  };
}
async function runCli(args = process.argv.slice(2), output = console) {
  try {
    if (args.length !== 8 || args[4] !== "--since" || args[6] !== "--until")
      throw new Error("Explicit time bounds required");
    const options = readArguments(args.slice(0, 4));
    output.log(
      JSON.stringify(
        await collectSandboxObservation({
          ...options,
          since: args[5],
          until: args[7],
        }),
      ),
    );
    return 0;
  } catch {
    output.error(
      JSON.stringify({
        kind: "observation_unavailable",
        completeness: "UNKNOWN",
      }),
    );
    return 1;
  }
}
module.exports = { collectSandboxObservation, runCli };
if (require.main === module)
  runCli().then((code) => {
    process.exitCode = code;
  });
