"use strict";
const { CoordinatorFailure } = require("./coordinator-aws.cjs");
function taskContainer(definition, tablePrefix) {
  const matches = definition.containerDefinitions.filter((container) =>
    container.environment?.some((entry) => entry.name === "DDB_TABLE_PREFIX"),
  );
  if (matches.length !== 1)
    throw new CoordinatorFailure(
      "configuration_invalid",
      "Expected one protocol container with an explicit table route",
    );
  const container = matches[0];
  const route = container.environment.filter(
    (entry) => entry.name === "DDB_TABLE_PREFIX",
  );
  if (route.length !== 1 || route[0].value !== tablePrefix)
    throw new CoordinatorFailure(
      "configuration_invalid",
      "Task table route mismatch",
    );
  return container;
}
function runtimeMode(container) {
  const command = JSON.stringify(container.command ?? ["npx", "yarn", "serve"]);
  const modes = {
    all: [
      ["npx", "yarn", "serve"],
      ["node", "dist/index.js"],
    ],
    bot: [
      ["npx", "yarn", "serve:bot"],
      ["node", "dist/apps/bot/main.js"],
    ],
    api: [
      ["npx", "yarn", "serve:api"],
      ["node", "dist/apps/api/main.js"],
    ],
  };
  if (container.entryPoint?.length)
    throw new CoordinatorFailure(
      "configuration_invalid",
      "Unreviewed task entry point",
    );
  for (const [mode, commands] of Object.entries(modes))
    if (commands.some((value) => JSON.stringify(value) === command))
      return mode;
  throw new CoordinatorFailure(
    "configuration_invalid",
    "Unreviewed task runtime command",
  );
}
function taskDefinitionInput(definition) {
  const next = structuredClone(definition);
  for (const field of [
    "taskDefinitionArn",
    "revision",
    "status",
    "requiresAttributes",
    "compatibilities",
    "registeredAt",
    "registeredBy",
    "deregisteredAt",
  ])
    delete next[field];
  return next;
}
function candidateDefinition(definition, config) {
  const next = taskDefinitionInput(definition);
  const container = taskContainer(next, config.tablePrefix);
  container.image = config.image;
  container.stopTimeout = 120;
  container.environment = container.environment.filter(
    (entry) => entry.name !== "DEPLOYMENT_CANDIDATE_ID",
  );
  container.environment.push({
    name: "DEPLOYMENT_CANDIDATE_ID",
    value: config.candidateId,
  });
  return next;
}
module.exports = {
  taskContainer,
  runtimeMode,
  taskDefinitionInput,
  candidateDefinition,
};
